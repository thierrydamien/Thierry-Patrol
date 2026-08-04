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
  /*
   * THE MARAUDER - a dart, not a slab. Two forward-swept arms carry the
   * cannons out at the tips (the weak points), with a narrow spearhead body
   * between them. Reads as "fast and pointed" from across the room, which is
   * what a boss that CHARGES you should look like.
   */
  marauder(ctx, boss, S, damage, timeMs){
    const A = S/132;
    const charging = !!boss.charge;
    // swept arms out to the cannon pods at (+-62,-4)
    [-1, 1].forEach(sd => {
      poly(ctx, [[sd*10*A, 22*A],[sd*36*A, -30*A],[sd*74*A, -16*A],
                 [sd*70*A, 16*A],[sd*24*A, 36*A]],
           "#320f1c", "#a8324a", 3*A);
      // the cannon itself, barrel pointing down-screen
      slab(ctx, sd*62*A, -4*A, 26*A, 34*A, 6*A, "#5c1526", "#ff6b7f", 2.8*A);
      ctx.fillStyle = "#ff9db0";
      slab(ctx, sd*62*A, 16*A, 12*A, 14*A, 3*A, "#ff9db0", null);
      bloom(ctx, sd*62*A, 18*A, 18*A, "255,80,110", 0.35);
    });
    // spearhead body
    poly(ctx, [[0,-64*A],[20*A,-8*A],[13*A,42*A],[-13*A,42*A],[-20*A,-8*A]],
         "#24091a", "#c23b55", 3.5*A);
    ctx.strokeStyle = "rgba(255,150,170,0.25)"; ctx.lineWidth = 2*A;
    ctx.beginPath(); ctx.moveTo(0,-52*A); ctx.lineTo(0, 36*A); ctx.stroke();
    // ram prow - lit while it is winding up to charge
    poly(ctx, [[0,-78*A],[12*A,-56*A],[-12*A,-56*A]],
         charging ? "#ffd6de" : "#e05070", null);
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
    // compact upper body
    poly(ctx, [[-40*A,-42*A],[40*A,-42*A],[52*A,-8*A],[30*A,16*A],[-30*A,16*A],[-52*A,-8*A]],
         "#0d2418", "#2f7d55", 3.4*A);
    panels(ctx, -32*A, 32*A, -34*A, 12*A, 4, 0.35);
    slab(ctx, 0, -30*A, 34*A, 16*A, 4*A, "#13351f", "#3f9c68", 2.2*A);
    lights(ctx, -26*A, 26*A, -38*A, 5, "160,255,200", timeMs, 2.2*A);

    // the two arms, reaching down and out to the cells at (+-58, 52)
    [-1, 1].forEach(sd => {
      ctx.strokeStyle = "#1b4a30"; ctx.lineWidth = 15*A; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sd*30*A, 4*A);
      ctx.quadraticCurveTo(sd*62*A, 18*A, sd*58*A + sway*sd, 44*A);
      ctx.stroke();
      ctx.strokeStyle = "#3f9c68"; ctx.lineWidth = 7*A;
      ctx.stroke();
      // elbow joint
      ctx.fillStyle = "#2f7d55";
      ctx.beginPath(); ctx.arc(sd*52*A, 18*A, 8*A, 0, TAU); ctx.fill();

      // the cell, clamped in a claw
      const cx = sd*58*A + sway*sd, cy = 52*A;
      ctx.fillStyle = "#2f7d55";
      [-1, 1].forEach(k => {
        poly(ctx, [[cx + k*20*A, cy - 24*A],[cx + k*30*A, cy - 4*A],
                   [cx + k*24*A, cy + 22*A],[cx + k*14*A, cy + 10*A]],
             "#2f7d55", null);
      });
      slab(ctx, cx, cy, 34*A, 40*A, 5*A, "#08170f", "#4ade80", 3*A);
      ctx.strokeStyle = "rgba(140,255,190,0.65)"; ctx.lineWidth = 2.4*A;
      for(let i = -1; i <= 1; i++){
        ctx.beginPath();
        ctx.moveTo(cx + i*10*A, cy - 15*A); ctx.lineTo(cx + i*10*A, cy + 15*A);
        ctx.stroke();
      }
      bloom(ctx, cx, cy, 30*A, "74,222,128", 0.3);
    });

    // tractor emitter, slung under the body between the arms
    poly(ctx, [[-16*A,14*A],[16*A,14*A],[10*A,36*A],[-10*A,36*A]],
         "#12402a", "#4ade80", 2.4*A);
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
    // the deck - long and low
    poly(ctx, [[-84*A,-2*A],[-64*A,-22*A],[64*A,-22*A],[84*A,-2*A],
               [70*A,32*A],[-70*A,32*A]], "#1d1030", "#7c4bbd", 3.5*A);
    // launch lanes running down the deck
    ctx.strokeStyle = "rgba(210,180,255,0.30)"; ctx.lineWidth = 3*A;
    ctx.setLineDash([10*A, 8*A]);
    [-38, 0, 38].forEach(x => {
      ctx.beginPath(); ctx.moveTo(x*A, -18*A); ctx.lineTo(x*A, 28*A); ctx.stroke();
    });
    ctx.setLineDash([]);
    // engine pods far out at (+-68, 20)
    [-1, 1].forEach(sd => {
      slab(ctx, sd*68*A, 20*A, 34*A, 42*A, 8*A, "#150a26", "#a855f7", 3*A);
      bloom(ctx, sd*68*A, 34*A, 24*A, "168,85,247", 0.42);
      ctx.fillStyle = "rgba(226,204,255,0.85)";
      slab(ctx, sd*68*A, 34*A, 18*A, 7*A, 3*A, "rgba(226,204,255,0.85)", null);
    });
    // command tower on the spine at (0,-30) - the tallest thing on the ship
    poly(ctx, [[-16*A,-14*A],[-11*A,-48*A],[11*A,-48*A],[16*A,-14*A]],
         "#2a1547", "#c9a4ff", 3*A);
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
    // the ring
    ctx.strokeStyle = "#0d3d4a"; ctx.lineWidth = 30*A;
    ctx.beginPath(); ctx.arc(0, 12*A, 58*A, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 3.5*A;
    ctx.beginPath(); ctx.arc(0, 12*A, 73*A, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 12*A, 43*A, 0, TAU); ctx.stroke();
    // ribs across the ring
    ctx.strokeStyle = "rgba(120,220,240,0.3)"; ctx.lineWidth = 2.5*A;
    for(let i = 0; i < 8; i++){
      const a = (TAU/8)*i + timeMs/6000;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*43*A, 12*A + Math.sin(a)*43*A);
      ctx.lineTo(Math.cos(a)*73*A, 12*A + Math.sin(a)*73*A);
      ctx.stroke();
    }
    // mine hatches set into the rim at (+-58, 14)
    [-1, 1].forEach(sd => {
      slab(ctx, sd*58*A, 14*A, 38*A, 38*A, 10*A, "#04191f", "#22d3ee", 3*A);
      ctx.fillStyle = "rgba(34,211,238," + (0.35 + Math.sin(timeMs/260 + sd)*0.25).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(sd*58*A, 14*A, 11*A, 0, TAU); ctx.fill();
    });
    // the mast and spine array at (0,-46)
    ctx.strokeStyle = "#1c7f95"; ctx.lineWidth = 9*A;
    ctx.beginPath(); ctx.moveTo(0, -14*A); ctx.lineTo(0, -40*A); ctx.stroke();
    slab(ctx, 0, -46*A, 62*A, 20*A, 6*A, "#062b36", "#7ce9f7", 3*A);
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
