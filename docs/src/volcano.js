/*
 * THE FORGE WORLD - the eruptions.
 *
 * Emberfall's backdrop (skygen.js) is the cooled floor; this module is the
 * part that is still molten. Vents open under the fight, roar for a readable
 * two-and-a-half seconds, then throw a fan of molten bombs up to ship
 * altitude - and the bombs are the level's whole idea: they hurt the
 * squadron AND they melt the enemy's metal, so the smart flying is to get
 * out from over the roar and drag the waves back across it. The star for it
 * (objectives: "melt") pays the tactic; the kills themselves route through
 * the flare's no-pay path so the coin ledger stays honest.
 *
 * Same shape as dive.js: a mission flag (`volcano`) plus hooks game.js
 * already calls - begin/update, a draw pass under the world (vents, scars)
 * and one over it (bombs, ash). The COLLISIONS do not live here: they sit
 * in game.js beside the solar flare's, because that is where onPlayerHit
 * and onEnemyKilled exist and every other world-hurts-you rule already
 * lives. This file owns what the eruption looks like; game.js owns what it
 * costs.
 *
 * Everything is drawn as small local fills on purpose. The Dive taught the
 * frame budget lesson: one full-screen wash halves a software rasterizer,
 * so this level has none - the heat lives in the floor and the bombs.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

let S = null;

/* A bomb's life in three acts: rising out of the throat (harmless, growing),
 * flying at ship altitude (the hazard), falling back (harmless, shrinking). */
const RISE = 0.62, FALL = 0.55, LIFE = 3.1;

function reset(){ S = null; }

function begin(){
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S = { t: 0, vents: [], bombs: [], stains: [], ash: [],
        nextVent: 4.5,                 // the first roar comes early, as a lesson
        roared: false };
  for(let i = 0; i < 34; i++)
    S.ash.push({ x: Math.random()*W, y: Math.random()*H,
                 vx: -(6 + Math.random()*10), vy: 10 + Math.random()*16,
                 s: 1 + Math.random()*1.4, a: 0.10 + Math.random()*0.14 });
}

function active(){ return !!S; }

/** The bombs currently at ship altitude - the only ones game.js may charge
 *  for. A bomb marked spent has already splashed on a hull. */
function liveBombs(){
  if(!S) return [];
  return S.bombs.filter(b => !b.spent && b.t > RISE && b.t < LIFE - FALL);
}

function update(dt, run, world){
  if(!S || run.ended) return;
  const fx = SF.fx, audio = SF.audio;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;

  // The floor scrolls at the surface rate (render.js); everything parked on
  // it drifts with it, or the scars would slide against their own ground.
  const drift = 7.5*dt;

  const fighting = run.phase !== "intro" && run.phase !== "lap" && run.phase !== "outro";
  if(fighting){
    S.nextVent -= dt;
    if(S.nextVent <= 0){
      S.nextVent = 9 + Math.random()*5;
      S.vents.push({ x: 60 + Math.random()*(W - 120),
                     y: H*(0.20 + Math.random()*0.42),
                     phase: "warm", timer: 2.6, r: 26 });
      audio.play("telegraph");
      SF.comms.say("volcanoRoar");
    }
  }

  for(let i = S.vents.length - 1; i >= 0; i--){
    const v = S.vents[i];
    v.y += drift;
    v.timer -= dt;
    if(v.phase === "warm" && v.timer <= 0){
      v.phase = "erupt"; v.timer = 0.5;
      fx.shake(8);
      fx.flash(0.3, "255,150,60");
      audio.play("gust");
      const n = 6 + Math.floor(Math.random()*3);
      for(let k = 0; k < n; k++){
        const a = Math.random()*TAU, sp = 60 + Math.random()*95;
        S.bombs.push({ x: v.x, y: v.y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
                       t: 0, r: 9 + Math.random()*4, ph: Math.random()*TAU });
      }
    } else if(v.phase === "erupt" && v.timer <= 0){
      v.phase = "cool"; v.timer = 1.4;
    } else if(v.phase === "cool" && v.timer <= 0){
      S.stains.push({ x: v.x, y: v.y, r: v.r*0.9, a: 0.5 });
      S.vents.splice(i, 1);
    }
  }

  for(let i = S.bombs.length - 1; i >= 0; i--){
    const b = S.bombs[i];
    b.t += dt;
    b.x += b.vx*dt; b.y += b.vy*dt + drift;
    b.vx *= 1 - 0.22*dt; b.vy *= 1 - 0.22*dt;
    // molten things shed sparks; cheap ones, and not every frame
    if(!b.spent && Math.random() < dt*7)
      fx.spark(b.x, b.y, (Math.random() - 0.5)*40, (Math.random() - 0.5)*40,
               "#ff8a3c", 0.25, 2.2);
    if(b.spent || b.t >= LIFE){
      if(!b.spent){                                  // it landed, nobody paid
        fx.ring(b.x, b.y, 22, "#ff8a3c", 3, 0.3);
        S.stains.push({ x: b.x, y: b.y, r: 10, a: 0.45 });
      }
      S.bombs.splice(i, 1);
    }
  }

  for(let i = S.stains.length - 1; i >= 0; i--){
    const st = S.stains[i];
    st.y += drift; st.a -= dt*0.22;
    if(st.a <= 0 || st.y > H + 40) S.stains.splice(i, 1);
  }

  for(const a of S.ash){
    a.x += a.vx*dt; a.y += a.vy*dt;
    if(a.x < -4) a.x = W + 4;
    if(a.y > H + 4){ a.y = -4; a.x = Math.random()*W; }
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - under the world: the ground's side of the story             */
/* ------------------------------------------------------------------ */

function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;

  // Cooling scars where lava landed - proof the eruptions are real.
  for(const st of S.stains){
    const g = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.r*1.6);
    g.addColorStop(0, "rgba(255,138,60," + (st.a*0.7).toFixed(3) + ")");
    g.addColorStop(0.6, "rgba(184,58,16," + (st.a*0.4).toFixed(3) + ")");
    g.addColorStop(1, "rgba(94,22,6,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(st.x, st.y, st.r*1.6, 0, TAU); ctx.fill();
  }

  for(const v of S.vents){
    if(v.phase === "warm"){
      /*
       * The telegraph, and it must be unmissable: the throat brightens, and
       * a ring closes on it like a countdown - the same "this spot, soon"
       * language every telegraph in the game speaks.
       */
      const k = 1 - Math.max(0, v.timer)/2.6;          // 0 -> 1 over the roar
      const pulse = 0.75 + Math.sin(S.t*10)*0.25;
      const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r*(0.6 + k));
      g.addColorStop(0, "rgba(255,233,160," + (0.5*k*pulse).toFixed(3) + ")");
      g.addColorStop(0.5, "rgba(255,138,60," + (0.32*k*pulse).toFixed(3) + ")");
      g.addColorStop(1, "rgba(184,58,16,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r*(0.6 + k), 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(255,138,60," + (0.25 + 0.45*k).toFixed(3) + ")";
      ctx.lineWidth = 2;
      const ringR = v.r*(3.0 - 2.0*k);
      ctx.beginPath(); ctx.arc(v.x, v.y, ringR, 0, TAU); ctx.stroke();
    } else if(v.phase === "erupt"){
      const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r*2.2);
      g.addColorStop(0, "rgba(255,246,200,0.9)");
      g.addColorStop(0.4, "rgba(255,138,60,0.5)");
      g.addColorStop(1, "rgba(184,58,16,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r*2.2, 0, TAU); ctx.fill();
    } else {                                           // cool: the glow lets go
      const k = Math.max(0, v.timer)/1.4;
      const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r*1.4);
      g.addColorStop(0, "rgba(255,138,60," + (0.4*k).toFixed(3) + ")");
      g.addColorStop(1, "rgba(94,22,6,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r*1.4, 0, TAU); ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - over the world: what's flying                               */
/* ------------------------------------------------------------------ */

function drawOver(ctx, timeMs){
  if(!S) return;

  for(const b of S.bombs){
    if(b.spent) continue;
    // three acts: swell out of the throat, fly, sink back
    const k = b.t < RISE ? 0.25 + 0.75*(b.t/RISE)
            : b.t > LIFE - FALL ? Math.max(0.2, (LIFE - b.t)/FALL)
            : 1;
    const r = b.r*k;
    const live = b.t > RISE && b.t < LIFE - FALL;
    const g = ctx.createRadialGradient(b.x - r*0.25, b.y - r*0.25, 0, b.x, b.y, r);
    g.addColorStop(0, "#ffe9a0");
    g.addColorStop(0.55, "#ff8a3c");
    g.addColorStop(1, live ? "#b83a10" : "#5e1606");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
    // dark crust flecks, so it reads as rock that is molten - not a bullet
    ctx.fillStyle = "rgba(30,10,4,0.7)";
    ctx.beginPath(); ctx.arc(b.x + r*0.4, b.y + r*0.2, r*0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x - r*0.3, b.y + r*0.45, r*0.2, 0, TAU); ctx.fill();
    if(live){
      const halo = ctx.createRadialGradient(b.x, b.y, r, b.x, b.y, r*2);
      halo.addColorStop(0, "rgba(255,138,60,0.28)");
      halo.addColorStop(1, "rgba(255,138,60,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(b.x, b.y, r*2, 0, TAU); ctx.fill();
    }
  }

  // Ash on the wind - the quiet reminder of where you are.
  ctx.fillStyle = "rgba(160,150,145,0.5)";
  for(const a of S.ash){
    ctx.globalAlpha = a.a;
    ctx.fillRect(a.x, a.y, a.s, a.s);
  }
  ctx.globalAlpha = 1;
}

SF.volcano = { _state: () => S,
               reset, begin, active, liveBombs, update, drawSky, drawOver };
})();
