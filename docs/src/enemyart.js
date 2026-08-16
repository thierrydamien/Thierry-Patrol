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
/** Mix toward an {r,g,b} colour rather than a grey - how shadows go cool. */
function mixTo(c, t, k){
  return "rgb(" + Math.round(c.r + (t.r - c.r)*k) + "," +
                  Math.round(c.g + (t.g - c.g)*k) + "," +
                  Math.round(c.b + (t.b - c.b)*k) + ")";
}
function paletteFor(tint, elite){
  const c = hexToRgb(tint || "#c0392b");
  return {
    /*
     * EXPOSURE. Putting the fleet under a light also washed it out: measured
     * over the whole roster, mean sprite luminance went 148 -> 160 and not one
     * enemy came out darker. Most of that was the ink diet (thinning the
     * outline removed the near-black that had been holding small sprites
     * down), so the fix is NOT to paint the outline back on - that undoes the
     * reason for the pass. It's to stop lifting the lit half so far.
     *
     * lit ran to 42% white, which on this roster's already-pastel tints
     * (#eaf2ff, #86efac, #bef264) is most of the way to paper. At 18% the
     * highlight is still a highlight and the hull keeps its colour, and base
     * is now the tint exactly as the data file spells it.
     */
    lit:    mix(c, 255, 0.18),
    base:   mix(c, 255, 0),
    /*
     * The shaded half used to run to 0.42/0.68 toward black, which models
     * nicely on a light background and disappears on this game's. Space IS
     * the background here, so the dark side of a hull has to stay a colour
     * rather than becoming a hole.
     */
    /*
     * Shadows COOL as they darken instead of just dimming - mixed toward a
     * deep space navy, not black. Shadows that keep the hue are the single
     * clearest "flat drawing" tell; shadows that drift cold read as light.
     *
     * Deeper than the first cut (0.44/0.66): the roster needed its overall
     * value back, and spending that on the shadow side buys form instead of
     * losing it. Checked for hue drain too - mean chroma across the roster is
     * 74.6 against the pre-lighting 74.7, so the ships stay as identifiable
     * by colour as they ever were, which is how a seven-year-old tells a
     * Mender from a Marksman.
     */
    shade:  mixTo(c, {r:22, g:30, b:56}, 0.58),
    deep:   mixTo(c, {r:14, g:20, b:42}, 0.78),
    // Half the old ink. The line's job passed to the light: lightBake()
    // draws the lit and shaded edges, and a heavy outline over that reads
    // as a sticker border again.
    line:   "rgba(8,10,18,0.55)",
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
/*
 * An armour panel is lit like everything else on the hull.
 *
 * This was three lines - poly, flat fill, done - while hull() directly above
 * runs a three-stop gradient on the key-light axis and then catches the rim.
 * So on thirteen call sites the hull underneath was modelled and the plate on
 * top of it was a sticker, which is most of what made the heavies read flat.
 *
 * The wash is expressed in white/black alphas rather than mixing the colour,
 * because callers pass hex ("#22262f") AND the rgb() strings that come out of
 * mix() as p.metal/p.deep/p.trim - hexToRgb would return NaN on half of them.
 */
function plate(ctx, pts, p, S, colour){
  poly(ctx, pts);
  ctx.fillStyle = colour || p.deep; ctx.fill();
  ctx.save();
  poly(ctx, pts); ctx.clip();
  const g = ctx.createLinearGradient(-S*0.30, -S*0.30, S*0.25, S*0.30);
  g.addColorStop(0,    "rgba(255,255,255,0.14)");
  g.addColorStop(0.45, "rgba(255,255,255,0)");
  g.addColorStop(1,    "rgba(0,0,0,0.22)");
  ctx.fillStyle = g;
  poly(ctx, pts); ctx.fill();
  ctx.translate(S*0.012, S*0.012);
  poly(ctx, pts);
  ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = S*0.018;
  ctx.stroke();
  ctx.restore();
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
  /*
   * THIS PAINTED NOTHING. NOT DIM - NOTHING.
   *
   * The gradient was built at (x, cy) and THEN the context was translated by
   * (x, cy). A canvas gradient's coordinates are resolved against the CTM at
   * fill time, so its centre landed at (2x, 2cy) while the arc sat at
   * (x, cy) - about 0.34S away from a gradient that dies at 0.14S. Every
   * pixel of every enemy exhaust in the game took the terminal transparent
   * stop. Measured through node-canvas on the Grunt's own call site: 0 lit
   * pixels, peak alpha 0. Fixed: 568 lit pixels, peak alpha 226.
   *
   * This is why the fleet read as flat cardboard, and why the nozzle could
   * never be tuned into looking lit - there was nothing behind it to tune.
   * The gradient is built INSIDE the transform now, where it is used.
   */
  const cy = y - len*0.34;
  ctx.save();
  ctx.translate(x, cy); ctx.scale(w*1.25/(len*0.8), 1);
  // Tighter and hotter than the first bake: at roster sizes the old wide
  // warm bloom read as a brown mushroom growing off the tail. Most of the
  // energy now sits in a white-hot first third and the tail genuinely dies.
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len*0.62);
  g.addColorStop(0, "rgba(255,248,224,0.95)");
  g.addColorStop(0.22, "rgba(255,196,110,0.55)");
  g.addColorStop(0.6, "rgba(255,130,64,0.16)");
  g.addColorStop(1, "rgba(255,110,50,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, len*0.8, 0, TAU); ctx.fill();
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
  /*
   * THE TITHE SERPENT's head - the only creature in a fleet of machines,
   * which is the point: it doesn't fly the garden, it LIVES there. A blunt
   * diamond skull, big lantern eyes, and a jaw cracked open exactly one
   * coin wide. The body rings are drawn by the renderer from the same
   * palette; this painter is just the face a kid learns to chase.
   */
  /*
   * A serpent RING: an armoured annulus with fin ridges, drawn to chain
   * visually when the renderer strings them along the head's tape. The
   * weak one gets its lantern glow from the renderer, not from here.
   */
  serpentSeg(ctx, S, p){
    ctx.fillStyle = p.shade;
    ctx.beginPath(); ctx.arc(0, 0, S*0.34, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = p.base;
    ctx.beginPath(); ctx.arc(-S*0.05, -S*0.06, S*0.30, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = p.lit;
    ctx.beginPath(); ctx.arc(-S*0.09, -S*0.10, S*0.16, 0, Math.PI*2); ctx.fill();
    // the hole through the middle - it is a ring, not a bead
    ctx.fillStyle = p.deep;
    ctx.beginPath(); ctx.arc(0, 0, S*0.115, 0, Math.PI*2); ctx.fill();
    // fin ridges
    ctx.strokeStyle = p.deep; ctx.lineWidth = S*0.06; ctx.lineCap = "round";
    [-1,1].forEach(sd => {
      ctx.beginPath();
      ctx.moveTo(sd*S*0.30, -S*0.10);
      ctx.quadraticCurveTo(sd*S*0.46, 0, sd*S*0.30, S*0.12);
      ctx.stroke();
    });
    ctx.lineCap = "butt";
    ctx.strokeStyle = p.line; ctx.lineWidth = Math.max(1, S*0.03);
    ctx.beginPath(); ctx.arc(0, 0, S*0.34, 0, Math.PI*2); ctx.stroke();
  },
  /*
   * A ship part on the Foundry belt: half-built machinery on a pallet -
   * a turret pod, exposed ribs, one loose cable. It must read as CARGO,
   * not a fighter, so nothing about it points anywhere.
   */
  part(ctx, S, p){
    // pallet
    ctx.fillStyle = p.metalD;
    ctx.fillRect(-S*0.36, S*0.16, S*0.72, S*0.14);
    ctx.fillStyle = p.line;
    ctx.fillRect(-S*0.30, S*0.30, S*0.10, S*0.06);
    ctx.fillRect( S*0.20, S*0.30, S*0.10, S*0.06);
    // the half-built pod
    hull(ctx, [0,S*0.16, S*0.26,S*0.02, S*0.20,-S*0.24, -S*0.20,-S*0.24,
               -S*0.26,S*0.02], p, S);
    // exposed ribs where the plating isn't on yet
    ctx.strokeStyle = p.deep; ctx.lineWidth = S*0.045;
    for(let i=-1;i<=1;i++){
      ctx.beginPath();
      ctx.moveTo(i*S*0.11, -S*0.20); ctx.lineTo(i*S*0.11, S*0.08);
      ctx.stroke();
    }
    // one loose cable, because half-built things dangle
    ctx.strokeStyle = p.metal; ctx.lineWidth = S*0.035; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(S*0.18, -S*0.10);
    ctx.quadraticCurveTo(S*0.34, S*0.02, S*0.28, S*0.14);
    ctx.stroke();
    ctx.lineCap = "butt";
  },
  /*
   * THE LIMPET. Vermin, not a fighter - so no cockpit, no guns and no
   * thruster anywhere on it. A squat ribbed slug with a suction rim at the
   * front and two hooks, and the rim faces the player because that is the end
   * that is going to end up on your hull.
   */
  limpet(ctx, S, p){
    hull(ctx, [0,S*0.30, S*0.26,S*0.14, S*0.22,-S*0.20, 0,-S*0.30,
               -S*0.22,-S*0.20, -S*0.26,S*0.14], p, S);
    // ribs across the back, so it reads as a shell rather than a plate
    ctx.strokeStyle = p.deep; ctx.lineWidth = S*0.05;
    for(let i = -1; i <= 1; i++){
      ctx.beginPath();
      ctx.moveTo(-S*0.20, i*S*0.13); ctx.lineTo(S*0.20, i*S*0.13);
      ctx.stroke();
    }
    // the suction rim
    ctx.strokeStyle = p.trim; ctx.lineWidth = S*0.06;
    ctx.beginPath(); ctx.arc(0, S*0.18, S*0.15, 0.15, Math.PI - 0.15); ctx.stroke();
    ctx.fillStyle = p.deep;
    ctx.beginPath(); ctx.arc(0, S*0.19, S*0.08, 0, TAU); ctx.fill();
    // two hooks
    ctx.strokeStyle = p.metal; ctx.lineWidth = S*0.045; ctx.lineCap = "round";
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s*S*0.20, S*0.06);
      ctx.quadraticCurveTo(s*S*0.34, S*0.16, s*S*0.26, S*0.30);
      ctx.stroke();
    });
    ctx.lineCap = "butt";
  },
  /*
   * THE SKY OX. Broad, bone-pale and unarmed - a heavy brow slab, a hide of
   * overlapping plates and four short hoof-thrusters. It must read as an
   * ANIMAL at a glance, because the whole level depends on a child not
   * treating it as another thing to shoot: nothing on it points at you and
   * nothing on it glows.
   */
  grazer(ctx, S, p){
    /*
     * Two goes at this before it read as an animal, and both failures were the
     * same mistake: these sprites are drawn NOSE-DOWN, so anything placed at
     * -y lands along the TOP edge. Version one put the hooves there and got
     * four grey tabs over a pale block - a fortress turret. Version two swept
     * a pair of horns across the body and got what looked like a bag strap.
     *
     * So: symmetric about the vertical, seen from above. A broad humped back,
     * a blunt head at the FRONT (which is +y, the way it is walking), and four
     * short legs poking out at the sides where legs can actually be seen. No
     * horns, nothing pointing at the player, nothing that glows. It has to
     * read as livestock at a glance, because the whole level depends on a
     * child not treating it as another thing to shoot.
     */
    // four short legs out the sides, drawn under the body
    ctx.fillStyle = p.deep;
    [[-1, 0.12], [-1, -0.14], [1, 0.12], [1, -0.14]].forEach(([sd, y]) => {
      ctx.beginPath();
      ctx.moveTo(sd*S*0.28, y*S - S*0.05);
      ctx.lineTo(sd*S*0.42, y*S - S*0.03);
      ctx.lineTo(sd*S*0.42, y*S + S*0.04);
      ctx.lineTo(sd*S*0.28, y*S + S*0.06);
      ctx.closePath(); ctx.fill();
    });
    // the body: widest at the shoulders, tapering to the rump behind
    hull(ctx, [ 0,S*0.30,  S*0.30,S*0.16,  S*0.34,-S*0.06,
                S*0.22,-S*0.28,  0,-S*0.34,
               -S*0.22,-S*0.28, -S*0.34,-S*0.06, -S*0.30,S*0.16], p, S);
    // hide plates, following the curve of the back
    ctx.strokeStyle = p.shade; ctx.lineWidth = S*0.032;
    for(let i = 0; i < 3; i++){
      const y = -S*0.18 + i*S*0.13;
      ctx.beginPath();
      ctx.moveTo(-S*0.26, y);
      ctx.quadraticCurveTo(0, y + S*0.07, S*0.26, y);
      ctx.stroke();
    }
    // the head: a blunt wedge at the front, lower than the back
    ctx.fillStyle = p.shade;
    ctx.beginPath();
    ctx.moveTo(0, S*0.48);
    ctx.lineTo(S*0.15, S*0.36);
    ctx.lineTo(S*0.13, S*0.22);
    ctx.lineTo(-S*0.13, S*0.22);
    ctx.lineTo(-S*0.15, S*0.36);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = S*0.024; ctx.stroke();
    // muzzle and two small dark eyes
    ctx.fillStyle = p.deep;
    ctx.beginPath(); ctx.ellipse(0, S*0.42, S*0.07, S*0.045, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(12,10,9,0.85)";
    [-1, 1].forEach(sd => {
      ctx.beginPath(); ctx.arc(sd*S*0.085, S*0.28, S*0.028, 0, TAU); ctx.fill();
    });
  },
  serpent(ctx, S, p){
    // skull: blunt diamond, nose toward the player (+y)
    hull(ctx, [0,S*0.42, S*0.30,S*0.10, S*0.24,-S*0.26, -S*0.24,-S*0.26,
               -S*0.30,S*0.10], p, S);
    // brow ridges
    ctx.strokeStyle = p.shade; ctx.lineWidth = S*0.05; ctx.lineCap = "round";
    [-1,1].forEach(sd => {
      ctx.beginPath();
      ctx.moveTo(sd*S*0.06, S*0.02);
      ctx.quadraticCurveTo(sd*S*0.20, S*0.06, sd*S*0.24, -S*0.06);
      ctx.stroke();
    });
    ctx.lineCap = "butt";
    // lantern eyes - the glow that reads at combat size
    [-1,1].forEach(sd => {
      const g = ctx.createRadialGradient(sd*S*0.13, S*0.10, 0, sd*S*0.13, S*0.10, S*0.10);
      g.addColorStop(0, "#fff7d8");
      g.addColorStop(0.45, p.lit);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sd*S*0.13, S*0.10, S*0.10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#1a2c26";
      ctx.beginPath(); ctx.arc(sd*S*0.13, S*0.11, S*0.035, 0, Math.PI*2); ctx.fill();
    });
    // the jaw, cracked one coin wide - with the coin
    ctx.fillStyle = p.deep;
    ctx.beginPath();
    ctx.moveTo(-S*0.14, S*0.34); ctx.lineTo(S*0.14, S*0.34);
    ctx.lineTo(S*0.09, S*0.46); ctx.lineTo(-S*0.09, S*0.46);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath(); ctx.arc(0, S*0.40, S*0.055, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#8a5406"; ctx.lineWidth = Math.max(1, S*0.015);
    ctx.beginPath(); ctx.arc(0, S*0.40, S*0.055, 0, Math.PI*2); ctx.stroke();
    // fangs
    ctx.fillStyle = "#e8f2ee";
    [-1,1].forEach(sd => {
      ctx.beginPath();
      ctx.moveTo(sd*S*0.12, S*0.34); ctx.lineTo(sd*S*0.075, S*0.34);
      ctx.lineTo(sd*S*0.10, S*0.43); ctx.closePath(); ctx.fill();
    });
  },

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
/*
 * THE ELITE CARAPACE - an elite you can pick out by SHAPE.
 *
 * An elite was the same silhouette 18% larger with a gold glow round it, which
 * in a wall of twelve ships at arm's length is no difference at all: size reads
 * as distance, and the glow is one more bright thing in a sky full of them. A
 * child cannot pick the dangerous one without stopping to look, and stopping to
 * look is exactly what they cannot afford.
 *
 * So it gets a spiked shell, drawn UNDER the hull. Underneath is what makes it
 * work on all seventeen archetypes without a single bespoke variant: the
 * outline changes - a ring of blades fanning out past the wings - while the
 * archetype's own shape stays completely legible on top of it. A Guardian is
 * still obviously a Guardian; it just has teeth now.
 *
 * Nine blades, deliberately odd, so it never reads as a symmetrical flower, and
 * rotated off-axis so no blade lines up with the nose and gets read as a gun.
 */
function eliteCarapace(ctx, S, p){
  /*
   * SEPARATE SPINES, not a star polygon.
   *
   * The first attempt drew a nine-point star ring under the hull and it was a
   * lesson: it fringed the outline correctly and ruined everything else. The
   * blades were so wide they read as a sunburst BADGE rather than armour, and
   * between the ring's gold rim, the elite palette's gold canopy and the gold
   * shadow already on the sprite, the archetype's own colour disappeared - a
   * red Grunt and a purple Striker both came out gold. That is the wrong trade:
   * you learn "elite" and lose "which enemy is this", when the whole point was
   * to gain one without spending the other.
   *
   * So: six narrow spines, dark metal, tipped rather than rimmed, and no inner
   * collar (the collar was what muddied the hull interiors). The colour work is
   * left entirely to the archetype underneath.
   */
  /*
   * BASE sits deliberately deep - well inside even the narrowest hull (the
   * Marksman's funnel, the Interceptor's dart). At 0.32 the spines started
   * outside those two and hung in open space like loose darts; from 0.22 every
   * spine emerges from UNDER the ship, which is what makes it read as something
   * bolted on rather than something floating nearby.
   */
  const N = 6, BASE = S*0.22, TIP = S*0.52, HALF = 0.125, TURN = 0.42;
  for(let i = 0; i < N; i++){
    const a = TURN + (i/N)*TAU;
    const bx0 = Math.cos(a - HALF)*BASE, by0 = Math.sin(a - HALF)*BASE;
    const bx1 = Math.cos(a + HALF)*BASE, by1 = Math.sin(a + HALF)*BASE;
    const tx = Math.cos(a)*TIP,          ty = Math.sin(a)*TIP;
    ctx.beginPath();
    ctx.moveTo(bx0, by0); ctx.lineTo(tx, ty); ctx.lineTo(bx1, by1);
    ctx.closePath();
    ctx.fillStyle = p.metalD; ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = S*0.018; ctx.stroke();
    // Just the point catches the light - enough to carry at arm's length,
    // not enough to repaint the ship.
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - HALF*0.42)*TIP*0.74, Math.sin(a - HALF*0.42)*TIP*0.74);
    ctx.lineTo(tx, ty);
    ctx.lineTo(Math.cos(a + HALF*0.42)*TIP*0.74, Math.sin(a + HALF*0.42)*TIP*0.74);
    ctx.closePath();
    ctx.fillStyle = p.trim; ctx.fill();
  }
}

/*
 * THE LIGHT PASS - what turns a coloured drawing into a lit object, applied
 * to the finished bake as three composites on the sprite's own alpha:
 *
 *  1. A warm rim along every top-left edge: the sprite minus itself shifted
 *     toward the light leaves a crescent exactly one shift wide on the lit
 *     side of the silhouette, tinted near-white and added.
 *  2. A cool falloff along every bottom-right edge, same trick mirrored,
 *     laid over as deep navy - the shadow side turns cold, never black.
 *  3. One soft sheen across the whole hull from the key light's corner, so
 *     nineteen separately-drawn parts sit under ONE sun.
 *
 * Bake-time only: the game still blits one cached canvas per enemy. This is
 * also what shipart runs over the player's hull - one sun for everyone.
 */
function lightBake(cv, k){
  const w = cv.width, h = cv.height;
  const c = cv.getContext("2d");
  if(!c || !w) return;
  const K = k == null ? 1 : k;
  const d = Math.max(1.25, w*0.016);
  /*
   * HEADROOM. A fixed additive rim is the wrong model: the same alpha that
   * shapes a deep indigo Thief has nowhere to go on a near-white Swooper and
   * simply turns its edge to paper. Measured, that was the whole of what was
   * left of the "too bright" report - the roster's near-white area (luminance
   * 250+) sat at 1.79% of the average hull against 0.30% before the pass, and
   * every ship over it was a pastel.
   *
   * So ask the sprite how much room it has. Sampling a quarter of the opaque
   * pixels is plenty for a mean, and this is bake-time on a cached canvas.
   * Dark hulls keep the full rim; bright ones get as little as 45% of it,
   * which is the difference between a lit edge and a blown one.
   */
  let litK = 1;
  try {
    const px = c.getImageData(0, 0, w, h).data;
    let s = 0, n = 0;
    for(let i = 0; i < px.length; i += 16){
      if(px[i+3] < 200) continue;
      s += 0.2126*px[i] + 0.7152*px[i+1] + 0.0722*px[i+2]; n++;
    }
    // n===0 is the jsdom stub's zero buffer, not a real reading - leave it be.
    if(n > 20) litK = Math.max(0.45, Math.min(1, 1 - (s/n - 120)/170));
  } catch(e){ /* tainted or stubbed context: full rim, as before */ }
  const crescent = (dx, dy, tint) => {
    const t = document.createElement("canvas");
    t.width = w; t.height = h;
    const tc = t.getContext("2d");
    if(!tc) return null;
    tc.drawImage(cv, 0, 0);
    tc.globalCompositeOperation = "destination-out";
    tc.drawImage(cv, dx, dy);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = tint;
    tc.fillRect(0, 0, w, h);
    return t;
  };
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  /*
   * At 0.40 of a near-white cream, every single sprite in the roster came out
   * peaking at exactly 255 - a clipped highlight, which reads as washed
   * rather than lit. Two changes, both about ceiling: 0.28 instead of 0.40,
   * and a rim colour that is properly cream rather than nearly white, so its
   * own luminance caps how far it can push a pixel. Warmer reads as sunlight
   * where the old one read as flash.
   */
  const lit = crescent(d, d, "rgba(255,236,205,1)");
  if(lit){
    c.globalCompositeOperation = "lighter";
    c.globalAlpha = 0.28*K*litK;
    c.drawImage(lit, 0, 0);
  }
  /*
   * The cool side takes up the slack. Contrast is what sells the light, and
   * it can come from either end - taking it from the shadow costs nothing,
   * where taking it from the highlight costs the highlight.
   */
  const dark = crescent(-d*0.9, -d*0.9, "rgb(12,17,36)");
  if(dark){
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 0.70*K;
    c.drawImage(dark, 0, 0);
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-atop";
  const sheen = c.createRadialGradient(w*0.30, h*0.26, 0, w*0.30, h*0.26, w*0.95);
  // Same trade across the whole-sprite sheen: barely any lift at the sun's
  // corner, a real falloff away from it.
  sheen.addColorStop(0, "rgba(255,252,240," + (0.04*K).toFixed(3) + ")");
  sheen.addColorStop(0.45, "rgba(255,252,240,0)");
  sheen.addColorStop(0.8, "rgba(10,16,34," + (0.23*K).toFixed(3) + ")");
  c.fillStyle = sheen;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/*
 * SURFACE GREEBLES - two or three small service details per archetype, on a
 * deterministic side per type so the fleet stops being perfectly symmetric
 * badges. source-atop, so they sit ON the hull and never break a silhouette
 * the player has already learned.
 */
function greebles(ctx, S, typeId, p){
  let hsh = 0;
  for(let i = 0; i < typeId.length; i++) hsh = (hsh*31 + typeId.charCodeAt(i)) >>> 0;
  /*
   * QUIET, AND OFF THE FURNITURE. The first cut put a chunky panel and a
   * vent row anywhere on the hull, and on ships whose middle is a symbol
   * (the Mender's cross, the Carrier's windows) they read as scratches
   * across the emblem, not service detail. So: one shoulder only, well off
   * the centreline, at whisper alpha - shading, not marks - and everything
   * scales with the hull.
   */
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const side = (hsh & 1) ? 1 : -1;
  const gx = side * S*(0.17 + ((hsh>>3) % 4)*0.012);
  const gy = S*(0.04 + ((hsh>>6) % 4)*0.024);
  ctx.fillStyle = "rgba(10,14,26,0.18)";
  ctx.fillRect(gx - S*0.036, gy, S*0.072, S*0.042);
  ctx.fillStyle = "rgba(255,248,230,0.09)";
  ctx.fillRect(gx - S*0.036, gy + S*0.042, S*0.072, S*0.008);
  ctx.fillStyle = "rgba(10,14,26,0.20)";
  for(let i = 0; i < 2; i++)
    ctx.fillRect(gx - S*0.028, gy - S*0.024 - i*S*0.020, S*0.056, S*0.008);
  ctx.restore();
}

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
  try {
    // Shell first, hull on top: the blades fringe the silhouette while the
    // archetype underneath stays exactly as readable as its ordinary twin.
    if(elite) eliteCarapace(ctx, RES, p);
    shape(ctx, RES, p);
    // Service details, then the sun: greebles are hull surface, so they get
    // lit like the rest of it.
    greebles(ctx, RES, typeId, p);
    lightBake(cv, elite ? 0.85 : 1);   // the carapace glow carries an elite
  } catch(e){ return null; }
  cache[key] = cv;
  return cv;
}

/** True if this archetype has drawn art (everything except rocks and mines). */
function has(typeId){ return !!SHAPES[typeId]; }

SF.enemyArt = { spriteFor, has, SHAPES, paletteFor, lightBake };
})();
