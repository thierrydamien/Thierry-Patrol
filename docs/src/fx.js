/*
 * ParticleManager + screen effects: the "juice" layer.
 *
 * Everything here is pooled and allocation-free in the hot path. Gameplay code
 * never news up an effect - it calls SF.fx.explosion(...) and forgets.
 *
 * Screen-level feel lives here too: shake, hit-stop (a few frozen frames on a
 * big impact, the single cheapest trick for making hits land) and full-screen
 * flashes.
 */
(function(){
"use strict";
const SF = window.SF;
const { Pool, rand, randInt, clamp, TAU } = SF.core;

const particles  = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,life:0,max:1,size:2,color:"#fff",
                                     kind:"spark", drag:0.94, gravity:0, spin:0, angle:0, delay:0,
                                     edge:null }), 900);
const texts      = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:-34,gravity:0,pop:0,
                                     life:0,max:0.9,text:"",color:"#fff",size:14,bold:true,
                                     rise:false }), 80);
const rings      = new Pool(() => ({ alive:false, x:0,y:0,life:0,max:0.45,r0:6,r1:60,color:"#fff",width:3,delay:0 }), 40);
/*
 * LIGHT SOURCES.
 *
 * An explosion used to emit particles and illuminate nothing - the world
 * around it never noticed, which is most of the visible difference between
 * "drawn effects" and "things happening in a place". A light is a position, a
 * radius, a colour and a short life, drawn as an additive pool UNDER the ships
 * (after the scenery, before the entities), so a kill briefly lights the dust
 * around it, the canyon wall beside it, anything dark enough to catch it. The
 * bright pixels then feed the lens glow for free: a light both illuminates and
 * blooms.
 *
 * Deliberately NOT hooked to the guns. At ten shots a second a muzzle light is
 * a 10Hz strobe, which is squarely inside the band Calmer Visuals exists to
 * avoid. Explosions are events; triggers are not.
 *
 * Every light is spawned with FIXED parameters - no random draws. explosion()
 * is called from the seeded kill path, and a light that rolled a number there
 * would move every spawn point downstream of it.
 */
const lights     = new Pool(() => ({ alive:false, x:0,y:0, r:90, life:0, max:0.34,
                                     color:"255,190,110", peak:0.34 }), 48);

let shakeMag = 0, shakeDecay = 26;
let flashAlpha = 0, flashColor = "255,60,80";
let hitStopUntil = 0;
let nowMs = 0;

/*
 * STAGING.
 *
 * A real explosion doesn't happen all at once - the flash is instant, the
 * fireball takes a beat to bloom, and the smoke is what's left when the fire
 * has burned down. Emitting all of it on one frame is what makes a game
 * explosion read as a puff.
 *
 * The staging must not touch WHEN the random numbers are drawn, only when the
 * result becomes visible: every emitter here draws from the seeded simulation
 * stream (see core.js), and deferring a draw to a later frame would reorder
 * that stream and move gameplay far away from here. So the particles are all
 * born on the death frame exactly as before, and simply hold still and stay
 * invisible until their delay runs out.
 *
 * `spawnDelay` is stamped onto everything spawned inside an `at()` block,
 * which keeps six public emitter signatures unchanged.
 */
let spawnDelay = 0;
function at(d, fn){ const prev = spawnDelay; spawnDelay = d; fn(); spawnDelay = prev; }
/* `edge` is cleared HERE rather than at each call site: these objects are
   pooled and reused, so a shed armour panel that set it would otherwise hand
   an outline to whatever plain speck inherited its slot next. */
function pspawn(){ const p = particles.spawn(); p.delay = spawnDelay; p.edge = null; return p; }
function rspawn(){ const r = rings.spawn();     r.delay = spawnDelay; return r; }

/* ---------------------------------------------------------
   EMITTERS
   --------------------------------------------------------- */
function spark(x, y, vx, vy, color, life, size){
  const p = pspawn();
  p.x=x; p.y=y; p.vx=vx; p.vy=vy; p.color=color; p.life=0; p.max=life; p.size=size;
  p.kind="spark"; p.drag=0.93; p.gravity=0; p.spin=0; p.angle=0;
  return p;
}

/** A burst of sparks - the generic "something got hit" puff. */
function sparks(x, y, n, color, speed){
  speed = speed || 120;
  // Coin pickups arrive here from the collision layer with this exact
  // signature (used nowhere else). Recognising it locally keeps the call
  // site - and the seeded randoms its three sparks draw - untouched.
  if(n === 3 && speed === 90 && color === "#ffd23f") coinBurst(x, y);
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), s = rand(speed*0.3, speed);
    spark(x, y, Math.cos(a)*s, Math.sin(a)*s, color, rand(0.18,0.42), rand(1.5,3));
  }
}

/*
 * The coin's own moment: a golden pop and a few embers drifting up off the
 * pickup point. Rate-limited the way the coin sound is - at coin-rain
 * density one flourish per beat reads richer than twenty - and drawn from
 * Math.random only, so it can never perturb the seeded simulation stream.
 */
let coinFxAt = -1e9;
function coinBurst(x, y){
  if(nowMs - coinFxAt < 70) return;
  coinFxAt = nowMs;
  const p = pspawn();
  p.x=x; p.y=y; p.life=0; p.max=0.1; p.size=10;
  p.color="#ffd23f"; p.kind="flash"; p.vx=0; p.vy=0; p.drag=1; p.gravity=0; p.spin=0; p.angle=0;
  const n = Math.random() < 0.5 ? 2 : 3;
  for(let i=0;i<n;i++){
    const e = pspawn();
    e.x = x + mrand(-3,3); e.y = y + mrand(-2,2);
    e.vx = mrand(-22,22); e.vy = mrand(-95,-45);
    e.color = Math.random() < 0.5 ? "#ffd23f" : "#ffe9a8";
    e.life=0; e.max=mrand(0.35,0.6); e.size=mrand(1.4,2.2);
    e.kind="ember"; e.drag=0.96; e.gravity=70; e.spin=0; e.angle=mrand(0,TAU);
  }
}

/**
 * Directional impact: sparks spray *back along the shot*, the way metal
 * actually behaves. An omnidirectional puff reads as "near a hit"; a cone
 * pointing back at the gun reads as "MY shot did that".
 */
function impact(x, y, vx, vy, color, n){
  const l = Math.max(1, Math.hypot(vx, vy));
  const bx = -vx/l, by = -vy/l;                  // back along the bullet
  const base = Math.atan2(by, bx);
  for(let i=0;i<(n||5);i++){
    const a = base + rand(-0.55, 0.55);
    const s = rand(90, 260);
    spark(x, y, Math.cos(a)*s, Math.sin(a)*s, i===0 ? "#ffffff" : color, rand(0.12,0.3), rand(1.5,3));
  }
}

/*
 * Decoration's own random source. core.js asks cosmetic code to draw from
 * Math.random so it can never perturb the seeded simulation stream; the
 * emitters below predate that rule and still draw from `rand`, which is
 * harmless as long as they are called in a fixed order. Anything NEW here
 * takes this instead, so adding a flourish can't move a spawn point three
 * minutes later in the mission.
 */
function mrand(a, b){ return a + Math.random()*(b - a); }

/**
 * Rolling fireball cores - the orange heart of an explosion. `rnd` swaps the
 * random source: purely decorative callers pass `mrand` to stay off the
 * simulation stream.
 */
function fireball(x, y, n, size, rnd){
  const rand = rnd || SF.core.rand;
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), d = rand(0, size*0.4);
    const p = pspawn();
    p.x=x+Math.cos(a)*d; p.y=y+Math.sin(a)*d;
    p.vx=Math.cos(a)*rand(10,60); p.vy=Math.sin(a)*rand(10,60)-20;
    p.life=0; p.max=rand(0.28,0.55); p.size=rand(size*0.22, size*0.4);
    p.kind="fire"; p.drag=0.95; p.gravity=-30; p.spin=0; p.angle=0; p.color="";
  }
}

/** Glowing embers that linger and flicker after the fireball is gone. */
function embers(x, y, n){
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), s = rand(30, 150);
    const p = pspawn();
    p.x=x; p.y=y; p.vx=Math.cos(a)*s; p.vy=Math.sin(a)*s - 40;
    p.color = Math.random() < 0.5 ? "#ffd23f" : "#ff8a3d";
    p.life=0; p.max=rand(0.5,1.1); p.size=rand(1.2,2.6);
    p.kind="ember"; p.drag=0.97; p.gravity=140; p.spin=0; p.angle=rand(0,TAU);
  }
}

/** Chunky wreckage that tumbles and falls - sells a kill far better than dots. */
function debris(x, y, n, color){
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), s = rand(40, 190);
    const p = pspawn();
    p.x=x; p.y=y; p.vx=Math.cos(a)*s; p.vy=Math.sin(a)*s - 30;
    p.color=color; p.life=0; p.max=rand(0.5,1.0); p.size=rand(2.5,5.5);
    p.kind="debris"; p.drag=0.985; p.gravity=210; p.angle=rand(0,TAU); p.spin=rand(-9,9);
  }
}

function smoke(x, y, n, color){
  for(let i=0;i<n;i++){
    const p = pspawn();
    p.x=x+rand(-6,6); p.y=y+rand(-6,6); p.vx=rand(-18,18); p.vy=rand(10,44);
    p.color=color||"#6b6b78"; p.life=0; p.max=rand(0.5,1.1); p.size=rand(3,7);
    p.kind="smoke"; p.drag=0.97; p.gravity=0; p.spin=0; p.angle=0;
  }
}

/** Expanding shockwave ring - reserved for big events so it stays special. */
function ring(x, y, r1, color, width, life){
  const r = rspawn();
  r.x=x; r.y=y; r.life=0; r.max=life||0.45; r.r0=6; r.r1=r1; r.color=color; r.width=width||3;
}

/**
 * A soft dome of light that swells and dies - the glow kick under a big
 * death. The fireball is made of small hot cores and reads as detail; this is
 * the one wide, shapeless burst of brightness, and it's most of why a big
 * kill should land differently from a small one with the sound off.
 */
function bloom(x, y, size, life){
  const p = pspawn();
  p.x=x; p.y=y; p.life=0; p.max=life||0.34; p.size=size;
  p.kind="bloom"; p.color="#fff"; p.vx=0; p.vy=0; p.drag=1; p.gravity=0; p.spin=0; p.angle=0;
}

/*
 * HOW A PARTICULAR THING COMES APART.
 *
 * One staged explosion used to serve all twenty-six archetypes, so the last
 * frame a player ever saw of an enemy was the one frame where every enemy in
 * the game looked identical - a Brute in plate armour went out exactly like a
 * Grunt. These are the differences, and they are strictly ADDITIVE: the five
 * base emitters below still run, in their order, drawing their count of
 * simulation randoms. Everything here takes `mrand` (Math.random) so it stays
 * off the seeded stream entirely and a death can never move a wave script.
 *
 * Keyed off what a thing IS rather than which type it is, so a new archetype
 * inherits the right one by describing itself (see the `death` field in
 * enemies.js).
 */
const DEATHS = {
  /* Armour comes off in panels. Big, slow, heavy, and they fall. */
  plate(x, y, size, color){
    const n = 5 + Math.floor(mrand(0, 3));
    for(let i=0;i<n;i++){
      const a = mrand(0, TAU), sp = mrand(60, 165);
      const p = pspawn();
      p.x = x + Math.cos(a)*size*0.2; p.y = y + Math.sin(a)*size*0.2;
      p.vx = Math.cos(a)*sp; p.vy = Math.sin(a)*sp - 55;
      p.color = "#7d8798";                       // bare metal, not the ship's tint
      p.edge = "#d8e2f2";                        // the lit face, so it reads as metal
      p.life = 0; p.max = mrand(0.6, 1.0); p.size = size*mrand(0.10, 0.18);
      p.kind = "debris"; p.drag = 0.988; p.gravity = 250;
      p.angle = mrand(0, TAU); p.spin = mrand(-3.5, 3.5);
    }
    at(0.05, () => ring(x, y, size*0.9, "#dfe6f5", 2, 0.26));
  },
  /* A hive does not explode so much as evacuate. */
  burst(x, y, size, color){
    for(let i=0;i<16;i++){
      const a = (i/16)*TAU + mrand(-0.12, 0.12), sp = mrand(150, 290);
      const p = pspawn();
      p.x = x; p.y = y; p.vx = Math.cos(a)*sp; p.vy = Math.sin(a)*sp;
      p.color = i % 4 === 0 ? "#ffffff" : color;
      p.life = 0; p.max = mrand(0.4, 0.8); p.size = mrand(1.6, 3.0);
      p.kind = "ember"; p.drag = 0.93; p.gravity = 30; p.spin = 0; p.angle = 0;
    }
    at(0.10, () => ring(x, y, size*1.6, color, 2.5, 0.42));
  },
  /*
   * The one that was already two things - but a Splitter drops three REAL
   * shard enemies on death, so this must not also draw chunks: the first
   * version threw two slabs a fifth the size of the ship and they read as
   * orange bars parked over the fireball, competing with the actual shards
   * arriving underneath them. What is left is the SEAM - a hard lateral tear
   * and two small pieces leaving sideways, which says "it came apart"
   * without pretending to be the halves.
   */
  split(x, y, size, color){
    at(0.02, () => {
      const r = rspawn();
      r.x = x; r.y = y; r.life = 0; r.max = 0.18;
      r.r0 = 4; r.r1 = size*0.85; r.color = "#fff6e0"; r.width = 2;
    });
    [-1, 1].forEach(side => {
      const p = pspawn();
      p.x = x + side*size*0.12; p.y = y;
      p.vx = side*mrand(190, 280); p.vy = mrand(-40, 20);
      p.color = color;
      p.edge = "rgba(255,246,224,0.9)";
      p.life = 0; p.max = mrand(0.35, 0.55); p.size = size*mrand(0.09, 0.13);
      p.kind = "debris"; p.drag = 0.985; p.gravity = 240;
      p.angle = mrand(0, TAU); p.spin = side*mrand(7, 13);
      at(0.06, () => fireball(x + side*size*0.34, y + 4, 1, size*0.34, mrand));
    });
  },
  /* Rock does not burn. It goes to gravel. */
  shatter(x, y, size, color){
    const n = 8 + Math.floor(mrand(0, 4));
    for(let i=0;i<n;i++){
      const a = mrand(0, TAU), sp = mrand(70, 230);
      const p = pspawn();
      p.x = x; p.y = y; p.vx = Math.cos(a)*sp; p.vy = Math.sin(a)*sp - 20;
      p.color = mrand(0,1) < 0.35 ? "#e8eef8" : "#8b8f9c";
      p.life = 0; p.max = mrand(0.6, 1.1); p.size = mrand(2, 5.5);
      p.kind = "debris"; p.drag = 0.988; p.gravity = 260;
      p.angle = mrand(0, TAU); p.spin = mrand(-11, 11);
    }
  },
  /* Something electrical letting go: a hard white arc, then it dies dark. */
  fizz(x, y, size, color){
    at(0.02, () => ring(x, y, size*0.7, "#cfe9ff", 3, 0.16));
    at(0.12, () => ring(x, y, size*1.25, "#7cc4ff", 1.5, 0.3));
    for(let i=0;i<7;i++){
      at(mrand(0.02, 0.3), () => {
        const a = mrand(0, TAU), d = size*mrand(0.15, 0.55);
        sparksAt(x + Math.cos(a)*d, y + Math.sin(a)*d, 3, "#bfe4ff", 200);
      });
    }
  },
};

/* The spark emitter, off the seeded stream - the flourishes need one. */
function sparksAt(x, y, n, color, speed){
  for(let i=0;i<n;i++){
    const a = mrand(0, TAU), sp = mrand(speed*0.35, speed);
    const p = pspawn();
    p.x=x; p.y=y; p.vx=Math.cos(a)*sp; p.vy=Math.sin(a)*sp;
    p.color=color; p.life=0; p.max=mrand(0.16,0.34); p.size=mrand(1.2,2.4);
    p.kind="ember"; p.drag=0.9; p.gravity=0; p.spin=0; p.angle=0;
  }
}

/**
 * The standard enemy death, staged across about a quarter of a second: white
 * pop and thrown wreckage on the frame itself, the fireball a beat later,
 * embers as it burns down, smoke last of all.
 *
 * The five emitters are still called in their original order, and still draw
 * the same count of simulation randoms - reordering them would reorder every
 * seeded draw downstream of this death. Only the delays are new; the extra
 * flourishes below take `mrand` so they stay off that stream entirely.
 *
 * `style` names one of DEATHS and is layered on top, never in place of.
 */
function explosion(x, y, size, color, big, style){
  // The kill lights its neighbourhood.
  light(x, y, size*(big ? 3.1 : 2.3), big ? "255,200,130" : "255,184,116",
        big ? 0.42 : 0.30, big ? 0.5 : 0.32);
  at(0.035, () => fireball(x, y, big ? 7 : 4, size));
  sparks(x, y, big ? 18 : 10, color, big ? 240 : 160);
  at(0.14, () => embers(x, y, big ? 10 : 5));
  debris(x, y, big ? 12 : 6, color);
  at(0.22, () => smoke(x, y, big ? 8 : 3));
  const flash = pspawn();
  flash.x=x; flash.y=y; flash.life=0; flash.max=0.14; flash.size=size*0.75;
  flash.color="#ffffff"; flash.kind="flash"; flash.vx=0; flash.vy=0; flash.drag=1; flash.gravity=0;
  if(big){
    bloom(x, y, size*1.7, 0.32);
    // A hard white shock first, the coloured one rolling out behind it.
    ring(x, y, size*1.15, "#ffffff", 2.5, 0.22);
    at(0.06, () => ring(x, y, size*1.9, color, 3, 0.5));
    /*
     * Secondaries around the wreck. One fireball is a puff however big you
     * make it; three more going off out of step is what reads as something
     * coming apart.
     */
    for(let i=0;i<3;i++){
      const a = mrand(0, TAU), d = size*mrand(0.3, 0.75);
      const px = x + Math.cos(a)*d, py = y + Math.sin(a)*d*0.8;
      at(0.09 + i*0.07 + mrand(0, 0.04), () => {
        fireball(px, py, 2, size*0.5, mrand);
        bloom(px, py, size*0.65, 0.2);
      });
    }
  }
  // Last, and only ever in addition: what THIS thing does when it dies.
  const d = style && DEATHS[style];
  if(d) try { d(x, y, size, color); } catch(e){ /* a flourish never breaks a frame */ }
}

/**
 * A firework: a spherical burst of glittering embers with gravity, a white
 * core pop and a soft ring. Fired in salvos over the victory lap - the sky's
 * way of clapping.
 */
function firework(x, y, color){
  const N = 40;
  for(let i=0;i<N;i++){
    const a = (i/N)*TAU + rand(-0.07, 0.07), s = rand(110, 235);
    const p = pspawn();
    p.x=x; p.y=y; p.vx=Math.cos(a)*s; p.vy=Math.sin(a)*s;
    p.color = Math.random() < 0.2 ? "#ffffff" : color;
    p.life=0; p.max=rand(0.65, 1.15); p.size=rand(1.5, 2.7);
    p.kind="ember"; p.drag=0.955; p.gravity=95; p.spin=0; p.angle=rand(0,TAU);
  }
  const flash = pspawn();
  flash.x=x; flash.y=y; flash.life=0; flash.max=0.12; flash.size=26;
  flash.color="#ffffff"; flash.kind="flash"; flash.vx=0; flash.vy=0; flash.drag=1; flash.gravity=0;
  ring(x, y, 54, color, 2, 0.4);
  light(x, y, 120, "255,220,170", 0.22, 0.45);   // the sky claps, and it glows
}

/** A light in the world: a warm pool that blooms fast and dies out. */
function light(x, y, r, rgb, peak, max){
  const L = lights.spawn();
  L.x = x; L.y = y; L.r = r; L.life = 0;
  L.max = max || 0.34; L.color = rgb || "255,190,110"; L.peak = peak || 0.32;
}

/** Muzzle flash: a four-point star, rotated a little every shot. */
/*
 * The gun visibly FIRES. At 6.5px for 0.05s the old flash was three frames
 * of nothing - bullets simply appeared above the nose and the ship read as
 * an emitter, not a weapon. Bigger, a beat longer, and two hot motes kicked
 * up the bullet's path. The seeded draw for the star's angle is kept
 * byte-for-byte (fixed order on the fire path); everything NEW here rolls
 * from mrand so the simulation stream never notices the flourish.
 */
function muzzle(x, y, color, scale){
  const p = pspawn();
  p.x=x; p.y=y; p.life=0; p.max=0.085; p.size=(scale||1)*9.5;
  p.color=color||"#ffe9a8"; p.kind="muzzle"; p.vx=0; p.vy=-40; p.drag=1; p.gravity=0;
  p.angle=rand(-0.4,0.4); p.spin=0;
  for(let i=0;i<2;i++){
    spark(x + mrand(-3, 3), y - 2,
          mrand(-45, 45), -mrand(130, 240),
          i === 0 ? "#ffffff" : (color || "#ffe9a8"),
          mrand(0.08, 0.16), mrand(1.3, 2.1));
  }
}

/*
 * The birth cue on enemy fire: a brief pop at the gun, so shots stop
 * materialising out of clean sky and a kid gets one beat of "it just fired"
 * before the dodge. Deliberately random-free - this is called from the
 * simulation's fire paths, and the rule for anything on those paths is that
 * it may not consume a single seeded draw (see the explosion lights).
 *
 * Rate-limited PER GUN, not globally: a boss ring-volley spawns sixteen
 * bullets from one point in one frame, and sixteen stacked additive pops
 * would flashbang the arena. Same instant, same spot = one pop; two enemies
 * firing across the screen from each other still get one each.
 */
let eMuzzleAt = -1e9, eMuzzleX = 0, eMuzzleY = 0;
function enemyMuzzle(x, y, col, r){
  if(nowMs - eMuzzleAt < 30 && Math.abs(x - eMuzzleX) + Math.abs(y - eMuzzleY) < 24) return;
  eMuzzleAt = nowMs; eMuzzleX = x; eMuzzleY = y;
  const p = pspawn();
  p.x=x; p.y=y; p.life=0; p.max=0.11; p.size=4 + (r || 4)*0.6;
  p.color="rgba(" + (col || "255,93,115") + ",0.8)";
  p.kind="flash"; p.vx=0; p.vy=0; p.drag=1; p.gravity=0; p.spin=0; p.angle=0;
}

/*
 * ANNOUNCEMENTS STACK. THEY DO NOT SIT ON EACH OTHER.
 *
 * Thirteen different call sites in game.js throw a centred announcement at a
 * hand-picked fraction of the screen height - VH*0.2, VH*0.42, VH*0.6 - and
 * none of them knows what else is on screen. Caught in a real frame of The
 * Searchlight: "PILOT ADRIFT - CATCH THEM!" landing under the combo counter's
 * underline while the mission banner held below it and the objective chip
 * overlapped from the left. Three things shouting in the same column.
 *
 * Rather than re-tune thirteen magic numbers - which only holds until the
 * fourteenth - a rising text now looks for other rising texts near the same
 * column and drops below the lowest of them. The call sites keep their
 * intended position; they just stop colliding when two land together.
 *
 * Only `rise` texts take part: damage numbers are meant to overlap, there are
 * dozens of them, and they are thrown deliberately at what they came off.
 */
function text(x, y, str, color, size, rise){
  const t = texts.spawn();
  const sz = size || 14;
  if(rise){
    const items = texts.items;
    // A few passes, because pushing below one can put it under another.
    for(let pass = 0; pass < 6; pass++){
      let moved = false;
      for(let i = 0; i < items.length; i++){
        const o = items[i];
        if(o === t || !o.alive || !o.rise) continue;
        if(Math.abs(o.x - x) > 220) continue;            // a different column
        const gap = (o.size + sz)*0.62 + 6;
        if(Math.abs(o.y - y) < gap){ y = o.y + gap; moved = true; }
      }
      if(!moved) break;
    }
  }
  t.x=x; t.y=y; t.text=str; t.color=color||"#fff"; t.size=sz;
  t.life=0; t.max= rise ? 1.3 : 0.9; t.vy = rise ? -46 : -34;
  t.vx=0; t.gravity=0; t.pop=0;         // banners rise straight and steady
  t.rise = !!rise;
}

/**
 * The number that floats off a hit. It pops - overshooting its size in the
 * first 60ms and settling back - and then arcs: thrown upward, pulled down,
 * drifting slightly aside. A number that only slides up reads as UI printed
 * over the fight; one that is thrown off the hull reads as part of it.
 *
 * Size and heat follow the damage, so a heavy round is legible as a heavy
 * round without anyone reading the digits. Sideways drift is Math.random -
 * it exists to stop two numbers landing on top of each other, and has no
 * business in the simulation stream.
 */
function damageNumber(x, y, amount, crit){
  const t = texts.spawn();
  // Cleared explicitly: the slot may have just held an announcement, and a
  // stale flag would put damage numbers into the announcement stack - where
  // they would shove each other down the screen instead of overlapping, which
  // is exactly what they are supposed to do.
  t.rise = false;
  const heavy = Math.min(1, Math.max(0, (amount - 1) / 8));
  t.x=x+rand(-4,4); t.y=y; t.text=String(amount);
  t.color = crit ? "#ffd23f" : (heavy > 0.45 ? "#ffe9a8" : "rgba(255,255,255,0.92)");
  t.size = (crit ? 18 : 13) + heavy*7;
  t.life=0; t.max = crit ? 0.85 : 0.7;
  t.vy = -118; t.gravity = 430; t.vx = mrand(-26, 26); t.pop = 1;
}

/* ---------------------------------------------------------
   SCREEN EFFECTS
   --------------------------------------------------------- */
// Screen shake is a feel multiplier for most players and motion sickness for
// a few, so the settings screen can turn it off at the source.
let shakeOn = localStorage.getItem("patrol_shake_off") !== "1";
function shakeEnabled(){ return shakeOn; }
function setShakeEnabled(v){
  shakeOn = !!v;
  localStorage.setItem("patrol_shake_off", shakeOn ? "0" : "1");
  if(!shakeOn) shakeMag = 0;
}

/*
 * CALMER VISUALS.
 *
 * This game strobes: full-screen flashes on every heavy hit, a DISCO modifier
 * that pulses the whole sky, a BLACKOUT mission, hit-stop, parallax and a
 * constant particle storm. Exactly one rule in 82KB of CSS honoured
 * prefers-reduced-motion, and it dimmed a single menu icon - which is no use
 * at all, because everything that actually flashes is painted on the canvas
 * where CSS cannot reach it.
 *
 * So the switch lives here, defaults to whatever the device asks for, and is
 * overridable in Settings. It damps the full-screen flash hard (that is the
 * photosensitivity risk, and it is the one thing a child cannot look away
 * from) and thins the particle storm; the game stays entirely playable.
 */
const prefersCalm = (() => {
  try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch(e){ return false; }
})();
let calmOn = localStorage.getItem("patrol_calm") !== null
  ? localStorage.getItem("patrol_calm") === "1"
  : prefersCalm;
function calmEnabled(){ return calmOn; }
function setCalmEnabled(v){
  calmOn = !!v;
  localStorage.setItem("patrol_calm", calmOn ? "1" : "0");
  if(calmOn) flashAlpha = Math.min(flashAlpha, 0.12);
}

/*
 * THE LENS GLOW, switchable. Off is for one case and one only: an old device
 * where two extra full-frame composites a frame cost more than the look is
 * worth. It is deliberately NOT folded into Calmer Visuals - a steady bloom is
 * not a flash hazard, it is the opposite, it takes the hard edge off every
 * bright thing on screen - so calm keeps it, at a little over half strength.
 */
let glowOn = localStorage.getItem("patrol_glow_off") !== "1";
function glowEnabled(){ return glowOn; }
function setGlowEnabled(v){
  glowOn = !!v;
  localStorage.setItem("patrol_glow_off", glowOn ? "0" : "1");
  // Switching it back on asks the question again: the device may simply have
  // been busy the first time, and there is no other way back from a verdict.
  if(glowOn){ glowAfford = true; glowJudged = false; glowSeen = 0; glowSlowAvg = 0; }
}

/*
 * ...AND WHETHER THE DEVICE CAN ACTUALLY AFFORD IT.
 *
 * The glow is one bilinear blend over every pixel on screen. On a GPU that is
 * nothing. On a machine drawing canvas in software it is more than a whole
 * 60fps frame: measured end to end, glow on took 16.7ms a frame to 33.3ms -
 * half rate, reproducibly. There is no device list that would tell us which
 * one a family member is holding, so the game asks the only instrument that
 * knows: its own frame clock.
 *
 * It watches for the WHOLE session, and that is the part worth explaining.
 * The first version measured a hundred and twenty frames, decided, and never
 * looked again - and it passed a machine that then ran at half rate for the
 * rest of the mission, because it had made its judgement during the opening
 * seconds when the sky is empty. The heaviest frame of a mission is never the
 * first one; it is the one with a fully upgraded gun's worth of bullets, a
 * wave of elites and an explosion on it. So the measurement has to still be
 * running when that frame arrives.
 *
 * A decaying average of "did this frame miss the deadline", rather than a
 * window: one number, no buffer, and it takes sustained trouble to move. A
 * single hitch - a garbage collection, a wave spawning - barely registers,
 * while forty-odd bad frames in a row cross the line and shed the lens for the
 * session. Nothing is announced mid-fight; the settings screen explains it,
 * the way the rumble row explains itself on an iPad.
 *
 * A device that is merely busy fails this too, and that is the right answer as
 * well: something struggling should not be paying for a lens effect.
 */
let glowAfford = true, glowJudged = false, glowSeen = 0, glowSlowAvg = 0;
const GLOW_WARMUP = 60, GLOW_SLOW_MS = 20, GLOW_FAIL = 0.6, GLOW_EASE = 1/45;
/** Is the glow both wanted and affordable? The renderer asks this one. */
function glowActive(){ return glowOn && glowAfford; }
/** True when the player asked for it and the device could not keep up. */
function glowShed(){ return glowOn && !glowAfford; }
/** Fed one frame delta (ms) from the main loop, while a mission is running. */
function glowWatch(dtMs){
  if(glowJudged || !glowOn) return;
  if(glowSeen++ < GLOW_WARMUP) return;      // first paint, JIT, the sky bake
  glowSlowAvg += ((dtMs > GLOW_SLOW_MS ? 1 : 0) - glowSlowAvg) * GLOW_EASE;
  if(glowSlowAvg > GLOW_FAIL){ glowJudged = true; glowAfford = false; }
}

function shake(mag){ if(shakeOn) shakeMag = Math.max(shakeMag, mag * (calmOn ? 0.35 : 1)); }

/* ---------------------------------------------------------
   THE CAMERA
   ---------------------------------------------------------
 * For thirty-five missions and nine bosses the frame never moved. Individual
 * things scaled and wobbled - the ship, a boss's swell, a pickup's pop - but
 * the framing was a fixed rectangle from the first patrol to the last, so the
 * game had no way of saying "look at THIS".
 *
 * One rule, and it is a hard one: the camera only ever pushes IN. Going below
 * 1.0 would pull the edges of the playfield inside the canvas and show bare
 * ground around a sky that is exactly VW x VH, on devices nobody here can
 * test. A "pull back" is therefore always the RELEASE of a push, which reads
 * as the same beat and cannot expose anything.
 *
 * It rides the same two switches shake does. Somebody who turned shake off did
 * it because moving frames make them ill, and a lens that creeps is the same
 * complaint; CALM keeps the push but takes most of the travel out of it.
 */
const CAM_MAX = 1.14;
let camZoom = 1;                 // where the lens is now
let camTarget = 1;               // where it is heading
let camHold = 0;                 // seconds left pinned at the target
let camFx = 0.5, camFy = 0.42;   // focus, in 0..1 of the playfield

/**
 * Push in on something. Clamped to 14%: past that the enemies a player needs
 * to see start leaving the screen, which is a worse problem than a flat frame.
 */
function push(zoom, holdSec, fx01, fy01){
  if(!shakeOn) return;
  const want = 1 + (Math.min(CAM_MAX, zoom || 1) - 1) * (calmOn ? 0.35 : 1);
  camTarget = Math.max(camTarget, want);
  camHold = Math.max(camHold, holdSec || 0.5);
  if(fx01 != null) camFx = clamp(fx01, 0.12, 0.88);
  if(fy01 != null) camFy = clamp(fy01, 0.12, 0.88);
}

function cameraUpdate(dt){
  if(camHold > 0){
    camHold -= dt;
    // Rise fast: the moment being marked has already happened.
    camZoom += (camTarget - camZoom) * Math.min(1, dt*7.5);
  } else {
    camTarget = 1;
    // Fall slow. The release IS the pull-back, and a snap would read as a jolt.
    camZoom += (1 - camZoom) * Math.min(1, dt*2.1);
    if(camZoom < 1.0009){ camZoom = 1; camFx = 0.5; camFy = 0.42; }
  }
}

/** Applies the lens. Called once, inside the frame's own save/restore. */
function cameraApply(ctx, VW, VH){
  if(camZoom <= 1.0001) return;
  const cx = VW*camFx, cy = VH*camFy;
  ctx.translate(cx, cy);
  ctx.scale(camZoom, camZoom);
  ctx.translate(-cx, -cy);
}

function cameraZoom(){ return camZoom; }
function cameraReset(){ camZoom = 1; camTarget = 1; camHold = 0; camFx = 0.5; camFy = 0.42; }
function flash(alpha, rgb){
  flashAlpha = Math.max(flashAlpha, calmOn ? Math.min(alpha, 0.12) : alpha);
  if(rgb) flashColor = rgb;
}
/** Freeze the world for a few ms so a heavy hit registers physically. */
function hitStop(ms){ hitStopUntil = Math.max(hitStopUntil, nowMs + ms); }
function isHitStopped(){ return nowMs < hitStopUntil; }

function reset(){
  particles.killAll(); texts.killAll(); rings.killAll(); lights.killAll();
  shakeMag = 0; flashAlpha = 0; hitStopUntil = 0;
  cameraReset();
}

/* ---------------------------------------------------------
   UPDATE / DRAW
   --------------------------------------------------------- */
function update(dt, timeMs){
  nowMs = timeMs;
  { const ls = lights.items;
    for(let i=0;i<ls.length;i++){
      const L = ls[i];
      if(!L.alive) continue;
      L.life += dt;
      if(L.life >= L.max) L.alive = false;
    } }
  cameraUpdate(dt);
  const items = particles.items;
  for(let i=0;i<items.length;i++){
    const p = items[i];
    if(!p.alive) continue;
    // Staged: born on the death frame, but frozen and unlit until its turn.
    if(p.delay > 0){ p.delay -= dt; continue; }
    p.life += dt;
    if(p.life >= p.max){ p.alive = false; continue; }
    p.x += p.vx*dt; p.y += p.vy*dt;
    p.vy += p.gravity*dt;
    const d = Math.pow(p.drag, dt*60);
    p.vx *= d; p.vy *= d;
    if(p.spin) p.angle += p.spin*dt;
  }
  const ts = texts.items;
  for(let i=0;i<ts.length;i++){
    const t = ts[i];
    if(!t.alive) continue;
    t.life += dt;
    if(t.life >= t.max){ t.alive = false; continue; }
    t.x += t.vx*dt;
    t.y += t.vy*dt;
    t.vy = t.gravity ? t.vy + t.gravity*dt          // thrown: arcs up, then falls
                     : t.vy * Math.pow(0.94, dt*60); // banner: rises and eases out
    t.vx *= Math.pow(0.93, dt*60);
  }
  const rs = rings.items;
  for(let i=0;i<rs.length;i++){
    const r = rs[i];
    if(!r.alive) continue;
    if(r.delay > 0){ r.delay -= dt; continue; }
    r.life += dt;
    if(r.life >= r.max) r.alive = false;
  }
  shakeMag = Math.max(0, shakeMag - shakeDecay*dt*2.2);
  flashAlpha = Math.max(0, flashAlpha - dt*2.4);
}

/**
 * Camera offset for this frame; the renderer applies it around everything.
 *
 * Two detuned sinusoids per axis, not fresh noise per frame: noise buzzes
 * like a loose speaker and buzzes twice as fast at 120Hz, while a dominant
 * frequency with an overtone lurches and settles. Time-based, so the feel is
 * identical at any framerate; decay still lives in shakeMag. 1/3 puts the
 * summed peak (1.5x) exactly where the old +/-mag/2 random put it.
 */
const SHAKE_AMP = 1/3;
function shakeOffset(out){
  if(shakeMag <= 0.25){ out.x = 0; out.y = 0; return out; }
  const t = nowMs/1000;
  out.x = (Math.sin(t*47)       + 0.5*Math.sin(t*89 + 1.7)) * shakeMag * SHAKE_AMP;
  out.y = (Math.sin(t*53 + 2.3) + 0.5*Math.sin(t*97 + 4.1)) * shakeMag * SHAKE_AMP;
  return out;
}

/*
 * Two passes: solid matter (smoke, debris) with normal blending, then
 * everything hot (sparks, flashes, fire, embers) drawn additively so
 * overlapping light stacks toward white the way real glare does. That one
 * compositing switch is most of the difference between "coloured squares"
 * and "an explosion".
 */
const fireGrad = (() => {          // one radial fireball sprite, drawn once
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  if(g){
    const gr = g.createRadialGradient(32,32,2, 32,32,32);
    gr.addColorStop(0, "rgba(255,245,220,1)");
    gr.addColorStop(0.25, "rgba(255,190,90,0.9)");
    gr.addColorStop(0.6, "rgba(255,100,40,0.45)");
    gr.addColorStop(1, "rgba(180,40,20,0)");
    g.fillStyle = gr; g.fillRect(0,0,64,64);
  }
  return c;
})();

/*
 * The glow kick's sprite: white at the heart, warm through the middle, gone
 * by the rim. Wider and softer than the fireball, and drawn additively over
 * it, so a big death briefly lights the sky around itself.
 */
const bloomGrad = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  if(g){
    const gr = g.createRadialGradient(32,32,0, 32,32,32);
    gr.addColorStop(0, "rgba(255,255,255,0.95)");
    gr.addColorStop(0.18, "rgba(255,226,170,0.6)");
    gr.addColorStop(0.5, "rgba(255,150,70,0.22)");
    gr.addColorStop(1, "rgba(255,110,50,0)");
    g.fillStyle = gr; g.fillRect(0,0,64,64);
  }
  return c;
})();

/*
 * A PARTICLE IS A BLIT, NOT A PATH.
 *
 * The fireball and the bloom have always been pre-rendered sprites. The three
 * kinds that outnumber them were not: a spark laid down TWO filled arcs (a hot
 * core and a soft skirt), and smoke and flash one each. Profiled on a
 * deliberately busy scene - 82 enemies, 400 enemy bullets, ~800 live particles
 * - that came to 669 arc() and 679 fill() calls every frame, and those two
 * lines were the top of the canvas call list after the blits themselves.
 *
 * A filled path has to be tessellated and scan-converted every single time.
 * A cached sprite is a texture blit, which is the fastest thing a 2D canvas
 * does. There are only ever eight distinct particle colours alive at once, so
 * the cache is eight small canvases and never grows.
 *
 * The spark sprite is baked by laying down the SAME two discs in the SAME
 * additive mode, so the sprite is exactly what the old code produced at full
 * alpha, and blitting it at globalAlpha A reproduces A*(core + 0.4*skirt) -
 * the old result, one call instead of two. (The one departure: at the very
 * centre the old pair summed past opaque and clipped here instead. Measured
 * over a busy frame it moves the picture by well under one part in a
 * thousand - see the pin.)
 */
const SPRITE_R = 32;                       // baked radius; the blit scales it
const softCache = new Map();               // spark: hot core + soft skirt
const discCache = new Map();               // smoke and flash: one flat disc
function bakeSprite(paint){
  const cv = document.createElement("canvas");
  cv.width = cv.height = SPRITE_R*2;
  const c = cv.getContext("2d");
  if(c) paint(c);
  return cv;
}
function softSprite(color){
  let s = softCache.get(color);
  if(!s){
    s = bakeSprite(c => {
      c.globalCompositeOperation = "lighter";
      c.fillStyle = color;
      c.beginPath(); c.arc(SPRITE_R, SPRITE_R, SPRITE_R*(0.62/1.15), 0, TAU); c.fill();
      c.globalAlpha = 0.4;
      c.beginPath(); c.arc(SPRITE_R, SPRITE_R, SPRITE_R, 0, TAU); c.fill();
    });
    softCache.set(color, s);
  }
  return s;
}
function discSprite(color){
  let s = discCache.get(color);
  if(!s){
    s = bakeSprite(c => {
      c.fillStyle = color;
      c.beginPath(); c.arc(SPRITE_R, SPRITE_R, SPRITE_R, 0, TAU); c.fill();
    });
    discCache.set(color, s);
  }
  return s;
}

/*
 * The pools of light, additive, drawn between the scenery and the ships.
 * Fast attack, long decay: full for the first fifth of the life, then a curve
 * down - a flash that fades, not a bulb that switches. Calm mode keeps them at
 * a little over half, the same deal the camera and the glow get.
 */
function drawLights(ctx){
  const ls = lights.items;
  let any = false;
  for(let i=0;i<ls.length;i++) if(ls[i].alive){ any = true; break; }
  if(!any) return;
  const k = calmOn ? 0.55 : 1;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for(let i=0;i<ls.length;i++){
    const L = ls[i];
    if(!L.alive) continue;
    const t = L.life / L.max;
    const a = L.peak * (t < 0.2 ? t/0.2 : Math.pow(1 - (t - 0.2)/0.8, 1.7)) * k;
    if(a <= 0.004) continue;
    const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    g.addColorStop(0, "rgba(" + L.color + "," + a.toFixed(3) + ")");
    g.addColorStop(0.55, "rgba(" + L.color + "," + (a*0.35).toFixed(3) + ")");
    g.addColorStop(1, "rgba(" + L.color + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(L.x, L.y, L.r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawParticles(ctx){
  const items = particles.items;

  // Pass 1: matter.
  for(let i=0;i<items.length;i++){
    const p = items[i];
    if(!p.alive || p.delay > 0) continue;
    const t = 1 - p.life/p.max;
    if(p.kind === "smoke"){
      ctx.globalAlpha = t*0.45;
      const s = p.size*(1.6 - t*0.6);
      ctx.drawImage(discSprite(p.color), p.x - s, p.y - s, s*2, s*2);
    } else if(p.kind === "debris"){
      ctx.globalAlpha = Math.min(1, t*1.6);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      const w = p.size, h = p.size*0.7;
      ctx.fillStyle = p.color;
      ctx.fillRect(-w/2, -h/2, w, h);
      /*
       * Ordinary wreckage is a two-pixel speck and a flat fill is all it
       * needs. A shed armour PANEL is ten times that, and at that size an
       * unshaded rectangle stops reading as metal and starts reading as a
       * grey bar somebody left on the screen - which is exactly what it
       * looked like. Anything big enough to be a shape gets the fleet's own
       * lighting: a dark rim so it sits against the sky, and one lit edge so
       * it turns as it tumbles.
       */
      if(p.edge){
        ctx.strokeStyle = "rgba(8,10,18,0.85)";
        ctx.lineWidth = Math.max(1, w*0.14);
        ctx.strokeRect(-w/2, -h/2, w, h);
        ctx.fillStyle = p.edge;
        ctx.fillRect(-w/2, -h/2, w, Math.max(1, h*0.26));
      }
      ctx.restore();
    }
  }

  // Pass 2: light.
  ctx.globalCompositeOperation = "lighter";
  for(let i=0;i<items.length;i++){
    const p = items[i];
    if(!p.alive || p.delay > 0) continue;
    const t = 1 - p.life/p.max;
    if(p.kind === "bloom"){
      /*
       * Fast attack, long decay. Swelling in from nothing would read as a
       * balloon inflating; light arrives all at once and then dies back, so
       * it opens near full size in the first frames and fades from there.
       */
      const k = p.life/p.max;
      const s = p.size*(0.55 + Math.min(1, k*5)*0.45 + k*0.35);
      // Kept well under 1: the flash, the fireball and this all stack
      // additively, and at full strength the first 100ms clipped to a
      // featureless white disc that hid the explosion happening inside it.
      ctx.globalAlpha = (1-k)*(1-k)*0.6;
      ctx.drawImage(bloomGrad, p.x - s, p.y - s, s*2, s*2);
    } else if(p.kind === "flash"){
      ctx.globalAlpha = t;
      const s = p.size*(0.4 + (1-t)*0.9);
      ctx.drawImage(discSprite(p.color), p.x - s, p.y - s, s*2, s*2);
    } else if(p.kind === "fire"){
      ctx.globalAlpha = t;
      const s = p.size*(1.1 + (1-t)*0.8);
      ctx.drawImage(fireGrad, p.x - s, p.y - s, s*2, s*2);
    } else if(p.kind === "muzzle"){
      ctx.globalAlpha = t;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      const s = p.size*(0.5 + (1-t)*0.7);
      // Four-point star: two thin crossed diamonds plus a hot core.
      ctx.beginPath();
      ctx.moveTo(0,-s); ctx.lineTo(s*0.18,0); ctx.lineTo(0,s); ctx.lineTo(-s*0.18,0);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s*0.7,0); ctx.lineTo(0,s*0.14); ctx.lineTo(s*0.7,0); ctx.lineTo(0,-s*0.14);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(0, 0, s*0.16, 0, TAU); ctx.fill();
      ctx.restore();
    } else if(p.kind === "ember"){
      const flicker = 0.55 + Math.sin((p.life*31) + p.angle*7)*0.45;
      ctx.globalAlpha = Math.min(1, t*1.6)*flicker;
      ctx.fillStyle = p.color;
      // Rotated by the angle stamped at spawn: forty axis-aligned squares
      // per firework read as confetti pixels, not glitter.
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
      ctx.restore();
    } else { // spark
      ctx.globalAlpha = Math.min(1, t*1.8);
      ctx.fillStyle = p.color;
      // Streaked along velocity so fast sparks read as motion, not dots.
      const vl = Math.hypot(p.vx, p.vy);
      if(vl > 60){
        const k = Math.min(2.6, vl/110);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size*k, -p.size/2, p.size*2*k, p.size);
        ctx.restore();
      } else {
        // A hot core with a soft skirt. The rotated square just above is a
        // deliberate contract (confetti reads as pixels, not glitter); this
        // branch is the engine spark, and a hard square is a glitch.
        // Both discs live in the sprite now - one blit instead of two fills.
        const s = p.size*1.15;
        ctx.drawImage(softSprite(p.color), p.x - s, p.y - s, s*2, s*2);
      }
    }
  }

  const rs = rings.items;
  for(let i=0;i<rs.length;i++){
    const r = rs[i];
    if(!r.alive || r.delay > 0) continue;
    const t = r.life/r.max;
    /*
     * Fades FASTER than it grows. The radius runs on an easeOutCubic, so a
     * linear fade left the ring at 70% opacity when it was already half its
     * final size - a hard drawn circle rather than a shock dissipating. Now
     * that the explosion also lights the ground around it, that was the one
     * part of a blast still reading as an outline.
     */
    ctx.globalAlpha = Math.pow(1-t, 1.9)*0.85;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width*(1-t*0.6);
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r0 + (r.r1-r.r0)*SF.core.easeOutCubic(t), 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function drawTexts(ctx){
  const ts = texts.items;
  ctx.textAlign = "center";
  for(let i=0;i<ts.length;i++){
    const t = ts[i];
    if(!t.alive) continue;
    const k = 1 - t.life/t.max;
    ctx.globalAlpha = Math.min(1, k*1.7);
    ctx.font = "bold " + t.size + "px Rajdhani, Arial, sans-serif";
    /*
     * The pop: overshoot to 1.45x and snap back over the first ~70ms. Text
     * that simply appears at its final size is the thing that makes damage
     * numbers look like a debug readout; the overshoot is the whole trick,
     * and it costs one transform on a handful of glyphs.
     */
    const popped = t.pop > 0 && t.life < 0.2;
    if(popped){
      // Out to 1.7x in 45ms, then settle back to 1 over the next 150ms. The
      // first version eased straight down from the overshoot and was over
      // inside two frames - the pop has to be held to be seen at all.
      const s = t.life < 0.045
        ? 0.55 + 1.15*SF.core.easeOutCubic(t.life/0.045)
        : 1 + 0.7*(1 - SF.core.easeOutCubic((t.life - 0.045)/0.155));
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
    }
    const x = popped ? 0 : t.x, y = popped ? 0 : t.y;
    // Outlined, because floating numbers live over explosions.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(6,8,18,0.7)";
    ctx.strokeText(t.text, x, y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, x, y);
    if(popped) ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

/*
 * The damage flash is a vignette, not a sheet. A flat fill washed out the
 * HUD and the very bullets the player needs to dodge next; colour rushing
 * in from the edges says "hit" just as loudly and leaves the centre - where
 * the flying happens - readable. Gradient cached per size + colour.
 */
let flashGrad = null, flashGradKey = "";
function drawFlash(ctx, w, h){
  if(flashAlpha <= 0.01) return;
  const key = w + "x" + h + "|" + flashColor;
  if(flashGradKey !== key){
    flashGrad = ctx.createRadialGradient(w/2, h/2, Math.min(w, h)*0.35,
                                         w/2, h/2, Math.hypot(w, h)*0.60);
    flashGrad.addColorStop(0, "rgba(" + flashColor + ",0)");
    flashGrad.addColorStop(1, "rgba(" + flashColor + ",1)");
    flashGradKey = key;
  }
  ctx.save();
  ctx.globalAlpha = Math.min(1, flashAlpha*0.55);
  ctx.fillStyle = flashGrad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

SF.fx = {
  // `spark` (singular) is the directional primitive - the Storm streaks its
  // wind with it, where the omnidirectional `sparks` puff would read as rain.
  spark,
  sparks, impact, fireball, embers, debris, smoke, ring, explosion, muzzle, enemyMuzzle, text, damageNumber,
  firework, bloom,
  shake, flash, hitStop, isHitStopped, reset, shakeEnabled, setShakeEnabled,
  DEATHS, push, cameraApply, cameraZoom, cameraReset,
  calmEnabled, setCalmEnabled,
  glowEnabled, setGlowEnabled, glowActive, glowShed, glowWatch,
  light, drawLights,
  update, shakeOffset, drawParticles, drawTexts, drawFlash,
  _pools: { particles, texts, rings, lights },
};
})();
