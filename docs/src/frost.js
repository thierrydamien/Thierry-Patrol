/*
 * WHITEOUT - the cold that comes in fronts.
 *
 * Frostfall (skygen.js) is the far side of the desert world: the night side,
 * where the light the thieves took never reached and the sea froze where it
 * stood. This module is the weather. Every ten seconds or so a COLD FRONT
 * rolls across the sky: a lane lights up blue for two long seconds (the
 * telegraph - the same "this place, soon" language every warning in the game
 * speaks), then a wall of frost sweeps along it from one edge to the other.
 * Anything it passes over freezes solid. THEIR ships stop dead and hang in
 * the air, guns cold, and a frozen ship shatters in a single hit - but for
 * only five seconds, so the harvest has to be quick. YOUR ship freezes too:
 * no stick, no guns for a second and a half, while the wave keeps coming.
 * Never a life - the hull is invulnerable under the ice - just time, which is
 * the fairest thing a seven-year-old can lose.
 *
 * Two stars pay for the two halves of the lesson: "shatter" for harvesting
 * what the cold left (objectives: shatter, a `shattered` counter), and
 * "stayWarm" for never being in the lane when it lit (a `frozenTimes`
 * counter that the star asks to stay at zero).
 *
 * Same shape as volcano.js and mirage.js: a mission flag (`frost`) plus the
 * hooks game.js already calls - begin/update, a draw pass under the world
 * (the ice the fronts leave on the ground) and one over it (the lane, the
 * front, the snow, the ice on a frozen ship). The COSTS live in game.js
 * beside the volcano's, where onPlayerHit and onEnemyKilled exist: this file
 * owns what a front looks like and where it is; game.js owns what it does.
 *
 * Drawn cheaply on purpose: the lane is two gradients, the front is one
 * gradient and a line, the ice on a ship is a rounded rect. No full-screen
 * wash - the Dive's frame-budget lesson holds on the ice as well.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;
const T = s => (SF.i18n ? SF.i18n.t(s) : s);

/* How long the ice holds. Theirs is long enough to fly to and shatter,
 * short enough that a child cannot wait for the whole sky to freeze and
 * stroll through it; yours is a beat, not a punishment. */
const FREEZE_SECS = 5.0;
const PLAYER_FREEZE_SECS = 1.5;
/* The telegraph, the sweep, and the gap between fronts. */
const WARN_SECS = 2.2;
const SPEED = 300;              // px/s along the lane
const BAND = 120;               // how deep the wall of frost is
const FIRST_AT = 6.0;           // the first front comes early, as a lesson

let S = null;

function reset(){ S = null; }

function begin(){
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S = { t: 0, fronts: [], rime: [], snow: [], nextFront: FIRST_AT,
        frozenShips: 0, frontsRun: 0 };
  for(let i = 0; i < 40; i++)
    S.snow.push({ x: Math.random()*W, y: Math.random()*H,
                  vx: -(4 + Math.random()*14), vy: 18 + Math.random()*26,
                  s: 1 + Math.random()*1.6, a: 0.25 + Math.random()*0.35,
                  ph: Math.random()*TAU });
}

function active(){ return !!S; }

/**
 * The fronts that are sweeping right now - the only ones game.js may charge
 * for. Each carries the rect the frost occupies this frame.
 */
function liveFronts(){
  if(!S) return [];
  const out = [];
  for(const f of S.fronts){
    if(f.phase !== "sweep") continue;
    const x0 = f.dir > 0 ? f.x - BAND : f.x, x1 = x0 + BAND;
    out.push({ x0, x1, y0: f.y0, y1: f.y1, f });
  }
  return out;
}

function inFront(fr, x, y){
  return x >= fr.x0 && x <= fr.x1 && y >= fr.y0 && y <= fr.y1;
}

function update(dt, run, world){
  if(!S || run.ended) return;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;
  const drift = 7.5*dt;      // the ground's own scroll rate (render.js)

  const fighting = run.phase !== "intro" && run.phase !== "lap" && run.phase !== "outro";
  if(fighting){
    S.nextFront -= dt;
    if(S.nextFront <= 0){
      S.nextFront = 7 + Math.random()*3;
      // A lane roughly half the height, anywhere the fight can be.
      const span = H*(0.40 + Math.random()*0.14);
      const top = SF.entityConst.PLAY_TOP || 60;
      const y0 = top + Math.random()*(H - top - span - 40);
      const dir = Math.random() < 0.5 ? 1 : -1;
      S.fronts.push({ phase: "warn", timer: WARN_SECS, y0, y1: y0 + span, dir,
                      x: dir > 0 ? -BAND : W + BAND, id: ++S.frontsRun });
      SF.audio.play("telegraph");
      SF.comms.say("frostWarn");
    }
  }

  for(let i = S.fronts.length - 1; i >= 0; i--){
    const f = S.fronts[i];
    f.y0 += drift; f.y1 += drift;
    if(f.phase === "warn"){
      f.timer -= dt;
      if(f.timer <= 0){ f.phase = "sweep"; SF.audio.play("gust"); }
    } else if(f.phase === "sweep"){
      f.x += f.dir*SPEED*dt;
      // Rime where the wall has just been: the ground remembers the cold.
      if(Math.random() < dt*22)
        S.rime.push({ x: f.dir > 0 ? f.x - BAND*Math.random() : f.x + BAND*Math.random(),
                      y: f.y0 + Math.random()*(f.y1 - f.y0), r: 8 + Math.random()*16, a: 0.5 });
      if(f.dir > 0 ? f.x - BAND > W + 10 : f.x + BAND < -10) S.fronts.splice(i, 1);
    }
  }

  for(let i = S.rime.length - 1; i >= 0; i--){
    const r = S.rime[i];
    r.y += drift; r.a -= dt*0.16;
    if(r.a <= 0 || r.y > H + 40) S.rime.splice(i, 1);
  }

  for(const s of S.snow){
    s.ph += dt*1.4;
    s.x += (s.vx + Math.sin(s.ph)*10)*dt; s.y += s.vy*dt;
    if(s.x < -4) s.x = W + 4;
    if(s.y > H + 4){ s.y = -4; s.x = Math.random()*W; }
  }
}

/* ------------------------------------------------------------------ */
/*  FREEZING - the state changes, called by game.js when a front hits   */
/* ------------------------------------------------------------------ */

/** Ice takes a ship: it stops where it is, guns cold, for FREEZE_SECS. */
function freezeEnemy(e){
  if(!S || !e.alive || e.frozen > 0) return false;
  e.frozen = FREEZE_SECS;
  e.frozenVx = e.vx; e.frozenVy = e.vy;
  e.vx = 0; e.vy = 0;
  e.fireTimer = Math.max(e.fireTimer, FREEZE_SECS + 0.4);   // and stays cold a beat after
  S.frozenShips++;
  SF.fx.ring(e.x, e.y, e.r + 8, "#dff4ff", 2, 0.3);
  SF.fx.sparks(e.x, e.y, 6, "#ffffff", 90);
  return true;
}

/** Ice takes the pilot: a beat with no stick and no guns, and no damage. */
function freezePlayer(p){
  if(!S || !p.alive || p.frozen > 0) return false;
  p.frozen = PLAYER_FREEZE_SECS;
  p.invuln = Math.max(p.invuln, PLAYER_FREEZE_SECS + 0.2);
  p.vx = 0; p.vy = 0;
  SF.fx.ring(p.x, p.y, p.r + 14, "#dff4ff", 3, 0.4);
  SF.fx.sparks(p.x, p.y, 10, "#ffffff", 120);
  SF.fx.text(p.x, p.y - 44, T("FROZEN!"), "#dff4ff", 18, true);
  SF.audio.play("freeze", null, p.x);
  return true;
}

/* ------------------------------------------------------------------ */
/*  DRAW - under the world: the ice the fronts leave                    */
/* ------------------------------------------------------------------ */

function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;
  // Rime on the ground where a front passed: proof the weather is real.
  for(const r of S.rime){
    const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.r);
    g.addColorStop(0, "rgba(255,255,255," + (r.a*0.8).toFixed(3) + ")");
    g.addColorStop(0.6, "rgba(223,244,255," + (r.a*0.4).toFixed(3) + ")");
    g.addColorStop(1, "rgba(223,244,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - the ice on a ship (called from render.drawEnemies, and here  */
/*  for the pilot)                                                      */
/* ------------------------------------------------------------------ */

/**
 * A block of ice around a hull: pale, faceted, with the cracks that say it
 * will break. `k` is how much of the freeze is left (1 = just caught), so a
 * thawing block goes glassy and thin before it lets go.
 */
function drawIce(ctx, x, y, size, t, k){
  const w = size*0.62, h = size*0.62, r = size*0.16;
  const a = 0.35 + 0.35*Math.min(1, k == null ? 1 : k);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.18);
  // the block
  const g = ctx.createLinearGradient(-w, -h, w, h);
  g.addColorStop(0, "rgba(244,249,255," + (a*0.95).toFixed(3) + ")");
  g.addColorStop(0.5, "rgba(190,224,248," + (a*0.75).toFixed(3) + ")");
  g.addColorStop(1, "rgba(150,196,236," + (a*0.9).toFixed(3) + ")");
  ctx.fillStyle = g;
  roundRect(ctx, -w, -h, w*2, h*2, r); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255," + (0.55 + 0.35*Math.min(1, k == null ? 1 : k)).toFixed(3) + ")";
  ctx.lineWidth = 1.6;
  roundRect(ctx, -w, -h, w*2, h*2, r); ctx.stroke();
  // facets: two highlight strokes, one crack
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-w*0.7, -h*0.85); ctx.lineTo(-w*0.2, -h*0.95); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-w*0.9, -h*0.3); ctx.lineTo(-w*0.85, h*0.3); ctx.stroke();
  ctx.strokeStyle = "rgba(90,140,190,0.7)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w*0.2, -h*0.6); ctx.lineTo(w*0.05, 0); ctx.lineTo(w*0.45, h*0.5); ctx.stroke();
  // a glint that wanders, so a frozen ship is never still
  const gx = Math.cos(t*2.1 + x*0.01)*w*0.5, gy = Math.sin(t*1.7 + y*0.01)*h*0.5;
  const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, size*0.22);
  gl.addColorStop(0, "rgba(255,255,255,0.7)"); gl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(gx, gy, size*0.22, 0, TAU); ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/*  DRAW - over the world: the lane, the wall, the snow                 */
/* ------------------------------------------------------------------ */

function drawOver(ctx, timeMs){
  if(!S) return;
  const VW = SF.game.VW || 600;

  for(const f of S.fronts){
    if(f.phase === "warn"){
      /*
       * THE TELEGRAPH, and it has to be unmissable: the whole lane goes
       * blue and breathes faster as the front gets close, and the edge it
       * will come from burns white. A child reads "not THERE" in one look,
       * which is the entire lesson.
       */
      const k = 1 - Math.max(0, f.timer)/WARN_SECS;             // 0 -> 1 over the warning
      const pulse = 0.6 + Math.sin(S.t*(6 + k*10))*0.4;
      /*
       * A SATURATED blue, not a pale one. The first cut tinted the lane with
       * the ice's own colour and it vanished into the sheet from across the
       * room; the one thing this level cannot afford is a warning you have
       * to hunt for. Deep blue on white ice reads at a glance.
       */
      const a = 0.22 + 0.22*k*pulse;
      const lane = ctx.createLinearGradient(0, f.y0, 0, f.y1);
      lane.addColorStop(0, "rgba(60,130,255,0)");
      lane.addColorStop(0.12, "rgba(60,130,255," + a.toFixed(3) + ")");
      lane.addColorStop(0.88, "rgba(60,130,255," + a.toFixed(3) + ")");
      lane.addColorStop(1, "rgba(60,130,255,0)");
      ctx.fillStyle = lane;
      ctx.fillRect(0, f.y0, VW, f.y1 - f.y0);
      // the edge it comes from
      const ex = f.dir > 0 ? 0 : VW;
      const eg = ctx.createLinearGradient(ex, 0, ex + f.dir*90, 0);
      eg.addColorStop(0, "rgba(255,255,255," + (0.35 + 0.5*k*pulse).toFixed(3) + ")");
      eg.addColorStop(1, "rgba(220,240,255,0)");
      ctx.fillStyle = eg;
      ctx.fillRect(f.dir > 0 ? 0 : VW - 90, f.y0, 90, f.y1 - f.y0);
      // the lane's rails: hard blue lines, so the edges are exact
      ctx.strokeStyle = "rgba(40,110,240," + (0.45 + 0.5*k).toFixed(3) + ")";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, f.y0); ctx.lineTo(VW, f.y0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, f.y1); ctx.lineTo(VW, f.y1); ctx.stroke();
    } else {
      /*
       * THE WALL. A deep band of white-blue with a hard bright leading edge,
       * and crystals thrown ahead of it - the thing that is coming for you,
       * drawn like weather rather than like a hitbox.
       */
      const x0 = f.dir > 0 ? f.x - BAND : f.x;
      const g = ctx.createLinearGradient(x0, 0, x0 + BAND, 0);
      if(f.dir > 0){
        g.addColorStop(0, "rgba(220,240,255,0)");
        g.addColorStop(0.55, "rgba(230,245,255,0.55)");
        g.addColorStop(1, "rgba(255,255,255,0.9)");
      } else {
        g.addColorStop(0, "rgba(255,255,255,0.9)");
        g.addColorStop(0.45, "rgba(230,245,255,0.55)");
        g.addColorStop(1, "rgba(220,240,255,0)");
      }
      ctx.fillStyle = g;
      ctx.fillRect(x0, f.y0, BAND, f.y1 - f.y0);
      ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(f.x, f.y0); ctx.lineTo(f.x, f.y1); ctx.stroke();
      // crystals ahead of the edge
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for(let i = 0; i < 9; i++){
        const yy = f.y0 + ((i*0.117 + S.t*0.35) % 1)*(f.y1 - f.y0);
        const dx = f.dir*(6 + ((i*37) % 26));
        ctx.fillRect(f.x + dx, yy, 2, 2);
      }
    }
  }

  // The pilot under the ice.
  const world = SF.game.world;
  if(world){
    const seats = world.livePlayers();
    for(let i = 0; i < seats.length; i++){
      const p = seats[i];
      if(p.alive && p.frozen > 0) drawIce(ctx, p.x, p.y, 62, timeMs/1000, p.frozen/PLAYER_FREEZE_SECS);
    }
  }

  // Snow, always: the quiet reminder of where you are.
  ctx.fillStyle = "#ffffff";
  for(const s of S.snow){
    ctx.globalAlpha = s.a;
    ctx.fillRect(s.x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;
}

SF.frost = { _state: () => S,
             reset, begin, active, liveFronts, inFront, freezeEnemy, freezePlayer,
             update, drawSky, drawIce, drawOver,
             FREEZE_SECS, PLAYER_FREEZE_SECS };
})();
