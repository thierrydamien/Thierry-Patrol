/*
 * Enemy art, drawn rather than photographed.
 *
 * Every enemy used to be the same PNG in a different colour, which meant
 * nineteen archetypes with one silhouette - you had to remember what "the
 * green one" did. These are hand-built vector ships, one shape per archetype,
 * so a Mender and a Marksman are different things at a glance.
 *
 * Each sprite is rasterised ONCE into an offscreen canvas (per type, per
 * colour, per elite flag) and then blitted, so the per-frame cost is a single
 * drawImage - the same as the old sprite - no matter how detailed the drawing.
 *
 * Convention: ships are drawn nose-DOWN, because that's the way they fly. The
 * light comes from the top-left in sprite space and stays put, which is what
 * stops a fleet of these reading as flat stickers.
 */
(function(){
"use strict";
const SF = window.SF;
const { TAU } = SF.core;

const RES = 128;              // rasterise at this size, scale at draw time
const PAD = 4;                // room for glow so it isn't clipped

/* ---------------------------------------------------------
   PALETTE
   One tint in, a small consistent set of shades out, so the
   whole roster looks like it came out of the same factory.
   --------------------------------------------------------- */
function hexToRgb(hex){
  const v = parseInt(String(hex).replace("#",""), 16);
  return { r:(v>>16)&255, g:(v>>8)&255, b:v&255 };
}
function mix(c, target, k){
  return "rgb(" + Math.round(c.r + (target - c.r)*k) + "," +
                  Math.round(c.g + (target - c.g)*k) + "," +
                  Math.round(c.b + (target - c.b)*k) + ")";
}
function paletteFor(tint, elite){
  const c = hexToRgb(tint || "#c0392b");
  return {
    lit:    mix(c, 255, 0.42),
    base:   mix(c, 255, 0.06),
    /*
     * The shaded half used to run to 0.42/0.68 toward black, which models
     * nicely on a light background and disappears on this game's. Space IS
     * the background here, so the dark side of a hull has to stay a colour
     * rather than becoming a hole.
     */
    shade:  mix(c, 0,   0.34),
    deep:   mix(c, 0,   0.58),
    line:   "rgba(10,12,20,0.85)",
    metal:  "#8c96a8",
    metalD: "#4a5262",
    glass:  elite ? "#fff2c0" : "#bde9ff",
    glassRgb: elite ? "255,226,140" : "150,225,255",
    glow:   elite ? "#ffd23f" : tint || "#ff8a3d",
    trim:   elite ? "#ffd23f" : mix(c, 255, 0.72),
    // Key light from the top-left, and a cool counter-light off the sky.
    rim:     elite ? "rgba(255,236,170,0.92)" : "rgba(255,250,238,0.82)",
    rimCool: "rgba(126,188,255,0.34)",
  };
}

/* ---------------------------------------------------------
   DRAWING HELPERS
   --------------------------------------------------------- */
function poly(ctx, pts){
  ctx.beginPath();
  for(let i=0;i<pts.length;i+=2){
    if(i === 0) ctx.moveTo(pts[i], pts[i+1]); else ctx.lineTo(pts[i], pts[i+1]);
  }
  ctx.closePath();
}
/*
 * Rim light, and the reason these ships stop reading as cutouts.
 *
 * The hull gradient models the form, but the only thing separating a ship
 * from the sky was a near-black outline - which works over a bright nebula
 * and does nothing at all over empty space, where the silhouette simply
 * dissolves. A lit edge solves both problems at once: it draws the shape AND
 * it puts the fleet under one light.
 *
 * The trick is cheap and works on any polygon: clip to the shape, then stroke
 * the same outline shifted a little AWAY from the light. On the edges facing
 * the light the shifted line lands inside the hull and shows; on the far
 * edges it lands outside and the clip eats it. No per-edge normals, no
 * winding maths, and it's all baked into the cached sprite anyway.
 */
function rimLight(ctx, pts, p, S){
  const d = S*0.024;
  ctx.save();
  poly(ctx, pts); ctx.clip();
  ctx.translate(d, d);                          // key light: top-left
  poly(ctx, pts);
  ctx.strokeStyle = p.rim; ctx.lineWidth = S*0.044; ctx.stroke();
  ctx.restore();
  /*
   * A cool counter-light on the opposite edges at half strength. These ships
   * fly nose-down, so this is the edge coming at the player - and it's the
   * one the eye tracks when deciding whether something is about to arrive.
   */
  ctx.save();
  poly(ctx, pts); ctx.clip();
  ctx.translate(-d*0.85, -d*0.85);
  poly(ctx, pts);
  ctx.strokeStyle = p.rimCool; ctx.lineWidth = S*0.042; ctx.stroke();
  ctx.restore();
}

/** Fill with a top-left lit gradient, outline, then catch the light. */
function hull(ctx, pts, p, S){
  const g = ctx.createLinearGradient(-S*0.4, -S*0.4, S*0.35, S*0.4);
  g.addColorStop(0, p.lit);
  g.addColorStop(0.45, p.base);
  g.addColorStop(1, p.shade);
  poly(ctx, pts);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = p.line; ctx.lineWidth = S*0.026; ctx.stroke();
  rimLight(ctx, pts, p, S);
}
function plate(ctx, pts, p, S, colour){
  poly(ctx, pts);
  ctx.fillStyle = colour || p.deep; ctx.fill();
}
/*
 * A canopy that is lit rather than painted. The glass used to be a flat disc
 * with a white dot on it, which at 42px on screen is just a pale blob; giving
 * it a halo and a hot core makes it the one small bright thing on the hull,
 * and a bright point is what the eye finds first on a dark sky.
 */
function cockpit(ctx, x, y, rx, ry, p){
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, ry/rx);
  const halo = ctx.createRadialGradient(0, 0, rx*0.4, 0, 0, rx*2.4);
  halo.addColorStop(0, "rgba(" + p.glassRgb + ",0.5)");
  halo.addColorStop(0.5, "rgba(" + p.glassRgb + ",0.16)");
  halo.addColorStop(1, "rgba(" + p.glassRgb + ",0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, rx*2.4, 0, TAU); ctx.fill();
  ctx.fillStyle = p.glass;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.arc(-rx*0.28, -rx*0.3, rx*0.42, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.arc(0, 0, rx*0.34, 0, TAU); ctx.fill();
  ctx.restore();
}
/*
 * Engine at the tail (the top, since these fly nose-down): a dark nozzle with
 * a soft bloom behind it. This started as a bright triangle and every ship in
 * the fleet looked like it had horns - an exhaust has to be diffuse at the
 * edges or the eye reads it as part of the hull.
 */
function thruster(ctx, x, y, w, len, p){
  const cy = y - len*0.34;
  const g = ctx.createRadialGradient(x, cy, 0, x, cy, len*0.8);
  g.addColorStop(0, "rgba(255,240,206,0.95)");
  g.addColorStop(0.32, "rgba(255,172,92,0.5)");
  g.addColorStop(1, "rgba(255,120,60,0)");
  ctx.fillStyle = g;
  ctx.save();
  ctx.translate(x, cy); ctx.scale(w*1.25/(len*0.6), 1);
  ctx.beginPath(); ctx.arc(0, 0, len*0.6, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = p.metalD;
  ctx.fillRect(x - w*0.85, y - w*0.42, w*1.7, w*0.84);
  /*
   * A hot spot in the mouth of the nozzle. The bloom above carries the shape
   * of the exhaust but its brightest point is soft, and at 42px on screen a
   * soft peak is no peak - the engine only reads as lit if one genuinely
   * white pixel sits on the metal.
   *
   * It has to stay SMALL. The first version was a little over half the nozzle
   * width and every ship in the fleet looked like it was wearing a pale
   * bubble on its head - the same failure the exhaust itself had, which is
   * how this thruster ended up diffuse in the first place.
   */
  const cr = w*0.5, cyy = y - w*0.16;
  const core = ctx.createRadialGradient(x, cyy, 0, x, cyy, cr);
  core.addColorStop(0, "rgba(255,255,255,0.8)");
  core.addColorStop(0.5, "rgba(255,214,150,0.3)");
  core.addColorStop(1, "rgba(255,170,90,0)");
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(x, cyy, cr, 0, TAU); ctx.fill();
}

/* ---------------------------------------------------------
   THE ROSTER
   Each shape draws in a box of size S centred on the origin,
   nose pointing to +y.
   --------------------------------------------------------- */
const SHAPES = {
  /* --- the plain shooters: a family of darts, growing heavier --- */
  grunt(ctx, S, p){
    hull(ctx, [0,S*0.44, S*0.20,S*0.02, S*0.30,-S*0.20, 0,-S*0.30,
               -S*0.30,-S*0.20, -S*0.20,S*0.02], p, S);
    plate(ctx, [0,S*0.30, S*0.09,S*0.00, 0,-S*0.12, -S*0.09,S*0.00], p, S, p.deep);
    cockpit(ctx, 0, S*0.06, S*0.075, S*0.10, p);
    thruster(ctx, 0, -S*0.28, S*0.09, S*0.20, p);
  },
  weaver(ctx, S, p){
    // Swept crescent - reads as "this one slides sideways".
    hull(ctx, [0,S*0.40, S*0.34,-S*0.04, S*0.44,-S*0.26, S*0.14,-S*0.18,
               0,-S*0.28, -S*0.14,-S*0.18, -S*0.44,-S*0.26, -S*0.34,-S*0.04], p, S);
    plate(ctx, [S*0.16,-S*0.06, S*0.34,-S*0.20, S*0.20,-S*0.16], p, S, p.trim);
    plate(ctx, [-S*0.16,-S*0.06, -S*0.34,-S*0.20, -S*0.20,-S*0.16], p, S, p.trim);
    cockpit(ctx, 0, S*0.10, S*0.07, S*0.09, p);
    thruster(ctx, 0, -S*0.26, S*0.08, S*0.18, p);
  },
  striker(ctx, S, p){
    // Flat-topped gunship with two outboard barrels.
    hull(ctx, [0,S*0.36, S*0.16,S*0.14, S*0.36,S*0.06, S*0.36,-S*0.22,
               -S*0.36,-S*0.22, -S*0.36,S*0.06, -S*0.16,S*0.14], p, S);
    [-1,1].forEach(s => {
      plate(ctx, [s*S*0.34,S*0.10, s*S*0.24,S*0.10, s*S*0.24,S*0.30, s*S*0.34,S*0.30], p, S, p.metal);
    });
    plate(ctx, [-S*0.30,-S*0.20, S*0.30,-S*0.20, S*0.24,-S*0.06, -S*0.24,-S*0.06], p, S, p.deep);
    cockpit(ctx, 0, S*0.10, S*0.09, S*0.07, p);
    thruster(ctx, -S*0.18, -S*0.20, S*0.07, S*0.16, p);
    thruster(ctx,  S*0.18, -S*0.20, S*0.07, S*0.16, p);
  },
  swooper(ctx, S, p){
    // Forward-swept: it comes at you.
    hull(ctx, [0,S*0.46, S*0.13,S*0.10, S*0.42,S*0.22, S*0.30,-S*0.12,
               0,-S*0.26, -S*0.30,-S*0.12, -S*0.42,S*0.22, -S*0.13,S*0.10], p, S);
    plate(ctx, [0,S*0.34, S*0.07,S*0.04, 0,-S*0.08, -S*0.07,S*0.04], p, S, p.trim);
    cockpit(ctx, 0, S*0.12, S*0.065, S*0.09, p);
    thruster(ctx, 0, -S*0.24, S*0.10, S*0.20, p);
  },
  kamikaze(ctx, S, p){
    // A warhead with fins. Nothing about it says "returns home".
    hull(ctx, [0,S*0.50, S*0.13,S*0.06, S*0.26,-S*0.24, 0,-S*0.16,
               -S*0.26,-S*0.24, -S*0.13,S*0.06], p, S);
    ctx.fillStyle = p.glow;
    ctx.beginPath(); ctx.arc(0, S*0.30, S*0.07, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = S*0.02; ctx.stroke();
    thruster(ctx, 0, -S*0.18, S*0.10, S*0.26, p);
  },
  turret(ctx, S, p){
    // Squat platform: it parks and shells you.
    hull(ctx, [S*0.18,S*0.34, S*0.38,S*0.10, S*0.38,-S*0.10, S*0.18,-S*0.34,
               -S*0.18,-S*0.34, -S*0.38,-S*0.10, -S*0.38,S*0.10, -S*0.18,S*0.34], p, S);
    ctx.fillStyle = p.metalD;
    [-1,0,1].forEach(i => ctx.fillRect(i*S*0.17 - S*0.045, S*0.24, S*0.09, S*0.20));
    plate(ctx, [-S*0.22,-S*0.16, S*0.22,-S*0.16, S*0.16,S*0.10, -S*0.16,S*0.10], p, S, p.deep);
    cockpit(ctx, 0, -S*0.02, S*0.10, S*0.08, p);
  },
  brute(ctx, S, p){
    // Broad and armoured, with shoulder plates you can read at a glance.
    hull(ctx, [0,S*0.40, S*0.26,S*0.22, S*0.44,-S*0.06, S*0.34,-S*0.28,
               -S*0.34,-S*0.28, -S*0.44,-S*0.06, -S*0.26,S*0.22], p, S);
    [-1,1].forEach(s => {
      plate(ctx, [s*S*0.42,-S*0.04, s*S*0.30,-S*0.26, s*S*0.16,-S*0.20, s*S*0.26,S*0.04],
            p, S, p.metal);
    });
    plate(ctx, [0,S*0.30, S*0.12,S*0.02, 0,-S*0.16, -S*0.12,S*0.02], p, S, p.deep);
    cockpit(ctx, 0, S*0.06, S*0.08, S*0.07, p);
    thruster(ctx, -S*0.14, -S*0.26, S*0.08, S*0.18, p);
    thruster(ctx,  S*0.14, -S*0.26, S*0.08, S*0.18, p);
  },
  carrier(ctx, S, p){
    // A hauler: boxy, slow, and visibly carrying something.
    hull(ctx, [S*0.20,S*0.40, S*0.40,S*0.12, S*0.40,-S*0.24, -S*0.40,-S*0.24,
               -S*0.40,S*0.12, -S*0.20,S*0.40], p, S);
    plate(ctx, [-S*0.26,-S*0.02, S*0.26,-S*0.02, S*0.26,S*0.24, -S*0.26,S*0.24], p, S, p.metalD);
    ctx.fillStyle = p.glass;
    for(let i=-1;i<=1;i++) ctx.fillRect(i*S*0.15 - S*0.05, S*0.04, S*0.10, S*0.14);
    thruster(ctx, -S*0.26, -S*0.22, S*0.08, S*0.16, p);
    thruster(ctx,  S*0.26, -S*0.22, S*0.08, S*0.16, p);
    thruster(ctx,  0,      -S*0.22, S*0.09, S*0.20, p);
  },

  /* --- the ones that need a different answer: distinctly odd shapes --- */
  shielder(ctx, S, p){
    // A disc with a projector ring - obviously not a fighter.
    ctx.strokeStyle = p.trim; ctx.lineWidth = S*0.05;
    ctx.beginPath(); ctx.arc(0, 0, S*0.36, 0, TAU); ctx.stroke();
    hull(ctx, [0,S*0.26, S*0.22,S*0.08, S*0.22,-S*0.14, 0,-S*0.26,
               -S*0.22,-S*0.14, -S*0.22,S*0.08], p, S);
    ctx.fillStyle = p.glass;
    ctx.beginPath(); ctx.arc(0, 0, S*0.12, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = S*0.022; ctx.stroke();
    [0,1,2,3].forEach(n => {
      const a = n/4*TAU + Math.PI/4;
      ctx.fillStyle = p.metal;
      ctx.beginPath();
      ctx.arc(Math.cos(a)*S*0.36, Math.sin(a)*S*0.36, S*0.055, 0, TAU);
      ctx.fill();
    });
  },
  splitter(ctx, S, p){
    // Three visible lobes, so "it comes apart" is legible before it does.
    [-1,0,1].forEach(i => {
      const x = i*S*0.20, y = i === 0 ? S*0.06 : -S*0.04;
      hull(ctx, [x,y+S*0.28, x+S*0.16,y, x,y-S*0.24, x-S*0.16,y], p, S);
    });
    ctx.strokeStyle = p.line; ctx.lineWidth = S*0.03;
    ctx.beginPath();
    ctx.moveTo(-S*0.20, S*0.0); ctx.lineTo(S*0.20, S*0.0); ctx.stroke();
    cockpit(ctx, 0, S*0.08, S*0.055, S*0.055, p);
  },
  shard(ctx, S, p){
    hull(ctx, [0,S*0.40, S*0.22,-S*0.22, -S*0.22,-S*0.22], p, S);
    thruster(ctx, 0, -S*0.20, S*0.08, S*0.16, p);
  },
  thief(ctx, S, p){
    // Sleek, with grabber claws out front. It's here for the money.
    hull(ctx, [0,S*0.34, S*0.16,S*0.06, S*0.26,-S*0.24, -S*0.26,-S*0.24,
               -S*0.16,S*0.06], p, S);
    ctx.strokeStyle = p.metal; ctx.lineWidth = S*0.05; ctx.lineCap = "round";
    [-1,1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s*S*0.13, S*0.20);
      ctx.quadraticCurveTo(s*S*0.34, S*0.34, s*S*0.20, S*0.46);
      ctx.stroke();
    });
    ctx.lineCap = "butt";
    cockpit(ctx, 0, S*0.02, S*0.07, S*0.07, p);
    thruster(ctx, 0, -S*0.22, S*0.10, S*0.20, p);
  },
  sniper(ctx, S, p){
    // Long barrel, thin body: it's a rifle with engines.
    ctx.fillStyle = p.metalD;
    ctx.fillRect(-S*0.045, S*0.10, S*0.09, S*0.40);
    ctx.fillStyle = p.trim;
    ctx.fillRect(-S*0.065, S*0.40, S*0.13, S*0.06);
    hull(ctx, [0,S*0.16, S*0.20,S*0.00, S*0.30,-S*0.26, -S*0.30,-S*0.26,
               -S*0.20,S*0.00], p, S);
    cockpit(ctx, 0, -S*0.08, S*0.075, S*0.06, p);
    thruster(ctx, -S*0.18, -S*0.24, S*0.06, S*0.14, p);
    thruster(ctx,  S*0.18, -S*0.24, S*0.06, S*0.14, p);
  },
  /*
   * VESPER. A swept dart with the game's only forward-raked wings, so the
   * rival never reads as another interceptor in a new colour - and the shape
   * points the same way yours does. It should look like a ship somebody
   * flies, not another thing that spawned.
   */
  rival(ctx, S, p){
    hull(ctx, [0,S*0.46, S*0.13,S*0.16, S*0.44,-S*0.06, S*0.30,-S*0.20,
               S*0.10,-S*0.12, 0,-S*0.22, -S*0.10,-S*0.12, -S*0.30,-S*0.20,
               -S*0.44,-S*0.06, -S*0.13,S*0.16], p, S);
    plate(ctx, [0,S*0.30, S*0.10,0, 0,-S*0.14, -S*0.10,0], p, S, p.trim);
    cockpit(ctx, 0, S*0.10, S*0.07, S*0.11, p);
    thruster(ctx, -S*0.13, -S*0.20, S*0.07, S*0.16, p);
    thruster(ctx,  S*0.13, -S*0.20, S*0.07, S*0.16, p);
  },
  interceptor(ctx, S, p){
    // A two-prong fork - it flies at you in a way nothing else does.
    hull(ctx, [S*0.10,S*0.44, S*0.22,S*0.10, S*0.34,-S*0.24, S*0.06,-S*0.14,
               -S*0.06,-S*0.14, -S*0.34,-S*0.24, -S*0.22,S*0.10, -S*0.10,S*0.44], p, S);
    plate(ctx, [0,S*0.18, S*0.08,-S*0.04, 0,-S*0.16, -S*0.08,-S*0.04], p, S, p.trim);
    cockpit(ctx, 0, S*0.02, S*0.06, S*0.08, p);
    thruster(ctx, -S*0.20, -S*0.22, S*0.07, S*0.18, p);
    thruster(ctx,  S*0.20, -S*0.22, S*0.07, S*0.18, p);
  },
  bomber(ctx, S, p){
    // Fat belly with an open bay. You can see where the mines come from.
    hull(ctx, [0,S*0.36, S*0.30,S*0.20, S*0.42,-S*0.10, S*0.24,-S*0.28,
               -S*0.24,-S*0.28, -S*0.42,-S*0.10, -S*0.30,S*0.20], p, S);
    plate(ctx, [-S*0.18,S*0.06, S*0.18,S*0.06, S*0.14,S*0.30, -S*0.14,S*0.30], p, S, "#22262f");
    ctx.fillStyle = p.glow;
    [-1,1].forEach(s => {
      ctx.beginPath(); ctx.arc(s*S*0.07, S*0.20, S*0.045, 0, TAU); ctx.fill();
    });
    cockpit(ctx, 0, -S*0.10, S*0.10, S*0.07, p);
    thruster(ctx, -S*0.22, -S*0.26, S*0.08, S*0.16, p);
    thruster(ctx,  S*0.22, -S*0.26, S*0.08, S*0.16, p);
  },
  hive(ctx, S, p){
    // A comb. Reads as a container, not a fighter.
    hull(ctx, [S*0.22,S*0.34, S*0.42,0, S*0.22,-S*0.34, -S*0.22,-S*0.34,
               -S*0.42,0, -S*0.22,S*0.34], p, S);
    ctx.fillStyle = p.deep;
    const cells = [[0,0],[0,-0.2],[0,0.2],[-0.18,-0.1],[0.18,-0.1],[-0.18,0.1],[0.18,0.1]];
    cells.forEach(([cx,cy]) => {
      ctx.beginPath();
      for(let n=0;n<6;n++){
        const a = n/6*TAU + Math.PI/6;
        const x = cx*S + Math.cos(a)*S*0.085, y = cy*S + Math.sin(a)*S*0.085;
        if(n === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = p.glow;
    ctx.beginPath(); ctx.arc(0, S*0.26, S*0.06, 0, TAU); ctx.fill();
  },
  mender(ctx, S, p){
    // Rounded, unarmed, with repair arms. Obviously support.
    hull(ctx, [0,S*0.32, S*0.24,S*0.16, S*0.30,-S*0.12, S*0.12,-S*0.30,
               -S*0.12,-S*0.30, -S*0.30,-S*0.12, -S*0.24,S*0.16], p, S);
    ctx.strokeStyle = p.metal; ctx.lineWidth = S*0.055;
    [-1,1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s*S*0.22, S*0.04); ctx.lineTo(s*S*0.40, S*0.22); ctx.stroke();
      ctx.fillStyle = p.trim;
      ctx.beginPath(); ctx.arc(s*S*0.40, S*0.22, S*0.06, 0, TAU); ctx.fill();
    });
    ctx.fillStyle = "#eafff4";
    ctx.fillRect(-S*0.05, -S*0.16, S*0.10, S*0.26);
    ctx.fillRect(-S*0.13, -S*0.08, S*0.26, S*0.10);
    thruster(ctx, 0, -S*0.28, S*0.09, S*0.18, p);
  },
};

/* ---------------------------------------------------------
   RASTER CACHE
   --------------------------------------------------------- */
const cache = {};
function spriteFor(typeId, tint, elite){
  const key = typeId + "|" + tint + "|" + (elite ? 1 : 0);
  if(cache[key]) return cache[key];
  const shape = SHAPES[typeId];
  if(!shape) return null;
  const cv = document.createElement("canvas");
  cv.width = cv.height = RES + PAD*2;
  const ctx = cv.getContext("2d");
  if(!ctx) return null;
  const p = paletteFor(tint, elite);
  ctx.translate(cv.width/2, cv.height/2);
  ctx.lineJoin = "round";
  if(elite){ ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = RES*0.10; }
  try { shape(ctx, RES, p); } catch(e){ return null; }
  cache[key] = cv;
  return cv;
}

/** True if this archetype has drawn art (everything except rocks and mines). */
function has(typeId){ return !!SHAPES[typeId]; }

SF.enemyArt = { spriteFor, has, SHAPES, paletteFor };
})();
