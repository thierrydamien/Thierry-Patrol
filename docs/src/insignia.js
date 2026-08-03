/*
 * Squadron insignia - drawn patches, not emoji.
 *
 * Pilots used to pick from a row of emoji (🦈 🍕 🦄). They render differently
 * on every device, they sit at whatever baseline the font feels like, and next
 * to hand-drawn ships and a drawn campaign map they looked like clip art. These
 * are proper patches instead: a metal ring, a coloured field in the pilot's own
 * ship colour, and a white emblem.
 *
 * Same approach as the enemy art - each (design, colour) pair is rasterised
 * once into an offscreen canvas and cached, so drawing one is a single blit.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;
const RES = 128;

function hexToRgb(hex){
  const v = parseInt(String(hex).replace("#",""), 16);
  return [(v>>16)&255, (v>>8)&255, v&255];
}
function shade(hex, k){
  const c = hexToRgb(hex), t = k < 0 ? 0 : 255, a = Math.abs(k);
  return "rgb(" + c.map(v => Math.round(v + (t - v)*a)).join(",") + ")";
}

/* ---------------------------------------------------------
   EMBLEMS
   Each draws a white mark inside a box of size S centred on
   the origin. Kept to simple bold shapes: a patch is read at
   24 pixels on a pilot card, not admired at 128.
   --------------------------------------------------------- */
function star(ctx, S, points, inner){
  ctx.beginPath();
  for(let i=0;i<points*2;i++){
    const r = (i%2 ? S*inner : S*0.42);
    const a = -Math.PI/2 + i*Math.PI/points;
    const x = Math.cos(a)*r, y = Math.sin(a)*r;
    if(i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath(); ctx.fill();
}

const EMBLEMS = {
  star(ctx, S){ star(ctx, S, 5, 0.17); },

  chevrons(ctx, S){
    ctx.lineWidth = S*0.11; ctx.lineCap = "round"; ctx.lineJoin = "round";
    [-0.20, 0.02, 0.24].forEach(o => {
      ctx.beginPath();
      ctx.moveTo(-S*0.26, o*S + S*0.10);
      ctx.lineTo(0, o*S - S*0.10);
      ctx.lineTo(S*0.26, o*S + S*0.10);
      ctx.stroke();
    });
  },

  wings(ctx, S){
    [-1,1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s*S*0.09, -S*0.06);
      ctx.quadraticCurveTo(s*S*0.30, -S*0.16, s*S*0.44, S*0.02);
      ctx.quadraticCurveTo(s*S*0.28, -S*0.02, s*S*0.10, S*0.09);
      ctx.closePath(); ctx.fill();
    });
    ctx.beginPath();
    ctx.moveTo(0, -S*0.24); ctx.lineTo(S*0.09, 0);
    ctx.lineTo(0, S*0.24); ctx.lineTo(-S*0.09, 0);
    ctx.closePath(); ctx.fill();
  },

  bolt(ctx, S){
    ctx.beginPath();
    ctx.moveTo(S*0.10, -S*0.40); ctx.lineTo(-S*0.26, S*0.06);
    ctx.lineTo(-S*0.02, S*0.06); ctx.lineTo(-S*0.12, S*0.40);
    ctx.lineTo(S*0.26, -S*0.08); ctx.lineTo(S*0.02, -S*0.08);
    ctx.closePath(); ctx.fill();
  },

  comet(ctx, S){
    ctx.beginPath(); ctx.arc(S*0.16, -S*0.10, S*0.16, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(S*0.06, -S*0.24); ctx.lineTo(-S*0.40, S*0.30);
    ctx.lineTo(S*0.08, S*0.02);
    ctx.closePath(); ctx.fill();
  },

  trident(ctx, S){
    ctx.lineWidth = S*0.10; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, -S*0.34); ctx.lineTo(0, S*0.38); ctx.stroke();
    [-1,1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s*S*0.28, -S*0.30); ctx.lineTo(s*S*0.28, S*0.02);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(-S*0.30, S*0.02); ctx.lineTo(S*0.30, S*0.02); ctx.stroke();
  },

  orbit(ctx, S){
    ctx.beginPath(); ctx.arc(0, 0, S*0.15, 0, TAU); ctx.fill();
    ctx.lineWidth = S*0.07;
    ctx.save(); ctx.rotate(-0.5); ctx.scale(1, 0.42);
    ctx.beginPath(); ctx.arc(0, 0, S*0.40, 0, TAU); ctx.stroke();
    ctx.restore();
  },

  flame(ctx, S){
    ctx.beginPath();
    ctx.moveTo(0, -S*0.40);
    ctx.quadraticCurveTo(S*0.34, -S*0.02, S*0.16, S*0.22);
    ctx.quadraticCurveTo(S*0.06, S*0.40, -S*0.14, S*0.28);
    ctx.quadraticCurveTo(-S*0.34, S*0.10, -S*0.10, -S*0.14);
    ctx.quadraticCurveTo(-S*0.06, S*0.02, S*0.02, -S*0.06);
    ctx.closePath(); ctx.fill();
  },

  crown(ctx, S){
    ctx.beginPath();
    ctx.moveTo(-S*0.36, S*0.22); ctx.lineTo(-S*0.30, -S*0.24);
    ctx.lineTo(-S*0.12, S*0.00); ctx.lineTo(0, -S*0.34);
    ctx.lineTo(S*0.12, S*0.00); ctx.lineTo(S*0.30, -S*0.24);
    ctx.lineTo(S*0.36, S*0.22);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(-S*0.36, S*0.26, S*0.72, S*0.11);
  },

  target(ctx, S){
    ctx.lineWidth = S*0.08;
    [0.36, 0.20].forEach(r => { ctx.beginPath(); ctx.arc(0,0,S*r,0,TAU); ctx.stroke(); });
    ctx.beginPath(); ctx.arc(0,0,S*0.07,0,TAU); ctx.fill();
  },

  crescent(ctx, S){
    ctx.beginPath(); ctx.arc(0, 0, S*0.38, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(S*0.18, -S*0.10, S*0.32, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  },

  arrowhead(ctx, S){
    ctx.beginPath();
    ctx.moveTo(0, -S*0.40); ctx.lineTo(S*0.34, S*0.26);
    ctx.lineTo(0, S*0.08); ctx.lineTo(-S*0.34, S*0.26);
    ctx.closePath(); ctx.fill();
  },

  hex(ctx, S){
    ctx.lineWidth = S*0.09;
    [0.38, 0.20].forEach((r, i) => {
      ctx.beginPath();
      for(let n=0;n<6;n++){
        const a = n/6*TAU - Math.PI/2;
        const x = Math.cos(a)*S*r, y = Math.sin(a)*S*r;
        if(n === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath();
      if(i === 0) ctx.stroke(); else ctx.fill();
    });
  },

  sixstar(ctx, S){ star(ctx, S, 6, 0.20); },
};

/** The pickable set, in the order the Armory shows them. */
const DESIGNS = ["star","chevrons","wings","bolt","comet","trident",
                 "orbit","flame","crown","target","crescent","arrowhead",
                 "hex","sixstar"];

/* ---------------------------------------------------------
   THE PATCH
   --------------------------------------------------------- */
const cache = {};
function spriteFor(design, colour){
  const id = EMBLEMS[design] ? design : "star";
  const col = colour || "#f5a623";
  const key = id + "|" + col;
  if(cache[key]) return cache[key];

  const cv = document.createElement("canvas");
  cv.width = cv.height = RES;
  const ctx = cv.getContext("2d");
  if(!ctx) return null;
  const S = RES, r = S*0.46;
  ctx.translate(S/2, S/2);

  // Metal rim
  const rim = ctx.createLinearGradient(-r, -r, r, r);
  rim.addColorStop(0, "#e8edf6");
  rim.addColorStop(0.45, "#8a94a8");
  rim.addColorStop(1, "#4a5262");
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

  // Coloured field, lit from the top left like everything else in the game
  const field = ctx.createRadialGradient(-r*0.35, -r*0.4, r*0.05, 0, 0, r*0.88);
  field.addColorStop(0, shade(col, 0.45));
  field.addColorStop(0.6, col);
  field.addColorStop(1, shade(col, -0.55));
  ctx.fillStyle = field;
  ctx.beginPath(); ctx.arc(0, 0, r*0.86, 0, TAU); ctx.fill();

  ctx.strokeStyle = "rgba(10,12,20,0.45)";
  ctx.lineWidth = S*0.012;
  ctx.beginPath(); ctx.arc(0, 0, r*0.86, 0, TAU); ctx.stroke();

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = S*0.05;
  ctx.shadowOffsetY = S*0.012;
  EMBLEMS[id](ctx, S*0.82);
  ctx.restore();

  cache[key] = cv;
  return cv;
}

/** Paints a patch into an element, replacing whatever was there. */
function mount(el, design, colour, px){
  if(!el) return;
  el.innerHTML = "";
  const cv = document.createElement("canvas");
  const size = px || 32;
  cv.width = cv.height = size * 2;      // 2x for retina
  cv.style.width = cv.style.height = size + "px";
  el.appendChild(cv);
  const ctx = cv.getContext("2d");
  const sprite = spriteFor(design, colour);
  if(ctx && sprite) ctx.drawImage(sprite, 0, 0, size*2, size*2);
}

/** Inline markup for the places that build HTML strings. */
function dataUrl(design, colour){
  const sprite = spriteFor(design, colour);
  try { return sprite ? sprite.toDataURL() : ""; } catch(e){ return ""; }
}

SF.insignia = { DESIGNS, EMBLEMS, spriteFor, mount, dataUrl };
})();
