/*
 * THE MIRAGE - the lying sky.
 *
 * Sunstruck (skygen.js) is the desert itself: dunes, a dry riverbed and their
 * mirror towers baking the air. This module is the lie the heat tells. Most
 * ships that fly in bring a TWIN with them - a mirage, drawn from the same
 * art, flying the same behaviour a few lengths off - and the twin is nothing:
 * it never fires, it costs nothing to fly through, and a shot at it vanishes
 * into hot air. The tell is on the ground. Everything real on this world casts
 * a shadow on the sand; a mirage casts none. The level's whole lesson is
 * "look down before you shoot", and its own star (objectives: "seeThrough")
 * pays for exactly that: a real ship destroyed while its untouched twin was
 * still shimmering beside it.
 *
 * Same shape as volcano.js: a mission flag (`mirage`) plus the hooks game.js
 * already calls - begin/update, a draw pass under the world (the shadows) and
 * one over it (dissolving ghosts, blown sand, the sun). The twin is a real
 * pooled enemy so every behaviour, formation and leash works on it unchanged;
 * what makes it a mirage is `e.mirage`, which the collision pass (systems.js)
 * and the kill path (game.js) both read, and the fact that it is `uncounted`,
 * so no kill objective ever knows it flew.
 *
 * Drawn cheaply on purpose: a shadow is one drawImage of a cached silhouette,
 * a ghost is six band-sliced drawImages, and there is no full-screen haze -
 * the Dive's frame-budget lesson holds in the desert too.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;
const T = s => (SF.i18n ? SF.i18n.t(s) : s);

/*
 * The sun stands high and to the upper left, so every shadow on this world
 * falls down and to the right - the same light the dune crests are painted
 * by, which is what makes the shadow read as sitting ON the sand.
 *
 * Pushed out and darkened after the family played it: "the mirages aren't
 * that obvious". At (14,26) and a third opaque the shadow sat half under the
 * hull that cast it, so on a bright dune the tell the whole level rests on
 * was something you had to hunt for. Further out, darker, and with a soft
 * pool under it, it reads as a shape ON the ground from across the room -
 * which is the only way "shoot the one with the shadow" can be a rule a
 * seven-year-old plays by rather than a sentence they were told once.
 */
const SHADOW_DX = 20, SHADOW_DY = 34;
/* How many wasted shots a mirage soaks before the heat lets go of it. One
 * would make spraying free; forever would make it a wall. Three is a cost a
 * child feels without a fight ever being lost to it. */
const HITS_TO_BURST = 3;
const DISSOLVE = 0.42;

/*
 * Who gets a twin. Ships whose whole job is a mechanic of their own - a
 * carrier with a pilot inside, a Guardian's bubble, a Mender's beam, a Hive
 * spawning, a Marksman's charged line, a thief with your money - would either
 * hand the mirage a real effect or hand the player a tell for free (an SOS
 * label with no shadow is not a lesson). The doubles are the fighters.
 */
const TWINS = { grunt:1, weaver:1, striker:1, swooper:1, kamikaze:1, turret:1,
                brute:1, splitter:1, interceptor:1, bomber:1 };

let S = null;
const silCache = {};

function reset(){ S = null; }

function begin(){
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S = { t: 0, stamp: 0, twinned: 0, burst: 0, ghosts: [], sand: [], lastText: -9 };
  for(let i = 0; i < 28; i++)
    S.sand.push({ x: Math.random()*W, y: Math.random()*H,
                  vx: 16 + Math.random()*22, vy: 5 + Math.random()*10,
                  s: 1 + Math.random()*1.2, a: 0.12 + Math.random()*0.16 });
}

function active(){ return !!S; }

/* ------------------------------------------------------------------ */
/*  THE TWIN                                                           */
/* ------------------------------------------------------------------ */

/** Whether this freshly spawned ship brings a mirage with it. */
function eligible(e){
  return !!(S && e && e.alive && e.counted && !e.hazard && !e.fromBoss &&
            !e.mirage && TWINS[e.typeId]);
}

/**
 * Spawn the mirage of a real ship: same art, same behaviour, a few lengths
 * off and a little ahead or behind - sometimes the fake is the one that
 * reaches you first, or a child would learn "shoot the front one" instead
 * of "look at the sand".
 *
 * Fewer twins on the dense tiers, where a wall of thirteen already fills the
 * width: the lesson needs room to be read, and the pool has a ceiling.
 */
function twin(world, real, difficulty, force){
  if(!eligible(real)) return null;
  const density = (difficulty && difficulty.density) || 1;
  const p = Math.min(0.85, Math.max(0.4, 0.85/Math.sqrt(density)));
  if(!force && Math.random() > p) return null;   // `force`: the suite's dice
  const W = SF.game.VW || 600;
  const side = Math.random() < 0.5 ? -1 : 1;
  let x = real.x + side*(46 + Math.random()*24);
  if(x < 24 || x > W - 24) x = real.x - side*(46 + Math.random()*24);
  const y = real.y + (Math.random() < 0.5 ? -1 : 1)*(38 + Math.random()*18);
  const m = world.spawnEnemy(real.typeId, x, y, {
    difficulty, elite: real.elite, hoverY: real.hoverY, uncounted: true,
  });
  m.mirage = true;
  m.fireTimer = Infinity;            // hot air has no guns
  m.diver = false;                   // ...and cutting past it is not a dodge
  m.carriesRescue = false; m.bounty = false; m.huntsEscort = false;
  m.anchorX = x; m.weaveWidth = real.weaveWidth; m.weaveSpeed = real.weaveSpeed;
  m.phase = real.phase; m.hoverTime = real.hoverTime;
  m.speed = real.speed; m.vy = real.vy;
  m.mirageHits = 0; m.brushed = false;
  /*
   * The pair is tied by a stamp, not by the reference alone: the pool
   * recycles slots, so `twinOf.alive` could one day be answering for a
   * brand-new grunt in the dead ship's chair. spawnEnemy zeroes the stamp on
   * reuse, and a zero never matches.
   */
  const stamp = ++S.stamp;
  real.mirageStamp = stamp; real.mirageTwin = m;
  m.twinOf = real; m.twinStamp = stamp;
  S.twinned++;
  return m;
}

/** Is the ship this mirage was cast by still in the sky? */
function realAlive(m){
  const r = m.twinOf;
  return !!(r && r.alive && !r.mirage && r.mirageStamp === m.twinStamp);
}

/**
 * Is this real ship's twin still shimmering IN THE FIELD, untouched? Asked
 * by systems.js on the first round that lands on the real one, and that
 * answer is the star: you picked the real one first.
 *
 * "In the field" matters: a ship destroyed the instant it crosses the top
 * edge, while its double is still staged above the screen, fooled nobody
 * because it had nobody to fool.
 */
function seenThrough(real){
  const m = real && real.mirageTwin;
  return !!(m && m.alive && m.mirage && m.twinStamp === real.mirageStamp &&
            m.twinOf === real && m.mirageHits === 0 && m.y > 10);
}

/** The heat lets go: the ghost comes apart in bands and is gone. */
function dissolve(m, quiet){
  if(!m || !m.alive) return;
  m.alive = false;
  if(!S) return;
  S.ghosts.push({ x: m.x, y: m.y, typeId: m.typeId, tint: m.type.tint || "#c0392b",
                  elite: m.elite, size: m.size, ph: m.phase || 0, t: 0 });
  if(!quiet){
    SF.fx.ring(m.x, m.y, m.r + 10, "#fff1c4", 2, 0.28);
    SF.audio.play("mirage", null, m.x);
  }
}

/** The real one is gone - dead or fled - so its lie has nothing to stand on. */
function onRealGone(real){
  const m = real && real.mirageTwin;
  if(m && m.alive && m.mirage && m.twinStamp === real.mirageStamp) dissolve(m, true);
}

/**
 * A shot arrived. It is spent - the round is already dead in systems.js -
 * and the mirage flinches, says what it is, and after enough of them bursts.
 */
function hit(m, hx, hy){
  if(!S || !m.alive) return;
  m.mirageHits = (m.mirageHits || 0) + 1;
  m.flash = 0;                       // no white hit-flash: nothing was hit
  const fx = SF.fx;
  fx.ring(hx, hy, 12, "#fff1c4", 1.6, 0.18);
  fx.spark(hx, hy, (Math.random() - 0.5)*30, -20 - Math.random()*30, "#fff1c4", 0.3, 1.8);
  SF.audio.play("mirage", null, m.x);
  if(m.mirageHits === 1){
    if(S.t - S.lastText > 0.6){
      fx.text(m.x, m.y - m.r - 10, T("MIRAGE!"), "#fff1c4", 15, true);
      S.lastText = S.t;
    }
    SF.comms.say("mirageShot");
  }
  if(m.mirageHits >= HITS_TO_BURST){ S.burst++; dissolve(m); }
}

/* ------------------------------------------------------------------ */
/*  UPDATE                                                             */
/* ------------------------------------------------------------------ */

function update(dt, run, world){
  if(!S || run.ended) return;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;

  const items = world.enemies.items;
  const seats = world.livePlayers();
  for(let i = 0; i < items.length; i++){
    const m = items[i];
    if(!m.alive || !m.mirage) continue;
    // No liar, no lie: a mirage outlives its ship by exactly one frame.
    if(!realAlive(m)){ dissolve(m, true); continue; }
    // Flying through one costs nothing, and says so once, with a ripple.
    if(!m.brushed){
      for(let s = 0; s < seats.length; s++){
        const p = seats[s];
        if(!p.alive) continue;
        const dx = p.x - m.x, dy = p.y - m.y, rr = m.r + p.r;
        if(dx*dx + dy*dy < rr*rr){
          m.brushed = true;
          SF.fx.ring(m.x, m.y, m.r + 8, "#fff1c4", 2, 0.3);
          SF.audio.play("mirage", null, m.x);
          break;
        }
      }
    }
  }

  for(let i = S.ghosts.length - 1; i >= 0; i--){
    const g = S.ghosts[i];
    g.t += dt;
    if(g.t >= DISSOLVE) S.ghosts.splice(i, 1);
  }

  for(const g of S.sand){
    g.x += g.vx*dt; g.y += g.vy*dt;
    if(g.x > W + 4){ g.x = -4; g.y = Math.random()*H; }
    if(g.y > H + 4){ g.y = -4; g.x = Math.random()*W; }
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - under the world: the shadows on the sand                    */
/* ------------------------------------------------------------------ */

/** The dark shape a ship throws on the ground: its own sprite, flooded to
 *  one warm dark, cached once per archetype. Rocks have no drawn art and
 *  get a plain dark blot, which is what a rock's shadow is anyway. */
function silhouetteFor(e){
  const key = e.typeId + "|" + (e.elite ? 1 : 0);
  if(silCache[key] !== undefined) return silCache[key];
  let sil = null;
  const sprite = SF.enemyArt && SF.enemyArt.spriteFor(e.typeId, e.type.tint || "#c0392b", e.elite);
  if(sprite){
    const cv = document.createElement("canvas");
    cv.width = sprite.width; cv.height = sprite.height;
    const c = cv.getContext("2d");
    if(c){
      c.drawImage(sprite, 0, 0);
      c.globalCompositeOperation = "source-in";
      c.fillStyle = "#2b1a0c";
      c.fillRect(0, 0, cv.width, cv.height);
      sil = cv;
    }
  }
  silCache[key] = sil;
  return sil;
}

/**
 * Every real thing's shadow on the sand. Takes plain lists rather than the
 * World, because the death rewind (rewind.js) replays a stand-in world from
 * its tape and the shadows have to be there too - "oh, THAT one was real"
 * is half of what the replay exists to show on this level.
 */
function drawShadows(ctx, enemies, players, VH){
  const RES = (SF.enemyArt && SF.enemyArt.RES) || 128;
  ctx.save();
  for(let i = 0; i < enemies.length; i++){
    const e = enemies[i];
    if(!e.alive || e.mirage || e.attached || !e.type) continue;
    if(e.y < -20 || e.y > VH + 20) continue;
    const size = e.size * (0.4 + 0.6*Math.min(1, e.spawnAnim == null ? 1 : e.spawnAnim));
    const sil = silhouetteFor(e);
    const sx = e.x + SHADOW_DX, sy = e.y + SHADOW_DY;
    // A soft pool first: real shadows have a penumbra, and it is what makes
    // the hard silhouette on top read as ground rather than as a sticker.
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#2b1a0c";
    ctx.beginPath(); ctx.ellipse(sx, sy, size*0.52, size*0.42, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.55;
    if(sil){
      const box = size * sil.width / RES * 0.92;
      ctx.drawImage(sil, sx - box/2, sy - box/2, box, box);
    } else {
      ctx.beginPath(); ctx.ellipse(sx, sy, size*0.36, size*0.3, 0, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 0.55;
  // The squadron is real too - and its shadow is the first one a child sees,
  // right under their own ship, before any enemy has flown in.
  ctx.fillStyle = "#2b1a0c";
  for(let s = 0; s < players.length; s++){
    const p = players[s];
    if(!p || p.alive === false) continue;
    const k = (p.r || 13)/13;
    const sx = p.x + SHADOW_DX, sy = p.y + SHADOW_DY;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 19*k);
    ctx.lineTo(sx + 14*k, sy + 12*k);
    ctx.lineTo(sx, sy + 6*k);
    ctx.lineTo(sx - 14*k, sy + 12*k);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;
  const world = SF.game.world;
  if(!world) return;
  drawShadows(ctx, world.enemies.items, world.livePlayers(), VH);
}

/* ------------------------------------------------------------------ */
/*  DRAW - the ghost itself (called from render.drawEnemies)           */
/* ------------------------------------------------------------------ */

/** A mirage: the real sprite, sliced into bands that slide against each
 *  other like heat over a road. Touched, it shivers harder and thins - the
 *  shot that found nothing is written on the thing it found. */
function drawGhost(ctx, e, size, t){
  const RES = (SF.enemyArt && SF.enemyArt.RES) || 128;
  const sprite = SF.enemyArt && SF.enemyArt.spriteFor(e.typeId, e.type.tint || "#c0392b", e.elite);
  const k = 1 + (e.mirageHits || 0)*0.6;
  const breathe = 0.5 + Math.sin(t*6 + (e.phase || 0)*3)*0.5;
  ctx.save();
  ctx.globalAlpha = Math.max(0.28, 0.52 + 0.10*breathe - (e.mirageHits || 0)*0.1);
  if(sprite){
    const box = size * sprite.width / RES;
    const sw = sprite.width, sh = sprite.height;
    // Ten bands sliding twice as far as they used to. At six bands and two
    // pixels the lie was a clean sprite with a wobble nobody saw across a
    // busy sky; the ship has to look like it is coming apart in the heat.
    const bands = 10, bh = sh/bands, dh = box/bands;
    for(let i = 0; i < bands; i++){
      const off = Math.sin(t*9*k + i*1.7 + (e.phase || 0))*4.6*k;
      ctx.drawImage(sprite, 0, i*bh, sw, bh, e.x - box/2 + off, e.y - box/2 + i*dh, box, dh + 0.6);
    }
  } else {
    ctx.fillStyle = e.type.tint || "#c0392b";
    ctx.beginPath(); ctx.arc(e.x, e.y, size/2, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  DRAW - over the world: what the heat is doing                      */
/* ------------------------------------------------------------------ */

function drawOver(ctx, timeMs){
  if(!S) return;
  const RES = (SF.enemyArt && SF.enemyArt.RES) || 128;
  const VW = SF.game.VW || 600;

  // Ghosts coming apart: the bands fly sideways and fade, nothing bursts.
  for(const g of S.ghosts){
    const k = g.t/DISSOLVE;
    const sprite = SF.enemyArt && SF.enemyArt.spriteFor(g.typeId, g.tint, g.elite);
    if(!sprite) continue;
    const box = g.size * sprite.width / RES;
    const sw = sprite.width, sh = sprite.height;
    const bands = 6, bh = sh/bands, dh = box/bands;
    ctx.save();
    ctx.globalAlpha = 0.6*(1 - k);
    for(let i = 0; i < bands; i++){
      const dir = i % 2 ? 1 : -1;
      const off = dir*(Math.sin(i*1.7 + g.ph)*2 + k*k*46);
      ctx.drawImage(sprite, 0, i*bh, sw, bh, g.x - box/2 + off, g.y - box/2 + i*dh - k*8, box, dh + 0.6);
    }
    ctx.restore();
  }

  // Sand on the wind - the only thing on this world that moves without lying.
  ctx.fillStyle = "#fff1c4";
  for(const g of S.sand){
    ctx.globalAlpha = g.a;
    ctx.fillRect(g.x, g.y, g.s*1.6, g.s*0.7);
  }
  ctx.globalAlpha = 1;

  // The sun, hammering down from the corner every shadow points away from.
  const sx = VW*0.10, sy = 26;
  const glare = ctx.createRadialGradient(sx, sy, 0, sx, sy, 120);
  glare.addColorStop(0, "rgba(255,250,225,0.55)");
  glare.addColorStop(0.25, "rgba(255,236,170,0.22)");
  glare.addColorStop(1, "rgba(255,220,140,0)");
  ctx.fillStyle = glare;
  ctx.beginPath(); ctx.arc(sx, sy, 120, 0, TAU); ctx.fill();
}

SF.mirage = { _state: () => S,
              reset, begin, active, twin, eligible, seenThrough, onRealGone,
              hit, dissolve, update, drawSky, drawShadows, drawGhost, drawOver };
})();
