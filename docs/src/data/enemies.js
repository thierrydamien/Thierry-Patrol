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
    // A convoy-hunter picks the HAULER, not the pilot - and it may have to
    // climb to reach it, so the usual "always dives" floor is lifted here.
    const esc = e.huntsEscort && c.escort;
    const aim = esc || c.player;
    if(!e.locked && e.y > 40 && aim){
      e.lockX = aim.x; e.lockY = aim.y; e.locked = true;
      const dx = e.lockX - e.x, dy = esc ? (e.lockY - e.y) : Math.max(40, e.lockY - e.y);
      const l = Math.max(1, Math.hypot(dx, dy));
      e.vx = dx/l * e.speed * 1.5;
      e.vy = dy/l * e.speed * 1.5;
    }
    e.speedMul = Math.min(2.2, (e.speedMul || 1) + dt * 0.7);
    e.x += e.vx * e.speedMul * dt;
    e.y += e.vy * e.speedMul * dt;
  },

  /**
   * Holds a high line and sweeps across it. It never shoots - its job is the
   * bubble it projects over everything near it, which is applied in
   * updateEnemies. Kill it and the wave it was protecting opens up.
   */
  shielder(e, dt, c){
    if(e.state === 0){
      e.y += e.vy * dt;
      if(e.y >= e.hoverY){ e.y = e.hoverY; e.state = 1; e.vx = (Math.random()<0.5?-1:1) * e.speed * 0.55; }
    } else {
      e.x += e.vx * dt;
      if(e.x < 70 || e.x > c.VW - 70) e.vx *= -1;
      e.y += Math.sin(e.phase += dt) * 8 * dt;
    }
  },

  /**
   * Goes after your money. Picks the nearest loose coin, hoovers it up, and
   * once it is carrying enough it runs for the top of the screen. Shoot it
   * down and it drops everything it stole; let it go and that cash is gone.
   */
  thief(e, dt, c){
    if(e.fleeing){
      e.y -= e.speed * 1.35 * dt;
      return;
    }
    let target = null, bestD = 1e9;
    const items = c.pickups ? c.pickups.items : null;
    if(items){
      for(let i=0;i<items.length;i++){
        const it = items[i];
        if(!it.alive || it.kind !== "coin") continue;
        const d = (it.x-e.x)*(it.x-e.x) + (it.y-e.y)*(it.y-e.y);
        if(d < bestD){ bestD = d; target = it; }
      }
    }
    if(target){
      const dx = target.x - e.x, dy = target.y - e.y;
      const l = Math.max(1, Math.hypot(dx, dy));
      e.x += dx/l * e.speed * 1.25 * dt;
      e.y += dy/l * e.speed * 1.25 * dt;
      if(l < e.r + 12){
        target.alive = false;
        e.loot = (e.loot || 0) + target.value;
        e.stolen = (e.stolen || 0) + 1;
        if(e.stolen >= 4) e.fleeing = true;
      }
    } else {
      // Nothing to steal yet: drift down the screen looking for some.
      e.y += e.speed * 0.55 * dt;
      e.x += Math.sin(e.phase += dt*1.6) * 90 * dt;
      if(e.y > c.VH * 0.72) e.fleeing = true;
    }
    e.patience = (e.patience || 0) + dt;
    if(e.patience > 11) e.fleeing = true;
  },

  /**
   * Parks near the top and takes deliberate, telegraphed shots. `charge`
   * counts up while it aims - the renderer draws the line it is about to
   * fire down, so you always get a moment to step out of it.
   */
  sniper(e, dt, c){
    if(e.state === 0){
      e.y += e.vy * dt;
      if(e.y >= e.hoverY){ e.y = e.hoverY; e.state = 1; }
      return;
    }
    e.x += Math.sin(e.phase += dt*0.7) * 26 * dt;
    e.charge = (e.charge || 0) + dt;
    if(e.charge >= e.chargeTime){
      e.charge = 0;
      if(c.player && c.world){
        const dx = c.player.x - e.x, dy = c.player.y - e.y;
        const l = Math.max(1, Math.hypot(dx, dy));
        c.world.spawnEnemyBullet(e.x, e.y + e.r, dx/l*430, dy/l*430, "aimed", 5.5);
      }
    }
  },

  /**
   * Matches your column and comes down on top of you. Unlike a kamikaze it
   * never commits - it keeps correcting, so you have to actually break the
   * lock by moving rather than just sidestepping once.
   */
  intercept(e, dt, c){
    const esc = e.huntsEscort && c.escort;
    const aim = esc || c.player;
    const target = aim ? aim.x : c.VW/2;
    e.x = lerp(e.x, target, Math.min(1, dt * (1.1 + c.smart*0.35)));
    // Hunting the convoy means holding ITS line, not sinking past it.
    if(esc) e.y += (esc.y - e.y) * Math.min(1, dt*1.1);
    else e.y += e.vy * (e.y > c.VH*0.5 ? 1.25 : 0.85) * dt;
  },

  /**
   * Lays mines and lumbers on. The mines are the point: they turn a corner
   * of the screen into somewhere you can't fly for a while.
   */
  bomber(e, dt, c){
    e.y += e.vy * 0.75 * dt;
    e.x += Math.sin(e.phase += dt*0.8) * 60 * dt;
    e.dropTimer = (e.dropTimer || 1.2) - dt;
    if(e.dropTimer <= 0 && c.world && e.y > 40 && e.y < c.VH*0.7){
      e.dropTimer = 2.4;
      const m = c.world.spawnEnemy("mine", e.x, e.y + 18, { difficulty: c.difficulty, uncounted: true });
      m.vy = 34;
    }
  },

  /** A dropped mine: drifts, arms, then goes off on its own if you leave it. */
  mine(e, dt, c){
    e.y += e.vy * dt;
    e.fuse = (e.fuse || 0) + dt;
    if(e.fuse > 9) e.hp = 0;      // resolved as a kill next collision pass
  },

  /**
   * Hangs back and keeps making more of them. Left alone the screen fills up,
   * so it is the thing you should be shooting even though it never shoots you.
   */
  hive(e, dt, c){
    if(e.state === 0){
      e.y += e.vy * dt;
      if(e.y >= e.hoverY){ e.y = e.hoverY; e.state = 1; }
      return;
    }
    e.x += Math.sin(e.phase += dt*0.6) * 40 * dt;
    e.dropTimer = (e.dropTimer || 2.2) - dt;
    if(e.dropTimer <= 0 && c.world){
      e.dropTimer = 2.8;
      const d = c.world.spawnEnemy("shard", e.x, e.y + 14, { difficulty: c.difficulty, uncounted: true });
      d.vy = 150;
    }
  },

  /**
   * Repairs whatever near it is hurt. Pairs with the Guardian as the other
   * "shoot this one first" answer - except a Mender undoes work you have
   * already done, which is more annoying and therefore more motivating.
   */
  mender(e, dt, c){
    e.y += e.vy * (e.y < e.hoverY ? 1 : 0.15) * dt;
    e.healTarget = null;
    if(!c.world) return;
    const items = c.world.enemies.items;
    let best = null, bestD = 200*200;
    for(let i=0;i<items.length;i++){
      const o = items[i];
      if(!o.alive || o === e || o.hp >= o.maxHp || o.type.heals) continue;
      const d = (o.x-e.x)*(o.x-e.x) + (o.y-e.y)*(o.y-e.y);
      if(d < bestD){ bestD = d; best = o; }
    }
    if(best){
      e.healTarget = best;
      best.hp = Math.min(best.maxHp, best.hp + best.maxHp * 0.22 * dt);
    }
  },

  /** A rock. Tumbles down on a fixed drift - no thinking, just mass. */
  tumble(e, dt){
    e.y += e.vy * dt;
    e.x += e.vx * dt;
    e.spin = (e.spin || 0) + dt * (e.spinRate || 1);
  },

  /**
   * Drops in, then patrols its line shelling the playfield. It has a tour of
   * duty: once that expires it leaves under its own power. Nothing may park on
   * the field forever - a permanent enemy the player can't reach would stall
   * the mission, since a mission only ends when the field is clear.
   */
  turret(e, dt, c){
    if(e.state === 0){
      e.y += e.vy * dt;
      if(e.y >= e.hoverY){
        e.y = e.hoverY;
        e.state = 1;
        e.stateTimer = 16 + Math.random()*8;
        if(!e.vx) e.vx = (Math.random() < 0.5 ? -1 : 1) * (55 + Math.random()*45);
      }
    } else if(e.state === 1){
      e.x += e.vx * dt;
      if(e.x < 44 || e.x > c.VW - 44) e.vx *= -1;
      e.stateTimer -= dt;
      if(e.stateTimer <= 0) e.state = 2;
    } else {
      e.y += e.vy * 1.2 * dt;
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
    fire:{ pattern:"straight", every:[2.0,3.4], speed:255 },
  },
  weaver: {
    name:"Weaver", behaviour:"weave", hp:1, r:13, size:42, speed:120,
    score:7, money:7, tint:"#ff9d4a",
    fire:{ pattern:"straight", every:[2.1,3.5], speed:245 },
  },
  striker: {
    name:"Striker", behaviour:"hover", hp:2, r:15, size:46, speed:162,
    score:10, money:10, tint:"#a855f7",
    fire:{ pattern:"aimed", every:[1.2,1.9], speed:280 },
  },
  swooper: {
    name:"Swooper", behaviour:"swoop", hp:2, r:15, size:44, speed:188,
    score:12, money:11, tint:"#4ade80",
    fire:{ pattern:"straight", every:[1.3,2.2], speed:268 },
  },
  kamikaze: {
    name:"Kamikaze", behaviour:"kamikaze", hp:1, r:13, size:40, speed:212,
    score:14, money:13, tint:"#ff2d55", fire:null,
  },
  turret: {
    name:"Gun Platform", behaviour:"turret", hp:5, r:20, size:62, speed:88,
    score:24, money:24, tint:"#60a5fa",
    fire:{ pattern:"spread3", every:[1.5,2.2], speed:245 },
    toughSeconds:1.0,          // an emplacement should have to be *reduced*
  },
  brute: {
    name:"Brute", behaviour:"brute", hp:6, r:21, size:64, speed:88,
    score:26, money:26, tint:"#f43f5e",
    fire:{ pattern:"spread3", every:[1.9,2.9], speed:232 },
    toughSeconds:1.2,          // armour that armour-piercing rounds matter for
  },
  carrier: {
    name:"Prison Hauler", behaviour:"carrier", hp:8, r:23, size:72, speed:76,
    score:40, money:42, tint:"#facc15", carriesRescue:true,
    toughSeconds:1.2,          // a hauler should cross real sky before it pops
    fire:{ pattern:"straight", every:[2.6,3.6], speed:220 },
  },

  /* --- the ones that change how you play, not just what you shoot --- */

  shielder: {
    name:"Guardian", behaviour:"shielder", hp:7, r:20, size:60, speed:120,
    score:34, money:34, tint:"#22d3ee", fire:null,
    toughSeconds:1.1,          // the bubble has to exist before it can be popped
    shieldRadius:135,          // everything inside this is untouchable
  },
  splitter: {
    name:"Splitter", behaviour:"dive", hp:4, r:19, size:58, speed:118,
    score:20, money:18, tint:"#4ade80",
    toughSeconds:0.6,
    splitsInto:{ type:"shard", n:3 },
    fire:{ pattern:"straight", every:[2.0,3.2], speed:240 },
  },
  shard: {
    name:"Shard", behaviour:"kamikaze", hp:1, r:10, size:30, speed:230,
    score:6, money:5, tint:"#86efac", fire:null,
  },
  thief: {
    name:"Coin Thief", behaviour:"thief", hp:3, r:15, size:46, speed:190,
    score:18, money:16, tint:"#facc15", fire:null,
    toughSeconds:0.7,          // stealing takes time; catching him must too
  },
  asteroid: {
    name:"Asteroid", behaviour:"tumble", hp:9, r:26, size:74, speed:104,
    score:8, money:14, tint:"#94a3b8", fire:null,
    hazard:true,               // scenery, not opposition: never counted as a kill
    toughSeconds:1.1,          // sized from your guns, so it stays an obstacle
  },
  /*
   * The big one. Deliberately slow to kill: a boulder is a decision, not a
   * target. Break it and you get three asteroids and a real payout; leave it
   * and you have to fly around a rock the size of your ship for ten seconds.
   */
  sniper: {
    name:"Marksman", behaviour:"sniper", hp:3, r:16, size:50, speed:130,
    score:22, money:20, tint:"#f472b6", fire:null,
    toughSeconds:0.7,
    chargeTime:1.7,            // long enough to see the line and move
  },
  interceptor: {
    name:"Interceptor", behaviour:"intercept", hp:2, r:14, size:44, speed:150,
    score:16, money:15, tint:"#fb923c",
    fire:{ pattern:"straight", every:[1.6,2.6], speed:270 },
  },
  bomber: {
    name:"Minelayer", behaviour:"bomber", hp:9, r:22, size:68, speed:96,
    score:32, money:32, tint:"#a3e635", fire:null,
    toughSeconds:0.9,          // it exists to leave mines behind - let it
  },
  mine: {
    name:"Mine", behaviour:"mine", hp:1, r:12, size:30, speed:34,
    score:3, money:3, tint:"#ef4444", fire:null,
  },
  hive: {
    name:"Hive", behaviour:"hive", hp:11, r:24, size:76, speed:104,
    score:44, money:44, tint:"#c084fc", fire:null,
    toughSeconds:1.1,          // a hive that never hatches is just a target
  },
  mender: {
    name:"Mender", behaviour:"mender", hp:6, r:19, size:56, speed:110,
    score:30, money:30, tint:"#34d399", fire:null,
    toughSeconds:1.0,          // the heal beam is the whole point
    heals:true,
  },
  boulder: {
    name:"Boulder", behaviour:"tumble", hp:52, r:50, size:142, speed:62,
    score:60, money:95, tint:"#94a3b8", fire:null,
    hazard:true, tough:true,
    toughSeconds:5,            // five seconds of concentrated fire, at any gear level
    splitsInto:{ type:"asteroid", n:3 },
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
  /*
   * A trench gate: a rank of blocks wall-to-wall with ONE gap two slots
   * wide, sized so a ship fits through with room to be imperfect. The gap
   * placement is the whole level - "gate" rolls it fresh each wave, so the
   * player reads the wall, finds the hole, and commits. Built from boulders,
   * so a maxed ship can BLAST a second hole instead: weave or dig, both work.
   */
  gate(n, VW){
    const slots = n + 2;                        // n blocks + a 2-slot gap
    const gapAt = randInt(0, slots - 2);        // gap can hug an edge
    const gap = VW / slots;
    const out = [];
    let placed = 0;
    for(let s = 0; s < slots; s++){
      if(s === gapAt || s === gapAt + 1) continue;
      out.push({ x: gap*(s + 0.5), y: -70, delay: placed*0.02 });
      placed++;
    }
    return out;
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
