/*
 * BOSS ART - every boss hull, drawn.
 *
 * The old system tinted a scaled-up ENEMY sprite for each boss. That is fine
 * at 130px and falls apart at 300: it reads as a coloured blob with no parts,
 * which is exactly wrong for fights whose whole mechanic is "shoot the parts
 * off". So each boss now has a hull of its own, built around ITS weak-point
 * coordinates, so the thing you are told to shoot is visibly a thing bolted
 * onto the ship.
 *
 * Material rule: a boss shares the frame with the enemyart fleet, so it is
 * built from the same stuff - a top-left-lit gradient hull, a dark outline,
 * and a rim where an edge faces the key light. The first version was dark
 * fills with bright neon outlines, and next to the cel-shaded escorts every
 * boss read as the least finished thing in the game. Emissive colour is now
 * reserved for parts that MEAN something: engines, eyes, weapon cores,
 * telegraphs - a boss stays theatrical without becoming a wireframe.
 *
 * All hulls are drawn live rather than pre-rendered because they react: cores
 * pulse, lights march, armour cracks as damage rises, and an armoured boss
 * needs to look armoured until it isn't. Everything is expressed in units of
 * S (the boss's size) around a local origin, so a hull scales cleanly.
 *
 * Perf note: these are ~60-140 path ops once per frame for ONE object on
 * screen. The hot paths (bullets, particles) are still pre-rendered blits.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, TAU } = SF.core;

/* ---------------- shared vocabulary ---------------- */
function hexToRgb(hex){
  const v = parseInt(String(hex).replace("#",""), 16);
  return { r:(v>>16)&255, g:(v>>8)&255, b:v&255 };
}
function mix(c, target, k){
  return "rgb(" + Math.round(c.r + (target - c.r)*k) + "," +
                  Math.round(c.g + (target - c.g)*k) + "," +
                  Math.round(c.b + (target - c.b)*k) + ")";
}
/*
 * Material from a part's two design hexes: the old bright edge colour becomes
 * the lit half of the ramp, the old flat fill survives as the shadow half.
 * Same mix() maths as enemyart.paletteFor, so one factory built everything.
 * Cached: draw() runs per frame and these strings never change.
 */
const MATS = {};
function mat(hi, lo, litK){
  const key = hi + "|" + (lo || "") + "|" + (litK || "");
  if(MATS[key]) return MATS[key];
  const a = hexToRgb(hi), b = hexToRgb(lo || hi);
  return (MATS[key] = {
    // litK caps the highlight for accents that are already pale - the default
    // 0.42 (the fleet's) pushes them to white in the gradient's lit corner
    lit:   mix(a, 255, litK === undefined ? 0.42 : litK),
    base:  mix(a, 255, 0.06),
    shade: lo ? mix(b, 255, 0.14) : mix(a, 0, 0.34),
    deep:  lo ? mix(b, 0, 0.30)   : mix(a, 0, 0.58),
  });
}
// The fleet's edge and light constants, verbatim: same dark line, same fixed
// top-left key light, same cool counter-light off the sky.
const LINE     = "rgba(10,12,20,0.85)";
const RIM      = "rgba(255,250,238,0.82)";
const RIM_COOL = "rgba(126,188,255,0.34)";
function lineW(S){ return Math.max(1.6, S*0.013); }
/** One gradient spans the whole hull, so every part sits under one light. */
function skin(ctx, m, S){
  const g = ctx.createLinearGradient(-S*0.5, -S*0.55, S*0.42, S*0.5);
  g.addColorStop(0, m.lit);
  g.addColorStop(0.45, m.base);
  g.addColorStop(1, m.shade);
  return g;
}
function pathPoly(ctx, pts){
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for(let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function pathSlab(ctx, x, y, w, h, r){
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(x - w/2, y - h/2, w, h, r);
  else ctx.rect(x - w/2, y - h/2, w, h);
}
/*
 * Rim light, enemyart's trick at boss scale: clip to the shape, stroke the
 * same outline shifted away from the key light - the shifted line only
 * survives inside the clip on the edges FACING the light. Then the cool
 * counter-light on the opposite edges. This is what stops a 250px silhouette
 * dissolving into a near-black sky.
 */
function rimPoly(ctx, pts, S, d, w){
  ctx.save();
  pathPoly(ctx, pts); ctx.clip();
  ctx.translate(d, d); pathPoly(ctx, pts);
  ctx.strokeStyle = RIM; ctx.lineWidth = w; ctx.stroke();
  ctx.restore();
  ctx.save();
  pathPoly(ctx, pts); ctx.clip();
  ctx.translate(-d*0.85, -d*0.85); pathPoly(ctx, pts);
  ctx.strokeStyle = RIM_COOL; ctx.lineWidth = w*0.95; ctx.stroke();
  ctx.restore();
}
/** Gradient fill + dark outline + rim. `rw` slims the rim on small parts. */
function hullPoly(ctx, pts, m, S, rw){
  pathPoly(ctx, pts);
  ctx.fillStyle = skin(ctx, m, S); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = lineW(S); ctx.stroke();
  const k = rw || 1;
  rimPoly(ctx, pts, S, S*0.015*k, S*0.022*k);
}
function hullSlab(ctx, x, y, w, h, r, m, S){
  pathSlab(ctx, x, y, w, h, r);
  ctx.fillStyle = skin(ctx, m, S); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = lineW(S); ctx.stroke();
  // rim capped by the part's own size, or a small pod is all rim
  const d = Math.min(S*0.015, Math.min(w, h)*0.09);
  const lw = Math.min(S*0.022, Math.min(w, h)*0.16);
  ctx.save();
  pathSlab(ctx, x, y, w, h, r); ctx.clip();
  ctx.translate(d, d); pathSlab(ctx, x, y, w, h, r);
  ctx.strokeStyle = RIM; ctx.lineWidth = lw; ctx.stroke();
  ctx.restore();
  ctx.save();
  pathSlab(ctx, x, y, w, h, r); ctx.clip();
  ctx.translate(-d*0.85, -d*0.85); pathSlab(ctx, x, y, w, h, r);
  ctx.strokeStyle = RIM_COOL; ctx.lineWidth = lw*0.95; ctx.stroke();
  ctx.restore();
}
function poly(ctx, pts, fill, stroke, lw){
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for(let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if(fill){ ctx.fillStyle = fill; ctx.fill(); }
  if(stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function slab(ctx, x, y, w, h, r, fill, stroke, lw){
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(x - w/2, y - h/2, w, h, r);
  else ctx.rect(x - w/2, y - h/2, w, h);
  if(fill){ ctx.fillStyle = fill; ctx.fill(); }
  if(stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2.5; ctx.stroke(); }
}
/** Additive bloom - the only thing that makes a hull look powered. */
function bloom(ctx, x, y, r, rgb, a){
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(" + rgb + "," + a + ")");
  g.addColorStop(1, "rgba(" + rgb + ",0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}
/** A row of running lights that chase along the hull. */
function lights(ctx, x0, x1, y, n, rgb, timeMs, size){
  for(let i = 0; i < n; i++){
    const t = n === 1 ? 0.5 : i/(n-1);
    const on = (Math.floor(timeMs/130) + i) % 4 === 0;
    ctx.fillStyle = "rgba(" + rgb + "," + (on ? 0.95 : 0.3) + ")";
    ctx.beginPath();
    ctx.arc(x0 + (x1-x0)*t, y, size || 2.4, 0, TAU);
    ctx.fill();
  }
}
function panels(ctx, x0, x1, y0, y1, n, alpha){
  ctx.strokeStyle = "rgba(0,0,0," + (alpha || 0.4) + ")";
  ctx.lineWidth = 2;
  for(let i = 1; i < n; i++){
    const x = x0 + (x1-x0)*(i/n);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
  }
}
/** Battle damage: torn seams that glow hotter the closer it is to dead. */
/*
 * BATTLE DAMAGE. Every hull funnels through here, so this is the one place
 * that decides what a hurt boss looks like - and the old answer was "a few
 * thin brown squiggles", which at 70% health read as a scratched paint job
 * rather than a ship being taken apart. A kid has to be able to glance up and
 * know it is nearly done.
 *
 * Four stages, each arriving as the damage does:
 *   any     - a soot smudge and a split with a hot seam in it
 *   > 0.35  - the split becomes a TORN HOLE with a molten rim and dark inside
 *   > 0.55  - the worst holes VENT: a jet of flame and sparks, streaming back
 *   > 0.70  - the whole hull washes red on an emergency pulse
 *
 * Everything is driven off the boss's own seeded `wounds` plus the clock, so
 * it is stable frame to frame, costs no allocation, and needs no state.
 */
function cracks(ctx, boss, S, damage, timeMs){
  const k = S/150;
  const n = Math.min(boss.wounds.length, Math.floor(damage*10));
  const t = timeMs/1000;
  for(let i = 0; i < n; i++){
    const w = boss.wounds[i];
    const wx = w.x*k, wy = w.y*k, wr = w.r*k;

    // Soot: the burn is wider than the break, and it is what stops a wound
    // from looking like a pen line on clean paint.
    const sg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr*2.1);
    sg.addColorStop(0, "rgba(12,10,14,0.55)");
    sg.addColorStop(0.55, "rgba(12,10,14,0.26)");
    sg.addColorStop(1, "rgba(12,10,14,0)");
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(wx, wy, wr*2.1, 0, TAU); ctx.fill();

    const flicker = 0.30 + Math.sin(t*5.6 + i)*0.18;
    if(damage > 0.35 && i % 2 === 0){
      // A hole punched clean through: dark inside, molten at the lip. Drawn
      // as a ragged polygon off the wound's own numbers so it never crawls.
      ctx.beginPath();
      for(let q = 0; q < 11; q++){
        const a = q/11*TAU;
        // Ragged, but only a little: the first pass swung the radius by half
        // the wound per step and every hole came out a spiky orange kite.
        const rr = wr*(0.34 + (Math.sin(w.x*0.7 + q*1.3)*0.5 + 0.5)*0.16);
        ctx.lineTo(wx + Math.cos(a)*rr, wy + Math.sin(a)*rr*0.82);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(6,5,9,0.92)";
      ctx.fill();
      ctx.strokeStyle = "rgba(216," + Math.round(96 + flicker*70) + ",52,0.7)";
      ctx.lineWidth = Math.max(1, wr*0.1);
      ctx.stroke();
      bloom(ctx, wx, wy, wr*0.9, "255,140,60", 0.12 + flicker*0.10);
    } else {
      ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.lineWidth = wr*0.20;
      ctx.beginPath();
      ctx.moveTo(wx - wr*0.9, wy - wr*0.35);
      ctx.lineTo(wx + wr*0.35, wy);
      ctx.lineTo(wx + wr*0.9, wy + wr*0.45);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,150,70," + flicker.toFixed(2) + ")";
      ctx.lineWidth = wr*0.09;
      ctx.stroke();
    }

    /*
     * Venting. The two worst holes throw a plume back over the hull - flame
     * at the mouth going to smoke, plus a couple of sparks riding it. This is
     * the single loudest "it is losing" signal on the whole ship.
     */
    if(damage > 0.55 && i < 3){
      const len = wr*(1.9 + Math.sin(t*3.1 + i*1.9)*0.5);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const vg = ctx.createLinearGradient(wx, wy, wx, wy - len);
      vg.addColorStop(0, "rgba(255,190,90,0.55)");
      vg.addColorStop(0.4, "rgba(255,110,60,0.22)");
      vg.addColorStop(1, "rgba(120,80,90,0)");
      ctx.fillStyle = vg;
      ctx.beginPath();
      ctx.moveTo(wx - wr*0.3, wy);
      ctx.lineTo(wx + wr*0.3, wy);
      ctx.lineTo(wx + wr*0.1, wy - len);
      ctx.lineTo(wx - wr*0.1, wy - len);
      ctx.closePath(); ctx.fill();
      for(let q = 0; q < 3; q++){
        const u = ((t*1.4 + q*0.33 + i*0.17) % 1);
        ctx.fillStyle = "rgba(255," + Math.round(220 - u*120) + ",140," + (0.8*(1-u)).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(wx + Math.sin(u*7 + i)*wr*0.4, wy - u*len, Math.max(0.8, wr*0.13*(1-u)), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Emergency lighting: past two thirds gone, the whole hull throbs red. It
  // is the cue that reads from the far side of the room, which is exactly
  // where a seven-year-old watches a boss fight from.
  if(damage > 0.70){
    const beat = 0.5 + Math.sin(t*6.4)*0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const eg = ctx.createRadialGradient(0, 0, S*0.05, 0, 0, S*0.62);
    eg.addColorStop(0, "rgba(255,60,70," + (0.10 + beat*0.16).toFixed(3) + ")");
    eg.addColorStop(1, "rgba(255,40,60,0)");
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(0, 0, S*0.62, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/**
 * An engine plume: a tapered wash of light behind a nozzle, breathing on its
 * own clock. Bosses used to hang in the sky with nothing holding them there -
 * one of these under each hull is the cheapest possible "this thing flies".
 */
function thrust(ctx, x, y, w, len, rgb, timeMs, seed){
  const b = 0.82 + Math.sin(timeMs/110 + (seed || 0))*0.18;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createLinearGradient(x, y, x, y + len*b);
  g.addColorStop(0, "rgba(" + rgb + ",0.55)");
  g.addColorStop(0.35, "rgba(" + rgb + ",0.24)");
  g.addColorStop(1, "rgba(" + rgb + ",0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - w/2, y);
  ctx.lineTo(x + w/2, y);
  ctx.lineTo(x + w*0.16, y + len*b);
  ctx.lineTo(x - w*0.16, y + len*b);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // The hot core at the nozzle itself.
  bloom(ctx, x, y + len*0.06, w*0.85, rgb, 0.34*b);
}

/* ---------------- the hulls ---------------- */
const HULLS = {
  /*
   * THE MARAUDER - a dart, not a slab. Two forward-swept arms carry the
   * cannons out at the tips (the weak points), with a narrow spearhead body
   * between them. Reads as "fast and pointed" from across the room, which is
   * what a boss that CHARGES you should look like.
   */
  marauder(ctx, boss, S, damage, timeMs){
    const A = S/132;
    const charging = !!boss.charge;
    const arm  = mat("#a8324a", "#320f1c");
    const gun  = mat("#ff6b7f", "#5c1526");
    const body = mat("#c23b55", "#24091a");
    // Engines first, so the plume comes out from BEHIND the plating. A dart
    // that hangs in the sky with nothing pushing it is a cardboard cut-out.
    [-1, 1].forEach(sd => thrust(ctx, sd*10*A, 40*A, 15*A, 62*A, "255,120,150", timeMs, sd));
    // swept arms out to the cannon pods at (+-62,-4)
    [-1, 1].forEach(sd => {
      hullPoly(ctx, [[sd*10*A, 22*A],[sd*36*A, -30*A],[sd*74*A, -16*A],
                     [sd*70*A, 16*A],[sd*24*A, 36*A]], arm, S);
      // the cannon itself, barrel pointing down-screen; the muzzle stays hot
      // because it is the part you are told to shoot
      hullSlab(ctx, sd*62*A, -4*A, 26*A, 34*A, 6*A, gun, S);
      slab(ctx, sd*62*A, 16*A, 12*A, 14*A, 3*A, "#ff9db0", null);
      bloom(ctx, sd*62*A, 18*A, 18*A, "255,80,110", 0.35);
    });
    // spearhead body
    hullPoly(ctx, [[0,-64*A],[20*A,-8*A],[13*A,42*A],[-13*A,42*A],[-20*A,-8*A]],
             body, S);
    // spine seam, with a ridge catch-light on the side facing the key light
    ctx.strokeStyle = "rgba(10,12,20,0.45)"; ctx.lineWidth = 2*A;
    ctx.beginPath(); ctx.moveTo(0,-52*A); ctx.lineTo(0, 36*A); ctx.stroke();
    ctx.strokeStyle = "rgba(255,224,230,0.28)"; ctx.lineWidth = 1.2*A;
    ctx.beginPath(); ctx.moveTo(-1.8*A,-52*A); ctx.lineTo(-1.8*A, 36*A); ctx.stroke();
    // ram prow - lit while it is winding up to charge
    poly(ctx, [[0,-78*A],[12*A,-56*A],[-12*A,-56*A]],
         charging ? "#ffd6de" : "#e05070", LINE, lineW(S));
    if(charging) bloom(ctx, 0, -66*A, 40*A, "255,120,150", 0.5);
    lights(ctx, -14*A, 14*A, -34*A, 4, "255,190,200", timeMs, 2.2*A);
    bloom(ctx, 0, 14*A, 22*A, "255,60,90", 0.3 + damage*0.2);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * THE JAILER - a grabber. A narrow body up top with two long arms hanging
   * down and out, a holding cell clamped in each claw. Bottom-heavy and
   * spidery: nothing else in the game hangs BELOW itself like this, and it
   * puts the parts you must shoot down close to you rather than up on a deck.
   */
  jailer(ctx, boss, S, damage, timeMs){
    const A = S/140;
    const sway = Math.sin(timeMs/700)*3*A;
    const body = mat("#2f7d55", "#0d2418");
    const trim = mat("#3f9c68", "#13351f");
    [-1, 1].forEach(sd => thrust(ctx, sd*34*A, 12*A, 16*A, 50*A, "120,255,180", timeMs, sd*2));
    // compact upper body
    hullPoly(ctx, [[-40*A,-42*A],[40*A,-42*A],[52*A,-8*A],[30*A,16*A],[-30*A,16*A],[-52*A,-8*A]],
             body, S);
    panels(ctx, -32*A, 32*A, -34*A, 12*A, 4, 0.35);
    hullSlab(ctx, 0, -30*A, 34*A, 16*A, 4*A, trim, S);
    lights(ctx, -26*A, 26*A, -38*A, 5, "160,255,200", timeMs, 2.2*A);

    // the two arms, reaching down and out to the cells at (+-58, 52):
    // a dark contour, a lit tube, and a sheen line on the keyward side
    [-1, 1].forEach(sd => {
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sd*30*A, 4*A);
      ctx.quadraticCurveTo(sd*62*A, 18*A, sd*58*A + sway*sd, 44*A);
      ctx.strokeStyle = trim.deep; ctx.lineWidth = 15*A; ctx.stroke();
      ctx.strokeStyle = skin(ctx, trim, S); ctx.lineWidth = 10*A;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sd*30*A - 2*A, 2*A);
      ctx.quadraticCurveTo(sd*62*A - 2*A, 16*A, sd*58*A + sway*sd - 2*A, 42*A);
      ctx.strokeStyle = "rgba(255,250,238,0.3)"; ctx.lineWidth = 2.4*A;
      ctx.stroke();
      // elbow joint
      ctx.beginPath(); ctx.arc(sd*52*A, 18*A, 8*A, 0, TAU);
      ctx.fillStyle = body.base; ctx.fill();
      ctx.strokeStyle = LINE; ctx.lineWidth = lineW(S); ctx.stroke();
      ctx.fillStyle = "rgba(255,250,238,0.35)";
      ctx.beginPath(); ctx.arc(sd*52*A - 2.4*A, 15.5*A, 2.6*A, 0, TAU); ctx.fill();

      // the cell, clamped in a claw that grips from behind (so it sits in shade)
      const cx = sd*58*A + sway*sd, cy = 52*A;
      [-1, 1].forEach(k => {
        poly(ctx, [[cx + k*20*A, cy - 24*A],[cx + k*30*A, cy - 4*A],
                   [cx + k*24*A, cy + 22*A],[cx + k*14*A, cy + 10*A]],
             body.shade, "rgba(10,12,20,0.6)", lineW(S));
      });
      // metal cage around a dark cell - the containment field carries the glow
      hullSlab(ctx, cx, cy, 34*A, 40*A, 5*A, body, S);
      slab(ctx, cx, cy, 26*A, 32*A, 3*A, "#08170f", null);
      ctx.strokeStyle = "rgba(140,255,190,0.65)"; ctx.lineWidth = 2.4*A;
      for(let i = -1; i <= 1; i++){
        ctx.beginPath();
        ctx.moveTo(cx + i*10*A, cy - 15*A); ctx.lineTo(cx + i*10*A, cy + 15*A);
        ctx.stroke();
      }
      bloom(ctx, cx, cy, 30*A, "74,222,128", 0.3);
    });

    // tractor emitter, slung under the body between the arms
    hullPoly(ctx, [[-16*A,14*A],[16*A,14*A],[10*A,36*A],[-10*A,36*A]], trim, S, 0.6);
    slab(ctx, 0, 33*A, 14*A, 3.5*A, 1.5*A, "rgba(140,255,190,0.85)", null);
    bloom(ctx, 0, 36*A, 24*A, "120,255,180", 0.28 + Math.sin(timeMs/240)*0.14);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * SKY SENTINEL - a carrier seen from above: a long flat flight deck with
   * launch lanes, engine pods way out on the tips, and the command tower
   * standing high on the spine (the core).
   */
  sentinel(ctx, boss, S, damage, timeMs){
    const A = S/150;
    const deck  = mat("#7c4bbd", "#1d1030");
    const pod   = mat("#a855f7", "#150a26");
    const tower = mat("#c9a4ff", "#2a1547", 0.2);
    // The pods out on the tips were always meant to be engines; now they burn
    // like them, which is what makes a flat deck read as a ship under way.
    [-1, 1].forEach(sd => thrust(ctx, sd*68*A, 38*A, 26*A, 78*A, "190,130,255", timeMs, sd*3));
    // the deck - long and low
    hullPoly(ctx, [[-84*A,-2*A],[-64*A,-22*A],[64*A,-22*A],[84*A,-2*A],
                   [70*A,32*A],[-70*A,32*A]], deck, S);
    // launch lanes: recessed grooves that brighten toward the launch lip,
    // with a blinking threshold light - deck markings, not debug dashes
    [-38, 0, 38].forEach((x, i) => {
      ctx.strokeStyle = "rgba(10,12,20,0.45)"; ctx.lineWidth = 4*A;
      ctx.beginPath(); ctx.moveTo(x*A, -18*A); ctx.lineTo(x*A, 28*A); ctx.stroke();
      const lg = ctx.createLinearGradient(0, -18*A, 0, 28*A);
      lg.addColorStop(0, "rgba(210,180,255,0)");
      lg.addColorStop(1, "rgba(210,180,255,0.5)");
      ctx.strokeStyle = lg; ctx.lineWidth = 2*A;
      ctx.beginPath(); ctx.moveTo(x*A, -18*A); ctx.lineTo(x*A, 28*A); ctx.stroke();
      const on = 0.45 + Math.sin(timeMs/320 + i*2.1)*0.35;
      ctx.fillStyle = "rgba(226,204,255," + on.toFixed(2) + ")";
      ctx.fillRect(x*A - 3*A, 26*A, 6*A, 3*A);
    });
    // engine pods far out at (+-68, 20)
    [-1, 1].forEach(sd => {
      hullSlab(ctx, sd*68*A, 20*A, 34*A, 42*A, 8*A, pod, S);
      bloom(ctx, sd*68*A, 34*A, 24*A, "168,85,247", 0.42);
      slab(ctx, sd*68*A, 34*A, 18*A, 7*A, 3*A, "rgba(226,204,255,0.85)", null);
    });
    // command tower on the spine at (0,-30) - the tallest thing on the ship
    hullPoly(ctx, [[-16*A,-14*A],[-11*A,-48*A],[11*A,-48*A],[16*A,-14*A]],
             tower, S, 0.8);
    slab(ctx, 0, -38*A, 22*A, 10*A, 3*A, "#e9d5ff", null);
    bloom(ctx, 0, -34*A, 30*A, "200,150,255", 0.35 + damage*0.2);
    lights(ctx, -72*A, 72*A, -20*A, 11, "220,190,255", timeMs, 2.2*A);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * THE WARDEN - a ring station. A big open torus with mine hatches set into
   * the rim and the spine array on a mast above it. The only circular
   * silhouette among the bosses.
   */
  warden(ctx, boss, S, damage, timeMs){
    const A = S/158;
    const ring  = mat("#22d3ee", "#0d3d4a");
    const hatch = mat("#22d3ee", "#04191f");
    const arr   = mat("#7ce9f7", "#062b36", 0.16);
    // the ring: a gradient-lit torus with dark edges, plus a faint powered
    // line on the inner lip so the station still hums
    ctx.beginPath(); ctx.arc(0, 12*A, 58*A, 0, TAU);
    ctx.strokeStyle = skin(ctx, ring, S); ctx.lineWidth = 30*A; ctx.stroke();
    ctx.strokeStyle = LINE; ctx.lineWidth = lineW(S);
    ctx.beginPath(); ctx.arc(0, 12*A, 73*A, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 12*A, 43*A, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(34,211,238,0.3)"; ctx.lineWidth = 2*A;
    ctx.beginPath(); ctx.arc(0, 12*A, 43*A, 0, TAU); ctx.stroke();
    // rim light on the torus: outer edge catches it top-left, the hole's
    // inner wall catches it bottom-right, which is how a real ring sits
    const d = S*0.018;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 12*A, 73*A, 0, TAU); ctx.arc(0, 12*A, 43*A, 0, TAU, true);
    ctx.clip();
    ctx.translate(d, d);
    ctx.beginPath();
    ctx.arc(0, 12*A, 73*A, 0, TAU); ctx.arc(0, 12*A, 43*A, 0, TAU, true);
    ctx.strokeStyle = RIM; ctx.lineWidth = S*0.03; ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 12*A, 73*A, 0, TAU); ctx.arc(0, 12*A, 43*A, 0, TAU, true);
    ctx.clip();
    ctx.translate(-d*0.85, -d*0.85);
    ctx.beginPath();
    ctx.arc(0, 12*A, 73*A, 0, TAU); ctx.arc(0, 12*A, 43*A, 0, TAU, true);
    ctx.strokeStyle = RIM_COOL; ctx.lineWidth = S*0.028; ctx.stroke();
    ctx.restore();
    // ribs across the ring - panel seams; the gradient carries the light now
    ctx.strokeStyle = "rgba(10,12,20,0.4)"; ctx.lineWidth = 2.5*A;
    for(let i = 0; i < 8; i++){
      const a = (TAU/8)*i + timeMs/6000;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*43*A, 12*A + Math.sin(a)*43*A);
      ctx.lineTo(Math.cos(a)*73*A, 12*A + Math.sin(a)*73*A);
      ctx.stroke();
    }
    // mine hatches set into the rim at (+-58, 14)
    [-1, 1].forEach(sd => {
      hullSlab(ctx, sd*58*A, 14*A, 38*A, 38*A, 10*A, hatch, S);
      ctx.fillStyle = hatch.deep;
      ctx.beginPath(); ctx.arc(sd*58*A, 14*A, 13*A, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(34,211,238," + (0.35 + Math.sin(timeMs/260 + sd)*0.25).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(sd*58*A, 14*A, 11*A, 0, TAU); ctx.fill();
      bloom(ctx, sd*58*A, 14*A, 18*A, "34,211,238", 0.22);
    });
    // the mast and spine array at (0,-46)
    ctx.strokeStyle = ring.deep; ctx.lineWidth = 11*A;
    ctx.beginPath(); ctx.moveTo(0, -14*A); ctx.lineTo(0, -40*A); ctx.stroke();
    ctx.strokeStyle = skin(ctx, ring, S); ctx.lineWidth = 7*A;
    ctx.beginPath(); ctx.moveTo(0, -14*A); ctx.lineTo(0, -40*A); ctx.stroke();
    hullSlab(ctx, 0, -46*A, 62*A, 20*A, 6*A, arr, S);
    ctx.strokeStyle = "rgba(150,240,255,0.6)"; ctx.lineWidth = 2*A;
    for(let i = -2; i <= 2; i++){
      ctx.beginPath();
      ctx.moveTo(i*13*A, -56*A); ctx.lineTo(i*13*A, -36*A); ctx.stroke();
    }
    bloom(ctx, 0, -46*A, 34*A, "34,211,238", 0.3);
    bloom(ctx, 0, 12*A, 30*A, "34,211,238", 0.18 + damage*0.15);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * THE PHANTOM - a blade. Thin, swept, almost elegant: three lenses down the
   * spine and very little hull, because half the fight it isn't really there.
   */
  phantom(ctx, boss, S, damage, timeMs){
    const A = S/150;
    // low-key ramp: half the fight it isn't really there, so the hull stays
    // closer to the sky than any other boss's
    const body = mat("#6b74c9", "#141634", 0.22);
    // Kept dim: half the fight it isn't really there, and a bright exhaust
    // would give away a boss whose whole trick is not being visible.
    [-1, 1].forEach(sd => thrust(ctx, sd*30*A, 27*A, 13*A, 44*A, "150,165,255", timeMs, sd*4));
    hullPoly(ctx, [[0,-52*A],[42*A,-6*A],[64*A,20*A],[24*A,30*A],[0,20*A],
                   [-24*A,30*A],[-64*A,20*A],[-42*A,-6*A]], body, S);
    // swept edge highlights
    ctx.strokeStyle = "rgba(180,190,255,0.3)"; ctx.lineWidth = 2*A;
    [-1, 1].forEach(sd => {
      ctx.beginPath();
      ctx.moveTo(sd*6*A, -44*A); ctx.lineTo(sd*46*A, 16*A); ctx.stroke();
    });
    // lenses: core (0,-6) and two at (+-50, 14). These stay emissive - they
    // are the eyes AND the weak points - but a dark seat grounds each one.
    const lens = (x, y, r, glowA) => {
      bloom(ctx, x, y, r*2.4, "154,165,255", glowA);
      ctx.strokeStyle = LINE; ctx.lineWidth = 2*A;
      ctx.beginPath(); ctx.arc(x, y, r + 1.8*A, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#0a0c22";
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#9aa5ff"; ctx.lineWidth = 2.6*A;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = "rgba(220,225,255," + (0.5 + Math.sin(timeMs/200 + x)*0.3).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(x, y, r*0.45, 0, TAU); ctx.fill();
    };
    lens(0, -6*A, 20*A, 0.4 + damage*0.2);
    lens(-50*A, 14*A, 15*A, 0.3);
    lens( 50*A, 14*A, 15*A, 0.3);
    lights(ctx, -30*A, 30*A, -34*A, 5, "190,200,255", timeMs, 2*A);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * THE LEVIATHAN - the biggest thing in the game until the Devourer turned
   * up. Four parts, and it should look like four parts: a spine-mounted core,
   * two shoulder pods and a belly hatch, all hung off one enormous frame.
   */
  leviathan(ctx, boss, S, damage, timeMs){
    const A = S/176;
    const frame = mat("#c2570f", "#2a1206");
    const pod   = mat("#f97316", "#1c0c04");
    const hatch = mat("#f9a03c", "#1a0a03");
    const core  = mat("#ffc46b", "#3a1a06", 0.12);
    // Three of them, and big: the largest hull in the game should sound like
    // it, and the plumes are most of what sells the mass.
    [-40, 0, 40].forEach((x, i) =>
      thrust(ctx, x*A, 52*A, 26*A, 86*A, "255,150,60", timeMs, i*2.3));
    // frame
    hullPoly(ctx, [[-58*A,-40*A],[58*A,-40*A],[80*A,-6*A],[72*A,34*A],[30*A,58*A],
                   [-30*A,58*A],[-72*A,34*A],[-80*A,-6*A]], frame, S);
    panels(ctx, -60*A, 60*A, -34*A, 40*A, 8, 0.3);
    // shoulder pods at (+-62, 14)
    [-1, 1].forEach(sd => {
      hullSlab(ctx, sd*62*A, 14*A, 44*A, 48*A, 9*A, pod, S);
      bloom(ctx, sd*62*A, 14*A, 28*A, "249,115,22", 0.35);
      ctx.fillStyle = "rgba(255,200,140,0.75)";
      [-1, 0, 1].forEach(k => slab(ctx, sd*62*A, 14*A + k*13*A, 26*A, 5*A, 2*A,
                                   "rgba(255,200,140,0.75)", null));
    });
    // belly hatch at (0,44)
    hullSlab(ctx, 0, 44*A, 46*A, 28*A, 7*A, hatch, S);
    ctx.strokeStyle = "rgba(255,190,120,0.6)"; ctx.lineWidth = 2.4*A;
    ctx.beginPath(); ctx.moveTo(-18*A, 44*A); ctx.lineTo(18*A, 44*A); ctx.stroke();
    // spine core at (0,-18): a furnace throat - the heart glows out of a dark
    // aperture, or the bloom just bleaches the housing
    bloom(ctx, 0, -18*A, 40*A, "255,180,80", 0.4 + damage*0.25);
    hullPoly(ctx, [[-24*A,-2*A],[-16*A,-40*A],[16*A,-40*A],[24*A,-2*A]],
             core, S, 0.8);
    ctx.fillStyle = frame.deep;
    ctx.beginPath(); ctx.arc(0, -18*A, 15*A, 0, TAU); ctx.fill();
    // embers stay lit even at the bottom of the pulse - a dim furnace still burns
    const emb = ctx.createRadialGradient(0, -18*A, 0, 0, -18*A, 15*A);
    emb.addColorStop(0, "rgba(255,225,160,0.95)");
    emb.addColorStop(0.55, "rgba(255,160,60,0.55)");
    emb.addColorStop(1, "rgba(255,160,60,0)");
    ctx.fillStyle = emb;
    ctx.beginPath(); ctx.arc(0, -18*A, 15*A, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,235,190," + (0.72 + Math.sin(timeMs/170)*0.24).toFixed(2) + ")";
    ctx.beginPath(); ctx.arc(0, -18*A, 9*A, 0, TAU); ctx.fill();
    lights(ctx, -54*A, 54*A, -36*A, 9, "255,210,150", timeMs, 2.4*A);
    cracks(ctx, boss, S, damage, timeMs);
  },
};

/** True if this boss has hull art of its own. */
/*
 * THE FORGERY - Act 4's finale, phase one: a titan WELDED out of the hulls
 * of every boss the campaign has beaten. Not a new monster - a wrong one:
 * the Marauder for a left arm, the Warden for a right, the Phantom's lenses
 * for a head, the Sentinel's deck for a chest, the Leviathan's bulk for a
 * skirt, all stitched with glowing gold weld seams at the weak points. It
 * should read instantly as "everything you already killed, put back wrong".
 * Each stolen hull keeps its own colours on purpose; only the welds and a
 * thin gold wash say one hand bolted it together.
 */
/* The titan is five stolen hulls welded into one silhouette. They are
 * composed on an offscreen and washed gold THERE: source-atop against the
 * live canvas tinted a rectangle of whatever sat behind the boss (the
 * campaign map found that out the hard way). The bake is keyed to the
 * damage bucket, so battle scars still accumulate - and the stolen hulls
 * get no timeMs on purpose: they are dead metal, only the welds live. */
const FORGE_PARTS = [
  ["leviathan", 0,  84, 0.52, 0],      // skirt
  ["marauder", -96, 14, 0.46, -0.28],  // left arm, tucked behind the chest
  ["warden",   102, 18, 0.38,  0.30],  // right arm: the ring reads as a pauldron
  ["sentinel",  0,  -6, 0.60, 0],      // chest, welded OVER the arms - it bonds the figure
  ["phantom",   0, -86, 0.34, 0],      // head
];
let forgeCache = null;                 // one titan at a time
HULLS.forgery = function(ctx, boss, S, damage, timeMs){
  const A = S/300;
  const subDamage = Math.min(0.4, damage*0.6);
  const PX = 2;                        // baked at 2x so retina stays crisp
  const half = 200*A;                  // composite half-extent
  const key = S.toFixed(1) + ":" + Math.floor(subDamage*10);
  if(!forgeCache || forgeCache.key !== key){
    const cv = document.createElement("canvas");
    cv.width = cv.height = Math.max(2, Math.ceil(half*2*PX));
    const c2 = cv.getContext("2d");
    c2.translate(half*PX, half*PX);
    c2.scale(PX, PX);
    for(let i = 0; i < FORGE_PARTS.length; i++){
      const [id, x, y, scale, rot] = FORGE_PARTS[i];
      if(!HULLS[id]) continue;
      c2.save();
      c2.translate(x*A, y*A);
      if(rot) c2.rotate(rot);
      // Sub-painters read a couple of live fields; hand them a calm fake so
      // a stolen hull never runs its own theatrics inside the titan.
      try {
        HULLS[id](c2, { defId:id, charge:0, flash:0, blink:0,
                        wounds: boss.wounds || [], phase: null, phaseIndex: 0 },
                  S*scale, subDamage, 0);
      } catch(e){ /* a stolen hull must never break the titan */ }
      c2.restore();
    }
    // A thin gold wash bonds the patchwork into one machine - and on the
    // offscreen it can only ever touch the titan's own pixels.
    c2.globalCompositeOperation = "source-atop";
    c2.fillStyle = "rgba(232,193,74,0.12)";
    c2.fillRect(-half, -half, half*2, half*2);
    forgeCache = { key, canvas: cv };
  }
  ctx.drawImage(forgeCache.canvas, -half, -half, half*2, half*2);

  // The welds: stitched gold seams over the three joints (the weak points),
  // breathing slightly so the titan reads as barely holding together.
  const seam = (x, y, len, rot) => {
    ctx.save();
    ctx.translate(x*A, y*A); ctx.rotate(rot);
    ctx.strokeStyle = "rgba(232,193,74," + (0.55 + Math.sin(timeMs/260)*0.2).toFixed(3) + ")";
    ctx.lineWidth = Math.max(2, S*0.014);
    ctx.lineCap = "round";
    ctx.beginPath();
    const n = 5, step = len*A/n;
    for(let i=0;i<=n;i++) ctx.lineTo(-len*A/2 + i*step, (i%2 ? 1 : -1)*S*0.016);
    ctx.stroke();
    ctx.restore();
  };
  seam(-86, 10, 64, -0.5);
  seam( 86, 10, 64,  0.5);
  seam(  0,-38, 70,  0);
  // Weld nodes glow where the fight will pry it apart.
  [[-86,10],[86,10],[0,-38]].forEach(([wx, wy]) => {
    const g = ctx.createRadialGradient(wx*A, wy*A, 0, wx*A, wy*A, S*0.075);
    g.addColorStop(0, "rgba(255,230,150,0.85)");
    g.addColorStop(0.5, "rgba(232,193,74,0.30)");
    g.addColorStop(1, "rgba(232,193,74,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(wx*A, wy*A, S*0.075, 0, TAU); ctx.fill();
  });
};

function has(id){ return !!HULLS[id]; }

/** Draws the boss's hull, centred on the current transform origin. */
function draw(ctx, boss, S, damage, timeMs){
  const id = boss.defId;
  const fn = HULLS[id];
  if(!fn) return false;
  ctx.save();
  fn(ctx, boss, S, damage, timeMs);
  // Hit flash, deliberately faint: under sustained fire this fires nearly
  // every frame, and anything stronger bleaches the hull to grey.
  if(boss.flash > 0){
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,220,230," + Math.min(0.10, boss.flash*0.10).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(0, 0, S*0.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
  return true;
}

SF.bossart = { draw, has, HULLS, poly, slab, bloom, lights, panels, cracks };
})();
