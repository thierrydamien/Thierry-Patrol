/*
 * THE MOON OF DOORS - every door has a twin.
 *
 * The Threshold (skygen.js) is a dead moon paved with roads that lead to
 * gates, built by whoever lived here before the thieves found it. This
 * module is the gates. Two pairs stand open in the sky at a time, teal and
 * rose, and anything that flies into one comes out of its twin with its
 * speed and heading intact: THEIR ships, THEIR bolts, and YOUR rounds. Not
 * you - the doors are keyed to their metal now, and the squadron flies over
 * a disc like it is painted on the floor. Every twenty seconds or so the
 * runes go dark and the pairs stand up again somewhere else.
 *
 * The lesson has two halves and the two stars pay for them. A round fired
 * INTO a low door comes out of its high twin on top of the fleet before the
 * fleet has arrived - "doorShots" counts the ships destroyed by a round that
 * went through. And a ship that dives into a high door arrives from a low
 * one, sometimes right beside you - "doorAmbush" counts the ships destroyed
 * within a beat of stepping through, before they can turn.
 *
 * Same shape as the other world modules: a mission flag (`doors`) and the
 * hooks game.js already calls - begin/update, a draw pass under the world
 * (the stones and the discs, so ships fly over them) and one over it (the
 * motes and the flash of a passing). The teleports are this file's own
 * physics; the stars are paid at the kill door in game.js.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

const PAIRS = [
  { hue:"#48e5c2", deep:"#0f6b5c", rgb:"72,229,194" },      // teal
  { hue:"#ff5dbb", deep:"#7a1d55", rgb:"255,93,187" },      // rose
];
const GATE_R = 38;              // the disc a thing has to touch
const OPEN_SECS = 1.2;          // runes lighting up
const LIFE_SECS = 19;           // how long a pair stands
const CLOSE_SECS = 0.9;
const COOL = 0.7;               // no door twice in the same breath
const AMBUSH_SECS = 2.6;        // how long "just stepped through" lasts

let S = null;

function reset(){ S = null; }

function begin(){
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S = { t: 0, gates: [], life: 0, phase: "open", k: 0, motes: [], flashes: [],
        passes: 0, arrangements: 0 };
  arrange(W, H);
  for(let i = 0; i < 60; i++) S.motes.push(newMote(W, H));
}

function newMote(W, H){
  return { g: Math.floor(Math.random()*4), a: Math.random()*TAU, d: 60 + Math.random()*70,
           sp: 0.6 + Math.random()*0.8, s: 1 + Math.random()*1.4 };
}

/**
 * Stand the two pairs up. One door of each pair in the high band, where the
 * waves come in, and its twin low or wide, where you are - so a diving ship
 * that takes a high door arrives among you, and a round you fire into a low
 * door arrives among them. Nothing on top of anything else.
 */
function arrange(W, H){
  const top = (SF.entityConst && SF.entityConst.PLAY_TOP) || 60;
  const placed = [];
  const far = (x, y, min) => placed.every(g => (g.x - x)*(g.x - x) + (g.y - y)*(g.y - y) > min*min);
  const pick = (yLo, yHi, tries) => {
    for(let i = 0; i < tries; i++){
      const x = 80 + Math.random()*(W - 160), y = yLo + Math.random()*(yHi - yLo);
      if(far(x, y, 170)) return { x, y };
    }
    return { x: 80 + Math.random()*(W - 160), y: (yLo + yHi)/2 };
  };
  S.gates.length = 0;
  for(let p = 0; p < PAIRS.length; p++){
    const a = pick(top + 70, top + 210, 30);
    placed.push(a);
    const b = pick(H*0.48, H*0.80, 30);
    placed.push(b);
    const ga = { x: a.x, y: a.y, r: GATE_R, pair: p, twin: null, ph: Math.random()*TAU };
    const gb = { x: b.x, y: b.y, r: GATE_R, pair: p, twin: null, ph: Math.random()*TAU };
    ga.twin = gb; gb.twin = ga;
    S.gates.push(ga, gb);
  }
  S.life = LIFE_SECS; S.phase = "open"; S.k = 0;
  S.arrangements++;
}

function active(){ return !!S; }
/** Are the doors answering right now? Only a fully lit pair takes anything. */
function open(){ return !!S && S.phase === "open" && S.k >= 0.85; }

/** The door `x,y` is standing in, if any. */
function gateAt(x, y, r){
  if(!open()) return null;
  for(const g of S.gates){
    const dx = x - g.x, dy = y - g.y, rr = g.r + (r || 0)*0.5;
    if(dx*dx + dy*dy < rr*rr) return g;
  }
  return null;
}

/** Send a thing through: it leaves the twin the way it was going. */
function pass(o, g){
  const t = g.twin;
  const sp = Math.hypot(o.vx || 0, o.vy || 0);
  const ux = sp > 1 ? o.vx/sp : 0, uy = sp > 1 ? o.vy/sp : 1;
  o.x = t.x + ux*(t.r + 8); o.y = t.y + uy*(t.r + 8);
  o.doorCool = COOL;
  S.passes++;
  const pr = PAIRS[g.pair];
  S.flashes.push({ x: g.x, y: g.y, t: 0, rgb: pr.rgb }, { x: t.x, y: t.y, t: 0, rgb: pr.rgb });
  SF.audio.play("portal", null, t.x);
}

function update(dt, run, world){
  if(!S || run.ended) return;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;

  // The stand: light up, stand, go dark, stand up again elsewhere.
  if(S.phase === "open"){
    S.k = Math.min(1, S.k + dt/OPEN_SECS);
    S.life -= dt;
    if(S.life <= 0){ S.phase = "close"; }
  } else {
    S.k = Math.max(0, S.k - dt/CLOSE_SECS);
    if(S.k <= 0){ arrange(W, H); SF.audio.play("telegraph"); }
  }

  const fighting = run.phase !== "intro" && run.phase !== "lap" && run.phase !== "outro";
  if(fighting && open()){
    // Their ships.
    const items = world.enemies.items;
    for(let i = 0; i < items.length; i++){
      const e = items[i];
      if(e.throughDoor > 0) e.throughDoor -= dt;
      if(e.doorCool > 0){ e.doorCool -= dt; continue; }
      if(!e.alive || e.entering || e.attached || e.hazard) continue;
      const g = gateAt(e.x, e.y, e.r);
      if(g){
        pass(e, g);
        e.throughDoor = AMBUSH_SECS;
        // A hover-type keeps its station height on the far side; a diver
        // just keeps diving. Both are what the fiction promised.
        SF.comms.say("doorAmbush");
      }
    }
    // Their bolts, and yours.
    const eb = world.enemyBullets.items;
    for(let i = 0; i < eb.length; i++){
      const b = eb[i];
      if(!b.alive) continue;
      if(b.doorCool > 0){ b.doorCool -= dt; continue; }
      const g = gateAt(b.x, b.y, b.r);
      if(g) pass(b, g);
    }
    const pb = world.bullets.items;
    for(let i = 0; i < pb.length; i++){
      const b = pb[i];
      if(!b.alive) continue;
      if(b.doorCool > 0){ b.doorCool -= dt; continue; }
      const g = gateAt(b.x, b.y, b.r);
      if(g){ pass(b, g); b.doored = true; }
    }
  } else {
    // Cooldowns still run down while a pair is dark, so nothing is stuck.
    const items = world.enemies.items;
    for(let i = 0; i < items.length; i++){
      const e = items[i];
      if(e.throughDoor > 0) e.throughDoor -= dt;
      if(e.doorCool > 0) e.doorCool -= dt;
    }
  }

  for(const m of S.motes){ m.a += dt*m.sp*(1.2 + 0.6*S.k); m.d -= dt*(18 + 30*S.k); if(m.d < 6){ m.d = 60 + Math.random()*70; m.a = Math.random()*TAU; } }
  for(let i = S.flashes.length - 1; i >= 0; i--){ const f = S.flashes[i]; f.t += dt; if(f.t > 0.45) S.flashes.splice(i, 1); }
}

/* ------------------------------------------------------------------ */
/*  DRAW - under the world: the stones, the discs, the thread           */
/* ------------------------------------------------------------------ */

function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;
  const k = S.k;
  const ease = k*k*(3 - 2*k);

  // The thread between twins: faint, so a child can SEE which door leads
  // where without being told - a lesson drawn rather than said.
  for(let p = 0; p < PAIRS.length; p++){
    const a = S.gates[p*2], b = S.gates[p*2 + 1];
    const pr = PAIRS[p];
    ctx.save();
    ctx.strokeStyle = "rgba(" + pr.rgb + "," + (0.14*ease).toFixed(3) + ")";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 10]);
    ctx.lineDashOffset = -S.t*30;
    const mx = (a.x + b.x)/2 + (b.y - a.y)*0.18, my = (a.y + b.y)/2 - (b.x - a.x)*0.18;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  for(const g of S.gates){
    const pr = PAIRS[g.pair];
    const R = g.r;
    // The shadow the ring throws on the dust: the planet-light comes from the
    // upper right, so everything on this moon leans its shade down-left.
    ctx.fillStyle = "rgba(20,16,36,0.35)";
    ctx.beginPath(); ctx.ellipse(g.x - 9, g.y + 11, R*1.15, R*0.55, 0, 0, TAU); ctx.fill();

    // The ring of stones, warm on the lit side.
    for(let i = 0; i < 12; i++){
      const a = (i/12)*TAU + g.ph;
      const sx = g.x + Math.cos(a)*R*1.08, sy = g.y + Math.sin(a)*R*1.08;
      const lit = Math.cos(a + Math.PI*0.75);            // faces up-right
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
      ctx.fillStyle = lit > 0 ? "#5c5678" : "#3a3550";
      ctx.fillRect(-5, -7, 10, 14);
      ctx.fillStyle = lit > 0 ? "rgba(240,197,138,0.55)" : "rgba(240,197,138,0.12)";
      ctx.fillRect(-5, -7, 10, 3);
      ctx.restore();
    }

    // The disc: the pair's light, breathing, gathered toward the middle.
    if(ease > 0.02){
      const pulse = 0.85 + Math.sin(S.t*3 + g.ph)*0.15;
      const disc = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, R*0.95*ease);
      disc.addColorStop(0, "rgba(255,255,255," + (0.85*ease*pulse).toFixed(3) + ")");
      disc.addColorStop(0.25, "rgba(" + pr.rgb + "," + (0.75*ease).toFixed(3) + ")");
      disc.addColorStop(0.75, "rgba(" + pr.rgb + "," + (0.35*ease).toFixed(3) + ")");
      disc.addColorStop(1, "rgba(" + pr.rgb + ",0)");
      ctx.fillStyle = disc;
      ctx.beginPath(); ctx.arc(g.x, g.y, R*0.95*ease, 0, TAU); ctx.fill();
      // two arms of light turning in it
      ctx.save();
      ctx.translate(g.x, g.y); ctx.rotate(S.t*1.6 + g.ph);
      ctx.strokeStyle = "rgba(255,255,255," + (0.5*ease).toFixed(3) + ")";
      ctx.lineWidth = 2; ctx.lineCap = "round";
      for(let arm = 0; arm < 2; arm++){
        ctx.beginPath();
        for(let i = 0; i <= 12; i++){
          const t = i/12, ang = arm*Math.PI + t*2.4, rr = R*0.15 + t*R*0.7*ease;
          const x = Math.cos(ang)*rr, y = Math.sin(ang)*rr;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      // the runes on the rim, lit in order as the door opens
      ctx.strokeStyle = "rgba(" + pr.rgb + "," + (0.9*ease).toFixed(3) + ")";
      ctx.lineWidth = 2.2; ctx.lineCap = "round";
      const lit = Math.floor(24*ease);
      for(let i = 0; i < lit; i++){
        const a0 = (i/24)*TAU - S.t*0.4, a1 = a0 + TAU/24*0.45;
        ctx.beginPath(); ctx.arc(g.x, g.y, R*1.22, a0, a1); ctx.stroke();
      }
    } else {
      // Dark: the stones and a dead grey eye.
      ctx.fillStyle = "rgba(40,36,58,0.6)";
      ctx.beginPath(); ctx.arc(g.x, g.y, R*0.6, 0, TAU); ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - over the world: the motes falling in, the flash of a pass    */
/* ------------------------------------------------------------------ */

function drawOver(ctx, timeMs){
  if(!S) return;
  const ease = S.k*S.k*(3 - 2*S.k);
  if(ease > 0.05){
    for(const m of S.motes){
      const g = S.gates[m.g]; if(!g) continue;
      const pr = PAIRS[g.pair];
      const x = g.x + Math.cos(m.a)*m.d, y = g.y + Math.sin(m.a)*m.d*0.8;
      const a = (0.25 + 0.55*(1 - m.d/130))*ease;
      ctx.fillStyle = "rgba(" + pr.rgb + "," + a.toFixed(3) + ")";
      ctx.fillRect(x, y, m.s, m.s);
    }
  }
  for(const f of S.flashes){
    const k = f.t/0.45;
    ctx.strokeStyle = "rgba(" + f.rgb + "," + (0.9*(1 - k)).toFixed(3) + ")";
    ctx.lineWidth = 3 - 2*k;
    ctx.beginPath(); ctx.arc(f.x, f.y, GATE_R*(0.6 + 1.1*k), 0, TAU); ctx.stroke();
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, GATE_R*(0.8 + 0.6*k));
    g.addColorStop(0, "rgba(255,255,255," + (0.5*(1 - k)).toFixed(3) + ")");
    g.addColorStop(1, "rgba(" + f.rgb + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(f.x, f.y, GATE_R*(0.8 + 0.6*k), 0, TAU); ctx.fill();
  }
}

SF.doors = { _state: () => S, reset, begin, active, open, gateAt, pass, arrange,
             update, drawSky, drawOver, GATE_R, AMBUSH_SECS, PAIRS };
})();
