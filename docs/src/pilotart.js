/*
 * Pilot portraits: a drawn face in a flight helmet, assembled from options the
 * kids pick themselves in the Armory's MY PILOT editor.
 *
 * Design rules learned the hard way:
 *  - No individual teeth. A mocked-up gap-tooth grin was reviewed by the
 *    customer as "so scary". Mouths are simple friendly shapes only.
 *  - The editor exists because likeness is THEIRS to define - the game ships
 *    sensible defaults and never guesses what a child looks like.
 *
 * Same architecture as insignia/enemy art: pure drawing from a plain config
 * object, rasterised once per (avatar, helmet colour, badge) and cached, so a
 * portrait costs one blit wherever it appears - picker, menu, comms, podium,
 * cockpit.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

/* ---------------------------------------------------------
   THE PARTS BOX
   Small, curated sets: enough to feel like "me", few enough
   that a seven-year-old can try every combination.
   --------------------------------------------------------- */
const SKINS = ["#ffe3cf","#f5c9a6","#e8b98f","#c98e63","#9c6b45","#6f4a2f"];
const HAIR_COLORS = ["#1d1b16","#3b2a1a","#6b4423","#b8863b","#d94f2a","#8a919e"];
const HAIR_STYLES = ["short","spiky","curly","long","buzz"];
const GLASSES = ["none","round","square"];
const GLASS_COLORS = ["#2f7fe0","#d84040","#2fae5e","#8a5fd0","#1d1b16","#f5f7fb"];
const SMILES = ["smile","grin","cool"];

const DEFAULT_AVATAR = {
  skin: 2, hairStyle: "short", hairColor: 1,
  glasses: "round", glassColor: 0, smile: "grin",
};

/** A complete avatar, filling gaps from the default (old saves, partial edits). */
function normalize(a){
  const out = Object.assign({}, DEFAULT_AVATAR, a || {});
  if(SKINS[out.skin] == null) out.skin = DEFAULT_AVATAR.skin;
  if(HAIR_COLORS[out.hairColor] == null) out.hairColor = DEFAULT_AVATAR.hairColor;
  if(!HAIR_STYLES.includes(out.hairStyle)) out.hairStyle = DEFAULT_AVATAR.hairStyle;
  if(!GLASSES.includes(out.glasses)) out.glasses = DEFAULT_AVATAR.glasses;
  if(GLASS_COLORS[out.glassColor] == null) out.glassColor = DEFAULT_AVATAR.glassColor;
  if(!SMILES.includes(out.smile)) out.smile = DEFAULT_AVATAR.smile;
  return out;
}

function shade(hex, k){
  const v = parseInt(String(hex).replace("#",""), 16);
  const c = [(v>>16)&255, (v>>8)&255, v&255];
  const t = k < 0 ? 0 : 255, a = Math.abs(k);
  return "rgb(" + c.map(n => Math.round(n + (t-n)*a)).join(",") + ")";
}

/* ---------------------------------------------------------
   DRAWING
   Head in a box of size S centred on the origin. Chibi
   proportions: big face, tiny features, everything readable
   at 32 pixels on a comms panel.
   --------------------------------------------------------- */
function draw(ctx, cx, cy, S, opts){
  const av = normalize(opts.avatar);
  const helmet = opts.color || "#3399ff";
  const skin = SKINS[av.skin];
  const hairC = HAIR_COLORS[av.hairColor];

  ctx.save();
  ctx.translate(cx, cy);

  // Helmet shell behind everything
  const hg = ctx.createLinearGradient(-S*0.5, -S*0.55, S*0.4, S*0.35);
  hg.addColorStop(0, shade(helmet, 0.5));
  hg.addColorStop(0.4, helmet);
  hg.addColorStop(1, shade(helmet, -0.45));
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(0, -S*0.02, S*0.485, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(12,16,30,0.55)";
  ctx.lineWidth = S*0.022;
  ctx.stroke();

  // The pilot's insignia, small, on the helmet's brow
  if(opts.badge && SF.insignia && SF.insignia.EMBLEMS[opts.badge]){
    ctx.save();
    ctx.translate(0, -S*0.33);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    try { SF.insignia.EMBLEMS[opts.badge](ctx, S*0.22); } catch(e){}
    ctx.restore();
  }

  // Face opening: skin inside the visor ring
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(0, S*0.10, S*0.335, 0, TAU); ctx.fill();
  // soft cheek shading
  ctx.fillStyle = "rgba(255,120,110,0.20)";
  [-1,1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.20, S*0.20, S*0.06, 0, TAU); ctx.fill(); });

  // Hair, tucked under the helmet rim
  ctx.fillStyle = hairC;
  if(av.hairStyle !== "buzz"){
    ctx.beginPath();
    ctx.arc(0, S*0.06, S*0.335, Math.PI*1.02, Math.PI*1.98);
    if(av.hairStyle === "spiky"){
      for(let i=0;i<5;i++){
        const x0 = -S*0.30 + i*S*0.15;
        ctx.lineTo(x0 + S*0.075, S*0.02 + (i%2 ? S*0.02 : -S*0.015));
        ctx.lineTo(x0 + S*0.15, -S*0.055);
      }
    } else if(av.hairStyle === "curly"){
      for(let i=0;i<4;i++){
        ctx.arc(-S*0.24 + i*S*0.16, -S*0.02, S*0.085, Math.PI*1.1, Math.PI*0.1, false);
      }
    } else if(av.hairStyle === "long"){
      ctx.quadraticCurveTo(S*0.36, S*0.16, S*0.30, S*0.34);
      ctx.lineTo(S*0.24, S*0.10);
      ctx.quadraticCurveTo(S*0.10, -S*0.06, -S*0.24, S*0.10);
      ctx.lineTo(-S*0.30, S*0.34);
      ctx.quadraticCurveTo(-S*0.36, S*0.16, -S*0.335, S*0.02);
    } else { // short: a simple fringe
      ctx.quadraticCurveTo(S*0.22, -S*0.10, 0, -S*0.075);
      ctx.quadraticCurveTo(-S*0.22, -S*0.10, -S*0.33, S*0.03);
    }
    ctx.closePath(); ctx.fill();
  } else {
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(0, S*0.06, S*0.33, Math.PI*1.1, Math.PI*1.9);
    ctx.arc(0, S*0.10, S*0.27, Math.PI*1.85, Math.PI*1.15, true);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Eyes: friendly dots with a highlight
  ctx.fillStyle = "#241f1a";
  [-1,1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.135, S*0.10, S*0.035, 0, TAU); ctx.fill(); });
  ctx.fillStyle = "#fff";
  [-1,1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.135 - S*0.012, S*0.088, S*0.012, 0, TAU); ctx.fill(); });

  // Glasses
  if(av.glasses !== "none"){
    const gc = GLASS_COLORS[av.glassColor];
    ctx.strokeStyle = gc;
    ctx.lineWidth = S*0.032;
    ctx.fillStyle = "rgba(210,235,255,0.14)";
    [-1,1].forEach(s => {
      ctx.beginPath();
      if(av.glasses === "round") ctx.arc(s*S*0.135, S*0.10, S*0.105, 0, TAU);
      else {
        const r = S*0.03;
        const x0 = s*S*0.135 - S*0.10, y0 = S*0.10 - S*0.085, w = S*0.20, h = S*0.17;
        ctx.moveTo(x0+r, y0);
        ctx.lineTo(x0+w-r, y0); ctx.quadraticCurveTo(x0+w, y0, x0+w, y0+r);
        ctx.lineTo(x0+w, y0+h-r); ctx.quadraticCurveTo(x0+w, y0+h, x0+w-r, y0+h);
        ctx.lineTo(x0+r, y0+h); ctx.quadraticCurveTo(x0, y0+h, x0, y0+h-r);
        ctx.lineTo(x0, y0+r); ctx.quadraticCurveTo(x0, y0, x0+r, y0);
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
    });
    ctx.beginPath(); ctx.moveTo(-S*0.035, S*0.085); ctx.lineTo(S*0.035, S*0.085); ctx.stroke();
  }

  // Mouth: friendly shapes only - no teeth, ever (see header).
  ctx.strokeStyle = shade(skin, -0.55);
  ctx.lineWidth = S*0.028;
  ctx.lineCap = "round";
  if(av.smile === "grin"){
    ctx.fillStyle = "#7c3a2d";
    ctx.beginPath();
    ctx.arc(0, S*0.205, S*0.115, Math.PI*0.12, Math.PI*0.88);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e58a7e";                    // little tongue, not teeth
    ctx.beginPath(); ctx.arc(0, S*0.29, S*0.05, Math.PI, TAU); ctx.fill();
  } else if(av.smile === "cool"){
    ctx.beginPath();
    ctx.moveTo(-S*0.07, S*0.245);
    ctx.quadraticCurveTo(S*0.02, S*0.285, S*0.10, S*0.235);
    ctx.stroke();
  } else { // smile
    ctx.beginPath();
    ctx.arc(0, S*0.185, S*0.11, Math.PI*0.2, Math.PI*0.8);
    ctx.stroke();
  }

  // Chin strap + visor hinge dots
  ctx.strokeStyle = "rgba(30,36,54,0.7)";
  ctx.lineWidth = S*0.026;
  ctx.beginPath(); ctx.arc(0, S*0.08, S*0.40, Math.PI*0.3, Math.PI*0.7); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  [-1,1].forEach(s => { ctx.beginPath(); ctx.arc(s*S*0.42, S*0.05, S*0.035, 0, TAU); ctx.fill(); });

  ctx.restore();
}

/* ---------------------------------------------------------
   CACHING + DOM MOUNTING (same pattern as insignia)
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   REALISTIC PORTRAITS (optional, image-first)
   Drop an illustrated headshot at assets/pilots/<name>.png
   (lowercase profile name) and it replaces the drawn avatar
   everywhere, circle-cropped in a ring of the pilot's ship
   colour - the style of the reference mock. No image, no
   error: the drawn editor avatar is the fallback.
   --------------------------------------------------------- */
const photos = {};   // name -> { img, ok, pending, waiters:[] }
function photoFor(name){
  if(!name) return null;
  const key = String(name).toLowerCase();
  let rec = photos[key];
  if(!rec){
    rec = photos[key] = { img: new Image(), ok: false, pending: true, waiters: [] };
    rec.img.onload = () => {
      // A load event with no pixels (broken file, jsdom) is not a portrait.
      rec.ok = (rec.img.naturalWidth || 0) > 0; rec.pending = false;
      rec.waiters.splice(0).forEach(fn => { try { fn(); } catch(e){} });
    };
    rec.img.onerror = () => { rec.ok = false; rec.pending = false; rec.waiters.length = 0; };
    rec.img.src = "assets/pilots/" + encodeURIComponent(key) + ".png";
  }
  return rec;
}

/**
 * The one entry point everything should use: paints this pilot's face -
 * the illustrated portrait if one is installed, the drawn avatar otherwise -
 * centred on (cx, cy) in a box of size S.
 */
function paint(ctx, cx, cy, S, profile){
  const rec = photoFor(profile && profile.name);
  if(rec && rec.ok){
    const r = S*0.48;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    const iw = rec.img.naturalWidth || 1, ih = rec.img.naturalHeight || 1;
    const cover = (r*2) / Math.min(iw, ih);
    ctx.drawImage(rec.img, cx - iw*cover/2, cy - ih*cover/2, iw*cover, ih*cover);
    ctx.restore();
    ctx.strokeStyle = (profile && profile.shipColor) || "#3399ff";
    ctx.lineWidth = Math.max(2, S*0.045);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    return;
  }
  draw(ctx, cx, cy, S, {
    avatar: profile && profile.avatar,
    color: (profile && profile.shipColor) || "#3399ff",
    badge: SF.profile ? SF.profile.badgeFor(profile) : null,
  });
}

const cache = {};
function spriteFor(avatar, color, badge){
  const av = normalize(avatar);
  const key = JSON.stringify(av) + "|" + color + "|" + (badge || "");
  if(cache[key]) return cache[key];
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d");
  if(!c) return null;
  draw(c, 64, 66, 118, { avatar: av, color, badge });
  cache[key] = cv;
  return cv;
}

/** Paints a pilot's face into an element, replacing whatever was there. */
function mount(el, profile, px){
  if(!el || !profile) return;
  el.innerHTML = "";
  const cv = document.createElement("canvas");
  const size = px || 40;
  cv.width = cv.height = size*2;
  cv.style.width = cv.style.height = size + "px";
  el.appendChild(cv);
  const c = cv.getContext("2d");
  if(!c) return;
  const render = () => { c.clearRect(0,0,size*2,size*2); paint(c, size, size, size*1.9, profile); };
  render();
  // If an illustrated portrait is still loading, repaint this element the
  // moment it lands - mounts happen at render time, images at their leisure.
  const rec = photoFor(profile.name);
  if(rec && rec.pending) rec.waiters.push(render);
}

SF.pilotart = {
  draw, paint, spriteFor, mount, normalize, photoFor,
  SKINS, HAIR_COLORS, HAIR_STYLES, GLASSES, GLASS_COLORS, SMILES, DEFAULT_AVATAR,
};
})();
