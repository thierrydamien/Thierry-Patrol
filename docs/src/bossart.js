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
 * All hulls are drawn live rather than pre-rendered because they react: cores
 * pulse, lights march, armour cracks as damage rises, and an armoured boss
 * needs to look armoured until it isn't. Everything is expressed in units of
 * S (the boss's size) around a local origin, so a hull scales cleanly.
 *
 * Perf note: these are ~40-90 path ops once per frame for ONE object on
 * screen. The hot paths (bullets, particles) are still pre-rendered blits.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, TAU } = SF.core;

/* ---------------- shared vocabulary ---------------- */
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
function cracks(ctx, boss, S, damage, timeMs){
  const n = Math.min(boss.wounds.length, Math.floor(damage*10));
  for(let i = 0; i < n; i++){
    const w = boss.wounds[i], k = S/150;
    const wx = w.x*k, wy = w.y*k;
    ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.lineWidth = w.r*0.20*k;
    ctx.beginPath();
    ctx.moveTo(wx - w.r*k*0.9, wy - w.r*k*0.35);
    ctx.lineTo(wx + w.r*k*0.35, wy);
    ctx.lineTo(wx + w.r*k*0.9, wy + w.r*k*0.45);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,150,70," + (0.30 + Math.sin(timeMs/170 + i)*0.18).toFixed(2) + ")";
    ctx.lineWidth = w.r*0.09*k;
    ctx.stroke();
  }
}

/* ---------------- the hulls ---------------- */
const HULLS = {
  /*
   * THE MARAUDER - the first boss anyone meets. A raider's wedge: heavy
   * forward armour, two enormous side cannons (the weak points), and nothing
   * subtle anywhere. It should look like it was welded together in a hurry.
   */
  marauder(ctx, boss, S, damage, timeMs){
    const A = S/132;
    // cannons at (+-44, 14)
    [-1, 1].forEach(sd => {
      slab(ctx, sd*44*A, 14*A, 40*A, 62*A, 8*A, "#3a1220", "#8d2b3f", 3*A);
      slab(ctx, sd*44*A, -6*A, 22*A, 30*A, 5*A, "#571a2b", null);
      ctx.fillStyle = "#ff6b7f";
      slab(ctx, sd*44*A, -20*A, 12*A, 14*A, 3*A, "#ff6b7f", null);
    });
    // central wedge
    poly(ctx, [[0,-56*A],[30*A,-16*A],[26*A,34*A],[-26*A,34*A],[-30*A,-16*A]],
         "#2a0d18", "#a8324a", 3.5*A);
    panels(ctx, -24*A, 24*A, -40*A, 30*A, 4);
    // spiked prow
    poly(ctx, [[0,-70*A],[10*A,-50*A],[-10*A,-50*A]], "#c23b55", null);
    lights(ctx, -22*A, 22*A, -44*A, 5, "255,180,190", timeMs, 2.2*A);
    bloom(ctx, 0, 6*A, 26*A, "255,60,90", 0.34 + damage*0.2);
    slab(ctx, 0, 6*A, 26*A, 26*A, 6*A, "#7b1e33", "#ffb3c0", 2.5*A);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * THE JAILER - a prison hulk. Two lit cell blocks with bars (the weak
   * points ARE the cells: blow one open and a pilot floats out), and the
   * tractor emitter slung underneath.
   */
  jailer(ctx, boss, S, damage, timeMs){
    const A = S/140;
    poly(ctx, [[-46*A,-40*A],[46*A,-40*A],[60*A,0],[46*A,40*A],[-46*A,40*A],[-60*A,0]],
         "#0d2418", "#2f7d55", 3.5*A);
    panels(ctx, -40*A, 40*A, -34*A, 34*A, 5, 0.35);
    // cell blocks at (+-48, 16)
    [-1, 1].forEach(sd => {
      slab(ctx, sd*48*A, 16*A, 42*A, 44*A, 6*A, "#08170f", "#4ade80", 3*A);
      // bars
      ctx.strokeStyle = "rgba(140,255,190,0.55)"; ctx.lineWidth = 2.5*A;
      for(let i = -1; i <= 1; i++){
        ctx.beginPath();
        ctx.moveTo(sd*48*A + i*11*A, 2*A);
        ctx.lineTo(sd*48*A + i*11*A, 30*A);
        ctx.stroke();
      }
      bloom(ctx, sd*48*A, 16*A, 26*A, "74,222,128", 0.3);
    });
    // tractor emitter
    slab(ctx, 0, 34*A, 30*A, 16*A, 5*A, "#12402a", "#4ade80", 2.5*A);
    bloom(ctx, 0, 40*A, 22*A, "120,255,180", 0.35 + Math.sin(timeMs/240)*0.15);
    // bridge
    slab(ctx, 0, -22*A, 44*A, 26*A, 6*A, "#13351f", "#3f9c68", 2.5*A);
    lights(ctx, -34*A, 34*A, -36*A, 6, "160,255,200", timeMs, 2.2*A);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * SKY SENTINEL - their flagship, and the widest hull in the game. A long
   * carrier deck with a command tower (the core) and two engine pods.
   */
  sentinel(ctx, boss, S, damage, timeMs){
    const A = S/150;
    // deck
    poly(ctx, [[-70*A,-14*A],[-52*A,-30*A],[52*A,-30*A],[70*A,-14*A],
               [62*A,26*A],[-62*A,26*A]], "#1d1030", "#7c4bbd", 3.5*A);
    panels(ctx, -58*A, 58*A, -26*A, 22*A, 7, 0.42);
    // launch stripe down the middle of the deck
    ctx.strokeStyle = "rgba(200,170,255,0.32)"; ctx.lineWidth = 3*A;
    ctx.setLineDash([9*A, 9*A]);
    ctx.beginPath(); ctx.moveTo(0, -26*A); ctx.lineTo(0, 22*A); ctx.stroke();
    ctx.setLineDash([]);
    // engine pods at (+-52, 18)
    [-1, 1].forEach(sd => {
      slab(ctx, sd*52*A, 18*A, 38*A, 40*A, 8*A, "#150a26", "#a855f7", 3*A);
      bloom(ctx, sd*52*A, 30*A, 22*A, "168,85,247", 0.4);
      ctx.fillStyle = "rgba(220,190,255,0.8)";
      slab(ctx, sd*52*A, 30*A, 20*A, 8*A, 3*A, "rgba(220,190,255,0.8)", null);
    });
    // command tower = the core at (0,-8)
    bloom(ctx, 0, -8*A, 34*A, "200,150,255", 0.35 + damage*0.2);
    poly(ctx, [[-20*A,4*A],[-13*A,-26*A],[13*A,-26*A],[20*A,4*A]], "#2a1547", "#c9a4ff", 3*A);
    slab(ctx, 0, -14*A, 16*A, 12*A, 3*A, "#e9d5ff", null);
    lights(ctx, -60*A, 60*A, -28*A, 9, "220,190,255", timeMs, 2.2*A);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * THE WARDEN - an industrial minelaying rig. Two hatches that spit mines,
   * a spine rail along the top, exposed machinery everywhere.
   */
  warden(ctx, boss, S, damage, timeMs){
    const A = S/158;
    poly(ctx, [[-54*A,-30*A],[54*A,-30*A],[66*A,10*A],[40*A,38*A],[-40*A,38*A],[-66*A,10*A]],
         "#08222a", "#1c7f95", 3.5*A);
    panels(ctx, -48*A, 48*A, -24*A, 32*A, 6, 0.4);
    // spine rail = weak point at (0,-16)
    slab(ctx, 0, -16*A, 74*A, 18*A, 6*A, "#062b36", "#22d3ee", 3*A);
    ctx.strokeStyle = "rgba(120,240,255,0.5)"; ctx.lineWidth = 2*A;
    for(let i = -3; i <= 3; i++){
      ctx.beginPath();
      ctx.moveTo(i*11*A, -24*A); ctx.lineTo(i*11*A, -8*A); ctx.stroke();
    }
    bloom(ctx, 0, -16*A, 30*A, "34,211,238", 0.3);
    // mine hatches at (+-56, 16)
    [-1, 1].forEach(sd => {
      slab(ctx, sd*56*A, 16*A, 40*A, 40*A, 7*A, "#04191f", "#22d3ee", 3*A);
      ctx.fillStyle = "rgba(34,211,238," + (0.35 + Math.sin(timeMs/260 + sd)*0.25).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(sd*56*A, 16*A, 12*A, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#7ce9f7"; ctx.lineWidth = 2*A;
      ctx.beginPath(); ctx.arc(sd*56*A, 16*A, 16*A, 0, TAU); ctx.stroke();
    });
    // exposed gantry
    ctx.strokeStyle = "rgba(120,200,220,0.35)"; ctx.lineWidth = 3*A;
    ctx.beginPath();
    ctx.moveTo(-40*A, 30*A); ctx.lineTo(0, 20*A); ctx.lineTo(40*A, 30*A);
    ctx.stroke();
    lights(ctx, -50*A, 50*A, 34*A, 7, "160,240,255", timeMs, 2.2*A);
    cracks(ctx, boss, S, damage, timeMs);
  },

  /*
   * THE PHANTOM - a blade. Thin, swept, almost elegant: three lenses down the
   * spine and very little hull, because half the fight it isn't really there.
   */
  phantom(ctx, boss, S, damage, timeMs){
    const A = S/150;
    poly(ctx, [[0,-52*A],[42*A,-6*A],[64*A,20*A],[24*A,30*A],[0,20*A],
               [-24*A,30*A],[-64*A,20*A],[-42*A,-6*A]],
         "#141634", "#6b74c9", 3*A);
    // swept edge highlights
    ctx.strokeStyle = "rgba(180,190,255,0.35)"; ctx.lineWidth = 2*A;
    [-1, 1].forEach(sd => {
      ctx.beginPath();
      ctx.moveTo(sd*6*A, -44*A); ctx.lineTo(sd*46*A, 16*A); ctx.stroke();
    });
    // lenses: core (0,-6) and two at (+-50, 14)
    const lens = (x, y, r, glowA) => {
      bloom(ctx, x, y, r*2.4, "154,165,255", glowA);
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
    // frame
    poly(ctx, [[-58*A,-40*A],[58*A,-40*A],[80*A,-6*A],[72*A,34*A],[30*A,58*A],
               [-30*A,58*A],[-72*A,34*A],[-80*A,-6*A]],
         "#2a1206", "#c2570f", 4*A);
    panels(ctx, -60*A, 60*A, -34*A, 40*A, 8, 0.42);
    // shoulder pods at (+-62, 14)
    [-1, 1].forEach(sd => {
      slab(ctx, sd*62*A, 14*A, 44*A, 48*A, 9*A, "#1c0c04", "#f97316", 3.5*A);
      bloom(ctx, sd*62*A, 14*A, 28*A, "249,115,22", 0.35);
      ctx.fillStyle = "rgba(255,200,140,0.75)";
      [-1, 0, 1].forEach(k => slab(ctx, sd*62*A, 14*A + k*13*A, 26*A, 5*A, 2*A,
                                   "rgba(255,200,140,0.75)", null));
    });
    // belly hatch at (0,44)
    slab(ctx, 0, 44*A, 46*A, 28*A, 7*A, "#1a0a03", "#f9a03c", 3*A);
    ctx.strokeStyle = "rgba(255,190,120,0.6)"; ctx.lineWidth = 2.4*A;
    ctx.beginPath(); ctx.moveTo(-18*A, 44*A); ctx.lineTo(18*A, 44*A); ctx.stroke();
    // spine core at (0,-18)
    bloom(ctx, 0, -18*A, 40*A, "255,180,80", 0.4 + damage*0.25);
    poly(ctx, [[-24*A,-2*A],[-16*A,-40*A],[16*A,-40*A],[24*A,-2*A]],
         "#3a1a06", "#ffc46b", 3*A);
    ctx.fillStyle = "rgba(255,235,190," + (0.6 + Math.sin(timeMs/170)*0.3).toFixed(2) + ")";
    ctx.beginPath(); ctx.arc(0, -18*A, 11*A, 0, TAU); ctx.fill();
    lights(ctx, -54*A, 54*A, -36*A, 9, "255,210,150", timeMs, 2.4*A);
    cracks(ctx, boss, S, damage, timeMs);
  },
};

/** True if this boss has hull art of its own. */
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
