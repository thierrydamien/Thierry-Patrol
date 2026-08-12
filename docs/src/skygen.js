/*
 * Procedural deep-space backdrops - one per mission.
 *
 * Every level used to share a single JPG, so flying mission 8 looked exactly
 * like flying mission 1. These are generated instead: a palette and a seed per
 * mission produce a nebula with its own colour, structure and star density, so
 * the campaign visibly travels somewhere.
 *
 * Two properties make it work in a scrolling shooter:
 *
 *  - **Vertically tileable.** Every element is drawn three times (at y, y-H
 *    and y+H), so the image wraps seamlessly and the playfield can scroll
 *    through it forever without a seam. The old art was pan-only for exactly
 *    this reason - it could not be scrolled.
 *  - **Built once.** A backdrop is rendered into an offscreen canvas at
 *    mission start and then blitted, so hundreds of gradients cost nothing per
 *    frame.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

/* ---------------------------------------------------------
   PALETTES - one per mission, in campaign order.
   `clouds` are the emission colours, `dust` the dark lanes
   that give a nebula its structure, `star` tints the suns.
   --------------------------------------------------------- */
const SKIES = [
  // Mission 1 and 5 keep the original artwork - it is the look the game grew
  // up with, and a painted planet still beats anything generated.
  { name:"Home Reach",   photo:"playfieldBg" },

  { name:"Violet Drift", clouds:["#7c3aed","#a855f7","#4c1d95"], dust:"#0a0518", star:"#f3e8ff",
    density:1.0, stars:1.0, bright:3,
    props:[ {k:"planet", x:0.20, y:0.30, r:0.177, lit:"#8b6bd8", dark:"#241245", rings:true},
            {k:"planet", x:0.82, y:0.70, r:0.047, lit:"#c9b6f0", dark:"#3a2a5c", craters:true},
            {k:"galaxy", x:0.78, y:0.16, r:0.22} ] },

  { name:"Emerald Veil", clouds:["#059669","#14b8a6","#065f46"], dust:"#02100c", star:"#d1fae5",
    density:0.95, stars:0.9, bright:3,
    props:[ {k:"planet", x:0.80, y:0.24, r:0.146, lit:"#3fbf95", dark:"#0a3b2c", bands:true},
            {k:"rocks",  x:0.22, y:0.62, r:0.156, n:16},
            {k:"planet", x:0.14, y:0.14, r:0.036, lit:"#9ad9c4", dark:"#1d3a32", craters:true} ] },

  { name:"Rust Belt",    clouds:["#c2410c","#f59e0b","#7c2d12"], dust:"#140803", star:"#ffedd5",
    density:1.15, stars:0.8, bright:3,
    props:[ {k:"planet", x:0.74, y:0.62, r:0.239, lit:"#d2703a", dark:"#2f1105", bands:true, crescent:true},
            {k:"rocks",  x:0.25, y:0.30, r:0.177, n:22},
            {k:"sun",    x:0.10, y:0.82, r:0.026, color:"#ffd9a0"} ] },

  { name:"Ice Fields",   photo:"backAlt" },

  { name:"Squall Line",  clouds:["#0891b2","#67e8f9","#164e63"], dust:"#03090c", star:"#cffafe",
    density:1.5, stars:0.7, bright:2,
    props:[ {k:"planet", x:0.16, y:0.22, r:0.09, lit:"#5eead4", dark:"#134e4a", bands:true},
            {k:"rocks",  x:0.78, y:0.66, r:0.14, n:10} ] },

  { name:"Crimson Run",  clouds:["#be123c","#f43f5e","#881337"], dust:"#12030a", star:"#ffe4e6",
    density:1.05, stars:0.85, bright:2,
    props:[ {k:"sun",    x:0.78, y:0.22, r:0.083, color:"#ff8a6b"},
            {k:"planet", x:0.24, y:0.66, r:0.156, lit:"#8d3550", dark:"#210711", craters:true},
            {k:"planet", x:0.60, y:0.88, r:0.052, lit:"#c96b80", dark:"#2b0d18"} ] },

  { name:"Gold Reach",   clouds:["#b45309","#fbbf24","#78350f"], dust:"#120b02", star:"#fef3c7",
    density:1.1, stars:0.9, bright:3,
    props:[ {k:"planet", x:0.26, y:0.26, r:0.198, lit:"#e0a13e", dark:"#3a1f04", bands:true, rings:true},
            {k:"planet", x:0.80, y:0.74, r:0.068, lit:"#f2d79a", dark:"#4a3410", craters:true},
            {k:"rocks",  x:0.72, y:0.34, r:0.114, n:12} ] },

  { name:"The Trade Lane", clouds:["#a16207","#fcd34d","#713f12"], dust:"#0e0a02", star:"#fef9c3",
    density:0.9, stars:1.0, bright:3,
    props:[ {k:"planet", x:0.82, y:0.30, r:0.13, lit:"#e8b45a", dark:"#4a2c08", rings:true},
            {k:"planet", x:0.14, y:0.72, r:0.05, lit:"#f5deb0", dark:"#5c4318", craters:true},
            {k:"galaxy", x:0.24, y:0.14, r:0.18} ] },

  { name:"The Deep",     clouds:["#6d28d9","#db2777","#1e1b4b"], dust:"#05030f", star:"#ede9fe",
    density:1.3, stars:1.0, bright:4,
    props:[ {k:"planet", x:0.66, y:0.52, r:0.322, lit:"#4b3a7a", dark:"#07040f", crescent:true},
            {k:"galaxy", x:0.18, y:0.20, r:0.26},
            {k:"planet", x:0.14, y:0.80, r:0.047, lit:"#a78bfa", dark:"#1b1436"} ] },

  /* --- Act 2. Colder and emptier heading out, hotter as you close on their
     home star, so the run has a direction you can see. --- */

  { name:"The Blockade", clouds:["#0b1d3a","#173a6b","#050c1c"], dust:"#020409", star:"#9fc0e8",
    density:0.65, stars:0.55, bright:1,
    props:[ {k:"planet", x:0.78, y:0.80, r:0.20, lit:"#20406e", dark:"#040914", crescent:true},
            {k:"rocks",  x:0.22, y:0.24, r:0.15, n:12} ] },

  { name:"The Wreck Line", clouds:["#475569","#64748b","#1e293b"], dust:"#05070c", star:"#e2e8f0",
    density:0.8, stars:1.1, bright:2,
    props:[ {k:"rocks",  x:0.50, y:0.42, r:0.30, n:34},
            {k:"planet", x:0.16, y:0.76, r:0.104, lit:"#6b7c94", dark:"#0d131f", craters:true},
            {k:"rocks",  x:0.80, y:0.14, r:0.14, n:14} ] },

  { name:"Duelling Ground", clouds:["#9d174d","#f472b6","#4a044e"], dust:"#12030c", star:"#fce7f3",
    density:0.85, stars:1.1, bright:3,
    props:[ {k:"planet", x:0.18, y:0.24, r:0.12, lit:"#e879b0", dark:"#4a0d33", crescent:true},
            {k:"galaxy", x:0.80, y:0.66, r:0.20},
            {k:"planet", x:0.88, y:0.18, r:0.045, lit:"#f9c9e4", dark:"#54173c", craters:true} ] },

  { name:"Hatchery",     clouds:["#4d7c0f","#84cc16","#1a2e05"], dust:"#050b02", star:"#ecfccb",
    density:1.2, stars:0.75, bright:2,
    props:[ {k:"planet", x:0.78, y:0.34, r:0.208, lit:"#7fa83c", dark:"#16250a", bands:true},
            {k:"planet", x:0.20, y:0.72, r:0.073, lit:"#b6dd6e", dark:"#2b3d13", craters:true},
            {k:"galaxy", x:0.28, y:0.18, r:0.19} ] },

  { name:"Warden's Watch", clouds:["#0e7490","#22d3ee","#083344"], dust:"#020a0e", star:"#cffafe",
    density:1.0, stars:0.9, bright:3,
    props:[ {k:"planet", x:0.24, y:0.28, r:0.234, lit:"#2f8ba3", dark:"#04202b", rings:true},
            {k:"sun",    x:0.84, y:0.78, r:0.031, color:"#a5f3fc"},
            {k:"rocks",  x:0.72, y:0.44, r:0.13, n:12} ] },

  { name:"The Treasury", clouds:["#92400e","#eab308","#451a03"], dust:"#0f0902", star:"#fde68a",
    density:1.1, stars:0.85, bright:3,
    props:[ {k:"planet", x:0.76, y:0.30, r:0.21, lit:"#d9a441", dark:"#33200a", rings:true},
            {k:"rocks",  x:0.24, y:0.60, r:0.17, n:18},
            {k:"sun",    x:0.14, y:0.16, r:0.03, color:"#ffe9a8"} ] },

  { name:"Cold Approach", clouds:["#1e3a8a","#3b82f6","#0c1836"], dust:"#020510", star:"#dbeafe",
    density:0.75, stars:1.15, bright:4,
    props:[ {k:"planet", x:0.72, y:0.66, r:0.26, lit:"#3f6fc4", dark:"#050d21", crescent:true},
            {k:"planet", x:0.22, y:0.20, r:0.057, lit:"#93b8f5", dark:"#152540", craters:true} ] },

  { name:"The Fortress Wall", clouds:["#7f1d1d","#57534e","#1c1917"], dust:"#0a0505", star:"#e7e5e4",
    density:1.3, stars:0.5, bright:1,
    props:[ {k:"rocks", x:0.12, y:0.30, r:0.17, n:18},
            {k:"rocks", x:0.88, y:0.62, r:0.17, n:18} ] },

  { name:"Last Harbour", clouds:["#7e22ce","#e879f9","#2e1065"], dust:"#0a0316", star:"#fae8ff",
    density:1.15, stars:0.95, bright:3,
    props:[ {k:"galaxy", x:0.30, y:0.30, r:0.28},
            {k:"planet", x:0.78, y:0.62, r:0.182, lit:"#a855c9", dark:"#2a0a3c", bands:true, rings:true},
            {k:"planet", x:0.14, y:0.84, r:0.042, lit:"#f0abfc", dark:"#3b1049"} ] },

  { name:"Their Star",   clouds:["#9a3412","#fb923c","#450a0a"], dust:"#100301", star:"#ffedd5",
    density:1.35, stars:0.7, bright:4,
    props:[ {k:"sun",    x:0.70, y:0.26, r:0.125, color:"#ffb46b"},
            {k:"planet", x:0.26, y:0.68, r:0.244, lit:"#b8501f", dark:"#280702", bands:true, crescent:true},
            {k:"rocks",  x:0.68, y:0.82, r:0.14, n:16} ] },

  /* --- Act 3. Their star is out. The first of these two skies is the
     approach: near-black, almost starless, and the Devourer itself sitting
     in it. The second is the fight - the dead star's last embers. --- */
  { name:"Lights Out",   clouds:["#111827","#1e2a4a","#05070f"], dust:"#010207", star:"#7d8bb0",
    density:0.7, stars:0.45, bright:1,
    props:[ {k:"planet", x:0.80, y:0.20, r:0.10, lit:"#26324e", dark:"#0a0e1c", crescent:true},
            {k:"rocks",  x:0.18, y:0.68, r:0.12, n:8} ] },

  { name:"The Long Dark", clouds:["#0a0a16","#141430","#03030a"], dust:"#010104", star:"#9aa8c8",
    density:0.4, stars:0.45, bright:1,
    props:[ {k:"devourer", x:0.52, y:0.30, r:0.30},
            {k:"planet", x:0.16, y:0.86, r:0.10, lit:"#1b2136", dark:"#02030a", crescent:true} ] },

  { name:"The Last Star", clouds:["#7f1d1d","#dc2626","#1c0505"], dust:"#0d0202", star:"#ffd9d9",
    density:1.4, stars:0.6, bright:4,
    props:[ {k:"sun",    x:0.50, y:0.30, r:0.20, color:"#ff6b4a"},
            {k:"rocks",  x:0.22, y:0.70, r:0.20, n:24},
            {k:"rocks",  x:0.80, y:0.62, r:0.16, n:18} ] },

  /* --- Act 4. Through the crack the Devourer left. Not "more space":
     somewhere space doesn't quite work - and, at the end, the place where
     space gets MADE. --- */

  { name:"The Undertow",  clouds:["#155e75","#2dd4bf","#0b1c3c"], dust:"#020810", star:"#ccfbf1",
    density:0.95, stars:0.85, bright:2,
    props:[ {k:"planet", x:0.78, y:0.28, r:0.17, lit:"#2a9db0", dark:"#062030", crescent:true},
            {k:"galaxy", x:0.20, y:0.62, r:0.24},
            {k:"planet", x:0.16, y:0.16, r:0.045, lit:"#7fd8d0", dark:"#0e3a3a", craters:true} ] },

  { name:"The Chorus",    clouds:["#c026d3","#f59e0b","#4a0450"], dust:"#0e0312", star:"#fdf4ff",
    density:1.05, stars:0.9, bright:4,
    props:[ {k:"galaxy", x:0.72, y:0.20, r:0.26},
            {k:"planet", x:0.18, y:0.74, r:0.11, lit:"#d879e8", dark:"#3a0d44", rings:true},
            {k:"sun",    x:0.14, y:0.24, r:0.028, color:"#ffd9f4"} ] },

  { name:"The Foundry",   clouds:["#7c2d12","#f97316","#1c0a04"], dust:"#0d0502", star:"#ffedd5",
    density:1.2, stars:0.6, bright:2,
    props:[ {k:"planet", x:0.80, y:0.66, r:0.21, lit:"#c96a2a", dark:"#2a1004", bands:true},
            {k:"rocks",  x:0.24, y:0.28, r:0.19, n:20},
            {k:"sun",    x:0.68, y:0.16, r:0.04, color:"#ffb46b"} ] },

  { name:"The Serpent's Garden", clouds:["#047857","#22d3ee","#032f2b"], dust:"#02100b", star:"#d1fae5",
    density:1.0, stars:0.95, bright:3,
    props:[ {k:"planet", x:0.24, y:0.30, r:0.15, lit:"#2fbf9a", dark:"#083328", rings:true},
            {k:"galaxy", x:0.78, y:0.70, r:0.22},
            {k:"planet", x:0.86, y:0.18, r:0.05, lit:"#9fe8cf", dark:"#1d4038", craters:true} ] },

  /* The workshop's own twilight: graphite, one warm lamp, almost no stars.
     The finale overpaints it live (blueprint flashes, act-palette repaints),
     so the base sky stays deliberately quiet - it is the canvas, not the
     painting. */
  { name:"Behind the Sky", clouds:["#3d3a55","#c9b458","#15131f"], dust:"#0a0a12", star:"#e2e8f0",
    density:0.5, stars:0.55, bright:1,
    props:[ {k:"galaxy", x:0.30, y:0.24, r:0.20},
            {k:"planet", x:0.80, y:0.76, r:0.09, lit:"#6b6787", dark:"#191627", crescent:true} ] },
];

/* Deterministic RNG, so a mission's sky is elaborate but always the same sky. */
function rngFor(seed){
  let s = seed*9301 + 49297;
  return function(){
    s = (s*9301 + 49297) % 233280;
    return s/233280;
  };
}

function hexToRgb(hex){
  const v = parseInt(hex.replace("#",""), 16);
  return [(v>>16)&255, (v>>8)&255, v&255];
}
function rgba(hex, a){
  const c = hexToRgb(hex);
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}

/**
 * Draws `fn` three times - at y, y-H and y+H - so anything crossing an edge
 * appears on the other one. This is the whole trick behind the seamless wrap.
 */
function tiled(ctx, H, y, fn){
  fn(y);
  if(y > H*0.6) fn(y - H);
  if(y < H*0.4) fn(y + H);
}

/* ---------------------------------------------------------
   BACKGROUND FURNITURE
   Planets, suns, galaxies and rock fields. Without something
   with an edge in it, every generated sky reads as the same
   coloured haze - the difference between "a nebula" and
   "somewhere".
   --------------------------------------------------------- */
function drawPlanet(ctx, W, H, p, rand, lightDir){
  const cx = p.x*W, cy = p.y*H, r = p.r*W;
  // Unit vector toward the sky's bright core - the nebula is the light source,
  // so the lit limb agrees with the brightest sky behind it.
  const lx = lightDir[0], ly = lightDir[1], lang = Math.atan2(ly, lx);
  const paint = yy => {
    ctx.save();
    if(p.rings){                                   // back half of the ring
      ctx.save();
      ctx.translate(cx, yy); ctx.rotate(-0.42); ctx.scale(1, 0.22);
      ctx.strokeStyle = rgba(p.lit, 0.30);
      ctx.lineWidth = r*0.30;
      ctx.beginPath(); ctx.arc(0, 0, r*1.55, Math.PI, TAU); ctx.stroke();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(cx + lx*r*0.62, yy + ly*r*0.62, r*0.05, cx, yy, r);
    g.addColorStop(0, p.lit);
    g.addColorStop(0.55, p.dark);
    g.addColorStop(1, "#020309");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, yy, r, 0, TAU); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, yy, r, 0, TAU); ctx.clip();
    if(p.bands){
      ctx.globalAlpha = 0.16; ctx.fillStyle = p.lit;
      [-0.62,-0.34,-0.05,0.26,0.55].forEach(o =>
        ctx.fillRect(cx - r, yy + o*r, r*2, r*(0.06 + rand()*0.08)));
      ctx.globalAlpha = 1;
    }
    if(p.craters){
      for(let i=0;i<9;i++){
        const a = rand()*TAU, d = Math.sqrt(rand())*r*0.82, cr = r*(0.05 + rand()*0.12);
        ctx.fillStyle = rgba(p.dark, 0.55);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a)*d, yy + Math.sin(a)*d, cr, 0, TAU); ctx.fill();
      }
    }
    if(p.crescent){                                // heavy shadow: a lit sliver only
      const sg = ctx.createLinearGradient(cx + lx*r, yy + ly*r, cx - lx*r, yy - ly*r);
      sg.addColorStop(0, "rgba(0,0,0,0)");
      sg.addColorStop(0.42, "rgba(0,0,0,0.72)");
      sg.addColorStop(1, "rgba(0,0,0,0.94)");
      ctx.fillStyle = sg;
      ctx.fillRect(cx - r, yy - r, r*2, r*2);
    }
    // Soft limb glow on the core-facing edge. Drawn after the crescent so a
    // mostly-dark body still keeps a lit rim - the cue that says "sphere",
    // not "hole". Kept faint: scenery must never compete with bullets.
    const lg = ctx.createRadialGradient(cx + lx*r, yy + ly*r, r*0.15, cx + lx*r, yy + ly*r, r*1.05);
    lg.addColorStop(0, rgba(p.lit, 0.32));
    lg.addColorStop(1, rgba(p.lit, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(cx - r, yy - r, r*2, r*2);
    ctx.restore();

    ctx.strokeStyle = rgba(p.lit, 0.42);           // rim light, centred on the core
    ctx.lineWidth = Math.max(1, r*0.02);
    ctx.beginPath(); ctx.arc(cx, yy, r, lang - 0.9, lang + 0.9); ctx.stroke();

    if(p.rings){                                   // front half, over the disc
      ctx.save();
      ctx.translate(cx, yy); ctx.rotate(-0.42); ctx.scale(1, 0.22);
      ctx.strokeStyle = rgba(p.lit, 0.55);
      ctx.lineWidth = r*0.30;
      ctx.beginPath(); ctx.arc(0, 0, r*1.55, 0, Math.PI); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };
  tiled(ctx, H, cy, paint);
}

function drawSun(ctx, W, H, p){
  const cx = p.x*W, r = p.r*W;
  tiled(ctx, H, p.y*H, yy => {
    const g = ctx.createRadialGradient(cx, yy, 0, cx, yy, r*4.5);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.08, rgba(p.color, 0.8));
    g.addColorStop(0.3, rgba(p.color, 0.25));
    g.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, yy, r*4.5, 0, TAU); ctx.fill();
  });
}

function drawGalaxy(ctx, W, H, p, rand){
  const cx = p.x*W, r = p.r*W;
  tiled(ctx, H, p.y*H, yy => {
    ctx.save();
    ctx.translate(cx, yy); ctx.rotate(-0.6); ctx.scale(1, 0.38);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, "rgba(255,246,222,0.42)");
    g.addColorStop(0.3, "rgba(200,180,255,0.12)");
    g.addColorStop(1, "rgba(140,110,220,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    for(let i=0;i<120;i++){
      const a = rand()*TAU, d = Math.pow(rand(), 0.6)*r;
      ctx.globalAlpha = 0.45*(1 - d/r);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(Math.cos(a + d*0.018)*d, Math.sin(a + d*0.018)*d, 1.3, 1.3);
    }
    ctx.restore();
  });
}

/*
 * The Devourer, seen from a long way off. Painted into the SKY of the
 * approach mission - a black bulk with a ring of cold running lights and one
 * red eye, too big to fight, hanging where their star used to be. Nothing
 * else in the game is drawn into the backdrop like this; it exists so the
 * mission before the finale is spent looking at what is coming.
 */
function drawDevourerSilhouette(ctx, W, H, p){
  const cx = W*p.x, R = W*p.r;
  // Tiled like every other prop: the 2.4R eclipse shade reaches past the
  // canvas edge, and an untiled clip there put a hard shadow line on the wrap.
  tiled(ctx, H, H*p.y, cy => {
    ctx.save();
    // The eclipse it casts: everything behind it goes darker.
    const shade = ctx.createRadialGradient(cx, cy, R*0.4, cx, cy, R*2.4);
    shade.addColorStop(0, "rgba(0,0,0,0.85)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(cx - R*2.4, cy - R*2.4, R*4.8, R*4.8);

    // Hull: a squat hexagonal bulk with shoulder arms.
    ctx.fillStyle = "#05060e";
    ctx.beginPath();
    ctx.moveTo(cx - R,       cy - R*0.28);
    ctx.lineTo(cx - R*0.52,  cy - R*0.78);
    ctx.lineTo(cx + R*0.52,  cy - R*0.78);
    ctx.lineTo(cx + R,       cy - R*0.28);
    ctx.lineTo(cx + R*0.66,  cy + R*0.72);
    ctx.lineTo(cx - R*0.66,  cy + R*0.72);
    ctx.closePath(); ctx.fill();
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(cx + s*R*0.88, cy - R*0.34);
      ctx.lineTo(cx + s*R*1.5,  cy - R*0.10);
      ctx.lineTo(cx + s*R*1.42, cy + R*0.30);
      ctx.lineTo(cx + s*R*0.80, cy + R*0.34);
      ctx.closePath(); ctx.fill();
    });

    // Cold running lights along the shoulders, and the eye.
    ctx.fillStyle = "rgba(120,180,255,0.5)";
    for(let i = 0; i < 9; i++){
      const t = i/8;
      ctx.fillRect(cx - R*0.52 + t*R*1.04, cy - R*0.74, R*0.03, R*0.03);
    }
    ctx.globalCompositeOperation = "lighter";
    const eye = ctx.createRadialGradient(cx, cy + R*0.02, 0, cx, cy + R*0.02, R*0.42);
    eye.addColorStop(0, "rgba(255,70,90,0.85)");
    eye.addColorStop(0.4, "rgba(255,40,70,0.25)");
    eye.addColorStop(1, "rgba(255,0,40,0)");
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(cx, cy + R*0.02, R*0.42, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

function drawRocks(ctx, W, H, p, rand){
  const cx = p.x*W, r = p.r*W;
  tiled(ctx, H, p.y*H, yy => {
    for(let i=0;i<p.n;i++){
      const a = rand()*TAU, d = Math.sqrt(rand())*r;
      const x = cx + Math.cos(a)*d, y = yy + Math.sin(a)*d*0.7;
      const rr = r*(0.03 + rand()*0.07);
      ctx.fillStyle = "rgba(26,30,42,0.92)";
      ctx.beginPath();
      for(let k=0;k<7;k++){
        const ka = k/7*TAU, kr = rr*(0.7 + rand()*0.5);
        const kx = x + Math.cos(ka)*kr, ky = y + Math.sin(ka)*kr;
        if(k === 0) ctx.moveTo(kx, ky); else ctx.lineTo(kx, ky);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(160,175,200,0.22)";
      ctx.lineWidth = 1; ctx.stroke();
    }
  });
}

// One scratch canvas shared by every build(): props composite here at full
// alpha before being dimmed and blitted. Reused, not per-prop - at dpr 2 a
// throwaway canvas per prop would dominate the ~170ms build budget.
let propLayer = null;

/*
 * Contract: returns null for a photo-backed mission (the renderer pans the
 * painted artwork instead). Otherwise the canvas is W*dpr x H*dpr device
 * pixels, drawn in logical W x H coordinates via ctx.scale(dpr, dpr) - the
 * vertical wrap is seamless at logical H whatever the dpr. Callers keep
 * their tiling math in logical units and blit with an explicit destination
 * size: drawImage(sky, 0, y, W, H), and again at y - H.
 */
function build(missionIndex, W, H, dpr = 1){
  const sky = SKIES[missionIndex % SKIES.length];
  if(sky.photo) return null;                       // the renderer uses the artwork
  const rand = rngFor(missionIndex*137 + 7);
  const cv = document.createElement("canvas");
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
  const ctx = cv.getContext("2d");
  if(!ctx) return cv;
  ctx.scale(dpr, dpr);

  // Base: essentially black. Real deep-space photographs are mostly empty and
  // the nebula is an event in the frame - filling the whole canvas with colour
  // is what made the first attempt look like wallpaper. The tints peak just
  // inside the edges, not at them: row 0 must equal row H or the wrap carries
  // a hard colour step through every scroll.
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, "#03030a");
  base.addColorStop(0.06, rgba(sky.clouds[2], 0.22));
  base.addColorStop(0.5, "#03030a");
  base.addColorStop(0.94, rgba(sky.clouds[0], 0.14));
  base.addColorStop(1, "#03030a");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Two bright regions the gas clusters around, so each sky has somewhere to
  // look rather than being uniformly lit.
  const cores = [
    { x: (0.2 + rand()*0.6)*W, y: (0.15 + rand()*0.3)*H, r: (0.3 + rand()*0.2)*W },
    { x: (0.2 + rand()*0.6)*W, y: (0.55 + rand()*0.3)*H, r: (0.25 + rand()*0.2)*W },
  ];

  /* --- emission clouds ---------------------------------------------------
     Many overlapping soft blobs in "lighter" build up structure the way a
     single gradient never can: where they pile up you get bright cores, where
     they thin out you get wisps. */
  ctx.globalCompositeOperation = "lighter";
  const blobs = Math.round(150 * sky.density);
  for(let i=0;i<blobs;i++){
    // Most gas clusters around a core; the rest drifts loose.
    let x, y;
    if(rand() < 0.68){
      const c = cores[rand() < 0.5 ? 0 : 1];
      const a2 = rand()*TAU, d = Math.pow(rand(), 1.7)*c.r;
      x = c.x + Math.cos(a2)*d; y = c.y + Math.sin(a2)*d*0.8;
    } else { x = rand()*W; y = rand()*H; }
    const r = (0.03 + Math.pow(rand(), 1.6)*0.26) * W;
    const col = sky.clouds[Math.floor(rand()*sky.clouds.length)];
    const a = 0.022 + rand()*0.055;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(0.45, rgba(col, a*0.35));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  // Filaments: stretched blobs that read as gas being pulled into strands.
  for(let i=0;i<Math.round(34*sky.density);i++){
    const c = cores[rand() < 0.5 ? 0 : 1];
    const x = c.x + (rand()-0.5)*c.r*2.2, y = c.y + (rand()-0.5)*c.r*2.2;
    const rx = (0.02 + rand()*0.07)*W, ry = rx*(2.5 + rand()*4);
    const ang = rand()*Math.PI;
    const col = sky.clouds[Math.floor(rand()*sky.clouds.length)];
    tiled(ctx, H, y, yy => {
      ctx.save();
      ctx.translate(x, yy); ctx.rotate(ang);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgba(col, 0.10));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.scale(1, ry/rx);
      ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
      ctx.restore();
    });
  }
  ctx.globalCompositeOperation = "source-over";

  /* --- dust lanes --------------------------------------------------------
     Dark blobs carved back out of the glow. Without these a nebula is just a
     coloured smear; the silhouettes are what make it look photographed. */
  for(let i=0;i<Math.round(60*sky.density);i++){
    const x = rand()*W, y = rand()*H;
    const r = (0.04 + rand()*0.22)*W;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(sky.dust, 0.72 + rand()*0.24));
      g.addColorStop(0.6, rgba(sky.dust, 0.34));
      g.addColorStop(1, rgba(sky.dust, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  /* --- stars -------------------------------------------------------------
     Three grades: a dense field of specks, a middle grade with a halo, and a
     handful of suns with diffraction spikes. The spikes are what sell it -
     real astrophotography has them, and they cost four lines. */
  const small = Math.round(165 * sky.stars);
  for(let i=0;i<small;i++){
    const x = rand()*W, y = rand()*H;
    const s = 0.6 + rand()*1.5;
    ctx.globalAlpha = 0.25 + rand()*0.6;
    ctx.fillStyle = rand() < 0.16 ? sky.star : "#ffffff";
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;

  // A star is a hard point with a tight glow. The first pass used a wide pale
  // halo and every one of them read as a grey bubble.
  const mid = Math.round(22 * sky.stars);
  for(let i=0;i<mid;i++){
    const x = rand()*W, y = rand()*H, r = 0.9 + rand()*1.1;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r*4);
      g.addColorStop(0, rgba(sky.star, 0.45));
      g.addColorStop(1, rgba(sky.star, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r*4, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(x, yy, r*0.75, 0, TAU); ctx.fill();
    });
  }

  for(let i=0;i<sky.bright;i++){
    const x = rand()*W, y = rand()*H;
    const r = 1.6 + rand()*1.6, reach = r*(5 + rand()*4);
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, reach);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.10, rgba(sky.star, 0.42));
      g.addColorStop(1, rgba(sky.star, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, reach, 0, TAU); ctx.fill();
      // Four-point diffraction spikes.
      ctx.save();
      ctx.translate(x, yy);
      ctx.globalCompositeOperation = "lighter";
      [0, Math.PI/2].forEach(a => {
        ctx.save();
        ctx.rotate(a);
        const sg = ctx.createLinearGradient(-reach*1.5, 0, reach*1.5, 0);
        sg.addColorStop(0, rgba(sky.star, 0));
        sg.addColorStop(0.5, "rgba(255,255,255,0.7)");
        sg.addColorStop(1, rgba(sky.star, 0));
        ctx.fillStyle = sg;
        ctx.fillRect(-reach*1.5, -r*0.13, reach*3.0, r*0.26);
        ctx.restore();
      });
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    });
  }
  /* --- furniture ---------------------------------------------------------
     Drawn after the stars, because a planet is much nearer than they are.
     Props render at FULL alpha into the shared scratch layer, get pulled
     down in place (source-atop black keeps coverage, cuts brightness ~35%),
     then blit over the sky opaquely. The old way - 62% globalAlpha on the
     whole pass - kept scenery dim but let stars and nebula shine straight
     through solid bodies, and every planet read as a ghost hologram. Same
     dimness, real occlusion; scenery still never competes with bullets. */
  const props = sky.props || [];
  if(props.length){
    if(!propLayer) propLayer = document.createElement("canvas");
    if(propLayer.width !== cv.width) propLayer.width = cv.width;
    if(propLayer.height !== cv.height) propLayer.height = cv.height;
    const px = propLayer.getContext("2d");
    if(px){
      px.setTransform(dpr, 0, 0, dpr, 0, 0);       // reused canvas: reset, then logical coords
      px.clearRect(0, 0, W, H);
      // Planets light from the nearer nebula core (computed from the base
      // position, not per wrap copy, so the tiled copies match).
      const coreDir = (x, y) => {
        const c = (cores[0].x-x)*(cores[0].x-x) + (cores[0].y-y)*(cores[0].y-y) <=
                  (cores[1].x-x)*(cores[1].x-x) + (cores[1].y-y)*(cores[1].y-y) ? cores[0] : cores[1];
        const dx = c.x - x, dy = c.y - y, d = Math.hypot(dx, dy) || 1;
        return [dx/d, dy/d];
      };
      props.forEach(pr => {
        if(pr.k === "planet") drawPlanet(px, W, H, pr, rand, coreDir(pr.x*W, pr.y*H));
        else if(pr.k === "sun") drawSun(px, W, H, pr);
        else if(pr.k === "galaxy") drawGalaxy(px, W, H, pr, rand);
        else if(pr.k === "rocks") drawRocks(px, W, H, pr, rand);
        else if(pr.k === "devourer") drawDevourerSilhouette(px, W, H, pr);
      });
      px.globalCompositeOperation = "source-atop";
      px.fillStyle = "rgba(0,0,0,0.35)";
      px.fillRect(0, 0, W, H);
      px.globalCompositeOperation = "source-over";
      ctx.drawImage(propLayer, 0, 0, W, H);
    }
  }

  // No baked vignette: this texture tiles vertically, and baked-in dark
  // corners scrolled past as a seam band. The live screen-space vignette in
  // render.js does the job in the coordinate space a vignette belongs in.
  return cv;
}

/** Which asset a photo-backed mission uses, or null when it's generated. */
function photoFor(missionIndex){
  return (SKIES[missionIndex % SKIES.length] || {}).photo || null;
}

SF.skygen = { build, photoFor, SKIES };
})();
