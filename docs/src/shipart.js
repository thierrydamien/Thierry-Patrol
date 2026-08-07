/*
 * Ship art. One procedural pass that draws a pilot's ship *as it currently is*
 * - hull sprite plus a bolted-on part for every upgrade tier they own.
 *
 * This exists so progress is physical instead of numeric: buying Rapid Fire 3
 * grows two more cannon barrels you can point at. It is deliberately free of
 * gameplay state (it takes a plain levels object), because the same function
 * draws the hangar, the comms portraits and the story panels.
 *
 * Coordinate space: hull box of size S centred on the origin, nose at -S/2.
 */
(function(){
"use strict";
const SF = window.SF;
const { TAU } = SF.core;

/* Convenience: rounded rectangle without relying on ctx.roundRect (jsdom, old iPads). */
function rrect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}
function glow(ctx, color, blur){ ctx.shadowColor = color; ctx.shadowBlur = blur; }
/** Fills the current path and outlines it, so bolted-on hardware reads as solid. */
function fillEdge(ctx, S){
  ctx.fill();
  ctx.strokeStyle = "rgba(16,20,32,0.55)";
  ctx.lineWidth = S*0.010;
  ctx.stroke();
}
function noGlow(ctx){ ctx.shadowBlur = 0; }

/* ---------------------------------------------------------
   THE PARTS LADDER
   Declaration order is the order they're offered as "what's
   next", so it doubles as a suggested build path: cheap
   visible wins first, showpieces last.
   --------------------------------------------------------- */
const PARTS = [
  { id:"twinBarrel", up:"rapid", at:1, layer:"front",
    name:"Twin Barrels", blurb:"A second cannon on each side",
    draw(ctx,S,o){
      ctx.fillStyle = o.metal;
      [-1,1].forEach(s => { rrect(ctx, s*S*0.10 - S*0.030, -S*0.54, S*0.060, S*0.26, S*0.02); fillEdge(ctx, S); });
      ctx.fillStyle = o.color; glow(ctx, o.color, S*0.08);
      [-1,1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.10, -S*0.53, S*0.026, 0, TAU); ctx.fill(); });
      noGlow(ctx);
    } },

  { id:"ionNozzles", up:"thrusters", at:1, layer:"behind",
    name:"Ion Nozzles", blurb:"A hotter, longer exhaust plume",
    draw(ctx,S,o){
      const flick = 0.82 + Math.sin(o.t*17)*0.18;
      const g = ctx.createLinearGradient(0, S*0.36, 0, S*0.36 + S*0.46*flick);
      g.addColorStop(0, "rgba(120,215,255,0.95)");
      g.addColorStop(0.45, "rgba(80,150,255,0.55)");
      g.addColorStop(1, "rgba(60,110,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-S*0.11, S*0.36); ctx.lineTo(S*0.11, S*0.36);
      ctx.lineTo(0, S*0.36 + S*0.46*flick); ctx.closePath(); ctx.fill();
    } },

  { id:"wingGuns", up:"spread", at:1, layer:"front",
    name:"Wing Guns", blurb:"A gun pod bolted to each wing",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.metal;
        rrect(ctx, s*S*0.36 - S*0.045, -S*0.06, S*0.090, S*0.30, S*0.03); fillEdge(ctx, S);
        ctx.fillStyle = o.color;
        rrect(ctx, s*S*0.36 - S*0.018, -S*0.16, S*0.036, S*0.13, S*0.014); ctx.fill();
      });
    } },

  { id:"shieldRing", up:"shield", at:1, layer:"behind",
    name:"Shield Generator", blurb:"A live containment ring around the hull",
    draw(ctx,S,o){
      ctx.save();
      ctx.rotate(o.t*0.7);
      ctx.strokeStyle = o.ghost ? o.color : "rgba(120,200,255,0.75)";
      ctx.lineWidth = S*0.022;
      ctx.setLineDash([S*0.16, S*0.10]);
      ctx.beginPath(); ctx.arc(0, 0, S*0.60, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } },

  { id:"hullPlates", up:"armor", at:1, layer:"front",
    name:"Hull Plates", blurb:"Angled armour down both flanks",
    draw(ctx,S,o){
      ctx.fillStyle = o.ghost ? o.color : "rgba(196,206,222,0.52)";
      ctx.strokeStyle = "rgba(20,26,40,0.55)";
      ctx.lineWidth = S*0.012;
      [-1,1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s*S*0.22, -S*0.18);
        ctx.lineTo(s*S*0.31, -S*0.02);
        ctx.lineTo(s*S*0.28, S*0.20);
        ctx.lineTo(s*S*0.21, S*0.15);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
    } },

  { id:"bombPods", up:"bomb", at:1, layer:"front",
    name:"Bomb Pods", blurb:"Underslung pods, one per bomb",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.metal;
        rrect(ctx, s*S*0.26 - S*0.052, S*0.10, S*0.104, S*0.17, S*0.05); fillEdge(ctx, S);
        ctx.fillStyle = "#ff8a3d";
        ctx.beginPath(); ctx.arc(s*S*0.26, S*0.185, S*0.026, 0, TAU); ctx.fill();
      });
    } },

  { id:"tractorDish", up:"magnet", at:1, layer:"front",
    name:"Tractor Dish", blurb:"A pulsing collector under the nose",
    draw(ctx,S,o){
      ctx.strokeStyle = o.ghost ? o.color : "#8fe9c0";
      ctx.lineWidth = S*0.020;
      ctx.beginPath(); ctx.arc(0, -S*0.16, S*0.11, Math.PI*0.15, Math.PI*0.85); ctx.stroke();
      const pulse = (o.t*1.4) % 1;
      ctx.globalAlpha = (1 - pulse) * (o.ghost ? 0.5 : 1);
      ctx.beginPath(); ctx.arc(0, -S*0.16, S*0.11 + pulse*S*0.16, Math.PI*0.15, Math.PI*0.85); ctx.stroke();
      ctx.globalAlpha = o.ghost ? o.alpha : 1;
    } },

  { id:"seekerDome", up:"homing", at:1, layer:"front",
    name:"Seeker Dome", blurb:"The sensor that finds targets for you",
    draw(ctx,S,o){
      ctx.fillStyle = o.metal;
      ctx.beginPath(); ctx.arc(0, -S*0.02, S*0.075, Math.PI, TAU); ctx.fill();
      const on = Math.sin(o.t*6) > 0;
      ctx.fillStyle = on ? "#22d3ee" : "rgba(34,211,238,0.25)";
      if(on && !o.ghost) glow(ctx, "#22d3ee", S*0.10);
      ctx.beginPath(); ctx.arc(0, -S*0.05, S*0.026, 0, TAU); ctx.fill();
      noGlow(ctx);
    } },

  { id:"lance", up:"pierce", at:1, layer:"front",
    name:"Piercing Lance", blurb:"The spike that runs shots clean through",
    draw(ctx,S,o){
      ctx.fillStyle = o.ghost ? o.color : "#dfe7f5";
      ctx.beginPath();
      ctx.moveTo(0, -S*0.78); ctx.lineTo(S*0.035, -S*0.44);
      ctx.lineTo(-S*0.035, -S*0.44); ctx.closePath(); ctx.fill();
    } },

  { id:"plasmaCoils", up:"damage", at:2, layer:"front",
    name:"Plasma Coils", blurb:"Charge coils that light up as they cycle",
    draw(ctx,S,o){
      const pulse = 0.55 + Math.sin(o.t*5)*0.45;
      ctx.strokeStyle = o.ghost ? o.color : "rgba(255,210,63," + (0.45 + pulse*0.55) + ")";
      ctx.lineWidth = S*0.026;
      if(!o.ghost) glow(ctx, "#ffd23f", S*0.10*pulse);
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
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = o.ghost ? o.alpha : 1;
      });
    } },

  { id:"quadBarrel", up:"rapid", at:3, layer:"front",
    name:"Quad Barrels", blurb:"Four barrels cycling instead of two",
    draw(ctx,S,o){
      ctx.fillStyle = o.metal;
      [-1,1].forEach(s => { rrect(ctx, s*S*0.21 - S*0.026, -S*0.46, S*0.052, S*0.20, S*0.02); fillEdge(ctx, S); });
    } },

  { id:"outerPylons", up:"spread", at:3, layer:"front",
    name:"Outer Pylons", blurb:"Guns pushed out past the wingtips",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.strokeStyle = o.metal; ctx.lineWidth = S*0.038;
        ctx.beginPath(); ctx.moveTo(s*S*0.36, S*0.06); ctx.lineTo(s*S*0.54, S*0.00); ctx.stroke();
        ctx.fillStyle = o.color;
        rrect(ctx, s*S*0.54 - S*0.030, -S*0.14, S*0.060, S*0.20, S*0.02); ctx.fill();
      });
    } },

  { id:"heavyPlating", up:"armor", at:3, layer:"front",
    name:"Heavy Plating", blurb:"Riveted slabs over the flanks",
    draw(ctx,S,o){
      const plate = o.ghost ? o.color : "rgba(158,170,190,0.60)";
      ctx.strokeStyle = "rgba(20,26,40,0.6)";
      ctx.lineWidth = S*0.012;
      [-1,1].forEach(s => {
        ctx.fillStyle = plate;
        ctx.beginPath();
        ctx.moveTo(s*S*0.20, -S*0.30);
        ctx.lineTo(s*S*0.37, -S*0.06);
        ctx.lineTo(s*S*0.34, S*0.26);
        ctx.lineTo(s*S*0.22, S*0.20);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        for(let r=0;r<3;r++){
          ctx.beginPath(); ctx.arc(s*S*0.29, -S*0.10 + r*S*0.11, S*0.013, 0, TAU); ctx.fill();
        }
      });
    } },

  { id:"salvageClaws", up:"fortune", at:3, layer:"front",
    name:"Salvage Claws", blurb:"Grabbers that scrape more out of every kill",
    draw(ctx,S,o){
      ctx.strokeStyle = o.ghost ? o.color : "#ffd23f";
      ctx.lineWidth = S*0.026; ctx.lineCap = "round";
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
      [-1,1].forEach(s => {
        const g = ctx.createLinearGradient(0, S*0.30, 0, S*0.30 + S*0.40*flick);
        g.addColorStop(0, "rgba(255,220,140,0.95)");
        g.addColorStop(0.5, "rgba(255,140,60,0.5)");
        g.addColorStop(1, "rgba(255,90,40,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(s*S*0.28 - S*0.06, S*0.30); ctx.lineTo(s*S*0.28 + S*0.06, S*0.30);
        ctx.lineTo(s*S*0.28, S*0.30 + S*0.40*flick); ctx.closePath(); ctx.fill();
      });
    } },

  { id:"aegisHalo", up:"shield", at:4, layer:"behind",
    name:"Aegis Halo", blurb:"A second ring with orbiting nodes",
    draw(ctx,S,o){
      ctx.save();
      ctx.rotate(-o.t*0.9);
      ctx.strokeStyle = o.ghost ? o.color : "rgba(160,230,255,0.55)";
      ctx.lineWidth = S*0.014;
      ctx.beginPath(); ctx.arc(0, 0, S*0.74, 0, TAU); ctx.stroke();
      ctx.fillStyle = o.ghost ? o.color : "#a0e6ff";
      for(let n=0;n<4;n++){
        const a = n/4*TAU;
        ctx.beginPath(); ctx.arc(Math.cos(a)*S*0.74, Math.sin(a)*S*0.74, S*0.030, 0, TAU); ctx.fill();
      }
      ctx.restore();
    } },

  { id:"overdriveVents", up:"overdrive", at:1, layer:"front",
    name:"Overdrive Vents", blurb:"Heat vents that flare when you burn it",
    draw(ctx,S,o){
      const pulse = 0.5 + Math.sin(o.t*8)*0.5;
      ctx.fillStyle = o.ghost ? o.color : "rgba(255,138,61," + (0.5 + pulse*0.5) + ")";
      [-1,1].forEach(s => {
        for(let v=0;v<3;v++){
          rrect(ctx, s*S*0.11 - S*0.016, S*0.06 + v*S*0.075, S*0.032, S*0.045, S*0.012);
          ctx.fill();
        }
      });
    } },

  { id:"gatling", up:"rapid", at:5, layer:"front",
    name:"Gatling Drum", blurb:"A spinning drum where the nose gun was",
    draw(ctx,S,o){
      ctx.save();
      ctx.translate(0, -S*0.40);
      ctx.rotate(o.t*7);
      ctx.fillStyle = o.metal;
      ctx.beginPath(); ctx.arc(0, 0, S*0.11, 0, TAU); ctx.fill();
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
      if(!o.ghost) glow(ctx, "#ff66b3", S*0.16*pulse);
      ctx.fillStyle = o.ghost ? o.color : "rgba(255,140,200," + (0.45 + pulse*0.35) + ")";
      ctx.beginPath(); ctx.arc(0, S*0.10, S*0.036 + pulse*S*0.008, 0, TAU); ctx.fill();
      noGlow(ctx);
    } },

  { id:"broadside", up:"spread", at:5, layer:"front",
    name:"Full Broadside", blurb:"Every hardpoint on the wing, loaded",
    draw(ctx,S,o){
      [-1,1].forEach(s => {
        ctx.fillStyle = o.color;
        [0.44, 0.62].forEach(x => { rrect(ctx, s*S*x - S*0.024, -S*0.22, S*0.048, S*0.16, S*0.018); ctx.fill(); });
        ctx.fillStyle = "#fff";
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
      [-1, 1].forEach(s => {
        const x = s*S*0.16;
        const g = ctx.createLinearGradient(0, S*0.30, 0, S*0.30 + S*0.5*flick);
        g.addColorStop(0, "rgba(255,190,90,0.9)");
        g.addColorStop(1, "rgba(255,80,40,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - S*0.045, S*0.30); ctx.lineTo(x + S*0.045, S*0.30);
        ctx.lineTo(x, S*0.30 + S*0.5*flick); ctx.closePath(); ctx.fill();
      });
    },
    front(ctx, S, o){        // swept-back fins + a racing stripe
      ctx.fillStyle = o.color; glow(ctx, o.color, S*0.05);
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s*S*0.30, S*0.02); ctx.lineTo(s*S*0.52, S*0.32); ctx.lineTo(s*S*0.28, S*0.20);
        ctx.closePath(); ctx.fill();
      });
      noGlow(ctx);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-S*0.013, -S*0.40, S*0.026, S*0.56);
    },
  },
  titan: {
    front(ctx, S, o){        // riveted flank slabs + a nose plate
      ctx.fillStyle = o.metal;
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
      ctx.fillStyle = o.metal;
      [-1, 1].forEach(s => { rrect(ctx, s*S*0.05 - S*0.02, -S*0.66, S*0.04, S*0.30, S*0.015); fillEdge(ctx, S); });
      ctx.fillStyle = "#ff5d73"; glow(ctx, "#ff5d73", S*0.08);
      [-1, 1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.05, -S*0.66, S*0.024, 0, TAU); ctx.fill(); });
      noGlow(ctx);
    },
  },
  scavenger: {
    front(ctx, S, o){        // the golden collector scoop, sparks orbiting in
      ctx.strokeStyle = "#ffd23f"; glow(ctx, "#ffd23f", S*0.07);
      ctx.lineWidth = S*0.035; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(0, S*0.12, S*0.34, Math.PI*0.15, Math.PI*0.85); ctx.stroke();
      ctx.fillStyle = "#ffe9a8";
      [0, 1, 2].forEach(k => {
        const a = Math.PI*0.5 + Math.sin(o.t*2 + k*2.1)*Math.PI*0.3;
        ctx.beginPath(); ctx.arc(Math.cos(a)*S*0.34, S*0.12 + Math.sin(a)*S*0.34, S*0.02, 0, TAU); ctx.fill();
      });
      noGlow(ctx);
    },
  },
  ghost: {
    front(ctx, S, o){        // phase shimmer: a breathing outline off the hull
      const a = 0.28 + Math.sin(o.t*3)*0.16;
      ctx.strokeStyle = "rgba(160,180,255," + a.toFixed(2) + ")";
      glow(ctx, "#9aa5ff", S*0.09);
      ctx.lineWidth = S*0.02;
      ctx.beginPath(); ctx.ellipse(0, -S*0.04, S*0.42, S*0.52, 0, 0, TAU); ctx.stroke();
      noGlow(ctx);
    },
  },
  apex: {
    front(ctx, S, o){        // the Leviathan's gold: trim chevrons and edging
      ctx.strokeStyle = "#ffd23f"; glow(ctx, "#ffd23f", S*0.06);
      ctx.lineWidth = S*0.026; ctx.lineCap = "round";
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
 * clipped to a hull-ish silhouette so paint never floats off the metal.
 */
/*
 * The hull-ish silhouette liveries are clipped to, as vertices so the paint
 * easel can ask "is this cell on the ship?" against the SAME shape (see
 * paintjob.js). One polygon, two readers - they can never drift apart.
 */
const HULL_POLY = [
  [0, -0.50], [0.17, -0.14], [0.30, 0.16], [0.16, 0.44],
  [-0.16, 0.44], [-0.30, 0.16], [-0.17, -0.14],
];
function hullClip(ctx, S){
  ctx.beginPath();
  HULL_POLY.forEach(([x, y], i) => {
    if(i === 0) ctx.moveTo(x*S, y*S); else ctx.lineTo(x*S, y*S);
  });
  ctx.closePath();
  ctx.clip();
}
const LIVERY_ART = {
  /*
   * Two fat racing stripes, nose to tail - each with a dark border, because
   * the stock hull already has white panels and a plain white stripe simply
   * disappeared into them at flight size. The border is what makes it read
   * on ANY paint colour.
   */
  stripes(ctx, S){
    ctx.save(); hullClip(ctx, S);
    [-S*0.145, S*0.020].forEach(x => {
      ctx.fillStyle = "#10131c";
      ctx.fillRect(x - S*0.022, -S*0.52, S*0.169, S*1.04);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, -S*0.52, S*0.125, S*1.04);
    });
    ctx.restore();
  },
  /** Flames licking up from the tail - orange over red over yellow. */
  flames(ctx, S){
    ctx.save(); hullClip(ctx, S);
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
    tongue("#c2410c", S*0.34, S*0.86, 0);
    tongue("#f97316", S*0.27, S*0.66, 0);
    tongue("#fbbf24", S*0.18, S*0.44, 0);
    ctx.restore();
  },
  /** One enormous lightning bolt across the entire hull. */
  bolt(ctx, S){
    ctx.save(); hullClip(ctx, S);
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
  /** A chequered flag band right across the middle. */
  checkers(ctx, S){
    ctx.save(); hullClip(ctx, S);
    const cell = S*0.088, y0 = -S*0.10;
    for(let r = 0; r < 3; r++){
      for(let c = 0; c < 8; c++){
        ctx.fillStyle = (r + c) % 2 ? "#ffffff" : "#12161f";
        ctx.fillRect(-S*0.35 + c*cell, y0 + r*cell, cell, cell);
      }
    }
    ctx.restore();
  },
};

function drawShip(ctx, cx, cy, size, opts){
  const o = {
    color: opts.color || "#f5a623",
    metal: "#8a94a8",
    mateColor: opts.mateColor,
    t: opts.t || 0,
    ghost: false, alpha: 1,
  };
  const levels = opts.levels || {};
  const S = size;
  const bob = opts.idle === false ? 0 : Math.sin(o.t*1.6)*size*0.018;

  ctx.save();
  ctx.translate(cx, cy + bob);

  const behind = [], front = [];
  PARTS.forEach(p => { if(owns(levels, p)) (p.layer === "behind" ? behind : front).push(p); });

  // Base exhaust: every ship has one, it just gets replaced by better parts.
  if(!owns(levels, PART_BY_ID.ionNozzles)){
    const flick = 0.8 + Math.sin(o.t*15)*0.2;
    const g = ctx.createLinearGradient(0, S*0.34, 0, S*0.34 + S*0.22*flick);
    g.addColorStop(0, "rgba(255,190,120,0.8)");
    g.addColorStop(1, "rgba(255,120,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-S*0.07, S*0.34); ctx.lineTo(S*0.07, S*0.34);
    ctx.lineTo(0, S*0.34 + S*0.22*flick); ctx.closePath(); ctx.fill();
  }

  const tuneArt = TUNE_ART[opts.tune];
  behind.forEach(p => { ctx.save(); p.draw(ctx, S, o); ctx.restore(); });
  if(tuneArt && tuneArt.behind){ ctx.save(); tuneArt.behind(ctx, S, o); ctx.restore(); }
  drawHull(ctx, S, o.color);
  front.forEach(p => { ctx.save(); p.draw(ctx, S, o); ctx.restore(); });
  if(tuneArt && tuneArt.front){ ctx.save(); tuneArt.front(ctx, S, o); ctx.restore(); }
  // The livery goes on over every bought part: paint you can't see under a
  // wing is paint that wasn't worth buying. A "px1:" value is not a shop
  // pattern but a drawing the pilot made - same layer, same clipping.
  if(opts.decal){
    if(SF.paintjob && SF.paintjob.isCustom(opts.decal)){
      SF.paintjob.paint(ctx, S, opts.decal);
    } else if(LIVERY_ART[opts.decal]){
      ctx.save(); LIVERY_ART[opts.decal](ctx, S); ctx.restore();
    }
  }

  // The grey silhouette of what's next: always something to want.
  if(opts.ghost){
    const gp = typeof opts.ghost === "string" ? PART_BY_ID[opts.ghost] : opts.ghost;
    if(gp){
      const pulse = 0.28 + Math.sin(o.t*2.6)*0.16;
      ctx.save();
      ctx.globalAlpha = pulse;
      gp.draw(ctx, S, Object.assign({}, o, { ghost:true, alpha:pulse, color:"#ffffff", metal:"#ffffff" }));
      ctx.restore();
    }
  }
  ctx.restore();
}

/** The hull itself: the game's sprite when it's loaded, a drawn one when it isn't. */
function drawHull(ctx, S, color){
  const R = SF.render;
  if(R && R.isReady() && R.assets.ship){
    ctx.drawImage(R.tinted(R.assets.ship, color), -S/2, -S/2, S, S);
    return;
  }
  /*
   * Sprite-less fallback. It used to be one flat filled arrow, which is what
   * the pilot picker showed for months whenever it painted before the sprite
   * loaded - a coloured triangle reads as a placeholder, not a spacecraft. It
   * is a proper little interceptor now: shaded fuselage, swept wings, a
   * canopy and a lit engine, so an asset failure degrades to "simpler ship"
   * rather than "broken".
   */
  const dark = shadeHex(color, -0.45), lit = shadeHex(color, 0.42);

  // Swept wings, drawn behind the body
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(0, -S*0.06);
  ctx.lineTo(S*0.42, S*0.20); ctx.lineTo(S*0.30, S*0.30); ctx.lineTo(0, S*0.18);
  ctx.lineTo(-S*0.30, S*0.30); ctx.lineTo(-S*0.42, S*0.20);
  ctx.closePath(); ctx.fill();

  // Fuselage, lit from the top-left like everything else in the game
  const g = ctx.createLinearGradient(-S*0.18, -S*0.45, S*0.16, S*0.35);
  g.addColorStop(0, lit); g.addColorStop(0.45, color); g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -S*0.48);
  ctx.quadraticCurveTo(S*0.13, -S*0.20, S*0.14, S*0.14);
  ctx.lineTo(S*0.10, S*0.34);
  ctx.lineTo(-S*0.10, S*0.34);
  ctx.lineTo(-S*0.14, S*0.14);
  ctx.quadraticCurveTo(-S*0.13, -S*0.20, 0, -S*0.48);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(12,16,30,0.5)";
  ctx.lineWidth = S*0.012;
  ctx.stroke();

  // Canopy
  ctx.fillStyle = "rgba(190,230,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(0, -S*0.16, S*0.062, S*0.12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(-S*0.02, -S*0.20, S*0.024, S*0.05, 0, 0, TAU);
  ctx.fill();

  // Nose tip and engine mouth
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.moveTo(0, -S*0.48); ctx.lineTo(S*0.035, -S*0.30); ctx.lineTo(-S*0.035, -S*0.30);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(20,24,40,0.85)";
  rrect(ctx, -S*0.075, S*0.30, S*0.15, S*0.05, S*0.02); ctx.fill();
}

/** Local shade helper - the module has no other colour maths. */
function shadeHex(hex, k){
  const v = parseInt(String(hex).replace("#",""), 16);
  const c = [(v>>16)&255, (v>>8)&255, v&255];
  const t = k < 0 ? 0 : 255, a = Math.abs(k);
  return "rgb(" + c.map(n => Math.round(n + (t-n)*a)).join(",") + ")";
}

SF.shipart = { PARTS, PART_BY_ID, levelsOf, partList, nextPart, ownedCount, drawShip,
               hullClip, HULL_POLY };
})();
