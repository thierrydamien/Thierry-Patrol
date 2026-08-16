/*
 * Ship art. One procedural pass that draws a pilot's ship *as it currently is*
 * - a drawn hull plus a bolted-on part for every upgrade tier they own.
 *
 * This exists so progress is physical instead of numeric: buying Rapid Fire 3
 * grows two more cannon barrels you can point at. It is deliberately free of
 * gameplay state (it takes a plain levels object), because the same function
 * draws the hangar, the comms portraits and the story panels.
 *
 * The hull is DRAWN, in enemyart's exact language: one tint in, a derived
 * lit/base/shade/deep palette out, key light fixed at the top-left, a cool
 * counter-light off the sky, a rim light so the silhouette holds over empty
 * space, glass that stays glass whatever the paint colour. The photobashed
 * sprite this replaced was the one ship on screen that didn't come out of
 * that factory - and its port wing wore a mirror-flipped "PATROL" decal.
 *
 * Coordinate space: hull box of size S centred on the origin, nose at -S/2.
 */
(function(){
"use strict";
const SF = window.SF;
const { TAU } = SF.core;

/* ---------------------------------------------------------
   PALETTE - the same maths as enemyart's paletteFor, kept
   local so the player and the fleet can never drift apart by
   way of an import. One tint in, one small set of shades out.
   --------------------------------------------------------- */
const LINE    = "rgba(10,12,20,0.85)";
const METAL   = "#8c96a8";
const METAL_L = "#aeb8ca";
const METAL_D = "#4a5262";
const GLASS   = "#bde9ff";
const GLASS_RGB = "150,225,255";     // the fleet's cockpit ice - also the
                                     // ONE cool accent energy parts share
const GOLD    = "#ffd23f";           // the ONE warm accent gun parts share

function hexToRgb(hex){
  const v = parseInt(String(hex).replace("#",""), 16);
  return { r:(v>>16)&255, g:(v>>8)&255, b:v&255 };
}
function mix(c, target, k){
  return "rgb(" + Math.round(c.r + (target - c.r)*k) + "," +
                  Math.round(c.g + (target - c.g)*k) + "," +
                  Math.round(c.b + (target - c.b)*k) + ")";
}
const palettes = {};
function paletteFor(tint){
  let p = palettes[tint];
  if(p) return p;
  const c = hexToRgb(tint || "#f5a623");
  p = palettes[tint] = {
    lit:   mix(c, 255, 0.42),
    base:  mix(c, 255, 0.06),
    // Dark side stays a colour, never a hole - space IS the background here.
    shade: mix(c, 0,   0.34),
    deep:  mix(c, 0,   0.58),
    trim:  mix(c, 255, 0.72),
    glow:  tint || "#ff8a3d",
    rim:     "rgba(255,250,238,0.82)",
    rimCool: "rgba(126,188,255,0.34)",
  };
  return p;
}

/* Convenience: rounded rectangle without relying on ctx.roundRect (jsdom, old iPads). */
function rrect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}
function glow(ctx, color, blur){ ctx.shadowColor = color; ctx.shadowBlur = blur; }
function noGlow(ctx){ ctx.shadowBlur = 0; }
/** Fills the current path and outlines it at the fleet's line weight, so
 *  bolted-on hardware reads as solid metal and not a UI sticker. */
function fillEdge(ctx, S){
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(S*0.018, 1);   // never sub-pixel at flight size
  ctx.stroke();
}
/*
 * The two shared gradients every part draws with, made once per drawShip call
 * in hull-box coordinates: gunmetal for hardware, the pilot's derived palette
 * for painted panels. Light from the top-left, like the whole fleet.
 */
function metalGrad(ctx, S){
  const g = ctx.createLinearGradient(-S*0.4, -S*0.4, S*0.35, S*0.4);
  g.addColorStop(0, METAL_L); g.addColorStop(0.5, METAL); g.addColorStop(1, METAL_D);
  return g;
}
function paintGrad(ctx, S, p){
  const g = ctx.createLinearGradient(-S*0.4, -S*0.4, S*0.35, S*0.4);
  g.addColorStop(0, p.lit); g.addColorStop(0.45, p.base); g.addColorStop(1, p.shade);
  return g;
}
/*
 * Exhausts are diffuse blooms, never triangles - DESIGN 8i's rule, learned
 * when the whole fleet grew horns. A squashed radial gradient: hot core,
 * edges that genuinely reach zero.
 */
function plume(ctx, x, y, len, wide, r0, g0, b0){
  ctx.save();
  ctx.translate(x, y + len*0.30);
  ctx.scale(wide, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
  g.addColorStop(0, "rgba(255,244,214,0.88)");
  g.addColorStop(0.4, "rgba(" + r0 + "," + g0 + "," + b0 + ",0.42)");
  g.addColorStop(1, "rgba(" + r0 + "," + g0 + "," + b0 + ",0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, len, 0, TAU); ctx.fill();
  ctx.restore();
}

/* ---------------------------------------------------------
   THE PARTS LADDER
   Declaration order is the order they're offered as "what's
   next", so it doubles as a suggested build path: cheap
   visible wins first, showpieces last.

   Palette discipline: parts are gunmetal (o.metalG) plus the
   hull's own paint (o.paintG), with ONE warm accent shared by
   the gun family (GOLD) and ONE cool accent shared by the
   energy family (the fleet's cockpit ice). A maxed ship used
   to wear six unrelated candy hues; now it wears a kit.
   --------------------------------------------------------- */
const PARTS = [
  { id:"twinBarrel", up:"rapid", at:1, layer:"front",
    name:"Twin Barrels", blurb:"A second cannon on each side",
    draw(ctx,S,o){
      ctx.fillStyle = o.metalG;
      [-1,1].forEach(s => { rrect(ctx, s*S*0.10 - S*0.030, -S*0.54, S*0.060, S*0.26, S*0.02); fillEdge(ctx, S); });
      ctx.fillStyle = o.ghost ? o.color : GOLD;
      if(!o.ghost) glow(ctx, GOLD, S*0.06);
      [-1,1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.10, -S*0.53, S*0.024, 0, TAU); ctx.fill(); });
      noGlow(ctx);
    } },

  { id:"ionNozzles", up:"thrusters", at:1, layer:"behind",
    name:"Ion Nozzles", blurb:"A hotter, longer exhaust plume",
    draw(ctx,S,o){
      const flick = 0.82 + Math.sin(o.t*17)*0.18;
      plume(ctx, 0, S*0.40, S*0.44*flick, 0.42, 100, 150, 255);
    } },

  { id:"wingGuns", up:"spread", at:1, layer:"front",
    name:"Wing Guns", blurb:"A gun pod bolted to each wing",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.metalG;
        rrect(ctx, s*S*0.36 - S*0.045, -S*0.06, S*0.090, S*0.30, S*0.03); fillEdge(ctx, S);
        ctx.fillStyle = o.paintG;
        rrect(ctx, s*S*0.36 - S*0.018, -S*0.16, S*0.036, S*0.13, S*0.014); fillEdge(ctx, S);
      });
    } },

  { id:"shieldRing", up:"shield", at:1, layer:"behind",
    name:"Shield Generator", blurb:"A live containment ring around the hull",
    /*
     * Was a dashed stroked circle, which read as a debug gizmo riding every
     * render of an upgraded ship. Now it's what a live field would be: a soft
     * ring of light with the three emitter pods that project it.
     */
    draw(ctx,S,o){
      ctx.save();
      ctx.rotate(o.t*0.7);
      if(o.ghost){
        ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(S*0.018, 1);
        ctx.beginPath(); ctx.arc(0, 0, S*0.60, 0, TAU); ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(0, 0, S*0.50, 0, 0, S*0.70);
        g.addColorStop(0, "rgba(" + GLASS_RGB + ",0)");
        g.addColorStop(0.5, "rgba(" + GLASS_RGB + ",0.26)");
        g.addColorStop(1, "rgba(" + GLASS_RGB + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, S*0.70, 0, TAU); ctx.fill();
      }
      for(let n=0;n<3;n++){
        const a = n/3*TAU;
        const x = Math.cos(a)*S*0.60, y = Math.sin(a)*S*0.60;
        ctx.fillStyle = o.ghost ? o.color : METAL;
        ctx.beginPath(); ctx.arc(x, y, S*0.030, 0, TAU); fillEdge(ctx, S);
        if(!o.ghost){
          ctx.fillStyle = GLASS;
          ctx.beginPath(); ctx.arc(x, y, S*0.014, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    } },

  { id:"hullPlates", up:"armor", at:1, layer:"front",
    name:"Hull Plates", blurb:"Angled armour down both flanks",
    draw(ctx,S,o){
      ctx.fillStyle = o.ghost ? o.color : o.metalG;
      [-1,1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s*S*0.22, -S*0.18);
        ctx.lineTo(s*S*0.31, -S*0.02);
        ctx.lineTo(s*S*0.28, S*0.20);
        ctx.lineTo(s*S*0.21, S*0.15);
        ctx.closePath(); fillEdge(ctx, S);
      });
    } },

  { id:"bombPods", up:"bomb", at:1, layer:"front",
    name:"Bomb Pods", blurb:"Underslung pods, one per bomb",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.metalG;
        rrect(ctx, s*S*0.26 - S*0.052, S*0.10, S*0.104, S*0.17, S*0.05); fillEdge(ctx, S);
        ctx.fillStyle = o.ghost ? o.color : GOLD;
        ctx.beginPath(); ctx.arc(s*S*0.26, S*0.185, S*0.024, 0, TAU); ctx.fill();
      });
    } },

  { id:"tractorDish", up:"magnet", at:1, layer:"front",
    name:"Tractor Dish", blurb:"A pulsing collector under the nose",
    draw(ctx,S,o){
      ctx.fillStyle = o.ghost ? o.color : o.metalG;
      ctx.beginPath(); ctx.arc(0, -S*0.16, S*0.08, 0, Math.PI); ctx.closePath(); fillEdge(ctx, S);
      ctx.strokeStyle = o.ghost ? o.color : "rgba(" + GLASS_RGB + ",0.8)";
      ctx.lineWidth = Math.max(S*0.016, 1);
      ctx.beginPath(); ctx.arc(0, -S*0.16, S*0.11, Math.PI*0.15, Math.PI*0.85); ctx.stroke();
      const pulse = (o.t*1.4) % 1;
      ctx.globalAlpha = (1 - pulse) * (o.ghost ? 0.5 : 0.8);
      ctx.beginPath(); ctx.arc(0, -S*0.16, S*0.11 + pulse*S*0.16, Math.PI*0.15, Math.PI*0.85); ctx.stroke();
      ctx.globalAlpha = o.ghost ? o.alpha : 1;
    } },

  { id:"seekerDome", up:"homing", at:1, layer:"front",
    name:"Seeker Dome", blurb:"The sensor that finds targets for you",
    draw(ctx,S,o){
      ctx.fillStyle = o.ghost ? o.color : o.metalG;
      ctx.beginPath(); ctx.arc(0, -S*0.02, S*0.075, Math.PI, TAU); ctx.closePath(); fillEdge(ctx, S);
      const on = Math.sin(o.t*6) > 0;
      ctx.fillStyle = on ? GLASS : "rgba(" + GLASS_RGB + ",0.25)";
      if(on && !o.ghost) glow(ctx, GLASS, S*0.08);
      ctx.beginPath(); ctx.arc(0, -S*0.05, S*0.026, 0, TAU); ctx.fill();
      noGlow(ctx);
    } },

  { id:"lance", up:"pierce", at:1, layer:"front",
    name:"Piercing Lance", blurb:"The spike that runs shots clean through",
    draw(ctx,S,o){
      ctx.fillStyle = o.ghost ? o.color : o.metalG;
      ctx.beginPath();
      ctx.moveTo(0, -S*0.78); ctx.lineTo(S*0.035, -S*0.44);
      ctx.lineTo(-S*0.035, -S*0.44); ctx.closePath(); fillEdge(ctx, S);
      if(!o.ghost){
        ctx.fillStyle = GOLD; glow(ctx, GOLD, S*0.05);
        ctx.beginPath(); ctx.arc(0, -S*0.76, S*0.016, 0, TAU); ctx.fill();
        noGlow(ctx);
      }
    } },

  { id:"plasmaCoils", up:"damage", at:2, layer:"front",
    name:"Plasma Coils", blurb:"Charge coils that light up as they cycle",
    draw(ctx,S,o){
      const pulse = 0.55 + Math.sin(o.t*5)*0.45;
      ctx.strokeStyle = o.ghost ? o.color : "rgba(255,210,63," + (0.45 + pulse*0.55) + ")";
      ctx.lineWidth = Math.max(S*0.026, 1);
      if(!o.ghost) glow(ctx, GOLD, S*0.10*pulse);
      [-1,1].forEach(s => {
        ctx.beginPath();
        ctx.arc(s*S*0.20, S*0.02, S*0.13, -Math.PI*0.35, Math.PI*0.35, s < 0);
        ctx.stroke();
      });
      noGlow(ctx);
    } },

  { id:"droneCradle", up:"wingman", at:1, layer:"behind",
    name:"Drone Cradle", blurb:"Where your wingman docks",
    draw(ctx,S,o){
      const bob = Math.sin(o.t*2.2)*S*0.02;
      [-1,1].forEach(s => {
        ctx.fillStyle = o.mateColor || o.color;
        ctx.globalAlpha = (o.ghost ? o.alpha : 0.92);
        ctx.beginPath();
        ctx.moveTo(s*S*0.62, S*0.10 + bob*s);
        ctx.lineTo(s*S*0.70, S*0.24 + bob*s);
        ctx.lineTo(s*S*0.54, S*0.24 + bob*s);
        ctx.closePath(); fillEdge(ctx, S);
        ctx.globalAlpha = o.ghost ? o.alpha : 1;
      });
    } },

  { id:"quadBarrel", up:"rapid", at:3, layer:"front",
    name:"Quad Barrels", blurb:"Four barrels cycling instead of two",
    draw(ctx,S,o){
      ctx.fillStyle = o.metalG;
      [-1,1].forEach(s => { rrect(ctx, s*S*0.21 - S*0.026, -S*0.46, S*0.052, S*0.20, S*0.02); fillEdge(ctx, S); });
      ctx.fillStyle = o.ghost ? o.color : GOLD;
      [-1,1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.21, -S*0.45, S*0.020, 0, TAU); ctx.fill(); });
    } },

  { id:"outerPylons", up:"spread", at:3, layer:"front",
    name:"Outer Pylons", blurb:"Guns pushed out past the wingtips",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.metalG;
        ctx.save();
        ctx.translate(s*S*0.45, S*0.03); ctx.rotate(s*-0.32);
        rrect(ctx, -S*0.10, -S*0.020, S*0.20, S*0.040, S*0.015); fillEdge(ctx, S);
        ctx.restore();
        ctx.fillStyle = o.paintG;
        rrect(ctx, s*S*0.54 - S*0.030, -S*0.14, S*0.060, S*0.20, S*0.02); fillEdge(ctx, S);
        ctx.fillStyle = o.ghost ? o.color : GOLD;
        ctx.beginPath(); ctx.arc(s*S*0.54, -S*0.16, S*0.018, 0, TAU); ctx.fill();
      });
    } },

  { id:"heavyPlating", up:"armor", at:3, layer:"front",
    name:"Heavy Plating", blurb:"Riveted slabs over the flanks",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.ghost ? o.color : o.metalG;
        ctx.beginPath();
        ctx.moveTo(s*S*0.20, -S*0.30);
        ctx.lineTo(s*S*0.37, -S*0.06);
        ctx.lineTo(s*S*0.34, S*0.26);
        ctx.lineTo(s*S*0.22, S*0.20);
        ctx.closePath(); fillEdge(ctx, S);
        ctx.fillStyle = "rgba(14,18,30,0.55)";
        for(let r=0;r<3;r++){
          ctx.beginPath(); ctx.arc(s*S*0.29, -S*0.10 + r*S*0.11, S*0.013, 0, TAU); ctx.fill();
        }
      });
    } },

  { id:"salvageClaws", up:"fortune", at:3, layer:"front",
    name:"Salvage Claws", blurb:"Grabbers that scrape more out of every kill",
    draw(ctx,S,o){
      ctx.strokeStyle = o.ghost ? o.color : GOLD;
      ctx.lineWidth = Math.max(S*0.026, 1); ctx.lineCap = "round";
      [-1,1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s*S*0.10, S*0.24);
        ctx.quadraticCurveTo(s*S*0.30, S*0.34, s*S*0.22, S*0.46);
        ctx.stroke();
      });
      ctx.lineCap = "butt";
    } },

  { id:"afterburners", up:"thrusters", at:4, layer:"behind",
    name:"Afterburners", blurb:"Two outboard burners, wide open",
    draw(ctx,S,o){
      const flick = 0.8 + Math.sin(o.t*23 + 1)*0.2;
      [-1,1].forEach(s => plume(ctx, s*S*0.28, S*0.32, S*0.38*flick, 0.40, 255, 140, 60));
    } },

  { id:"aegisHalo", up:"shield", at:4, layer:"behind",
    name:"Aegis Halo", blurb:"A second ring with orbiting nodes",
    draw(ctx,S,o){
      ctx.save();
      ctx.rotate(-o.t*0.9);
      if(o.ghost){
        ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(S*0.014, 1);
        ctx.beginPath(); ctx.arc(0, 0, S*0.74, 0, TAU); ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(0, 0, S*0.66, 0, 0, S*0.82);
        g.addColorStop(0, "rgba(" + GLASS_RGB + ",0)");
        g.addColorStop(0.5, "rgba(" + GLASS_RGB + ",0.20)");
        g.addColorStop(1, "rgba(" + GLASS_RGB + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, S*0.82, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = o.ghost ? o.color : GLASS;
      for(let n=0;n<4;n++){
        const a = n/4*TAU;
        ctx.beginPath(); ctx.arc(Math.cos(a)*S*0.74, Math.sin(a)*S*0.74, S*0.030, 0, TAU); fillEdge(ctx, S);
      }
      ctx.restore();
    } },

  { id:"overdriveVents", up:"overdrive", at:1, layer:"front",
    name:"Overdrive Vents", blurb:"Heat vents that flare when you burn it",
    draw(ctx,S,o){
      const pulse = 0.5 + Math.sin(o.t*8)*0.5;
      [-1,1].forEach(s => {
        for(let v=0;v<3;v++){
          const y = S*0.06 + v*S*0.075;
          ctx.fillStyle = o.ghost ? o.color : "rgba(16,20,32,0.85)";
          rrect(ctx, s*S*0.11 - S*0.018, y, S*0.036, S*0.05, S*0.012); ctx.fill();
          if(!o.ghost){
            ctx.fillStyle = "rgba(255,210,63," + (0.40 + pulse*0.55) + ")";
            rrect(ctx, s*S*0.11 - S*0.011, y + S*0.008, S*0.022, S*0.034, S*0.008); ctx.fill();
          }
        }
      });
    } },

  { id:"gatling", up:"rapid", at:5, layer:"front",
    name:"Gatling Drum", blurb:"A spinning drum where the nose gun was",
    draw(ctx,S,o){
      ctx.save();
      ctx.translate(0, -S*0.40);
      ctx.rotate(o.t*7);
      // Flat gunmetal, not the shared gradient: this frame spins, and a
      // gradient would swirl the lighting round with it.
      ctx.fillStyle = o.ghost ? o.color : METAL;
      ctx.beginPath(); ctx.arc(0, 0, S*0.11, 0, TAU); fillEdge(ctx, S);
      ctx.fillStyle = o.ghost ? o.color : "#2b3242";
      for(let n=0;n<6;n++){
        const a = n/6*TAU;
        ctx.beginPath(); ctx.arc(Math.cos(a)*S*0.065, Math.sin(a)*S*0.065, S*0.022, 0, TAU); ctx.fill();
      }
      ctx.restore();
    } },

  { id:"plasmaCore", up:"damage", at:5, layer:"front",
    name:"Plasma Core", blurb:"The reactor that makes every shot bite",
    draw(ctx,S,o){
      const pulse = 0.6 + Math.sin(o.t*4)*0.4;
      if(!o.ghost) glow(ctx, GOLD, S*0.14*pulse);
      ctx.fillStyle = o.ghost ? o.color : "rgba(255,224,130," + (0.55 + pulse*0.35) + ")";
      ctx.beginPath(); ctx.arc(0, S*0.10, S*0.036 + pulse*S*0.008, 0, TAU); ctx.fill();
      if(!o.ghost){
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(0, S*0.10, S*0.015, 0, TAU); ctx.fill();
      }
      noGlow(ctx);
    } },

  { id:"broadside", up:"spread", at:5, layer:"front",
    name:"Full Broadside", blurb:"Every hardpoint on the wing, loaded",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.paintG;
        [0.44, 0.62].forEach(x => { rrect(ctx, s*S*x - S*0.024, -S*0.22, S*0.048, S*0.16, S*0.018); fillEdge(ctx, S); });
        ctx.fillStyle = o.ghost ? o.color : GOLD;
        ctx.beginPath(); ctx.arc(s*S*0.62, -S*0.24, S*0.018, 0, TAU); ctx.fill();
      });
    } },
];
const PART_BY_ID = {};
PARTS.forEach(p => PART_BY_ID[p.id] = p);

/* ---------------------------------------------------------
   WHAT A PILOT HAS BOLTED ON
   --------------------------------------------------------- */

/** { upgradeId: level } for a profile - the only input the art needs. */
function levelsOf(profile){
  const out = {};
  SF.config.UPGRADES.forEach(u => { out[u.id] = SF.profile.upgradeLevel(profile, u.id); });
  return out;
}
function owns(levels, part){ return (levels[part.up] || 0) >= part.at; }
/** Every part with an `owned` flag, in ladder order. */
function partList(levels){ return PARTS.map(p => ({ part:p, owned: owns(levels, p) })); }
/** The next part they haven't earned - the grey silhouette in the hangar. */
function nextPart(levels){ return PARTS.find(p => !owns(levels, p)) || null; }
function ownedCount(levels){ return PARTS.reduce((n,p) => n + (owns(levels,p) ? 1 : 0), 0); }

/* ---------------------------------------------------------
   DRAWING
   opts: { color, levels, t, size, ghost, mateColor, idle }
   --------------------------------------------------------- */
/*
 * Tune accents: each flight tune reshapes the ship a little, in the same
 * visual language as the bolt-on parts - so "which tune am I flying?" is
 * answered by looking at the ship, in the hangar and in combat alike.
 */
const TUNE_ART = {
  falcon: {
    behind(ctx, S, o){       // hot twin plumes at the wing roots
      const flick = 0.8 + Math.sin(o.t*19)*0.2;
      [-1, 1].forEach(s => plume(ctx, s*S*0.16, S*0.30, S*0.42*flick, 0.34, 255, 120, 50));
    },
    front(ctx, S, o){        // swept-back fins + a racing stripe
      ctx.fillStyle = o.paintG;
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s*S*0.30, S*0.02); ctx.lineTo(s*S*0.52, S*0.32); ctx.lineTo(s*S*0.28, S*0.20);
        ctx.closePath(); fillEdge(ctx, S);
      });
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-S*0.013, -S*0.40, S*0.026, S*0.56);
    },
  },
  titan: {
    front(ctx, S, o){        // riveted flank slabs + a nose plate
      ctx.fillStyle = o.metalG;
      [-1, 1].forEach(s => { rrect(ctx, s*S*0.30 - S*0.05, -S*0.14, S*0.10, S*0.40, S*0.03); fillEdge(ctx, S); });
      rrect(ctx, -S*0.10, -S*0.52, S*0.20, S*0.12, S*0.03); fillEdge(ctx, S);
      ctx.fillStyle = "rgba(16,20,32,0.7)";
      [-1, 1].forEach(s => [0, 1, 2].forEach(k => {
        ctx.beginPath(); ctx.arc(s*S*0.30, -S*0.06 + k*S*0.12, S*0.014, 0, TAU); ctx.fill();
      }));
    },
  },
  viper: {
    front(ctx, S, o){        // twin overclocked rails, tips burning
      ctx.fillStyle = o.metalG;
      [-1, 1].forEach(s => { rrect(ctx, s*S*0.05 - S*0.02, -S*0.66, S*0.04, S*0.30, S*0.015); fillEdge(ctx, S); });
      ctx.fillStyle = GOLD; glow(ctx, GOLD, S*0.08);
      [-1, 1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.05, -S*0.66, S*0.024, 0, TAU); ctx.fill(); });
      noGlow(ctx);
    },
  },
  scavenger: {
    front(ctx, S, o){        // the golden collector scoop, sparks orbiting in
      ctx.strokeStyle = GOLD; glow(ctx, GOLD, S*0.07);
      ctx.lineWidth = Math.max(S*0.035, 1); ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(0, S*0.12, S*0.34, Math.PI*0.15, Math.PI*0.85); ctx.stroke();
      ctx.fillStyle = "#ffe9a8";
      [0, 1, 2].forEach(k => {
        const a = Math.PI*0.5 + Math.sin(o.t*2 + k*2.1)*Math.PI*0.3;
        ctx.beginPath(); ctx.arc(Math.cos(a)*S*0.34, S*0.12 + Math.sin(a)*S*0.34, S*0.02, 0, TAU); ctx.fill();
      });
      noGlow(ctx);
      ctx.lineCap = "butt";
    },
  },
  ghost: {
    front(ctx, S, o){        // phase shimmer: a breathing outline off the hull
      const a = 0.28 + Math.sin(o.t*3)*0.16;
      ctx.strokeStyle = "rgba(160,180,255," + a.toFixed(2) + ")";
      glow(ctx, "#9aa5ff", S*0.09);
      ctx.lineWidth = Math.max(S*0.02, 1);
      ctx.beginPath(); ctx.ellipse(0, -S*0.04, S*0.42, S*0.52, 0, 0, TAU); ctx.stroke();
      noGlow(ctx);
    },
  },
  apex: {
    front(ctx, S, o){        // the Leviathan's gold: trim chevrons and edging
      ctx.strokeStyle = GOLD; glow(ctx, GOLD, S*0.06);
      ctx.lineWidth = Math.max(S*0.026, 1); ctx.lineCap = "round";
      [0, 1].forEach(k => {
        const y = -S*0.44 + k*S*0.10;
        ctx.beginPath();
        ctx.moveTo(-S*0.10, y + S*0.06); ctx.lineTo(0, y); ctx.lineTo(S*0.10, y + S*0.06);
        ctx.stroke();
      });
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s*S*0.14, -S*0.10); ctx.lineTo(s*S*0.44, S*0.22);
        ctx.stroke();
      });
      noGlow(ctx);
      ctx.lineCap = "butt";
    },
  },
};

/*
 * Style Shop LIVERIES.
 *
 * v1 was "nose art" - a little bolt, a small star, five teeth - and the
 * customer was right that it was pointless: at flight size the whole ship
 * is about fifty pixels, so a decal drawn at five percent of the hull is
 * three pixels of mush. Nobody could tell them apart, which makes it a
 * thing you pay for and cannot see.
 *
 * So they were scrapped for LIVERIES: paint that covers the whole hull.
 * Every one of these is a big, simple, high-contrast shape spanning most
 * of the ship, because the only thing that survives being fifty pixels
 * tall is a big simple shape. Drawn last, over every bought part, and
 * clipped to the hull silhouette so paint never floats off the metal.
 */
function hullClip(ctx, S, hullId){
  ctx.beginPath();
  hullOf(hullId).outline.forEach(([x, y], i) => {
    if(i === 0) ctx.moveTo(x*S, y*S); else ctx.lineTo(x*S, y*S);
  });
  ctx.closePath();
  ctx.clip();
}
const LIVERY_ART = {
  /*
   * Two fat racing stripes, nose to tail - each with a dark border, because
   * the stock hull already has light panels and a plain white stripe simply
   * disappeared into them at flight size. The border is what makes it read
   * on ANY paint colour.
   */
  stripes(ctx, S, hullId){
    ctx.save(); hullClip(ctx, S, hullId);
    // Moved OUT to leave a channel down the spine. They used to run
    // -0.145..0.145 with a 0.04 gap, which is narrower than the canopy - so
    // the one baked highlight on the hull, the thing that makes it read as a
    // cockpit rather than a blade, was painted over on every striped ship.
    [-S*0.235, S*0.110].forEach(x => {
      ctx.fillStyle = "#10131c";
      ctx.fillRect(x - S*0.022, -S*0.52, S*0.169, S*1.04);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, -S*0.52, S*0.125, S*1.04);
    });
    ctx.restore();
  },
  /** Flames licking up from the tail - orange over red over yellow.
   *  Widths reach the wingtips: the clip is the real hull now, so a narrow
   *  flame would stop visibly short of the edge it used to be eaten by. */
  flames(ctx, S, hullId){
    ctx.save(); hullClip(ctx, S, hullId);
    const tongue = (col, w, h, dy) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-w, S*0.46 + dy);
      for(let i = 0; i <= 6; i++){
        const t = i/6;
        const x = -w + t*w*2;
        const y = S*0.46 + dy - h*(1 - Math.abs(t - 0.5)*1.6) - (i % 2 ? h*0.18 : 0);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, S*0.46 + dy);
      ctx.closePath(); ctx.fill();
    };
    tongue("#c2410c", S*0.47, S*0.86, 0);
    tongue("#f97316", S*0.36, S*0.66, 0);
    tongue("#fbbf24", S*0.24, S*0.44, 0);
    ctx.restore();
  },
  /** One enormous lightning bolt across the entire hull. */
  bolt(ctx, S, hullId){
    ctx.save(); hullClip(ctx, S, hullId);
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = "rgba(90,50,0,0.75)";
    ctx.lineWidth = S*0.022;
    ctx.beginPath();
    ctx.moveTo( S*0.02, -S*0.50);
    ctx.lineTo(-S*0.26,  S*0.04);
    ctx.lineTo(-S*0.04,  S*0.04);
    ctx.lineTo(-S*0.14,  S*0.50);
    ctx.lineTo( S*0.26, -S*0.10);
    ctx.lineTo( S*0.03, -S*0.10);
    ctx.lineTo( S*0.22, -S*0.50);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  },
  /** A chequered flag band right across the middle - wingtip to wingtip. */
  checkers(ctx, S, hullId){
    ctx.save(); hullClip(ctx, S, hullId);
    const cell = S*0.115, y0 = -S*0.12;
    for(let r = 0; r < 4; r++){
      for(let c = 0; c < 8; c++){
        ctx.fillStyle = (r + c) % 2 ? "#ffffff" : "#12161f";
        ctx.fillRect(-S*0.46 + c*cell, y0 + r*cell, cell, cell);
      }
    }
    ctx.restore();
  },
};

function drawShip(ctx, cx, cy, size, opts){
  const color = opts.color || "#f5a623";
  const o = {
    color,
    pal: paletteFor(color),
    metal: METAL,
    metalG: null, paintG: null,        // filled in below, white in ghost mode
    mateColor: opts.mateColor,
    t: opts.t || 0,
    ghost: false, alpha: 1,
  };
  const levels = opts.levels || {};
  /*
   * A hull may draw bigger than the size it was handed. This is the Anvil's
   * loudest cue and the honest one: it carries a 14-pixel hitbox against the
   * Dart's 11, so a card that says "bigger target" should be showing a bigger
   * ship. Everything scales together - hull, parts, livery, exhaust - so no
   * bolted-on part goes anywhere near out of register.
   */
  const S = size * (hullOf(opts.hull).artScale || 1);
  const bob = opts.idle === false ? 0 : Math.sin(o.t*1.6)*size*0.018;

  ctx.save();
  ctx.translate(cx, cy + bob);
  o.metalG = metalGrad(ctx, S);
  o.paintG = paintGrad(ctx, S, o.pal);

  const behind = [], front = [];
  PARTS.forEach(p => { if(owns(levels, p)) (p.layer === "behind" ? behind : front).push(p); });

  // Base exhaust: every ship has one, it just gets replaced by better parts.
  // A diffuse bloom off the baked nozzle, never a bright triangle (DESIGN 8i).
  if(!owns(levels, PART_BY_ID.ionNozzles)){
    const flick = 0.8 + Math.sin(o.t*15)*0.2;
    plume(ctx, 0, S*0.36, S*0.26*flick, 0.5, 255, 140, 60);
  }

  const tuneArt = TUNE_ART[opts.tune];
  behind.forEach(p => { ctx.save(); p.draw(ctx, S, o); ctx.restore(); });
  if(tuneArt && tuneArt.behind){ ctx.save(); tuneArt.behind(ctx, S, o); ctx.restore(); }
  drawHull(ctx, S, o.color, opts.hull);
  front.forEach(p => { ctx.save(); p.draw(ctx, S, o); ctx.restore(); });
  if(tuneArt && tuneArt.front){ ctx.save(); tuneArt.front(ctx, S, o); ctx.restore(); }
  // The livery goes on over every bought part: paint you can't see under a
  // wing is paint that wasn't worth buying. A "px1:" value is not a shop
  // pattern but a drawing the pilot made - same layer, same clipping.
  if(opts.decal){
    if(SF.paintjob && SF.paintjob.isCustom(opts.decal)){
      SF.paintjob.paint(ctx, S, opts.decal, opts.hull);
    } else if(LIVERY_ART[opts.decal]){
      ctx.save(); LIVERY_ART[opts.decal](ctx, S, opts.hull); ctx.restore();
    }
  }

  // The grey silhouette of what's next: always something to want.
  if(opts.ghost){
    const gp = typeof opts.ghost === "string" ? PART_BY_ID[opts.ghost] : opts.ghost;
    if(gp){
      const pulse = 0.28 + Math.sin(o.t*2.6)*0.16;
      ctx.save();
      ctx.globalAlpha = pulse;
      gp.draw(ctx, S, Object.assign({}, o, { ghost:true, alpha:pulse,
        color:"#ffffff", metal:"#ffffff", metalG:"#ffffff", paintG:"#ffffff" }));
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ---------------------------------------------------------
   THE HULL
   A drawn interceptor in the fleet's language. One set of
   vertices, two readers: paintHull below and HULL_POLY (the
   livery clip + easel mask in paintjob.js) - so the paint can
   never again stop dead along an edge the eye can't see.
   --------------------------------------------------------- */

// Fuselage: nose at -0.50, a smooth polygon (round joins hide the facets).
const BODY = [
   0,    -0.500,
   0.050,-0.415,  0.088,-0.325,  0.114,-0.225,  0.128,-0.125,
   0.136,-0.015,  0.132, 0.095,  0.122, 0.205,  0.108, 0.305,  0.098, 0.360,
  -0.098, 0.360, -0.108, 0.305, -0.122, 0.205, -0.132, 0.095, -0.136,-0.015,
  -0.128,-0.125, -0.114,-0.225, -0.088,-0.325, -0.050,-0.415,
];
// Both wings as one polygon, so the rim light wraps the whole span.
const WING = [
   0,    -0.095,
   0.105,-0.040,  0.460, 0.185,  0.415, 0.290,  0.150, 0.235,
   0,     0.270,
  -0.150, 0.235, -0.415, 0.290, -0.460, 0.185, -0.105,-0.040,
];
// Canted tail fins, one each side.
const FIN = [0.052, 0.245,  0.150, 0.420,  0.052, 0.360];

/*
 * THE SECOND AIRFRAME, AND WHY IT IS SHAPED THE WAY IT IS.
 *
 * Twenty-one parts bolt onto this ship, and every one of them has offsets
 * hand-tuned to the silhouette above - Twin Barrels sit at 0.10, -0.54
 * because that is where THIS nose is. Drop those parts onto a differently
 * proportioned hull and the guns float off the front and the plating hangs
 * in air.
 *
 * So the two hulls share a SKELETON. The nose tip, the wing roots, the
 * wingtips and the tail sit at the same normalised coordinates on both, and
 * only the shape BETWEEN those anchors changes: the Anvil has a broad slab
 * fuselage where the Dart has a slim one, and a straight delta where the
 * Dart is swept. Every part lands correctly on both with nothing re-tuned,
 * and the two still read as different aircraft at a glance.
 *
 * The cost of that choice is honest: it constrains any future hull to the
 * same anchors. A genuinely different layout - a twin-boom, say - would need
 * the parts refactored onto named anchors first.
 */
const ANVIL_BODY = [
   0.090,-0.500, 0.132,-0.462,
   0.166,-0.390,  0.186,-0.300,  0.198,-0.200,  0.204,-0.100,
   0.206,-0.005,  0.202, 0.100,  0.194, 0.205,  0.166, 0.305,  0.124, 0.360,
  -0.124, 0.360, -0.166, 0.305, -0.194, 0.205, -0.202, 0.100, -0.206,-0.005,
  -0.204,-0.100, -0.198,-0.200, -0.186,-0.300, -0.166,-0.390,
  -0.132,-0.462, -0.090,-0.500,
];
/*
 * A STUBBY SLAB, NOT A SWEPT DART - and this is the whole difference.
 *
 * The first Anvil kept the Dart's wing exactly: same tips at 0.460/0.185, same
 * sweep. Measured, the two ships shared 76% of their pixels bare and 92%
 * FITTED OUT, which is how anybody actually sees their ship - the twenty-one
 * bolted-on parts are identical on both hulls and swamped what little the
 * fuselage was saying. The family looked at them and said they were the same
 * plane, and they were right.
 *
 * The wing is where a top-down aircraft is recognised, so this is a different
 * wing: it starts further forward, runs almost straight out instead of raking
 * back, and is CLIPPED SQUARE at the tip rather than drawn to a point. Deep
 * chord, blunt ends, no taper - a heavy-lifter's wing beside a dart's.
 *
 * The fuselage is only moderately wider than the Dart's, and that is a
 * correction: at 0.268 it was so broad it swallowed its own wing, and the ship
 * read as an egg with fins. The wing has to be the thing you see.
 *
 * The parts still land: nothing bolts on outboard of |x| 0.37, so the whole
 * span from there to the tip is ours to reshape.
 */
const ANVIL_WING = [
   0,    -0.175,
   0.175,-0.120,  0.430,-0.010,         // forward and nearly straight out
   0.430, 0.245,                         // squared-off tip: a straight edge
   0.230, 0.250,
   0,     0.300,
  -0.230, 0.250, -0.430, 0.245, -0.430,-0.010, -0.175,-0.120,
];
/* Two fins set out on the wing, where the Dart carries a small pair beside
   its tail. At flight size this is the cue that survives being covered in
   bought hardware. */
const ANVIL_FIN = [0.290, 0.230,  0.375, 0.415,  0.290, 0.330];
const ANVIL_POLY = [
  [0.090, -0.500], [0.132, -0.462],
  [0.186, -0.300], [0.204, -0.100],
  [0.430, -0.010], [0.430, 0.245], [0.375, 0.415], [0.290, 0.250],
  [0.230, 0.250], [0.194, 0.205], [0.166, 0.305], [0.124, 0.400],
  [-0.124, 0.400], [-0.166, 0.305], [-0.194, 0.205], [-0.230, 0.250],
  [-0.290, 0.250], [-0.375, 0.415], [-0.430, 0.245], [-0.430, -0.010],
  [-0.204, -0.100], [-0.186, -0.300],
  [-0.132, -0.462], [-0.090, -0.500],
];

/*
 * The outer silhouette - the union of BODY, WING and FIN above, traced once.
 * This is what liveries and the kid's own paint are clipped to, and what the
 * easel mask is built from (see paintjob.js). One polygon, two readers - they
 * can never drift apart, and now it IS the visible hull.
 */
const HULL_POLY = [
  [0, -0.50],
  [0.088, -0.325], [0.128, -0.125], [0.133, -0.022],   // body edge to wing root
  [0.460, 0.185], [0.415, 0.290], [0.120, 0.242],      // out the wing and back
  [0.108, 0.305], [0.150, 0.420], [0.060, 0.400],      // tail fin
  [-0.060, 0.400], [-0.150, 0.420], [-0.108, 0.305],
  [-0.120, 0.242], [-0.415, 0.290], [-0.460, 0.185],
  [-0.133, -0.022], [-0.128, -0.125], [-0.088, -0.325],
];

/*
 * HULLS. `id` is stored on the profile; everything else is art or stats.
 * The stat block is read by buildLoadout - the hull is the chassis, the tune
 * is the engine map, and they multiply.
 *
 * There is deliberately no damage stat here. Bullet damage is a small INTEGER
 * - it picks the shot's art tier as well as its bite - so a chassis multiplier
 * has nothing to round into at the bottom of the track: the Anvil's first
 * draft advertised "+15% damage" and delivered exactly nothing until the
 * cannon was three levels up. A card that lies for the first half of the game
 * is worse than a card with one less line, so the Anvil trades in the currency
 * it actually deals in - staying alive.
 */
const HULLS = [
  { id:"dart", name:"THE DART", cost:0,
    blurb:"The ship the family has always flown. Slim, quick, and a small thing to hit.",
    pros:["small target","quickest hull"], cons:[],
    body:BODY, wing:WING, fin:FIN, outline:HULL_POLY,
    r:11, lives:0, shield:0, speed:1.00, invuln:1.00, artScale:1.00 },
  { id:"anvil", name:"THE ANVIL", cost:30000,
    blurb:"Twice the shoulders and a plate for a nose. Slower, and a much easier thing to hit - but it takes a beating and gets straight back up.",
    pros:["+1 life","+1 shield","+30% recovery"], cons:["bigger target","-12% speed"],
    body:ANVIL_BODY, wing:ANVIL_WING, fin:ANVIL_FIN, outline:ANVIL_POLY,
    r:14, lives:1, shield:1, speed:0.88, invuln:1.30, artScale:1.16 },
];
const HULL_BY_ID = {};
HULLS.forEach(h => { HULL_BY_ID[h.id] = h; });
/** Whatever was asked for, or the one everybody already flies. */
function hullOf(id){ return HULL_BY_ID[id] || HULLS[0]; }

function poly(ctx, pts, S){
  ctx.beginPath();
  for(let i=0;i<pts.length;i+=2){
    if(i === 0) ctx.moveTo(pts[i]*S, pts[i+1]*S); else ctx.lineTo(pts[i]*S, pts[i+1]*S);
  }
  ctx.closePath();
}
/*
 * Rim light, enemyart's trick verbatim: clip to the shape, stroke the same
 * outline shifted away from the key light so only the lit edges survive the
 * clip, then a cool counter-stroke the other way. It is what stops the hull
 * dissolving into a dark sky, and it is all baked into the cached sprite.
 */
function rimLight(ctx, pts, p, S){
  const d = S*0.024;
  ctx.save();
  poly(ctx, pts, S); ctx.clip();
  ctx.translate(d, d);                          // key light: top-left
  poly(ctx, pts, S);
  ctx.strokeStyle = p.rim; ctx.lineWidth = S*0.044; ctx.stroke();
  ctx.restore();
  ctx.save();
  poly(ctx, pts, S); ctx.clip();
  ctx.translate(-d*0.85, -d*0.85);
  poly(ctx, pts, S);
  ctx.strokeStyle = p.rimCool; ctx.lineWidth = S*0.042; ctx.stroke();
  ctx.restore();
}
/** Fill with the top-left lit paint gradient, outline, catch the light. */
function hullPiece(ctx, pts, p, S, grad){
  poly(ctx, pts, S);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = S*0.026; ctx.stroke();
  rimLight(ctx, pts, p, S);
}
/*
 * A canopy that is lit rather than painted - enemyart's cockpit, wearing the
 * fleet's fixed cool glass. It never takes the paint colour: a green pilot
 * flies green panels, not green windows.
 */
function canopy(ctx, x, y, rx, ry){
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, ry/rx);
  const halo = ctx.createRadialGradient(0, 0, rx*0.4, 0, 0, rx*2.4);
  halo.addColorStop(0, "rgba(" + GLASS_RGB + ",0.5)");
  halo.addColorStop(0.5, "rgba(" + GLASS_RGB + ",0.16)");
  halo.addColorStop(1, "rgba(" + GLASS_RGB + ",0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, rx*2.4, 0, TAU); ctx.fill();
  ctx.fillStyle = GLASS;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = rx*0.14; ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.arc(-rx*0.28, -rx*0.3, rx*0.42, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.arc(0, 0, rx*0.34, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Everything static about the hull, painted at size S. Bake-time only. */
function paintHull(ctx, S, p, withText, hullId){
  const H = hullOf(hullId);
  const BODY = H.body, WING = H.wing, FIN = H.fin;
  const paint = paintGrad(ctx, S, p);
  const metal = metalGrad(ctx, S);

  // Wings - painted panels, so they take the pilot's colour.
  hullPiece(ctx, WING, p, S, paint);

  // Painted trim along the leading edges, and wingtip lights.
  ctx.strokeStyle = p.trim; ctx.lineWidth = S*0.012;
  [-1,1].forEach(s => {
    ctx.beginPath();
    ctx.moveTo(s*S*0.13, -S*0.017); ctx.lineTo(s*S*0.44, S*0.181); ctx.stroke();
  });
  [-1,1].forEach(s => {
    glow(ctx, p.glow, S*0.05);
    ctx.fillStyle = p.glow;
    ctx.beginPath(); ctx.arc(s*S*0.435, S*0.228, S*0.015, 0, TAU); ctx.fill();
    noGlow(ctx);
  });

  /*
   * The squadron name, as real drawn text on BOTH wings - which is the fix
   * for the sprite whose port wing wore it mirror-flipped for months. Each
   * wing gets its own rotation along its own sweep; neither is ever a
   * negative scale of the other. Skipped below ~90px where it's only smudge.
   */
  if(withText){
    ctx.save();
    poly(ctx, WING, S); ctx.clip();      // lettering never leaves the metal
    ctx.font = "700 " + Math.max(S*0.054, 5).toFixed(1) + "px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    [-1,1].forEach(s => {
      ctx.save();
      ctx.translate(s*S*0.285, S*0.158);
      ctx.rotate(s*0.566);               // along the wing's own sweep
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.fillText("PATROL", 0, S*0.008);
      ctx.fillStyle = "rgba(10,14,26,0.66)";
      ctx.fillText("PATROL", 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  // Tail fins - gunmetal, like all trim.
  [-1,1].forEach(s => {
    ctx.beginPath();
    ctx.moveTo(s*S*FIN[0], S*FIN[1]);
    ctx.lineTo(s*S*FIN[2], S*FIN[3]);
    ctx.lineTo(s*S*FIN[4], S*FIN[5]);
    ctx.closePath();
    ctx.fillStyle = metal; ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = S*0.020; ctx.stroke();
  });

  // Engine: a dark nozzle plus one genuinely bright pixel in its mouth (the
  // fleet's thruster rule). The moving flame is drawn live by drawShip.
  ctx.fillStyle = METAL_D;
  rrect(ctx, -S*0.075, S*0.345, S*0.15, S*0.055, S*0.02); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = S*0.018; ctx.stroke();
  ctx.fillStyle = "#10141f";
  rrect(ctx, -S*0.055, S*0.362, S*0.11, S*0.028, S*0.012); ctx.fill();
  const core = ctx.createRadialGradient(0, S*0.376, 0, 0, S*0.376, S*0.035);
  core.addColorStop(0, "rgba(255,255,255,0.85)");
  core.addColorStop(0.5, "rgba(255,214,150,0.35)");
  core.addColorStop(1, "rgba(255,170,90,0)");
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(0, S*0.376, S*0.035, 0, TAU); ctx.fill();

  // Fuselage over the wings - the other painted panel.
  hullPiece(ctx, BODY, p, S, paint);

  // Deep spine channel and panel seams: the greebles that make 300px rich
  // and vanish harmlessly at 40.
  ctx.fillStyle = p.deep;
  poly(ctx, [0,-0.020, 0.045,0.060, 0.038,0.300, -0.038,0.300, -0.045,0.060], S);
  ctx.fill();
  ctx.strokeStyle = p.deep; ctx.lineWidth = S*0.008;
  [[0.120, 0.080], [0.112, 0.220]].forEach(([w, y]) => {
    ctx.beginPath(); ctx.moveTo(-w*S, y*S); ctx.lineTo(w*S, y*S); ctx.stroke();
  });

  // Gunmetal flank nacelles riding the wing roots.
  [-1,1].forEach(s => {
    ctx.fillStyle = metal;
    rrect(ctx, s*S*0.145 - S*0.030, -S*0.02, S*0.060, S*0.24, S*0.03); ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = S*0.018; ctx.stroke();
    ctx.fillStyle = "#181d2c";
    rrect(ctx, s*S*0.145 - S*0.018, -S*0.005, S*0.036, S*0.045, S*0.015); ctx.fill();
  });

  // Gunmetal nose cap.
  ctx.fillStyle = metal;
  poly(ctx, [0,-0.50, 0.046,-0.385, -0.046,-0.385], S);
  ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = S*0.016; ctx.stroke();

  // Glass last, over everything: the one small bright thing on the hull.
  canopy(ctx, 0, -S*0.175, S*0.066, S*0.115);
}

/*
 * Rasterise once, blit forever - enemyart's cache, with one extra concern:
 * the hero ship is drawn at 40px in combat and 300px in the hangar, so one
 * fixed resolution would be blurry somewhere. Sprites bake per (colour,
 * resolution) at up to 2x devicePixelRatio, so an iPad's hangar hull is as
 * crisp as its enemies. The pad leaves room for rim light and canopy halo.
 */
const TEXT_MIN = 90;        // below this the wing lettering is only smudge
const HULL_PAD = 0.10;      // fraction of S kept clear around the box
const hullCache = new Map();
function hullSprite(color, S, hullId){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const res = Math.max(24, Math.min(Math.round(S*dpr), 1024));
  const withText = S >= TEXT_MIN ? 1 : 0;
  const key = color + "|" + res + "|" + withText + "|" + (hullId || "dart");
  let cv = hullCache.get(key);
  if(cv) return cv;
  cv = document.createElement("canvas");
  const pad = Math.ceil(res*HULL_PAD);
  cv.width = cv.height = res + pad*2;
  const c = cv.getContext("2d");
  if(!c) return null;
  cv._scale = (res + pad*2)/res;
  c.translate(cv.width/2, cv.height/2);
  c.lineJoin = "round";
  paintHull(c, res, paletteFor(color), withText, hullId);
  // The wacky modes mint odd sizes; a runaway key set must not hoard canvases.
  if(hullCache.size >= 40) hullCache.clear();
  hullCache.set(key, cv);
  return cv;
}

/** The hull itself - always drawn, no sprite, no Image, no load order. */
function drawHull(ctx, S, color, hullId){
  const cv = hullSprite(color, S, hullId);
  if(cv){
    const w = S*cv._scale;
    ctx.drawImage(cv, -w/2, -w/2, w, w);
    return;
  }
  // A context that can't mint offscreen canvases still gets the ship.
  ctx.save();
  ctx.lineJoin = "round";
  paintHull(ctx, S, paletteFor(color), S >= TEXT_MIN ? 1 : 0, hullId);
  ctx.restore();
}

SF.shipart = { PARTS, PART_BY_ID, levelsOf, partList, nextPart, ownedCount, drawShip,
               hullClip, HULL_POLY, HULLS, HULL_BY_ID, hullOf };
})();
