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
const { clamp, lerp, rand } = SF.core;

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
    e.x = clamp(e.x, 16, c.VW - 16);
  },

  /** Drops to a hover line, holds station and shoots, then leaves. */
  hover(e, dt, c){
    if(e.state === 0){
      e.y += e.vy * dt;
      if(e.y >= e.hoverY){ e.y = e.hoverY; e.state = 1; e.stateTimer = e.hoverTime; }
    } else if(e.state === 1){
      e.x += Math.sin(e.phase += dt * 1.2) * 26 * dt;
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
      if(e.x < 30 || e.x > c.VW - 30) e.vx *= -1;
    }
  },

  /** Big, slow, and on smarter tiers it strafes away from your fire. */
  brute(e, dt, c){
    e.y += e.vy * dt;
    if(c.smart >= 1 && c.player){
      const away = e.x < c.player.x ? -1 : 1;
      e.x = clamp(e.x + away * 22 * c.smart * dt, 24, c.VW - 24);
    }
  },

  /** Carries a rescue pod - flees toward the bottom, so you must hurry. */
  carrier(e, dt, c){
    e.y += e.vy * dt;
    e.x += Math.sin(e.phase += dt) * 18 * dt;
  },
};

/* ---------------------------------------------------------
   ARCHETYPES
   hp/score/money are base values; difficulty scales them.
   fire: null, or { pattern, every:[min,max], speed, count }
   --------------------------------------------------------- */
const ENEMY_TYPES = {
  grunt: {
    name:"Grunt", behaviour:"dive", hp:1, r:11, size:34, speed:110,
    score:5, money:6, tint:null,
    fire:{ pattern:"straight", every:[2.4,4.0], speed:210 },
  },
  weaver: {
    name:"Weaver", behaviour:"weave", hp:1, r:11, size:34, speed:95,
    score:7, money:7, tint:"#ff9d4a",
    fire:{ pattern:"straight", every:[2.6,4.2], speed:200 },
  },
  striker: {
    name:"Striker", behaviour:"hover", hp:2, r:12, size:38, speed:130,
    score:10, money:10, tint:"#a855f7",
    fire:{ pattern:"aimed", every:[1.4,2.2], speed:230 },
  },
  swooper: {
    name:"Swooper", behaviour:"swoop", hp:2, r:12, size:36, speed:150,
    score:12, money:11, tint:"#4ade80",
    fire:{ pattern:"straight", every:[2.0,3.2], speed:220 },
  },
  kamikaze: {
    name:"Kamikaze", behaviour:"kamikaze", hp:1, r:11, size:32, speed:170,
    score:14, money:13, tint:"#ff2d55", fire:null,
  },
  turret: {
    name:"Gun Platform", behaviour:"turret", hp:5, r:16, size:50, speed:70,
    score:24, money:24, tint:"#60a5fa",
    fire:{ pattern:"spread3", every:[1.8,2.6], speed:200 },
  },
  brute: {
    name:"Brute", behaviour:"brute", hp:6, r:17, size:52, speed:70,
    score:26, money:26, tint:"#f43f5e",
    fire:{ pattern:"spread3", every:[2.2,3.4], speed:190 },
  },
  carrier: {
    name:"Prison Hauler", behaviour:"carrier", hp:8, r:19, size:58, speed:60,
    score:40, money:42, tint:"#facc15", carriesRescue:true,
    fire:{ pattern:"straight", every:[2.6,3.6], speed:180 },
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
const FORMATIONS = {
  line(n, VW){
    const gap = Math.min(58, (VW - 80) / Math.max(1, n - 1));
    const startX = VW/2 - gap*(n-1)/2;
    return Array.from({length:n}, (_,i) => ({ x: startX + i*gap, y: -30, delay: i*0.08 }));
  },
  vee(n, VW){
    const gap = 42, out = [];
    for(let i = 0; i < n; i++){
      const side = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i/2) + 1;
      out.push({ x: VW/2 + side*rank*gap*0.7, y: -30 - rank*26, delay: i*0.06 });
    }
    return out;
  },
  arc(n, VW){
    return Array.from({length:n}, (_,i) => {
      const t = n === 1 ? 0.5 : i/(n-1);
      return { x: 40 + t*(VW-80), y: -30 - Math.sin(t*Math.PI)*50, delay: i*0.09 };
    });
  },
  column(n, VW){
    const x = rand(60, VW-60);
    return Array.from({length:n}, (_,i) => ({ x, y: -30 - i*54, delay: i*0.12 }));
  },
  twinColumns(n, VW){
    return Array.from({length:n}, (_,i) => ({
      x: i % 2 === 0 ? VW*0.25 : VW*0.75,
      y: -30 - Math.floor(i/2)*52, delay: i*0.1,
    }));
  },
  sides(n, VW){
    return Array.from({length:n}, (_,i) => ({
      x: i % 2 === 0 ? 40 : VW-40,
      y: -30 - Math.floor(i/2)*46, delay: i*0.14,
    }));
  },
  scatter(n, VW){
    return Array.from({length:n}, (_,i) => ({ x: rand(34, VW-34), y: -30 - rand(0,120), delay: i*0.16 }));
  },
};

SF.enemyData = { BEHAVIOURS, ENEMY_TYPES, ELITE, FORMATIONS };
})();
