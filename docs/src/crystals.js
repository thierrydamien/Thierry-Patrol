/*
 * THE GLOW CAVE - shots bounce, bolts break.
 *
 * The Geode (skygen.js) is the inside of a world: a cavern lit by nothing
 * but what grows in it. This module is the crystals themselves - clusters
 * of light standing at ship height, drifting down the field with the floor
 * they grow from. Hulls fly through them (they are light, not stone), but a
 * ROUND cannot: yours ricochet off a facet and carry on, theirs shatter on
 * it like glass. So a crystal is two things at once - a mirror for your
 * guns and a wall for theirs - and choosing which is the whole level. Duck
 * under one and their fire breaks on it; angle a round into one and it
 * comes off the facet into a ship you could never have hit straight.
 *
 * Two stars for the two halves. "bounce" counts the ships destroyed by a
 * round that had already come off a crystal; "cover" counts their bolts
 * that broke on a crystal you were sheltering under.
 *
 * Same shape as the other world modules: a mission flag (`crystals`) plus
 * the hooks game.js already calls - begin/update, a draw pass under the
 * world (the pool of light each cluster throws on the floor) and one over
 * it (the shards, drawn glassy so a ship behind one is seen through it).
 * The ricochet is this file's own physics; the bounce star is paid at the
 * kill door in game.js and the cover star is counted here, where the bolt
 * dies.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

const HUES = [
  { name:"rose",  rgb:"255,96,196",  core:"#ffd6f1", edge:"#7a1d6b" },
  { name:"cyan",  rgb:"86,232,255",  core:"#e0fbff", edge:"#0e5f7a" },
  { name:"gold",  rgb:"255,214,102", core:"#fff4cf", edge:"#8a5a10" },
  { name:"violet",rgb:"168,120,255", core:"#eadfff", edge:"#3c1f7a" },
];
const COUNT = 6;                // clusters standing at once
const DRIFT = 7.5;              // the floor's own scroll rate (render.js)
const MAX_BOUNCES = 4;          // a round that will not stop is a round that leaves
const COVER_REACH = 120;        // how close under a crystal counts as sheltering

let S = null;

function reset(){ S = null; }

function begin(){
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S = { t: 0, clusters: [], sparks: [], bounces: 0, broken: 0, hueNext: 0, lastChime: -1 };
  for(let i = 0; i < COUNT; i++) grow(W, H, i/COUNT*H - 40, true);
}

function active(){ return !!S; }

/** Stand a new cluster up at `y` (or just above the top), clear of the others. */
function grow(W, H, y, anywhere){
  let x = 70 + Math.random()*(W - 140);
  for(let tries = 0; tries < 24; tries++){
    x = 70 + Math.random()*(W - 140);
    const yy = y == null ? -90 : y;
    if(S.clusters.every(c => (c.x - x)*(c.x - x) + (c.y - yy)*(c.y - yy) > 150*150)) break;
  }
  const hue = HUES[S.hueNext++ % HUES.length];
  const n = 3 + Math.floor(Math.random()*3);
  const shards = [];
  const base = Math.random()*TAU;
  for(let i = 0; i < n; i++){
    shards.push({ a: base + (i/n)*TAU + (Math.random() - 0.5)*0.5,
                  len: 26 + Math.random()*26, w: 9 + Math.random()*7,
                  lean: (Math.random() - 0.5)*0.35 });
  }
  const r = 30 + n*3.5;
  S.clusters.push({ x, y: y == null ? -90 : y, r, hue, shards, glow: 0, ph: Math.random()*TAU,
                    spin: (Math.random() - 0.5)*0.05 });
}

/** Where does a line from `p` cross cluster `c`'s circle? A unit normal at
 *  `p`, and the point on the rim `p` should be pushed out to. */
function normalAt(c, x, y){
  let dx = x - c.x, dy = y - c.y;
  let d = Math.hypot(dx, dy);
  if(d < 0.001){ dx = 0; dy = -1; d = 1; }
  return { nx: dx/d, ny: dy/d, d };
}

function update(dt, run, world){
  if(!S || run.ended) return;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;

  // The floor carries them; a cluster that leaves the bottom is replaced at the top.
  for(let i = S.clusters.length - 1; i >= 0; i--){
    const c = S.clusters[i];
    c.y += DRIFT*dt;
    if(c.glow > 0) c.glow = Math.max(0, c.glow - dt*2.2);
    if(c.y > H + 80){ S.clusters.splice(i, 1); grow(W, H, null); }
  }

  const seats = world.livePlayers();

  /*
   * YOUR ROUNDS RICOCHET. The reflection is the plain one - velocity mirrored
   * about the facet's normal - and the round is set back on the rim so it can
   * never be caught inside and reflected twice in a frame. Homing rounds
   * simply start steering again from their new heading.
   */
  const pb = world.bullets.items;
  for(let i = 0; i < pb.length; i++){
    const b = pb[i];
    if(!b.alive) continue;
    for(let k = 0; k < S.clusters.length; k++){
      const c = S.clusters[k];
      const rr = c.r + b.r;
      const dx = b.x - c.x, dy = b.y - c.y;
      if(dx*dx + dy*dy >= rr*rr) continue;
      const { nx, ny } = normalAt(c, b.x, b.y);
      const dot = b.vx*nx + b.vy*ny;
      if(dot >= 0){ b.x = c.x + nx*(rr + 1); b.y = c.y + ny*(rr + 1); continue; }   // already leaving
      b.vx -= 2*dot*nx; b.vy -= 2*dot*ny;
      b.x = c.x + nx*(rr + 1); b.y = c.y + ny*(rr + 1);
      b.bounced = (b.bounced || 0) + 1;
      S.bounces++;
      c.glow = 1;
      SF.fx.sparks(b.x, b.y, 4, c.hue.core, 120);
      SF.fx.ring(b.x, b.y, 10, c.hue.core, 1.5, 0.16);
      // A spread of five rounds can strike a facet in the same frame: one
      // chime per breath, or the cave rings like a dropped tray.
      if(S.t - S.lastChime > 0.07){ S.lastChime = S.t; SF.audio.play("chime", c.r, c.x); }
      if(b.bounced > MAX_BOUNCES) b.alive = false;
      break;
    }
  }

  /*
   * THEIR BOLTS BREAK. A bolt that reaches a crystal dies on it in a spray
   * of its own colour - and if you were sheltering under that crystal, it
   * was aimed at you, and the cover star knows.
   */
  const eb = world.enemyBullets.items;
  for(let i = 0; i < eb.length; i++){
    const b = eb[i];
    if(!b.alive) continue;
    for(let k = 0; k < S.clusters.length; k++){
      const c = S.clusters[k];
      const rr = c.r + b.r;
      const dx = b.x - c.x, dy = b.y - c.y;
      if(dx*dx + dy*dy >= rr*rr) continue;
      b.alive = false;
      S.broken++;
      c.glow = Math.max(c.glow, 0.6);
      SF.fx.sparks(b.x, b.y, 5, "#ffffff", 90);
      SF.audio.play("prism", null, c.x);
      let sheltered = false;
      for(let s = 0; s < seats.length && !sheltered; s++){
        const p = seats[s];
        if(!p.alive) continue;
        const px = p.x - c.x, py = p.y - c.y;
        if(py > 0 && px*px + py*py < COVER_REACH*COVER_REACH) sheltered = true;
      }
      if(sheltered && run.stats){
        run.stats.covered = (run.stats.covered || 0) + 1;
        if(run.stats.covered % 5 === 0) SF.comms.say("crystalCover");
      }
      break;
    }
  }

  for(let i = S.sparks.length - 1; i >= 0; i--){ const s = S.sparks[i]; s.t += dt; if(s.t > 0.4) S.sparks.splice(i, 1); }
}

/* ------------------------------------------------------------------ */
/*  DRAW - under the world: the light each cluster throws on the floor  */
/* ------------------------------------------------------------------ */

function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;
  for(const c of S.clusters){
    const pulse = 0.7 + Math.sin(S.t*1.3 + c.ph)*0.3;
    const R = c.r*2.6;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
    g.addColorStop(0, "rgba(" + c.hue.rgb + "," + (0.30*pulse + 0.35*c.glow).toFixed(3) + ")");
    g.addColorStop(0.5, "rgba(" + c.hue.rgb + "," + (0.12*pulse).toFixed(3) + ")");
    g.addColorStop(1, "rgba(" + c.hue.rgb + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.fill();
    // the dark base it grows from
    ctx.fillStyle = "rgba(14,8,26,0.7)";
    ctx.beginPath(); ctx.ellipse(c.x, c.y + 6, c.r*0.7, c.r*0.32, 0, 0, TAU); ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - over the world: the shards, glassy, and the ships through them */
/* ------------------------------------------------------------------ */

function shard(ctx, c, s, t){
  const a = s.a + c.spin*t;
  const tipX = c.x + Math.cos(a)*s.len, tipY = c.y + Math.sin(a)*s.len;
  const bx = c.x + Math.cos(a)*6, by = c.y + Math.sin(a)*6;
  const px = -Math.sin(a)*s.w*0.5, py = Math.cos(a)*s.w*0.5;
  const mx = c.x + Math.cos(a)*s.len*0.55, my = c.y + Math.sin(a)*s.len*0.55;
  // the body: a long facet lit from its core
  const g = ctx.createLinearGradient(bx - px, by - py, bx + px, by + py);
  g.addColorStop(0, c.hue.edge);
  g.addColorStop(0.42, c.hue.core);
  g.addColorStop(0.6, "rgb(" + c.hue.rgb + ")");
  g.addColorStop(1, c.hue.edge);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(bx - px, by - py);
  ctx.lineTo(mx - px*1.15, my - py*1.15);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(mx + px*1.15, my + py*1.15);
  ctx.lineTo(bx + px, by + py);
  ctx.closePath();
  ctx.fill();
  // the spine of light down the middle, and the rim
  ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bx + px*0.3, by + py*0.3); ctx.lineTo(tipX - Math.cos(a)*3, tipY - Math.sin(a)*3); ctx.stroke();
  ctx.strokeStyle = "rgba(" + c.hue.rgb + ",0.9)"; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(bx - px, by - py); ctx.lineTo(mx - px*1.15, my - py*1.15); ctx.lineTo(tipX, tipY);
  ctx.lineTo(mx + px*1.15, my + py*1.15); ctx.lineTo(bx + px, by + py);
  ctx.stroke();
}

function drawOver(ctx, timeMs){
  if(!S) return;
  for(const c of S.clusters){
    const pulse = 0.75 + Math.sin(S.t*2.1 + c.ph)*0.25;
    // the halo, brighter when a round has just struck it
    const halo = ctx.createRadialGradient(c.x, c.y, c.r*0.3, c.x, c.y, c.r*1.5);
    halo.addColorStop(0, "rgba(" + c.hue.rgb + "," + (0.22*pulse + 0.5*c.glow).toFixed(3) + ")");
    halo.addColorStop(1, "rgba(" + c.hue.rgb + ",0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r*1.5, 0, TAU); ctx.fill();
    // the shards, glassy: a ship behind one is seen through it
    ctx.save();
    ctx.globalAlpha = 0.78;
    for(const s of c.shards) shard(ctx, c, s, S.t);
    ctx.restore();
    // the heart
    const heart = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 9);
    heart.addColorStop(0, "rgba(255,255,255," + (0.9*pulse).toFixed(3) + ")");
    heart.addColorStop(1, "rgba(" + c.hue.rgb + ",0)");
    ctx.fillStyle = heart;
    ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, TAU); ctx.fill();
    if(c.glow > 0.05){
      ctx.strokeStyle = "rgba(255,255,255," + (0.8*c.glow).toFixed(3) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r*(1.05 + (1 - c.glow)*0.4), 0, TAU); ctx.stroke();
    }
  }
}

SF.crystals = { _state: () => S, reset, begin, active, update, drawSky, drawOver, grow, HUES };
})();
