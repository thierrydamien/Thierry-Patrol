/*
 * Renderer. Owns the canvas, the sprite atlas and every draw call; owns no
 * gameplay state. Gameplay never touches ctx, rendering never mutates the
 * world - which is what makes the game testable headlessly.
 *
 * Layers, back to front: nebula (slow pan) -> star fields (parallax) ->
 * pickups -> enemies -> boss -> bullets -> player -> particles -> floating
 * text -> HUD -> full-screen flashes.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, rand, TAU, easeOutCubic } = SF.core;
const { VW, VH, BULLET_TIERS } = SF.entityConst;

/* ---------------------------------------------------------
   ASSETS
   --------------------------------------------------------- */
const ASSET_PATHS = {
  ship: "assets/orange.png",
  enemy: "assets/red.png",
  bulletImg: "assets/bullet.png",
  playfieldBg: "assets/BackNew.jpg",
};
const assets = {};
let assetsReady = false;

function loadAssets(cb){
  const keys = Object.keys(ASSET_PATHS);
  let remaining = keys.length, ok = true;
  keys.forEach(key => {
    const img = new Image();
    img.onload = () => { if(--remaining === 0){ assetsReady = ok; cb(); } };
    img.onerror = () => { ok = false; if(--remaining === 0){ assetsReady = ok; cb(); } };
    img.src = ASSET_PATHS[key];
    assets[key] = img;
  });
}

/* ---- hue-preserving sprite tinting, cached per colour ---- */
function hexToRgb(hex){ const v = parseInt(hex.replace("#",""), 16); return { r:(v>>16)&255, g:(v>>8)&255, b:v&255 }; }
function rgbToHsb(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d!==0){
    if(max===r) h=((g-b)/d)%6; else if(max===g) h=(b-r)/d+2; else h=(r-g)/d+4;
    h*=60; if(h<0) h+=360;
  }
  return { h, s: max===0?0:d/max, v:max };
}
function hsbToRgb(h,s,v){
  const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r,g,b;
  if(h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;} else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;} else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return { r:Math.round((r+m)*255), g:Math.round((g+m)*255), b:Math.round((b+m)*255) };
}

let pixelsReadable = null;
function canReadPixels(){
  if(pixelsReadable !== null) return pixelsReadable;
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 2;
    const pctx = probe.getContext("2d");
    pctx.drawImage(assets.ship, 0, 0, 2, 2);
    pctx.getImageData(0, 0, 1, 1);
    pixelsReadable = true;
  } catch(e){ pixelsReadable = false; }
  return pixelsReadable;
}

const tintCache = {};
/** Recolours a sprite to a target hue while keeping its shading. */
function tinted(img, hex){
  const key = (img === assets.ship ? "s" : "e") + hex;
  if(tintCache[key]) return tintCache[key];
  if(!canReadPixels()) return img; // file:// tainting - just use the raw art
  const off = document.createElement("canvas");
  off.width = img.naturalWidth || 64; off.height = img.naturalHeight || 64;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, 0);
  const data = octx.getImageData(0, 0, off.width, off.height);
  const px = data.data;
  const target = rgbToHsb(hexToRgb(hex).r, hexToRgb(hex).g, hexToRgb(hex).b);
  for(let i=0;i<px.length;i+=4){
    if(px[i+3] === 0) continue;
    const hsb = rgbToHsb(px[i], px[i+1], px[i+2]);
    const rgb = hsbToRgb(target.h, hsb.s, hsb.v);
    px[i]=rgb.r; px[i+1]=rgb.g; px[i+2]=rgb.b;
  }
  octx.putImageData(data, 0, 0);
  tintCache[key] = off;
  return off;
}

/* ---------------------------------------------------------
   BACKGROUND
   The nebula is drawn oversized and drifted inside that margin
   (a slow camera pan) so it never shows a wrap seam, and three
   star layers scroll over it at different speeds. Everything
   speeds up with the mission number.
   --------------------------------------------------------- */
const BG_ZOOM = 1.16;
let bgPhase = 0, stars = [], comets = [], cometTimer = 5, warp = 1;

function initBackground(missionIndex){
  stars = [];
  // Star counts are per-area, not per-layer-constant: the playfield is 2.5x
  // the area it used to be, so a fixed count would read as empty space.
  const density = (VW*VH) / (390*620);
  [{n:46,s:18,size:1.1,a:0.45},{n:26,s:44,size:1.7,a:0.65},{n:14,s:88,size:2.6,a:0.9}]
    .forEach((L, li) => {
      const count = Math.round(L.n * density);
      for(let i=0;i<count;i++){
        stars.push({ x: rand(0,VW), y: rand(0,VH), speed:L.s, size:L.size, alpha:L.a,
                     layer:li, twinkle: rand(0,TAU) });
      }
    });
  comets = [];
  cometTimer = rand(3, 9);
  bgPhase = rand(0, TAU);
  warp = Math.min(1 + (missionIndex||0)*0.1, 2.0);
}

function updateBackground(dt){
  bgPhase += dt*0.08*warp;
  for(let i=0;i<stars.length;i++){
    const s = stars[i];
    s.y += s.speed*warp*dt;
    s.twinkle += dt*2.5;
    if(s.y > VH){ s.y -= VH; s.x = rand(0, VW); }
  }
  cometTimer -= dt;
  if(cometTimer <= 0){
    const fromLeft = Math.random() < 0.5;
    comets.push({ x: fromLeft ? -20 : VW+20, y: rand(0, VH*0.5),
                  vx: (fromLeft?1:-1)*rand(150,270), vy: rand(90,160), life:0, max:2.4 });
    cometTimer = rand(7, 16);
  }
  for(let i=comets.length-1;i>=0;i--){
    const c = comets[i];
    c.x += c.vx*dt; c.y += c.vy*dt; c.life += dt;
    if(c.life >= c.max) comets.splice(i,1);
  }
}

function drawBackground(ctx){
  if(assetsReady){
    // Cover-fit, not stretch: the nebula art is 4:5 and the field is 3:4, so
    // scaling each axis independently would visibly squash it. Scale by
    // whichever axis needs more, then drift inside the overflow.
    const img = assets.playfieldBg;
    const iw = img.naturalWidth || img.width || 400;
    const ih = img.naturalHeight || img.height || 500;
    const cover = Math.max(VW/iw, VH/ih) * BG_ZOOM;
    const dw = iw*cover, dh = ih*cover;
    const mx = (dw - VW)/2, my = (dh - VH)/2;
    ctx.drawImage(img,
      -mx + Math.sin(bgPhase)*mx*0.9,
      -my + Math.sin(bgPhase*0.63)*my*0.9,
      dw, dh);
  } else {
    ctx.fillStyle = "#05040f"; ctx.fillRect(0,0,VW,VH);
  }
  for(let i=0;i<stars.length;i++){
    const s = stars[i];
    ctx.globalAlpha = s.alpha * (0.75 + Math.sin(s.twinkle)*0.25);
    ctx.fillStyle = s.layer===2 ? "#cfe8ff" : "#ffffff";
    ctx.fillRect(s.x, s.y, s.size, s.size + (s.layer===2?2:0));
  }
  ctx.globalAlpha = 1;
  for(let i=0;i<comets.length;i++){
    const c = comets[i];
    const fade = 1 - c.life/c.max, l = Math.hypot(c.vx,c.vy);
    const nx = c.vx/l, ny = c.vy/l;
    const g = ctx.createLinearGradient(c.x, c.y, c.x-nx*28, c.y-ny*28);
    g.addColorStop(0, "rgba(255,255,255," + (0.85*fade) + ")");
    g.addColorStop(1, "rgba(120,180,255,0)");
    ctx.strokeStyle = g; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(c.x-nx*28, c.y-ny*28); ctx.stroke();
  }
}

/* ---------------------------------------------------------
   ENTITIES
   --------------------------------------------------------- */
function drawPlayer(ctx, p, timeMs){
  if(!p || !p.alive) return;
  if(p.invuln > 0 && Math.floor(p.invuln*12)%2 === 0) return; // blink while recovering

  const sprite = assetsReady ? tinted(assets.ship, p.color) : null;
  const size = 58;
  const y = p.y + p.recoil;

  for(let i=0;i<p.trail.length;i++){
    const t = p.trail[i];
    const a = 1 - t.life/0.3;
    ctx.globalAlpha = a*0.35;
    ctx.fillStyle = p.color;
    ctx.fillRect(t.x-2.5, t.y, 5, 11*a);
  }
  ctx.globalAlpha = 1;

  // Wingmen are the household's other pilots: their ship, their colour, their
  // name under it. Seeing "CHARLIE" flying off your wing is the whole point.
  for(let i=0;i<p.drones;i++){
    const mate = p.crew[i];
    const dx = i===0 ? -52 : 52, ds = size*0.58;
    const droneSprite = assetsReady ? tinted(assets.ship, mate ? mate.color : p.color) : null;
    ctx.save();
    ctx.translate(p.x+dx, y+6);
    ctx.rotate(p.bank*0.5);
    if(droneSprite) ctx.drawImage(droneSprite, -ds/2, -ds/2, ds, ds);
    else { ctx.fillStyle = mate ? mate.color : p.color; ctx.beginPath(); ctx.arc(0,0,ds/2,0,TAU); ctx.fill(); }
    ctx.restore();
    if(mate){
      ctx.save();
      ctx.font = "bold 10px Arial, sans-serif";
      ctx.textAlign = "center";
      // Outlined so the name stays readable against a busy background.
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(mate.callsign.toUpperCase(), p.x+dx, y+6+ds*0.95);
      ctx.fillStyle = mate.color;
      ctx.fillText(mate.callsign.toUpperCase(), p.x+dx, y+6+ds*0.95);
      ctx.restore();
      ctx.textAlign = "left";
    }
  }

  ctx.save();
  ctx.translate(p.x, y);
  ctx.rotate(p.bank);
  if(timeMs < p.overdriveUntil){                 // overdrive aura
    ctx.globalAlpha = 0.5 + Math.sin(timeMs/60)*0.2;
    ctx.fillStyle = "#ff8a3d";
    ctx.beginPath(); ctx.arc(0, 0, size*0.62, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if(sprite) ctx.drawImage(sprite, -size/2, -size/2, size, size);
  else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0,0,size/2,0,TAU); ctx.fill(); }
  ctx.restore();

  for(let i=0;i<p.shield;i++){
    ctx.strokeStyle = "rgba(120,200,255," + (0.75 - i*0.14) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, y, size*0.68 + i*4, 0, TAU); ctx.stroke();
  }
}

function drawEnemies(ctx, world){
  const items = world.enemies.items;
  for(let i=0;i<items.length;i++){
    const e = items[i];
    if(!e.alive) continue;
    const size = e.size * (0.4 + 0.6*easeOutCubic(e.spawnAnim));
    ctx.save();
    ctx.translate(e.x, e.y);
    if(e.elite){
      ctx.shadowColor = "#ffd23f";
      ctx.shadowBlur = 14;
    }
    ctx.rotate(Math.PI); // art faces up; enemies fly down
    const img = assetsReady
      ? (e.type.tint ? tinted(assets.enemy, e.type.tint) : assets.enemy)
      : null;
    if(img) ctx.drawImage(img, -size/2, -size/2, size, size);
    else { ctx.fillStyle = e.type.tint || "#c0392b"; ctx.beginPath(); ctx.arc(0,0,size/2,0,TAU); ctx.fill(); }
    ctx.restore();

    if(e.flash > 0){                              // white hit flash
      ctx.save();
      ctx.globalAlpha = clamp(e.flash, 0, 1) * 0.75;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(e.x, e.y, size*0.42, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if(e.carriesRescue){                          // marker so you know what to shoot
      ctx.fillStyle = "#ffd23f";
      ctx.font = "bold 13px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SOS", e.x, e.y - e.r - 8);
      ctx.textAlign = "left";
    }
    if(e.maxHp > 1 && e.hp < e.maxHp){            // health pip for armoured enemies
      const w = size*0.8, pct = clamp(e.hp/e.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.x-w/2, e.y-size/2-7, w, 3);
      ctx.fillStyle = e.elite ? "#ffd23f" : "#ff6b6b";
      ctx.fillRect(e.x-w/2, e.y-size/2-7, w*pct, 3);
    }
  }
}

function drawBullets(ctx, world){
  const items = world.bullets.items;
  for(let i=0;i<items.length;i++){
    const b = items[i];
    if(!b.alive) continue;
    const t = BULLET_TIERS[b.tier] || BULLET_TIERS[0];
    ctx.save();
    if(t.glow){ ctx.shadowColor = t.color; ctx.shadowBlur = t.glow; }
    ctx.fillStyle = t.color;
    const w = t.w * (b.fromDrone ? 0.7 : 1), h = t.h * (b.fromDrone ? 0.7 : 1);
    ctx.fillRect(b.x - w/2, b.y - h/2, w, h);
    ctx.restore();
  }

  const ebs = world.enemyBullets.items;
  ctx.save();
  for(let i=0;i<ebs.length;i++){
    const b = ebs[i];
    if(!b.alive) continue;
    if(b.kind === "orb"){
      ctx.shadowColor = "#ff7ce5"; ctx.shadowBlur = 8;
      ctx.fillStyle = "#ff7ce5";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    } else if(b.kind === "aimed"){
      ctx.shadowColor = "#ff5d73"; ctx.shadowBlur = 6;
      ctx.fillStyle = "#ffd0d6";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    } else {
      ctx.shadowColor = "#ff5d73"; ctx.shadowBlur = 5;
      ctx.fillStyle = "#ff5d73";
      ctx.fillRect(b.x-b.r*0.6, b.y-b.r, b.r*1.2, b.r*2);
    }
  }
  ctx.restore();
}

function drawPickups(ctx, world, timeMs){
  const items = world.pickups.items;
  for(let i=0;i<items.length;i++){
    const it = items[i];
    if(!it.alive) continue;
    ctx.save();
    ctx.translate(it.x, it.y);
    if(it.kind === "coin"){
      const squash = Math.abs(Math.cos(it.angle));
      ctx.fillStyle = "#ffd23f";
      ctx.strokeStyle = "#a8760a"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, 9*Math.max(0.25,squash), 9, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
    } else if(it.kind === "rescue"){
      const bob = Math.sin(timeMs/220)*2;
      ctx.fillStyle = "rgba(255,210,63,0.25)";
      ctx.beginPath(); ctx.arc(0, bob, 22, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath(); ctx.arc(0, bob, 13, 0, TAU); ctx.fill();
      ctx.fillStyle = "#241a00";
      ctx.font = "bold 11px Arial, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🧑", 0, bob+1);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    } else {
      const def = it.data;
      ctx.rotate(it.angle);
      ctx.fillStyle = def.color;
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0,0,15,0,TAU); ctx.fill(); ctx.stroke();
      ctx.rotate(-it.angle);
      ctx.fillStyle = "#0a0920";
      ctx.font = "bold 11px Arial, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.glyph, 0, 1);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }
}

/* ---------------------------------------------------------
   BOSS
   Damage is composited onto the sprite itself: scorch marks
   burned in with source-atop, and chunks erased from the
   silhouette with destination-out once it's badly hurt.
   --------------------------------------------------------- */
const bossBuf = document.createElement("canvas");
bossBuf.width = bossBuf.height = 220;
const bossBufCtx = bossBuf.getContext("2d");

function drawBoss(ctx, boss, timeMs){
  if(!boss || !boss.alive) return;
  const pct = clamp(boss.hp/boss.maxHp, 0, 1);
  const damage = 1 - pct;
  const bx = boss.x + (boss.wobble ? rand(-boss.wobble, boss.wobble) : 0);
  const by = boss.y + (boss.wobble ? rand(-boss.wobble, boss.wobble) : 0);
  const size = boss.size;

  // Telegraphs first, underneath the boss, so they never obscure it.
  drawTelegraph(ctx, boss, timeMs);
  drawBeam(ctx, boss);

  if(assetsReady){
    const B = bossBufCtx;
    B.setTransform(1,0,0,1,0,0);
    B.clearRect(0,0,220,220);
    B.save();
    B.translate(110,110);
    B.rotate(Math.PI);
    B.drawImage(tinted(assets.enemy, boss.tint), -size/2, -size/2, size, size);
    B.restore();

    const scorched = Math.min(boss.wounds.length, Math.floor(damage*12));
    B.save();
    B.globalCompositeOperation = "source-atop";
    for(let i=0;i<scorched;i++){
      const w = boss.wounds[i];
      const g = B.createRadialGradient(110+w.x, 110+w.y, 1, 110+w.x, 110+w.y, w.r);
      g.addColorStop(0, "rgba(18,8,8,0.95)");
      g.addColorStop(1, "rgba(40,20,20,0)");
      B.fillStyle = g;
      B.beginPath(); B.arc(110+w.x, 110+w.y, w.r, 0, TAU); B.fill();
    }
    B.restore();

    if(damage > 0.5){
      const broken = Math.floor((damage-0.5)*2*boss.wounds.length);
      B.save();
      B.globalCompositeOperation = "destination-out";
      for(let i=0;i<broken;i++){
        const w = boss.wounds[boss.wounds.length-1-i];
        B.beginPath(); B.arc(110+w.x, 110+w.y, w.r*0.72, 0, TAU); B.fill();
      }
      B.restore();
      B.save();
      B.globalCompositeOperation = "source-atop";
      B.strokeStyle = "rgba(255,150,40,0.9)"; B.lineWidth = 2;
      for(let i=0;i<broken;i++){
        const w = boss.wounds[boss.wounds.length-1-i];
        B.beginPath(); B.arc(110+w.x, 110+w.y, w.r*0.76, 0, TAU); B.stroke();
      }
      B.restore();
    }

    if(boss.flash > 0){
      B.save();
      B.globalCompositeOperation = "source-atop";
      B.fillStyle = "rgba(255,255,255," + Math.min(0.5, boss.flash) + ")";
      B.fillRect(0,0,220,220);
      B.restore();
    }
    ctx.drawImage(bossBuf, bx-110, by-110);
  } else {
    ctx.fillStyle = boss.tint;
    ctx.beginPath(); ctx.arc(bx, by, size*0.42*(0.7+0.3*pct), 0, TAU); ctx.fill();
  }

  // Weak points: bright while alive, smoking craters once blown off.
  boss.weakPoints.forEach(wp => {
    const wx = bx + wp.ox, wy = by + wp.oy;
    if(wp.destroyed){
      ctx.fillStyle = "rgba(20,10,10,0.85)";
      ctx.beginPath(); ctx.arc(wx, wy, wp.r*0.8, 0, TAU); ctx.fill();
      return;
    }
    const pulse = 0.55 + Math.sin(timeMs/180)*0.2;
    ctx.save();
    ctx.globalAlpha = wp.flash > 0 ? 1 : pulse;
    ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(wx, wy, wp.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = wp.flash > 0 ? "rgba(255,255,255,0.85)" : "rgba(255,210,63,0.28)";
    ctx.beginPath(); ctx.arc(wx, wy, wp.r*0.72, 0, TAU); ctx.fill();
    ctx.restore();
    const hpPct = clamp(wp.hp/wp.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(wx-wp.r, wy+wp.r+2, wp.r*2, 2.5);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(wx-wp.r, wy+wp.r+2, wp.r*2*hpPct, 2.5);
  });
}

/** Wind-up cues. Each attack reads differently on sight. */
function drawTelegraph(ctx, boss, timeMs){
  const t = boss.telegraph;
  if(!t) return;
  const k = 1 - t.timer/t.max;              // 0 -> 1 as it charges
  ctx.save();
  if(t.kind === "beam"){
    ctx.globalAlpha = 0.25 + k*0.45;
    ctx.fillStyle = "#ff5d73";
    ctx.fillRect(boss.x-25, boss.y, 50, VH);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(boss.x, boss.y); ctx.lineTo(boss.x, VH); ctx.stroke();
  } else if(t.kind === "lock"){
    const p = SF.game.world.player;
    if(p){
      ctx.globalAlpha = 0.5 + Math.sin(timeMs/50)*0.3;
      ctx.strokeStyle = "#ff5d73"; ctx.lineWidth = 2;
      const r = 38 - k*18;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x-r-6, p.y); ctx.lineTo(p.x-r+4, p.y);
      ctx.moveTo(p.x+r-4, p.y); ctx.lineTo(p.x+r+6, p.y); ctx.stroke();
    }
  } else if(t.kind === "charge"){
    ctx.globalAlpha = 0.5 + k*0.5;
    ctx.strokeStyle = "#ff7ce5"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(boss.x, boss.y, 26 + k*95, 0, TAU); ctx.stroke();
  } else if(t.kind === "hatch"){
    ctx.globalAlpha = 0.4 + k*0.5;
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(boss.x-42, boss.y+boss.r*0.4, 84, 8);
  } else {
    ctx.globalAlpha = 0.35 + k*0.5;
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath(); ctx.arc(boss.x, boss.y + boss.r*0.5, 8 + k*14, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawBeam(ctx, boss){
  if(!boss.beam) return;
  const warmup = boss.beam.timer > 1.2;
  ctx.save();
  ctx.globalAlpha = warmup ? 0.35 : 0.9;
  const g = ctx.createLinearGradient(boss.beam.x-boss.beam.width/2, 0, boss.beam.x+boss.beam.width/2, 0);
  g.addColorStop(0, "rgba(255,93,115,0)");
  g.addColorStop(0.5, warmup ? "rgba(255,93,115,0.6)" : "rgba(255,255,255,0.95)");
  g.addColorStop(1, "rgba(255,93,115,0)");
  ctx.fillStyle = g;
  ctx.fillRect(boss.beam.x - boss.beam.width/2, boss.y, boss.beam.width, VH);
  ctx.restore();
}

/* ---------------------------------------------------------
   HUD
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   COMMS PANEL
   Bottom-left, out of the way of the specials buttons on the
   right. The portrait is the speaker's *actual* ship - so when
   your brother says something, the ship in the panel is the
   one he's been building.
   --------------------------------------------------------- */
function drawComms(ctx){
  const msg = SF.comms && SF.comms.current();
  if(!msg) return;

  const PAD = Math.round(VW*0.03);
  const W = Math.min(VW - PAD*2 - 76, 330), H = 62;
  const inT = Math.min(1, msg.life/0.22);
  const outT = Math.min(1, Math.max(0, (msg.max - msg.life)/0.28));
  const slide = (1 - easeOutCubic(inT)) * -(W + PAD);
  // High enough to clear the ship and its wingmen at the bottom of the field.
  const x = PAD + slide, y = VH - 225;

  ctx.save();
  ctx.globalAlpha = outT;

  ctx.fillStyle = "rgba(6,10,24,0.82)";
  ctx.strokeStyle = msg.color;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, W, H, 12);
  ctx.fill(); ctx.stroke();
  // A speaker tab so it reads as someone talking, not a system message.
  ctx.fillStyle = msg.color;
  ctx.fillRect(x, y, 3, H);

  ctx.save();
  ctx.beginPath(); ctx.arc(x + 30, y + H/2, 22, 0, TAU); ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x + 8, y + 9, 44, 44);
  SF.shipart.drawShip(ctx, x + 30, y + H/2 + 2, 42,
    { color: msg.shipColor, levels: msg.levels, t: msg.life, idle: false });
  ctx.restore();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = msg.color;
  ctx.font = "bold 10px Arial, sans-serif";
  ctx.fillText(msg.speaker.toUpperCase(), x + 60, y + 11);
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "13px Arial, sans-serif";
  wrapText(ctx, msg.text, x + 60, y + 27, W - 72, 15, 2);
  ctx.restore();
}

/** Draws at most `maxLines` lines of wrapped text, ellipsising the overflow. */
function wrapText(ctx, text, x, y, maxW, lineH, maxLines){
  const words = String(text).split(" ");
  let line = "", n = 0;
  for(let i=0;i<words.length;i++){
    const test = line ? line + " " + words[i] : words[i];
    if(ctx.measureText(test).width > maxW && line){
      ctx.fillText(line, x, y + n*lineH);
      n++; line = words[i];
      if(n === maxLines - 1 && i < words.length - 1){
        let rest = words.slice(i).join(" ");
        while(rest.length > 3 && ctx.measureText(rest + "...").width > maxW) rest = rest.slice(0, -1);
        ctx.fillText(rest + (rest.length < words.slice(i).join(" ").length ? "..." : ""), x, y + n*lineH);
        return;
      }
    } else line = test;
  }
  if(line) ctx.fillText(line, x, y + n*lineH);
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function drawHud(ctx, game){
  const p = game.world.player;
  const run = game.run;
  ctx.save();
  ctx.textBaseline = "top";

  /* On a tablet the HUD can breathe: score sits left, mission and difficulty
     centre, wallet right, with lives and the mission bar on a second row -
     rather than everything crammed into one phone-width strip. */
  const PAD = Math.round(VW*0.03), TOP_H = 84;
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.fillRect(0, 0, VW, TOP_H);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(0, TOP_H-1, VW, 1);

  ctx.fillStyle = "white";
  ctx.font = "bold 21px Arial, sans-serif";
  ctx.fillText(String(run.score).padStart(6, "0"), PAD, 10);

  ctx.textAlign = "center";
  ctx.fillStyle = run.difficulty.color;
  ctx.font = "bold 14px Arial, sans-serif";
  ctx.fillText(run.mission.name.toUpperCase(), VW/2, 10);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "bold 10px Arial, sans-serif";
  ctx.fillText(run.difficulty.name, VW/2, 28);

  ctx.textAlign = "right";
  ctx.fillStyle = "#ffd23f";
  ctx.font = "bold 19px Arial, sans-serif";
  ctx.fillText("$" + run.money, VW-PAD, 10);
  ctx.textAlign = "left";

  // Lives and shield charges, second row left
  if(p){
    for(let i=0;i<p.lives;i++){
      ctx.save();
      ctx.translate(PAD + 7 + i*20, 50);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0,-8); ctx.lineTo(7,8); ctx.lineTo(0,4); ctx.lineTo(-7,8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for(let i=0;i<p.shield;i++){
      ctx.strokeStyle = "rgba(120,200,255,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(PAD + 7 + p.lives*20 + 10 + i*17, 50, 6.5, 0, TAU); ctx.stroke();
    }
  }

  // Mission progress bar, second row right - wide enough to actually read
  const prog = clamp(run.progress, 0, 1);
  const barW = Math.round(Math.min(190, VW*0.33));
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(VW-PAD-barW, 44, barW, 8);
  ctx.fillStyle = run.bossActive ? "#ff5d73" : "#4ade80";
  ctx.fillRect(VW-PAD-barW, 44, barW*prog, 8);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "10px Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(run.bossActive ? "BOSS FIGHT" : "MISSION " + Math.round(prog*100) + "%", VW-PAD, 58);
  ctx.textAlign = "left";

  // Live objective tracker: spelled out at the start of a mission (and for a
  // moment whenever one is completed), then shrunk to a compact strip so it
  // stops eating the playfield.
  const expanded = run.time < 7 || performance.now() < run.objectiveFlashUntil;
  if(expanded){
    ctx.font = "12px Arial, sans-serif";
    let oy = 92;
    for(let i=0;i<run.objectiveDefs.length;i++){
      const def = run.objectiveDefs[i];
      const met = def.test(run.stats);
      ctx.fillStyle = met ? "#4ade80" : "rgba(255,255,255,0.6)";
      ctx.fillText((met ? "★ " : "☆ ") + def.label + "  " + def.progress(run.stats), PAD, oy);
      oy += 15;
    }
  } else {
    ctx.font = "bold 13px Arial, sans-serif";
    let strip = "";
    for(let i=0;i<run.objectiveDefs.length;i++){
      strip += run.objectiveDefs[i].test(run.stats) ? "★" : "☆";
    }
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(strip + "  " + run.objectiveDefs[1].progress(run.stats), PAD, 92);
  }

  // Combo
  if(run.combo >= 3){
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 21px Arial, sans-serif";
    ctx.fillText("x" + run.combo + " COMBO", VW/2, 96);
    ctx.textAlign = "left";
  }

  // Boss bar
  const boss = game.world.boss;
  if(boss && boss.alive){
    const w = VW - Math.round(VW*0.2), barY = 122;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect((VW-w)/2, barY, w, 13);
    const pct = clamp(boss.hp/boss.maxHp, 0, 1);
    ctx.fillStyle = pct > 0.5 ? boss.tint : (pct > 0.25 ? "#ffa726" : "#ff3b30");
    ctx.fillRect((VW-w)/2, barY, w*pct, 13);
    // Phase ticks so you can see the next phase coming
    boss.def.phases.forEach(ph => {
      if(ph.at >= 1) return;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect((VW-w)/2 + w*ph.at, barY, 2, 13);
    });
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 11px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(boss.name, VW/2, barY-14);
    ctx.textAlign = "left";
  }

  // Low-health vignette
  if(p && p.lives === 1 && p.shield === 0){
    const pulse = 0.12 + Math.sin(performance.now()/260)*0.06;
    const g = ctx.createRadialGradient(VW/2, VH/2, VH*0.32, VW/2, VH/2, VH*0.72);
    g.addColorStop(0, "rgba(255,0,40,0)");
    g.addColorStop(1, "rgba(255,0,40," + pulse + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,VW,VH);
  }

  // Centre banner
  if(run.bannerText && performance.now() < run.bannerUntil){
    const remain = (run.bannerUntil - performance.now())/1000;
    ctx.globalAlpha = clamp(remain*2, 0, 1);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(VW*0.08, VH*0.36, VW*0.84, 84);
    ctx.fillStyle = run.bannerColor || "#fff";
    ctx.font = "bold 27px Arial, sans-serif";
    ctx.fillText(run.bannerText, VW/2, VH*0.36 + 18);
    if(run.bannerSub){
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.font = "15px Arial, sans-serif";
      ctx.fillText(run.bannerSub, VW/2, VH*0.36 + 54);
    }
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

SF.render = {
  loadAssets, assets, isReady: () => assetsReady,
  initBackground, updateBackground, drawBackground,
  drawPlayer, drawEnemies, drawBullets, drawPickups, drawBoss, drawHud, drawComms,
  tinted,
};
})();
