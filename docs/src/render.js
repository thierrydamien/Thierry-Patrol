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
  backAlt: "assets/BackBack.jpg",
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

function hexToRgbStr(hex){ const c = hexToRgb(hex); return c.r + "," + c.g + "," + c.b; }

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
// Foreground dust: tiny fast specks nearer than the ship. They do nothing but
// stream past - which is exactly what sells altitude and speed.
let dust = [];
let vignette = null;
// The generated backdrop for this mission, and how far we've flown through it.
let skyCanvas = null, skyScroll = 0, skyIndex = -1, skyPhoto = null;

function initBackground(missionIndex){
  /*
   * Two kinds of backdrop, by mission. Some missions use the painted artwork
   * (which can only pan - a photograph has no seamless wrap), the rest use a
   * generated nebula (which is tileable, so it genuinely scrolls). Mixing them
   * is deliberate: the paintings look better than anything generated, and the
   * generated ones stop all eight levels looking identical.
   */
  const idx = missionIndex || 0;
  if(idx !== skyIndex){
    skyPhoto = SF.skygen.photoFor(idx);
    skyCanvas = skyPhoto ? null : SF.skygen.build(idx, VW, VH);
    skyIndex = idx;
  }
  skyScroll = 0;
  stars = [];
  // Star counts are per-area, not per-layer-constant: the playfield is 2.5x
  // the area it used to be, so a fixed count would read as empty space.
  const density = (VW*VH) / (390*620);
  [{n:18,s:18,size:1.1,a:0.38},{n:11,s:44,size:1.7,a:0.55},{n:6,s:88,size:2.6,a:0.8}]
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
  dust = [];
  const dn = Math.round(26 * density);
  for(let i=0;i<dn;i++){
    dust.push({ x: rand(0,VW), y: rand(0,VH), speed: rand(320, 520),
                len: rand(6, 16), a: rand(0.05, 0.16) });
  }
}

function updateBackground(dt){
  bgPhase += dt*0.08*warp;
  // The backdrop is vertically tileable, so it can genuinely scroll rather
  // than drift - you are flying through it, not past a photograph.
  skyScroll = (skyScroll + dt*14*warp) % VH;
  for(let i=0;i<stars.length;i++){
    const s = stars[i];
    s.y += s.speed*warp*dt;
    s.twinkle += dt*2.5;
    if(s.y > VH){ s.y -= VH; s.x = rand(0, VW); }
  }
  for(let i=0;i<dust.length;i++){
    const d = dust[i];
    d.y += d.speed*warp*dt;
    if(d.y > VH + 20){ d.y = -20; d.x = rand(0, VW); }
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
  if(skyPhoto && assetsReady && assets[skyPhoto]){
    // Cover-fit, not stretch: the art is 4:5 and the field is 3:4, so scaling
    // each axis independently would visibly squash it. Scale by whichever axis
    // needs more, then drift inside the overflow.
    const img = assets[skyPhoto];
    const iw = img.naturalWidth || img.width || 400;
    const ih = img.naturalHeight || img.height || 500;
    const cover = Math.max(VW/iw, VH/ih) * BG_ZOOM;
    const dw = iw*cover, dh = ih*cover;
    const mx = (dw - VW)/2, my = (dh - VH)/2;
    ctx.drawImage(img,
      -mx + Math.sin(bgPhase)*mx*0.9,
      -my + Math.sin(bgPhase*0.63)*my*0.9,
      dw, dh);
  } else if(skyCanvas){
    // Drawn twice, offset by a screen height, so the wrap is seamless.
    const y = skyScroll;
    ctx.drawImage(skyCanvas, 0, y);
    ctx.drawImage(skyCanvas, 0, y - VH);
  } else {
    ctx.fillStyle = "#05040f"; ctx.fillRect(0,0,VW,VH);
  }
  for(let i=0;i<stars.length;i++){
    const s = stars[i];
    ctx.globalAlpha = s.alpha * (0.75 + Math.sin(s.twinkle)*0.25);
    // Real starfields aren't monochrome: a scatter of warm and blue-white.
    ctx.fillStyle = s.layer===2 ? "#cfe8ff" : (s.twinkle % 1 < 0.18 ? "#ffe9c4" : "#ffffff");
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

/*
 * Foreground pass, drawn over the entities: streaming dust and a cinematic
 * vignette. The vignette is one cached radial gradient - it pulls the eye to
 * the centre of the field and grounds the bright HUD against deep space.
 */
function drawForeground(ctx){
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#dfeaff";
  for(let i=0;i<dust.length;i++){
    const d = dust[i];
    ctx.globalAlpha = d.a;
    ctx.fillRect(d.x, d.y, 1.5, d.len*warp);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  if(!vignette){
    vignette = document.createElement("canvas");
    vignette.width = VW; vignette.height = VH;
    const v = vignette.getContext("2d");
    if(v){
      const g = v.createRadialGradient(VW/2, VH*0.46, VH*0.42, VW/2, VH*0.5, VH*0.86);
      g.addColorStop(0, "rgba(2,4,12,0)");
      g.addColorStop(1, "rgba(2,4,12,0.42)");
      v.fillStyle = g; v.fillRect(0,0,VW,VH);
    }
  }
  ctx.drawImage(vignette, 0, 0);
}

/* ---------------------------------------------------------
   ENTITIES
   --------------------------------------------------------- */
function drawPlayer(ctx, p, timeMs){
  if(!p || !p.alive) return;
  if(p.invuln > 0 && Math.floor(p.invuln*12)%2 === 0) return; // blink while recovering

  const size = 58;
  const y = p.y + p.recoil;
  const overdrive = timeMs < p.overdriveUntil;
  const speed = Math.hypot(p.vx || 0, p.vy || 0);

  // Engine wake: an additive ribbon of light behind the ship, stretched by
  // how fast it's actually moving.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for(let i=0;i<p.trail.length;i++){
    const t = p.trail[i];
    const a = 1 - t.life/0.3;
    ctx.globalAlpha = a*(overdrive ? 0.5 : 0.3);
    ctx.fillStyle = overdrive ? "#ffb35c" : p.color;
    const h = (11 + speed*0.02)*a;
    ctx.fillRect(t.x-2.5, t.y, 5, h);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // Overdrive: the whole screen gains vertical speed streaks - four seconds
  // of feeling twice as fast, not just shooting twice as fast.
  if(overdrive){
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for(let i=0;i<9;i++){
      const sx = ((i*173 + 37) % VW);
      const sy = ((timeMs*(0.9 + (i%4)*0.28) + i*310) % (VH + 160)) - 80;
      ctx.globalAlpha = 0.05 + (i%3)*0.02;
      ctx.fillStyle = "#bfe0ff";
      ctx.fillRect(sx, sy, 2, 90 + (i%3)*44);
    }
    ctx.restore();
  }

  // Wingmen are the household's other pilots: their real ship - their
  // colour, their bought parts - with their name under it.
  for(let i=0;i<p.drones;i++){
    const mate = p.crew[i];
    const dx = i===0 ? -52 : 52, ds = size*0.58;
    ctx.save();
    ctx.translate(p.x+dx, y+6);
    ctx.rotate(p.bank*0.5);
    SF.shipart.drawShip(ctx, 0, 0, ds, {
      color: mate ? mate.color : p.color,
      levels: mate ? mate.levels : {}, t: timeMs/1000 + i, idle: false,
    });
    ctx.restore();
    if(mate){
      ctx.save();
      ctx.font = "bold 10px Rajdhani, Arial, sans-serif";
      ctx.textAlign = "center";
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
  // Live engine flame under the hull: flickers, and stretches with real
  // velocity, so pushing the stick reads as thrust.
  {
    const thrust = 0.55 + speed/560 + (overdrive ? 0.5 : 0);
    const flick = 0.85 + Math.sin(timeMs/24)*0.15;
    const fl = size*(0.30 + 0.34*thrust)*flick;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const fg = ctx.createLinearGradient(0, size*0.3, 0, size*0.3 + fl);
    fg.addColorStop(0, overdrive ? "rgba(255,220,160,0.95)" : "rgba(140,210,255,0.85)");
    fg.addColorStop(0.5, overdrive ? "rgba(255,150,60,0.55)" : "rgba(90,150,255,0.4)");
    fg.addColorStop(1, "rgba(60,110,255,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-size*0.10, size*0.30);
    ctx.lineTo(size*0.10, size*0.30);
    ctx.lineTo(0, size*0.30 + fl);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  if(overdrive){                                 // afterburner corona
    const pulse = 0.5 + Math.sin(timeMs/55)*0.25;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, 6, size*0.1, 0, 6, size*0.85);
    g.addColorStop(0, "rgba(255,170,80," + (0.35*pulse+0.2) + ")");
    g.addColorStop(1, "rgba(255,100,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 6, size*0.85, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // The ship they actually built: same drawing the hangar shows, every
  // bought part bolted on and visible in combat.
  SF.shipart.drawShip(ctx, 0, 0, size, {
    color: p.color, levels: p.levels, t: timeMs/1000, idle: false, tune: p.tune,
    decal: p.decal,
  });
  ctx.restore();

  // Shield: a live energy skin rather than plain circles.
  if(p.shield > 0){
    const wob = Math.sin(timeMs/300)*1.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for(let i=0;i<p.shield;i++){
      const r = size*0.68 + i*4 + wob;
      const g = ctx.createRadialGradient(p.x, y, r*0.82, p.x, y, r);
      g.addColorStop(0, "rgba(120,200,255,0)");
      g.addColorStop(0.85, "rgba(120,200,255," + (0.16 - i*0.03) + ")");
      g.addColorStop(1, "rgba(160,225,255," + (0.4 - i*0.08) + ")");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, y, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(150,215,255," + (0.5 + Math.sin(timeMs/240)*0.15) + ")";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, y, size*0.68 + (p.shield-1)*4 + wob, 0, TAU); ctx.stroke();
  }
}

function drawEnemies(ctx, world, timeMs){
  const items = world.enemies.items;
  const t = (timeMs || 0)/1000;

  // Guardian bubbles go down first, so every shielded enemy sits inside a
  // visibly intact dome rather than on top of it.
  for(let i=0;i<items.length;i++){
    const g = items[i];
    if(!g.alive || !g.type.shieldRadius) continue;
    const rad = g.type.shieldRadius * (0.4 + 0.6*easeOutCubic(g.spawnAnim));
    const pulse = 0.5 + Math.sin(t*3)*0.5;
    const grad = ctx.createRadialGradient(g.x, g.y, rad*0.35, g.x, g.y, rad);
    grad.addColorStop(0, "rgba(34,211,238,0.02)");
    grad.addColorStop(0.75, "rgba(34,211,238," + (0.07 + pulse*0.06) + ")");
    grad.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(g.x, g.y, rad, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(34,211,238," + (0.30 + pulse*0.28) + ")";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 9]);
    ctx.save();
    ctx.translate(g.x, g.y); ctx.rotate(t*0.5); ctx.translate(-g.x, -g.y);
    ctx.beginPath(); ctx.arc(g.x, g.y, rad, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
  }

  // Telegraphs and beams go under the sprites, so nothing is ever hidden by
  // the warning about it.
  for(let i=0;i<items.length;i++){
    const e = items[i];
    if(!e.alive) continue;
    // A Marksman draws the line it is about to fire down, filling as it aims.
    if(e.type.chargeTime && e.state === 1 && world.player){
      const k = clamp(e.charge/e.chargeTime, 0, 1);
      const dx = world.player.x - e.x, dy = world.player.y - e.y;
      const l = Math.max(1, Math.hypot(dx, dy));
      ctx.strokeStyle = "rgba(244,114,182," + (0.15 + k*0.55) + ")";
      ctx.lineWidth = 1 + k*2.5;
      ctx.setLineDash([9, 7]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + dx/l*VH, e.y + dy/l*VH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // A Mender's repair beam - the thing you want to cut.
    if(e.healTarget && e.healTarget.alive){
      ctx.strokeStyle = "rgba(52,211,153,0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.healTarget.x, e.healTarget.y); ctx.stroke();
      ctx.fillStyle = "rgba(52,211,153,0.28)";
      ctx.beginPath(); ctx.arc(e.healTarget.x, e.healTarget.y, e.healTarget.r + 5, 0, TAU); ctx.fill();
    }
  }

  for(let i=0;i<items.length;i++){
    const e = items[i];
    if(!e.alive) continue;
    const size = e.size * (0.4 + 0.6*easeOutCubic(e.spawnAnim));
    if(e.type.behaviour === "tumble"){ drawAsteroid(ctx, e, size); continue; }
    if(e.type.behaviour === "mine"){ drawMine(ctx, e, size, t); continue; }
    ctx.save();
    ctx.translate(e.x, e.y);
    // (Elite glow is baked into the cached sprite - no per-frame shadowBlur.)
    // Drawn art where we have it (one silhouette per archetype), the old
    // recoloured PNG only as a fallback.
    const drawn = SF.enemyArt.spriteFor(e.typeId, e.type.tint || "#c0392b", e.elite);
    if(drawn){
      const box = size*1.16;                    // the sprite carries its own padding
      ctx.drawImage(drawn, -box/2, -box/2, box, box);
    } else {
      ctx.rotate(Math.PI); // legacy art faces up; enemies fly down
      const img = assetsReady
        ? (e.type.tint ? tinted(assets.enemy, e.type.tint) : assets.enemy)
        : null;
      if(img) ctx.drawImage(img, -size/2, -size/2, size, size);
      else { ctx.fillStyle = e.type.tint || "#c0392b"; ctx.beginPath(); ctx.arc(0,0,size/2,0,TAU); ctx.fill(); }
    }
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
      ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SOS", e.x, e.y - e.r - 8);
      ctx.textAlign = "left";
    }
    if(e.shielded){
      // A hard skin, not a hint: "my shots are doing nothing" has to be
      // readable at a glance or it reads as the game being broken.
      ctx.save();
      ctx.globalAlpha = 0.18;   // enough to read as sealed, not enough to hide the target
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "rgba(120,240,255,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7, 0, TAU); ctx.stroke();
    }
    if(e.loot > 0){                               // what this thief is carrying
      ctx.fillStyle = "#ffd23f";
      ctx.font = "bold 12px Rajdhani, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("£" + e.loot, e.x, e.y - e.r - 8);
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

/* A mine reads as a thing to avoid, not a thing to shoot: spiked, blinking,
   and blinking faster the closer it is to going off by itself. */
function drawMine(ctx, e, size, t){
  const R = size*0.42;
  const urgency = clamp((e.fuse||0)/9, 0, 1);
  const blink = Math.sin(t*(6 + urgency*22)) > 0;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate((e.fuse||0)*0.6);
  ctx.strokeStyle = "rgba(120,20,20,0.9)";
  ctx.lineWidth = Math.max(1.5, R*0.22);
  for(let n=0;n<6;n++){
    const a = n/6*TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*R*0.6, Math.sin(a)*R*0.6);
    ctx.lineTo(Math.cos(a)*R*1.35, Math.sin(a)*R*1.35);
    ctx.stroke();
  }
  ctx.fillStyle = "#4b1d1d";
  ctx.beginPath(); ctx.arc(0, 0, R*0.75, 0, TAU); ctx.fill();
  ctx.fillStyle = blink ? "#ff4444" : "rgba(255,68,68,0.28)";
  if(blink){ ctx.shadowColor = "#ff4444"; ctx.shadowBlur = R*0.9; }
  ctx.beginPath(); ctx.arc(0, 0, R*0.34, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

/* Rocks are drawn, not sprited: the enemy art is a ship, and a tumbling
   ship reads as a bug. A fixed seed per rock keeps its outline stable. */
function drawAsteroid(ctx, e, size){
  const R = size*0.5;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.spin || 0);
  // Lit from the upper left, like everything else on screen, so a rock reads
  // as a solid lump rather than a flat grey polygon.
  const lit = ctx.createLinearGradient(-R*0.7, -R*0.7, R*0.6, R*0.7);
  lit.addColorStop(0, "#9aa4b4");
  lit.addColorStop(0.55, "#6b7280");
  lit.addColorStop(1, "#3f4653");
  ctx.fillStyle = lit;
  ctx.strokeStyle = e.type.tough ? "rgba(8,11,18,0.95)" : "rgba(12,16,26,0.85)";
  ctx.lineWidth = Math.max(1.5, R*(e.type.tough ? 0.055 : 0.07));
  ctx.beginPath();
  const verts = e.type.tough ? 13 : 9;
  for(let n=0;n<verts;n++){
    const a = n/verts*TAU;
    const wob = 0.74 + ((Math.sin(n*12.9898 + e.spinRate*78.233)*43758.5453) % 1 + 1) % 1 * 0.38;
    const x = Math.cos(a)*R*wob, y = Math.sin(a)*R*wob;
    if(n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  [[0.28,-0.2,0.20],[-0.3,0.14,0.15],[0.06,0.34,0.12]].forEach(([cx,cy,cr]) => {
    ctx.fillStyle = "rgba(28,34,48,0.5)";         // crater floor
    ctx.beginPath(); ctx.arc(cx*R, cy*R, cr*R, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(190,200,215,0.22)";     // and its lit rim
    ctx.beginPath(); ctx.arc(cx*R - cr*R*0.22, cy*R - cr*R*0.26, cr*R*0.72, 0, TAU); ctx.fill();
  });
  // Cracks open up as it takes damage, so a boulder visibly comes apart
  // rather than just having a bar tick down.
  const wear = 1 - clamp(e.hp/e.maxHp, 0, 1);
  if(wear > 0.15){
    ctx.strokeStyle = "rgba(16,21,32," + Math.min(0.85, 0.3 + wear*0.6) + ")";
    ctx.lineWidth = Math.max(1, R*0.035);
    ctx.lineCap = "round";
    const cracks = wear > 0.6 ? 3 : wear > 0.35 ? 2 : 1;
    for(let c=0;c<cracks;c++){
      const a0 = (c/3)*TAU + (e.spinRate||0);
      // Kept well inside the silhouette so they read as fractures in the rock
      // rather than scratches drawn over the top of it.
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0)*R*0.66, Math.sin(a0)*R*0.66);
      ctx.lineTo(Math.cos(a0+0.55)*R*0.18, Math.sin(a0+0.55)*R*0.18);
      ctx.lineTo(Math.cos(a0+1.5)*R*0.60, Math.sin(a0+1.5)*R*0.60);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }
  ctx.restore();
  if(e.flash > 0){
    ctx.save();
    ctx.globalAlpha = clamp(e.flash, 0, 1)*0.7;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(e.x, e.y, R*0.9, 0, TAU); ctx.fill();
    ctx.restore();
  }
  /*
   * The rival wears her name and a proper bar - she is a duel, not a mob -
   * plus the jink TELL: she flares and leans before she moves, so a dodge is
   * always something you watched coming rather than something that happened
   * to you. That tell is the whole reason her evasion is fair.
   */
  if(e.type.named){
    if(e.tell > 0){
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,180,240," + (0.5*e.tell/0.22).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(e.x, e.y, R*1.5, 0, TAU); ctx.fill();
      // an arrow the way she is about to break
      ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3; ctx.lineCap = "round";
      const d = e.dodgeDir || 1;
      ctx.beginPath();
      ctx.moveTo(e.x + d*R*1.2, e.y);
      ctx.lineTo(e.x + d*R*2.0, e.y);
      ctx.moveTo(e.x + d*R*1.7, e.y - 6);
      ctx.lineTo(e.x + d*R*2.0, e.y);
      ctx.lineTo(e.x + d*R*1.7, e.y + 6);
      ctx.stroke();
      ctx.restore();
    }
    const w = size*1.15, pct = clamp(e.hp/e.maxHp, 0, 1);
    ctx.fillStyle = "rgba(6,10,22,0.8)";
    ctx.fillRect(e.x-w/2, e.y-R-16, w, 8);
    ctx.fillStyle = pct > 0.5 ? "#ff4fd8" : pct > 0.22 ? "#ffd23f" : "#ff5d73";
    ctx.fillRect(e.x-w/2+1, e.y-R-15, (w-2)*pct, 6);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff9de0";
    ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
    ctx.fillText(e.type.named, e.x, e.y - R - 22);
    ctx.textAlign = "left";
  } else if(e.hp < e.maxHp){
    const w = size*0.7, pct = clamp(e.hp/e.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(e.x-w/2, e.y-R-7, w, 3);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(e.x-w/2, e.y-R-7, w*pct, 3);
  }
}

/*
 * Bullets are pre-rendered once per look and blitted. The old path set
 * shadowBlur per bullet per frame - the single most expensive call in the
 * renderer once a maxed ship fills the screen - and still read as flat
 * rectangles. A baked bolt gets a white-hot core, a coloured body and a soft
 * halo for free.
 */
const boltCache = {};
function boltSprite(color, w, h){
  const key = color + w + "x" + h;
  if(boltCache[key]) return boltCache[key];
  const m = 8;                                   // halo margin
  const cv = document.createElement("canvas");
  cv.width = w + m*2; cv.height = h + m*2;
  const c = cv.getContext("2d");
  if(!c) return null;
  const cx = cv.width/2, cy = cv.height/2;
  // Halo - tight, or the additive pass turns every volley into fog.
  const halo = c.createRadialGradient(cx, cy, 1, cx, cy, Math.max(w, h*0.6));
  halo.addColorStop(0, color); halo.addColorStop(1, "rgba(0,0,0,0)");
  c.globalAlpha = 0.34; c.fillStyle = halo;
  c.fillRect(0, 0, cv.width, cv.height);
  c.globalAlpha = 1;
  // Body capsule
  c.fillStyle = color;
  c.beginPath();
  c.arc(cx, cy - h/2 + w/2, w/2, Math.PI, 0);
  c.lineTo(cx + w/2, cy + h/2 - w/2);
  c.arc(cx, cy + h/2 - w/2, w/2, 0, Math.PI);
  c.closePath(); c.fill();
  // A narrow white-hot core up the spine, brightest at the tip.
  const core = c.createLinearGradient(0, cy - h/2, 0, cy + h/2);
  core.addColorStop(0, "rgba(255,255,255,0.95)");
  core.addColorStop(0.6, "rgba(255,255,255,0.55)");
  core.addColorStop(1, "rgba(255,255,255,0.12)");
  c.fillStyle = core;
  c.beginPath();
  c.arc(cx, cy - h/2 + w/2, w*0.17, Math.PI, 0);
  c.lineTo(cx + w*0.17, cy + h/2 - w*0.6);
  c.arc(cx, cy + h/2 - w*0.6, w*0.17, 0, Math.PI);
  c.closePath(); c.fill();
  boltCache[key] = cv;
  return cv;
}
/** Soft vertical light streak, stretched behind a moving bolt. */
const streakSprite = (() => {
  const cv = document.createElement("canvas"); cv.width = 16; cv.height = 64;
  const c = cv.getContext("2d");
  if(c){
    const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath(); c.ellipse(8, 10, 5, 10, 0, 0, TAU); c.fill();
    c.fillRect(3, 10, 10, 54);
  }
  return cv;
})();

const enemyBoltCache = {};
function enemyBolt(kind, r){
  const key = kind + "|" + Math.round(r);
  if(enemyBoltCache[key]) return enemyBoltCache[key];
  const R = Math.max(3, r), m = Math.ceil(R*2.4);
  const cv = document.createElement("canvas");
  cv.width = cv.height = m*2;
  const c = cv.getContext("2d");
  if(!c) return null;
  const col = kind === "orb" ? "255,124,229" : "255,93,115";
  const halo = c.createRadialGradient(m, m, 1, m, m, m);
  halo.addColorStop(0, "rgba(" + col + ",0.85)");
  halo.addColorStop(0.45, "rgba(" + col + ",0.28)");
  halo.addColorStop(1, "rgba(" + col + ",0)");
  c.fillStyle = halo; c.fillRect(0, 0, m*2, m*2);
  c.fillStyle = "rgb(" + col + ")";
  c.beginPath(); c.arc(m, m, R, 0, TAU); c.fill();
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.beginPath(); c.arc(m - R*0.15, m - R*0.2, R*0.45, 0, TAU); c.fill();
  enemyBoltCache[key] = cv;
  return cv;
}

function drawBullets(ctx, world){
  const items = world.bullets.items;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for(let i=0;i<items.length;i++){
    const b = items[i];
    if(!b.alive) continue;
    const t = BULLET_TIERS[b.tier] || BULLET_TIERS[0];
    const k = b.fromDrone ? 0.7 : 1;
    const spr = boltSprite(t.color, t.w*k, t.h*k);
    if(!spr) continue;
    // Motion streak first, angled along the bullet's actual velocity.
    const ang = Math.atan2(b.vy, b.vx) + Math.PI/2;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.22;
    ctx.drawImage(streakSprite, -2.5*k, -2, 5*k, (t.h + 18)*k);
    ctx.globalAlpha = 1;
    ctx.drawImage(spr, -spr.width*0.5*k, -spr.height*0.5*k, spr.width*k, spr.height*k);
    ctx.restore();
  }
  ctx.restore();

  const ebs = world.enemyBullets.items;
  for(let i=0;i<ebs.length;i++){
    const b = ebs[i];
    if(!b.alive) continue;
    const spr = enemyBolt(b.kind === "orb" ? "orb" : "aimed", b.r);
    if(spr) ctx.drawImage(spr, b.x - spr.width/2, b.y - spr.height/2);
    else { ctx.fillStyle = "#ff5d73"; ctx.fillRect(b.x-b.r*0.6, b.y-b.r, b.r*1.2, b.r*2); }
  }
}

/*
 * Coins are the most numerous object in the game, so they get real art:
 * eight pre-rendered spin phases of a bevelled gold coin with a moving
 * glint. Flat yellow ellipses were the single most prototype-looking thing
 * still on screen.
 */
const coinPhases = [];
function coinSprite(phase){
  if(!coinPhases.length){
    for(let ph=0;ph<8;ph++){
      const cv = document.createElement("canvas");
      cv.width = cv.height = 26;
      const c = cv.getContext("2d");
      if(!c) break;
      const squash = Math.max(0.22, Math.abs(Math.cos(ph/8*Math.PI)));
      c.translate(13, 13);
      // Edge (visible when the face turns away)
      c.fillStyle = "#8a5f08";
      c.beginPath(); c.ellipse(0, 0, 9*squash + 1.2, 10.2, 0, 0, TAU); c.fill();
      // Face
      const g = c.createRadialGradient(-2.5, -3.5, 1, 0, 0, 10);
      g.addColorStop(0, "#fff3b0");
      g.addColorStop(0.45, "#ffd23f");
      g.addColorStop(1, "#c98d12");
      c.fillStyle = g;
      c.beginPath(); c.ellipse(0, 0, 9*squash, 9.6, 0, 0, TAU); c.fill();
      // Inner ring stamped into the face
      c.strokeStyle = "rgba(140,95,10,0.55)"; c.lineWidth = 1.4;
      c.beginPath(); c.ellipse(0, 0, 5.6*squash, 6.2, 0, 0, TAU); c.stroke();
      // Glint that walks across with the spin
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath(); c.ellipse(-3*squash + ph*0.5 - 2, -4, 1.7*squash + 0.4, 1.1, -0.5, 0, TAU); c.fill();
      coinPhases.push(cv);
    }
  }
  return coinPhases[phase % coinPhases.length];
}

/*
 * THE CONVOY's haulers: the carrier silhouette flipped to face UP - it's one
 * of ours - in friendly blue, with engine glow at the tail and a health bar
 * that only appears once it has been hurt. Unhurt ships with permanent bars
 * read as "damaged already", which is backwards.
 */
function drawHaulers(ctx, world, timeMs){
  if(!world.haulers || !world.haulers.length) return;
  const art = SF.enemyArt.spriteFor("carrier", "#3fc9ff", false);
  for(let i = 0; i < world.haulers.length; i++){
    const h = world.haulers[i];
    if(!h.alive) continue;
    ctx.save();
    ctx.translate(h.x, h.y);
    // engine glow, pulsing - the thing is straining
    const th = 0.5 + Math.sin(timeMs/120 + i)*0.25;
    const g = ctx.createRadialGradient(0, h.r + 6, 2, 0, h.r + 6, 26);
    g.addColorStop(0, "rgba(124,196,255," + (0.5*th).toFixed(2) + ")");
    g.addColorStop(1, "rgba(124,196,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, h.r + 6, 26, 0, TAU); ctx.fill();
    ctx.rotate(Math.PI);                       // carrier art faces down; ours faces up
    if(art) ctx.drawImage(art, -46, -46, 92, 92);
    ctx.rotate(-Math.PI);
    if(h.hitFlash > 0){
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = h.hitFlash*0.45;
      if(art){ ctx.rotate(Math.PI); ctx.drawImage(art, -46, -46, 92, 92); ctx.rotate(-Math.PI); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    /*
     * The hauler must never be mistaken for traffic: it wears a permanent
     * name, a permanent health bar, and a friendly bracket. The first cut
     * hid the bar until it was hurt - which meant the thing you were
     * supposed to be protecting looked exactly like everything you were
     * supposed to be shooting.
     */
    const k = Math.max(0, h.hp/h.maxHp);
    const w = 92;
    ctx.strokeStyle = "rgba(124,196,255,0.55)";
    ctx.lineWidth = 2.5;
    [-1, 1].forEach(sd => {                       // friendly brackets
      ctx.beginPath();
      ctx.moveTo(sd*(w/2), -h.r - 4);
      ctx.lineTo(sd*(w/2 + 7), -h.r - 4);
      ctx.lineTo(sd*(w/2 + 7), h.r + 4);
      ctx.lineTo(sd*(w/2), h.r + 4);
      ctx.stroke();
    });
    ctx.fillStyle = "rgba(6,10,22,0.8)";
    ctx.fillRect(-w/2, -h.r - 26, w, 10);
    ctx.fillStyle = k > 0.5 ? "#4ade80" : k > 0.25 ? "#ffd23f" : "#ff5d73";
    ctx.fillRect(-w/2 + 2, -h.r - 24, (w - 4)*k, 6);
    if(k <= 0.35 && Math.floor(timeMs/220) % 2 === 0){
      ctx.strokeStyle = "#ff5d73"; ctx.lineWidth = 2;
      ctx.strokeRect(-w/2, -h.r - 26, w, 10);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#bfe3ff";
    ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
    ctx.fillText("OUR HAULER — PROTECT IT", 0, h.r + 26);
    ctx.textAlign = "left";
    ctx.restore();
  }
}

/*
 * THE SEARCHLIGHT's dark: a black veil with holes punched where things glow -
 * your ship (the lamp), every pickup (so rescues call to you across the
 * dark), and both sides' fire (so danger is always visible; fairness is the
 * fixed rule the level bends everything else around).
 */
let darkCv = null, darkCtx = null;
/**
 * `soft` is The Long Dark's remix: the same veil at roughly half strength
 * with a wider lamp - dread rather than a job, still every glow punched
 * through so fairness holds in both darknesses.
 */
function drawBlackout(ctx, world, timeMs, soft){
  if(!darkCv){
    darkCv = document.createElement("canvas");
    darkCv.width = VW; darkCv.height = VH;
    darkCtx = darkCv.getContext("2d");
  }
  const c = darkCtx;
  if(!c) return;
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, VW, VH);
  c.fillStyle = soft ? "rgba(3,5,16,0.68)" : "rgba(2,4,13,0.92)";
  c.fillRect(0, 0, VW, VH);
  c.globalCompositeOperation = "destination-out";
  const hole = (x, y, r, a) => {
    const g = c.createRadialGradient(x, y, r*0.3, x, y, r);
    g.addColorStop(0, "rgba(0,0,0," + a + ")");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r*2, r*2);
  };
  const p = world.player;
  if(p && p.alive) hole(p.x, p.y, (soft ? 265 : 205) + Math.sin(timeMs/160)*9, 1);
  const pk = world.pickups.items;
  for(let i = 0; i < pk.length; i++)
    if(pk[i].alive) hole(pk[i].x, pk[i].y, pk[i].kind === "rescue" ? 84 : 58, 0.9);
  let lit = 0;
  const ebs = world.enemyBullets.items;
  for(let i = 0; i < ebs.length && lit < 44; i++)
    if(ebs[i].alive){ hole(ebs[i].x, ebs[i].y, 34, 0.85); lit++; }
  lit = 0;
  const pbs = world.bullets.items;
  for(let i = 0; i < pbs.length && lit < 44; i++)
    if(pbs[i].alive){ hole(pbs[i].x, pbs[i].y, 26, 0.6); lit++; }
  ctx.drawImage(darkCv, 0, 0);
}

function drawPickups(ctx, world, timeMs){
  const items = world.pickups.items;
  for(let i=0;i<items.length;i++){
    const it = items[i];
    if(!it.alive) continue;
    ctx.save();
    ctx.translate(it.x, it.y);
    if(it.kind === "coin"){
      const spr = coinSprite(Math.floor((it.angle/Math.PI)*8) & 7);
      if(spr) ctx.drawImage(spr, -13, -13);
      else {
        ctx.fillStyle = "#ffd23f";
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
      }
    } else if(it.kind === "star"){
      // The Star Vault's treasure: a spinning gold star in a warm halo.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const hg = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
      hg.addColorStop(0, "rgba(255,220,90,0.55)");
      hg.addColorStop(1, "rgba(255,220,90,0)");
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.rotate(it.angle*0.7);
      ctx.fillStyle = "#ffd23f";
      ctx.strokeStyle = "#fff3c4";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for(let k = 0; k < 10; k++){
        const a = -Math.PI/2 + k*Math.PI/5;
        const r = k % 2 === 0 ? 11 : 4.6;
        ctx[k === 0 ? "moveTo" : "lineTo"](Math.cos(a)*r, Math.sin(a)*r);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if(it.kind === "supply"){
      // The rare crate: a glowing hex canister in its prize's colour with the
      // prize drawn on the lid - big pulsing halo so it reads from anywhere.
      const def = (it.data && it.data.supply) || { color:"#ffd23f", id:"bomb" };
      const pulse = 0.6 + Math.sin(timeMs/160)*0.4;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(0, 0, 5, 0, 0, 30);
      halo.addColorStop(0, def.color + "");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.32 + pulse*0.2;
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.fill();
      ctx.restore();
      // hex shell
      ctx.save();
      ctx.rotate(Math.sin(timeMs/700)*0.15);
      ctx.fillStyle = "#101528";
      ctx.strokeStyle = def.color; ctx.lineWidth = 2.4;
      ctx.beginPath();
      for(let k=0;k<6;k++){
        const a = -Math.PI/2 + (k/6)*TAU;
        ctx[k === 0 ? "moveTo" : "lineTo"](Math.cos(a)*13, Math.sin(a)*13);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // the prize on the lid
      if(def.id === "life"){
        drawHeart(ctx, 0, 0, 6, def.color);
      } else if(def.id === "shieldFull"){
        drawShieldPip(ctx, 0, 0, 6, true);
      } else if(def.id === "overdrive"){
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.moveTo(2, -8); ctx.lineTo(-4, 1); ctx.lineTo(-0.5, 1);
        ctx.lineTo(-2, 8); ctx.lineTo(4, -1); ctx.lineTo(0.5, -1);
        ctx.closePath(); ctx.fill();
      } else {   // bomb: a ball with a lit fuse
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(0, 1.5, 5.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = def.color; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(2, -3); ctx.quadraticCurveTo(5, -7, 7, -6); ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(7, -6, 1.6 + pulse, 0, TAU); ctx.fill();
      }
      ctx.restore();
    } else if(it.kind === "rescue"){
      // A drifting survivor: glass escape pod, suited figure inside, and a
      // slow amber beacon - the one thing on screen you feel bad missing.
      const bob = Math.sin(timeMs/220)*2;
      const blink = Math.sin(timeMs/380) > 0.2;
      ctx.save();
      ctx.translate(0, bob);
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 24);
      halo.addColorStop(0, "rgba(255,210,63,0.5)");
      halo.addColorStop(1, "rgba(255,210,63,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(0, bob);
      // Pod shell
      const shell = ctx.createLinearGradient(-13, -13, 10, 13);
      shell.addColorStop(0, "#ffe27a"); shell.addColorStop(1, "#c98d12");
      ctx.fillStyle = shell;
      ctx.strokeStyle = "rgba(90,60,6,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill(); ctx.stroke();
      // Window with the survivor: white helmet, dark visor
      ctx.fillStyle = "#0c1428";
      ctx.beginPath(); ctx.arc(0, -1, 8.5, 0, TAU); ctx.fill();
      ctx.fillStyle = "#e8ecf4";
      ctx.beginPath(); ctx.arc(0, 0, 5.6, 0, TAU); ctx.fill();
      ctx.fillStyle = "#2b6ea8";
      ctx.beginPath(); ctx.ellipse(0, -0.5, 3.8, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.ellipse(-1.4, -1.6, 1.2, 0.8, -0.5, 0, TAU); ctx.fill();
      // Beacon
      ctx.fillStyle = blink ? "#ff5d43" : "rgba(255,93,67,0.25)";
      ctx.beginPath(); ctx.arc(0, -13.5, 2.1, 0, TAU); ctx.fill();
      ctx.restore();
    } else {
      // Power-ups: a slow-spinning hex casing with a pulsing halo in the
      // power's own colour - reads as hardware, not a poker chip.
      const def = it.data;
      const pulse = 0.6 + Math.sin(timeMs/300 + it.angle)*0.4;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 24);
      halo.addColorStop(0, def.color);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.22 + pulse*0.16;
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.rotate(it.angle*0.6);
      ctx.fillStyle = "rgba(8,12,26,0.92)";
      ctx.strokeStyle = def.color; ctx.lineWidth = 2;
      ctx.beginPath();
      for(let n=0;n<6;n++){
        const a = n/6*TAU - Math.PI/2;
        const px2 = Math.cos(a)*14, py2 = Math.sin(a)*14;
        if(n===0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(-it.angle*0.6);
      ctx.fillStyle = def.color;
      ctx.font = "bold 12px Rajdhani, Arial, sans-serif";
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
  if(!boss || (!boss.alive && !boss.dying)) return;
  const pct = clamp(boss.hp/boss.maxHp, 0, 1);
  const damage = 1 - pct;
  const bx = boss.x + (boss.wobble ? rand(-boss.wobble, boss.wobble) : 0);
  const by = boss.y + (boss.wobble ? rand(-boss.wobble, boss.wobble) : 0);
  const size = boss.size;

  // Telegraphs first, underneath the boss, so they never obscure it.
  drawTelegraph(ctx, boss, timeMs);
  drawBeam(ctx, boss);
  drawTractor(ctx, boss, timeMs);

  // The Phantom's cloak: everything from the aura to the hull inherits this
  // alpha. Weak points set their own alpha, so the targets stay findable on
  // a faded boss - which is exactly the fight.
  ctx.save();
  if(boss.def.cloak){
    const shimmer = 1 + Math.sin(timeMs/90)*0.06;
    ctx.globalAlpha = clamp((boss.cloakA === undefined ? 1 : boss.cloakA) * shimmer, 0.2, 1);
  }

  // A slow-breathing aura in the boss's own tint. It grows angrier-looking as
  // the fight goes on, and reads as "under power" rather than "pasted on".
  if(!boss.def.finale){
    const enraged = boss.phase && boss.phase.enrage;
    const pulse = 0.5 + Math.sin(timeMs/(enraged ? 130 : 420))*0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const ar = size*(0.62 + damage*0.1 + pulse*0.05);
    const g = ctx.createRadialGradient(bx, by, ar*0.3, bx, by, ar);
    const base = enraged ? "255,60,60" : hexToRgbStr(boss.tint);
    g.addColorStop(0, "rgba(" + base + "," + (0.10 + pulse*0.08 + damage*0.06) + ")");
    g.addColorStop(1, "rgba(" + base + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, ar, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Each boss borrows the drawn silhouette of the archetype it commands -
  // the Marauder is a giant brute, the Sentinel a carrier, the Warden a
  // bomber, the Leviathan a hive. Same damage compositing as before; the
  // tinted PNG remains only as a fallback.
  const bossId = Object.keys(SF.missions.BOSSES).find(k => SF.missions.BOSSES[k] === boss.def) || "";
  // The finale gets hull art of its own: the scaled-up enemy silhouettes that
  // serve every other boss read as a coloured blob at this size, and the last
  // boss in the game cannot be a blob.
  // KING PAPA: the Star Vault's photographed head on a little gold rocket.
  if(boss.def.photo){
    drawPapaBoss(ctx, boss, bx, by, size, damage, timeMs);
    ctx.restore();   // cloak alpha off
    return;
  }
  if(boss.def.finale){
    drawDevourerHull(ctx, boss, bx, by, size, damage, timeMs);
    drawWeakPoints(ctx, boss, bx, by, timeMs);
    ctx.restore();   // cloak alpha off
    return;
  }
  // Every boss with a hand-drawn hull uses it; the tinted enemy silhouette is
  // now only a fallback for anything that hasn't been drawn yet.
  if(SF.bossart && SF.bossart.has(bossId)){
    ctx.save();
    ctx.translate(bx, by);
    SF.bossart.draw(ctx, boss, size, damage, timeMs);
    ctx.restore();
    drawWeakPoints(ctx, boss, bx, by, timeMs);
    ctx.restore();   // cloak alpha off
    return;
  }
  const bossShape = { marauder:"brute", sentinel:"carrier", warden:"bomber",
                      jailer:"shielder", phantom:"sniper", leviathan:"hive" }[bossId] || null;
  const bossArt = bossShape ? SF.enemyArt.spriteFor(bossShape, boss.tint, false) : null;
  if(bossArt || assetsReady){
    const B = bossBufCtx;
    B.setTransform(1,0,0,1,0,0);
    B.clearRect(0,0,220,220);
    B.save();
    B.translate(110,110);
    if(bossArt){
      const box = size*1.16;
      B.drawImage(bossArt, -box/2, -box/2, box, box);
    } else {
      B.rotate(Math.PI);
      B.drawImage(tinted(assets.enemy, boss.tint), -size/2, -size/2, size, size);
    }
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

  drawWeakPoints(ctx, boss, bx, by, timeMs);
  ctx.restore();   // cloak alpha off
}

/*
 * THE DEVOURER'S HULL - the only boss in the game with art of its own.
 *
 * Drawn live rather than blitted from a sprite because it has to react: the
 * furnace brightens as the fight escalates, the intake glows when it is
 * charging, seams crack open as it takes damage, and at close to a third of
 * the screen wide it needs real panel detail to read as a machine instead of
 * a shape. Everything is in boss-local units of S so it scales cleanly.
 */
function drawDevourerHull(ctx, boss, bx, by, S, damage, timeMs){
  const s = S/300;                       // design was drawn at S = 300
  const phase = boss.phaseIndex || 0;
  const heat = Math.min(1, damage*0.7 + phase*0.12);   // hotter as it dies
  ctx.save();
  ctx.translate(bx, by);

  // --- the halo it sits in: a slow corona, redder as it degrades
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const cor = ctx.createRadialGradient(0, 0, S*0.24, 0, 0, S*0.95);
  cor.addColorStop(0, "rgba(255," + Math.round(70 - heat*50) + ",60," + (0.10 + heat*0.10).toFixed(2) + ")");
  cor.addColorStop(1, "rgba(255,20,50,0)");
  ctx.fillStyle = cor;
  ctx.beginPath(); ctx.arc(0, 0, S*0.95, 0, TAU); ctx.fill();
  ctx.restore();

  // --- shoulder arms (the hangars live out here)
  [-1, 1].forEach(side => {
    ctx.fillStyle = "#1a0c1a";
    ctx.beginPath();
    ctx.moveTo(side*S*0.30, -S*0.16);
    ctx.lineTo(side*S*0.62, -S*0.20);
    ctx.lineTo(side*S*0.68,  S*0.02);
    ctx.lineTo(side*S*0.58,  S*0.20);
    ctx.lineTo(side*S*0.30,  S*0.14);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#63304f"; ctx.lineWidth = 3*s; ctx.stroke();
    // hangar mouth
    ctx.fillStyle = "#0c0710";
    ctx.fillRect(side*S*0.42 - S*0.075, S*0.02, S*0.15, S*0.09);
    ctx.fillStyle = "rgba(255,140,60," + (0.35 + Math.sin(timeMs/300 + side)*0.2).toFixed(2) + ")";
    ctx.fillRect(side*S*0.42 - S*0.065, S*0.04, S*0.13, S*0.025);
  });

  // --- main hull: a heavy angular slab
  const hull = ctx.createLinearGradient(0, -S*0.42, 0, S*0.34);
  hull.addColorStop(0, "#2b1020");
  hull.addColorStop(0.45, "#180a18");
  hull.addColorStop(1, "#0b040c");
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-S*0.20, -S*0.42);
  ctx.lineTo( S*0.20, -S*0.42);
  ctx.lineTo( S*0.40, -S*0.20);
  ctx.lineTo( S*0.44,  S*0.10);
  ctx.lineTo( S*0.26,  S*0.32);
  ctx.lineTo(-S*0.26,  S*0.32);
  ctx.lineTo(-S*0.44,  S*0.10);
  ctx.lineTo(-S*0.40, -S*0.20);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#7d3a5c"; ctx.lineWidth = 3.5*s; ctx.stroke();

  // --- panel lines and armour ribs
  ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 2.5*s;
  for(let i = -2; i <= 2; i++){
    ctx.beginPath();
    ctx.moveTo(i*S*0.13, -S*0.40);
    ctx.lineTo(i*S*0.15,  S*0.30);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,200,220,0.07)"; ctx.lineWidth = 2*s;
  [-0.22, 0, 0.18].forEach(fy => {
    ctx.beginPath();
    ctx.moveTo(-S*0.40, S*fy); ctx.lineTo(S*0.40, S*fy); ctx.stroke();
  });

  // --- the crown: a ridge of sensor spines along the leading edge
  ctx.fillStyle = "#7d3a5c";
  for(let i = -3; i <= 3; i++){
    const x = i*S*0.075;
    ctx.beginPath();
    ctx.moveTo(x - S*0.018, -S*0.42);
    ctx.lineTo(x,           -S*0.50 - Math.abs(i)*S*0.008);
    ctx.lineTo(x + S*0.018, -S*0.42);
    ctx.closePath(); ctx.fill();
  }
  // running lights, marching
  for(let i = -4; i <= 4; i++){
    const on = (Math.floor(timeMs/140) + i) % 5 === 0;
    ctx.fillStyle = on ? "rgba(180,220,255,0.95)" : "rgba(90,140,200,0.35)";
    ctx.beginPath(); ctx.arc(i*S*0.062, -S*0.395, S*0.011, 0, TAU); ctx.fill();
  }

  // --- the intake: the maw it eats stars with, under the hull
  ctx.fillStyle = "#08040c";
  ctx.beginPath();
  ctx.moveTo(-S*0.22, S*0.20);
  ctx.lineTo( S*0.22, S*0.20);
  ctx.lineTo( S*0.15, S*0.36);
  ctx.lineTo(-S*0.15, S*0.36);
  ctx.closePath(); ctx.fill();
  // intake vanes, lit from inside
  const maw = 0.4 + heat*0.6 + Math.sin(timeMs/200)*0.12;
  ctx.strokeStyle = "rgba(255," + Math.round(150 - heat*90) + ",60," + clamp(maw,0,1).toFixed(2) + ")";
  ctx.lineWidth = 3*s;
  for(let i = -3; i <= 3; i++){
    ctx.beginPath();
    ctx.moveTo(i*S*0.06, S*0.21);
    ctx.lineTo(i*S*0.042, S*0.35);
    ctx.stroke();
  }

  // --- the furnace core: the heart of the thing, and the reason it glows
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const pulse = 0.72 + Math.sin(timeMs/(boss.phase && boss.phase.enrage ? 90 : 260))*0.28;
  const coreR = S*0.17*(0.9 + pulse*0.16);
  const g = ctx.createRadialGradient(0, S*0.02, 0, 0, S*0.02, coreR*1.7);
  g.addColorStop(0,   "rgba(255,255,240," + (0.75*pulse).toFixed(2) + ")");
  g.addColorStop(0.3, "rgba(255," + Math.round(190 - heat*120) + ",90," + (0.6*pulse).toFixed(2) + ")");
  g.addColorStop(1,   "rgba(255,40,60,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, S*0.02, coreR*1.7, 0, TAU); ctx.fill();
  ctx.restore();
  // containment ring around it
  ctx.strokeStyle = "rgba(255,220,160,0.75)"; ctx.lineWidth = 4*s;
  ctx.beginPath(); ctx.arc(0, S*0.02, coreR, 0, TAU); ctx.stroke();
  ctx.strokeStyle = "rgba(120,60,90,0.9)"; ctx.lineWidth = 7*s;
  for(let i = 0; i < 6; i++){
    const a = (TAU/6)*i + timeMs/3000;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*coreR*0.98, S*0.02 + Math.sin(a)*coreR*0.98);
    ctx.lineTo(Math.cos(a)*coreR*1.34, S*0.02 + Math.sin(a)*coreR*1.34);
    ctx.stroke();
  }

  // --- battle damage: seams tear open and glow through
  const cracks = Math.min(boss.wounds.length, Math.floor(damage*11));
  for(let i = 0; i < cracks; i++){
    const w = boss.wounds[i];
    const wx = w.x*s*1.9, wy = w.y*s*1.9;
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = w.r*0.22*s;
    ctx.beginPath();
    ctx.moveTo(wx - w.r*s, wy - w.r*0.4*s);
    ctx.lineTo(wx + w.r*0.4*s, wy);
    ctx.lineTo(wx + w.r*s, wy + w.r*0.5*s);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255," + Math.round(160 - heat*90) + ",70," +
                      (0.35 + Math.sin(timeMs/170 + i)*0.2).toFixed(2) + ")";
    ctx.lineWidth = w.r*0.10*s;
    ctx.stroke();
  }

  // Hit flash, deliberately faint: under sustained fire this fills EVERY frame,
  // and at 0.42 it bleached the whole hull to grey. The hull must stay dark.
  if(boss.flash > 0){
    ctx.fillStyle = "rgba(255,190,210," + Math.min(0.13, boss.flash*0.13).toFixed(3) + ")";
    ctx.beginPath();
    ctx.moveTo(-S*0.20, -S*0.42); ctx.lineTo(S*0.20, -S*0.42);
    ctx.lineTo(S*0.44, S*0.10); ctx.lineTo(S*0.26, S*0.32);
    ctx.lineTo(-S*0.26, S*0.32); ctx.lineTo(-S*0.44, S*0.10);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** Weak points: bright while alive, smoking craters once blown off. */
function drawWeakPoints(ctx, boss, bx, by, timeMs){
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

/* =========================================================
   THE FINALE'S EXCLUSIVE VISUALS
   Nothing else in the game draws at this scale. The rule that
   keeps it fair: WARNING state is transparent and outlined,
   BURN state is opaque and solid - so "is that live yet?" is
   answered by how solid it looks, from across the room.
   ========================================================= */

/** The Devourer's arena attacks: lane columns, claw, nova ring, star lance. */
function drawArena(ctx, boss, timeMs){
  if(!boss || (!boss.alive && !boss.dying)) return;

  // --- Columns of fire -------------------------------------------------
  const L = boss.lanes;
  if(L){
    const live = L.t > L.warn;
    const k = live ? 1 - (L.t - L.warn)/L.burn : L.t/L.warn;
    ctx.save();
    L.xs.forEach(lx => {
      if(live){
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createLinearGradient(lx - L.w/2, 0, lx + L.w/2, 0);
        g.addColorStop(0,   "rgba(255,80,60,0)");
        g.addColorStop(0.5, "rgba(255,220,180," + (0.75*k).toFixed(2) + ")");
        g.addColorStop(1,   "rgba(255,80,60,0)");
        ctx.fillStyle = g;
        ctx.fillRect(lx - L.w/2, 0, L.w, VH);
        ctx.fillStyle = "rgba(255,255,255," + (0.85*k).toFixed(2) + ")";
        ctx.fillRect(lx - 3, 0, 6, VH);
      } else {
        ctx.globalAlpha = 0.18 + k*0.3;
        ctx.fillStyle = "#ff5d73";
        ctx.fillRect(lx - L.w/2, 0, L.w, VH);
        ctx.globalAlpha = 0.7 + Math.sin(timeMs/45)*0.3;
        ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2;
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.moveTo(lx - L.w/2, 0); ctx.lineTo(lx - L.w/2, VH);
        ctx.moveTo(lx + L.w/2, 0); ctx.lineTo(lx + L.w/2, VH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    ctx.restore();
  }

  // --- The claw --------------------------------------------------------
  const c = boss.claw;
  if(c){
    const live = c.t > c.warn;
    ctx.save();
    if(!live){
      // The band it will sweep, dashed and pulsing.
      ctx.globalAlpha = 0.16 + Math.sin(timeMs/60)*0.08;
      ctx.fillStyle = "#ff5d73";
      ctx.fillRect(0, c.y - c.r, VW, c.r*2);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2; ctx.setLineDash([14, 9]);
      ctx.beginPath();
      ctx.moveTo(0, c.y - c.r); ctx.lineTo(VW, c.y - c.r);
      ctx.moveTo(0, c.y + c.r); ctx.lineTo(VW, c.y + c.r);
      ctx.stroke(); ctx.setLineDash([]);
    } else {
      // The arm: a segmented limb from the hull down to the claw head.
      ctx.strokeStyle = "#3a2030"; ctx.lineWidth = 26; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(boss.x, boss.y + boss.r*0.4);
      ctx.quadraticCurveTo((boss.x + c.x)/2, c.y - 130, c.x, c.y);
      ctx.stroke();
      ctx.strokeStyle = "#6b3b52"; ctx.lineWidth = 14;
      ctx.stroke();
      // The head: a glowing grabber with pincers.
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, c.r*1.5);
      g.addColorStop(0, "rgba(255,120,90,0.9)");
      g.addColorStop(1, "rgba(255,60,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, c.r*1.5, 0, TAU); ctx.fill();
      ctx.restore();
      // Pincers, drawn in the claw head's own frame. (They were briefly built
      // from head-local coordinates but painted in screen space, which parked
      // them in the top-left corner of the playfield.)
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.sin(c.t*7)*0.12);
      ctx.fillStyle = "#8d2b4a";
      [-1, 1].forEach(sd => {
        ctx.beginPath();
        ctx.moveTo(sd*c.r*0.20, -c.r*0.90);
        ctx.lineTo(sd*c.r*1.15, -c.r*0.10);
        ctx.lineTo(sd*c.r*0.90,  c.r*0.85);
        ctx.lineTo(sd*c.r*0.10,  c.r*0.20);
        ctx.closePath();
        ctx.fill();
      });
      ctx.fillStyle = "#ffd9a8";
      ctx.beginPath(); ctx.arc(0, 0, c.r*0.35, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // --- The nova, and its one safe ring ---------------------------------
  const n = boss.nova;
  if(n){
    const live = n.t > n.warn;
    const k = live ? 1 - (n.t - n.warn)/n.burn : n.t/n.warn;
    ctx.save();
    if(live){
      // Everything outside the ring is fire. The ring is a hole in it.
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,150,60," + (0.5*k).toFixed(2) + ")";
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath(); ctx.arc(n.cx, n.cy, n.r, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(n.cx, n.cy, n.r, 0, TAU); ctx.stroke();
    } else {
      // Warning: the ring draws itself, with a shrinking guide and a label.
      ctx.globalAlpha = 0.10 + k*0.25;
      ctx.fillStyle = "#ff8a3d";
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 4;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -timeMs/28;
      ctx.beginPath(); ctx.arc(n.cx, n.cy, n.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.cx, n.cy, n.r + 90*(1-k), 0, TAU); ctx.stroke();
      ctx.fillStyle = "#4ade80";
      ctx.font = "bold 15px Rajdhani, Arial, sans-serif";
      ctx.textAlign = "center";
      // Below the ring when there's room, above when there isn't - either way
      // clear of the centre band where mission banners live.
      const ly = n.cy + n.r + 26 < VH - 40 ? n.cy + n.r + 26 : n.cy - n.r - 16;
      ctx.fillText("GET IN THE RING!", n.cx, ly);
      ctx.textAlign = "left";
    }
    ctx.restore();
  }

  // --- The star lance: half the sky --------------------------------------
  const la = boss.lance;
  if(la){
    const live = la.t > la.warn;
    const k = live ? 1 - (la.t - la.warn)/la.burn : la.t/la.warn;
    const x0 = la.side < 0 ? 0 : VW/2;
    ctx.save();
    if(live){
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(x0, 0, x0 + VW/2, 0);
      const hot = "rgba(255,240,200," + (0.8*k).toFixed(2) + ")";
      g.addColorStop(la.side < 0 ? 0 : 1, hot);
      g.addColorStop(la.side < 0 ? 1 : 0, "rgba(255,90,40," + (0.5*k).toFixed(2) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, VW/2, VH);
      ctx.fillStyle = "rgba(255,255,255," + (0.9*k).toFixed(2) + ")";
      ctx.fillRect(VW/2 - 4, 0, 8, VH);
    } else {
      ctx.globalAlpha = 0.12 + k*0.28;
      ctx.fillStyle = "#ff8a3d";
      ctx.fillRect(x0, 0, VW/2, VH);
      // A scan line running down the doomed half, plus the safe-side arrow.
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3;
      const sy = VH*(k % 1);
      ctx.beginPath(); ctx.moveTo(x0, sy); ctx.lineTo(x0 + VW/2, sy); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#4ade80";
      ctx.beginPath(); ctx.moveTo(VW/2, 0); ctx.lineTo(VW/2, VH); ctx.stroke();
      ctx.fillStyle = "#4ade80";
      ctx.font = "bold 15px Rajdhani, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(la.side < 0 ? "→ THIS SIDE" : "THIS SIDE ←",
                   VW/2 + (la.side < 0 ? 88 : -88), VH*0.72);
      ctx.textAlign = "left";
    }
    ctx.restore();
  }
}

/** The rescued pilots, holding formation and firing, in phase five. */
function drawFleet(ctx, timeMs){
  const list = SF.finale && SF.finale.fleetList ? SF.finale.fleetList() : [];
  for(let i = 0; i < list.length; i++){
    const f = list[i];
    if(f.t < 0) continue;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.bank*0.35);
    SF.shipart.drawShip(ctx, 0, 0, 46,
      { color: f.color, levels: f.levels, t: timeMs/1000 + i, idle:false, decal: f.decal });
    ctx.restore();
    ctx.save();
    ctx.font = "bold 9px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(f.name, f.x, f.y + 30);
    ctx.fillStyle = f.color;
    ctx.fillText(f.name, f.x, f.y + 30);
    ctx.restore();
  }
}

/** The arrival: black, letterbox, and the name of the thing. */
/*
 * The everyday boss arrival: same grammar as the finale's - letterbox, the
 * dark, the descent, the name card - but driven by the boss's OWN identity,
 * so seven bosses get seven different cards from one function. Kept shorter
 * and less black than the Devourer's so the finale still out-arrives it.
 */
function drawBossIntro(ctx, timeMs){
  if(!SF.bossintro || !SF.bossintro.active()) return;
  const beat = SF.bossintro.beat();
  const boss = SF.game.world.boss;
  if(!beat || !boss) return;
  const tint = boss.tint || "#ff2d55";
  const rgb = SF.bossintro.hexToRgbStr(tint);

  const bar = Math.min(1, beat.i >= 1 ? 1 : beat.k) * VH*0.09;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VW, bar);
  ctx.fillRect(0, VH - bar, VW, bar);

  // The dark falls fast, lifts as the hull comes down. Never fully black -
  // that much dark belongs to the Devourer alone.
  let dark = 0;
  if(beat.id === "alarm") dark = beat.k * 0.62;
  else if(beat.id === "rise") dark = 0.62 - beat.k*0.34;
  else dark = 0.28;
  ctx.fillStyle = "rgba(0,0,0," + dark.toFixed(2) + ")";
  ctx.fillRect(0, 0, VW, VH);

  ctx.textAlign = "center";
  if(beat.id === "alarm"){
    // Klaxon light in the boss's colour, and one spare line.
    const pulse = 0.5 + Math.sin(timeMs/110)*0.5;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(" + rgb + "," + (pulse*0.13).toFixed(2) + ")";
    ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = clamp(beat.k*2.2, 0, 1);
    ctx.fillStyle = "#ffd9de";
    ctx.font = "600 17px Rajdhani, Arial, sans-serif";
    ctx.fillText("ALL WINGS — CONTACT", VW/2, VH*0.45);
    ctx.globalAlpha = 1;
  }
  if(beat.id === "rise"){
    ctx.globalAlpha = clamp(beat.k*1.8, 0, 1);
    ctx.fillStyle = tint;
    ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
    ctx.fillText("MASS: LARGE   ·   POWER: RISING", VW/2, VH - bar - 24);
    ctx.globalAlpha = 1;
  }
  if(beat.id === "name"){
    const k = beat.k;
    const grow = 1 + (1 - Math.min(1, k*3))*0.5;
    const a = clamp(k < 0.8 ? k*4 : (1-k)*5, 0, 1);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(VW/2, VH*0.44);
    ctx.scale(grow, grow);
    ctx.shadowColor = tint; ctx.shadowBlur = 30;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 40px Rajdhani, Arial, sans-serif";
    ctx.fillText(boss.name, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(" + rgb + ",0.9)";
    ctx.font = "italic 16px Rajdhani, Arial, sans-serif";
    if(boss.def.epithet) ctx.fillText(boss.def.epithet, 0, 28);
    ctx.restore();
    ctx.strokeStyle = "rgba(" + rgb + "," + a.toFixed(2) + ")";
    ctx.lineWidth = 2;
    const spread = VW*0.10 + k*VW*0.38;
    ctx.beginPath();
    ctx.moveTo(VW/2 - spread, VH*0.44 - 38); ctx.lineTo(VW/2 + spread, VH*0.44 - 38);
    ctx.moveTo(VW/2 - spread, VH*0.44 + 42); ctx.lineTo(VW/2 + spread, VH*0.44 + 42);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
  ctx.restore();
}

function drawFinaleIntro(ctx, timeMs){
  if(!SF.finale || !SF.finale.introActive()) return;
  const beat = SF.finale.introBeat();
  if(!beat) return;

  // Letterbox bars: they slide in over the first beat and hold.
  const bar = Math.min(1, beat.i >= 1 ? 1 : beat.k) * VH*0.11;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VW, bar);
  ctx.fillRect(0, VH - bar, VW, bar);

  // The dark: the star going out. Full black, then it lifts as it descends.
  let dark = 0;
  if(beat.id === "dark") dark = 0.94;
  else if(beat.id === "rise") dark = 0.94 - beat.k*0.55;
  else dark = 0.34;
  ctx.fillStyle = "rgba(0,0,0," + dark.toFixed(2) + ")";
  ctx.fillRect(0, 0, VW, VH);

  ctx.textAlign = "center";
  if(beat.id === "dark"){
    const a = Math.sin(Math.min(1, beat.k*1.6) * Math.PI);
    ctx.globalAlpha = clamp(a*1.4, 0, 1);
    ctx.fillStyle = "#9aa8c8";
    ctx.font = "600 17px Rajdhani, Arial, sans-serif";
    ctx.fillText("THEIR STAR WENT OUT AT 04:00.", VW/2, VH*0.44);
    ctx.fillText("SOMETHING ATE IT.", VW/2, VH*0.44 + 26);
    ctx.globalAlpha = 1;
  }
  if(beat.id === "power"){
    // A red eye opening in the dark, and a rising klaxon glow.
    const pulse = 0.3 + Math.sin(timeMs/90)*0.2 + beat.k*0.5;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,40,60," + (pulse*0.25).toFixed(2) + ")";
    ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = clamp(beat.k*1.6, 0, 1);
    ctx.fillStyle = "#ff5d73";
    ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
    ctx.fillText("MASS: UNREADABLE   ·   POWER: RISING", VW/2, VH - bar - 26);
    ctx.globalAlpha = 1;
  }
  if(beat.id === "name"){
    const k = beat.k;
    const grow = 1 + (1 - Math.min(1, k*3))*0.5;      // slams down to size
    const a = clamp(k < 0.82 ? k*4 : (1-k)*5.5, 0, 1);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(VW/2, VH*0.46);
    ctx.scale(grow, grow);
    ctx.shadowColor = "#ff2d55"; ctx.shadowBlur = 34;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 46px Rajdhani, Arial, sans-serif";
    ctx.fillText("THE DEVOURER", 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ff9db0";
    ctx.font = "italic 16px Rajdhani, Arial, sans-serif";
    ctx.fillText("it ate their star. ours is next.", 0, 30);
    ctx.restore();
    // Hairlines that fly apart from the title.
    ctx.strokeStyle = "rgba(255,45,85," + a.toFixed(2) + ")";
    ctx.lineWidth = 2;
    const spread = VW*0.12 + k*VW*0.42;
    ctx.beginPath();
    ctx.moveTo(VW/2 - spread, VH*0.46 - 42); ctx.lineTo(VW/2 + spread, VH*0.46 - 42);
    ctx.moveTo(VW/2 - spread, VH*0.46 + 46); ctx.lineTo(VW/2 + spread, VH*0.46 + 46);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
  ctx.restore();
}

/*
 * KING PAPA. A giant photographed head (assets/papa.png - the family drops
 * the picture in themselves; it ships with a placeholder) wearing a pixel
 * crown, riding a comically small gold rocket. The head bobs, the rocket
 * flame flickers, and stars orbit him, because he is the treasure. Drawn
 * with love and zero dignity - the point is two children laughing.
 */
let papaImg = null, papaImgReady = false;
/*
 * Tries each spelling in turn and keeps the first that loads, so whatever
 * the family actually uploads works: no renaming, no converting, no coming
 * back to ask which extension the code wanted. A 404 just falls through to
 * the next candidate; running out of candidates leaves the "?" medallion up.
 */
const PAPA_SRCS = ["assets/papa.png", "assets/papa.jpg", "assets/papa.jpeg",
                   "assets/papa.webp", "assets/papa.PNG", "assets/papa.JPG"];
let papaTry = 0;
function papaPhoto(){
  if(papaImgReady) return papaImg;
  if(papaImg || papaTry >= PAPA_SRCS.length) return null;
  try {
    const img = new Image();
    papaImg = img;
    img.onload = () => { papaImgReady = true; };
    img.onerror = () => { papaImg = null; papaTry++; };   // next spelling
    img.src = PAPA_SRCS[papaTry];
  } catch(e){ papaTry = PAPA_SRCS.length; }
  return null;
}
function drawPapaBoss(ctx, boss, bx, by, S, damage, timeMs){
  const bob = Math.sin(timeMs/420)*7;
  const tilt = Math.sin(timeMs/700)*0.06;
  const R = S*0.42;                       // the head's radius
  ctx.save();
  ctx.translate(bx, by + bob);
  ctx.rotate(tilt);

  // The comically small rocket he rides: gold slab, fins, flame.
  ctx.fillStyle = "#b8860b";
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(-S*0.16, R*0.72, S*0.32, S*0.20, 8);
  else ctx.rect(-S*0.16, R*0.72, S*0.32, S*0.20);
  ctx.fill();
  ctx.fillStyle = "#ffd23f";
  [-1, 1].forEach(sd => {
    ctx.beginPath();
    ctx.moveTo(sd*S*0.16, R*0.74);
    ctx.lineTo(sd*S*0.30, R*0.94);
    ctx.lineTo(sd*S*0.16, R*0.90);
    ctx.closePath(); ctx.fill();
  });
  const flick = 0.7 + Math.sin(timeMs/60)*0.3;
  const fg = ctx.createLinearGradient(0, R*0.92, 0, R*0.92 + S*0.3*flick);
  fg.addColorStop(0, "rgba(255,190,90,0.9)");
  fg.addColorStop(1, "rgba(255,90,40,0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-S*0.09, R*0.92); ctx.lineTo(S*0.09, R*0.92);
  ctx.lineTo(0, R*0.92 + S*0.3*flick); ctx.closePath(); ctx.fill();

  // The head: the photo in a gold ring, or a winking placeholder medallion
  // until the family installs the picture.
  const img = papaPhoto();
  ctx.beginPath(); ctx.arc(0, 0, R + 6, 0, TAU);
  ctx.fillStyle = "#ffd23f"; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
  if(img){
    ctx.drawImage(img, -R, -R, R*2, R*2);
  } else {
    ctx.fillStyle = "#f5c518";
    ctx.fillRect(-R, -R, R*2, R*2);
    ctx.fillStyle = "#7a5200";
    ctx.textAlign = "center";
    ctx.font = "bold " + Math.round(R*1.1) + "px Rajdhani, Arial, sans-serif";
    ctx.fillText("?", 0, R*0.38);
    ctx.font = "bold " + Math.round(R*0.20) + "px Rajdhani, Arial, sans-serif";
    ctx.fillText("upload docs/assets/papa.png", 0, R*0.72);
  }
  // Damage reads as a slow blush: the more you bop him, the pinker he gets.
  if(damage > 0.05){
    ctx.fillStyle = "rgba(255,90,90," + (damage*0.30).toFixed(2) + ")";
    ctx.fillRect(-R, -R, R*2, R*2);
  }
  ctx.restore();

  // The crown: five gold spikes with jewel tips, slightly askew. Always askew.
  ctx.save();
  ctx.rotate(-0.08);
  ctx.fillStyle = "#ffd23f";
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 2;
  const cw = R*0.9, ch = R*0.42, cy = -R - 4;
  ctx.beginPath();
  ctx.moveTo(-cw/2, cy);
  for(let k = 0; k < 5; k++){
    ctx.lineTo(-cw/2 + cw*(k + 0.5)/5, cy - ch);
    ctx.lineTo(-cw/2 + cw*(k + 1)/5, cy);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ["#ff5d73","#4ade80","#3fc9ff","#c084fc","#ff8a3d"].forEach((col, k) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(-cw/2 + cw*(k + 0.5)/5, cy - ch, 4, 0, TAU);
    ctx.fill();
  });
  ctx.restore();

  // Stars orbit him. He is the treasure.
  for(let k = 0; k < 5; k++){
    const a = timeMs/900 + k*(TAU/5);
    const ox = Math.cos(a)*(R + 26), oy = Math.sin(a)*(R + 18)*0.6;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(timeMs/300 + k);
    ctx.fillStyle = "rgba(255,210,63," + (0.55 + Math.sin(timeMs/200 + k)*0.25).toFixed(2) + ")";
    ctx.beginPath();
    for(let q = 0; q < 10; q++){
      const qa = -Math.PI/2 + q*Math.PI/5;
      const qr = q % 2 === 0 ? 7 : 3;
      ctx[q === 0 ? "moveTo" : "lineTo"](Math.cos(qa)*qr, Math.sin(qa)*qr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  drawWeakPoints(ctx, boss, bx, by, timeMs);
}

/** The Jailer's tractor beam: a rippling green cone locked onto the ship. */
function drawTractor(ctx, boss, timeMs){
  if(!boss.pull) return;
  const p = SF.game.world.player;
  if(!p || !p.alive) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const ripple = 0.14 + Math.sin(timeMs/60)*0.06;
  const g = ctx.createLinearGradient(boss.x, boss.y, p.x, p.y);
  g.addColorStop(0, "rgba(74,222,128," + (ripple + 0.22) + ")");
  g.addColorStop(1, "rgba(74,222,128," + ripple + ")");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(boss.x - 26, boss.y + boss.r*0.4);
  ctx.lineTo(boss.x + 26, boss.y + boss.r*0.4);
  ctx.lineTo(p.x + 20, p.y);
  ctx.lineTo(p.x - 20, p.y);
  ctx.closePath();
  ctx.fill();
  // Motes streaming UP the beam - the direction the ship is being dragged.
  for(let i=0;i<3;i++){
    const t = ((timeMs/700 + i/3) % 1);
    const mx = p.x + (boss.x - p.x)*t, my = p.y + (boss.y - p.y)*t;
    ctx.fillStyle = "rgba(160,255,190,0.7)";
    ctx.beginPath(); ctx.arc(mx + Math.sin(timeMs/80 + i)*6, my, 2.4, 0, TAU); ctx.fill();
  }
  ctx.restore();
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
  const bw = boss.beam.width;
  ctx.save();
  ctx.globalAlpha = warmup ? 0.35 : 0.95;
  const g = ctx.createLinearGradient(boss.beam.x-bw/2, 0, boss.beam.x+bw/2, 0);
  g.addColorStop(0, "rgba(255,93,115,0)");
  g.addColorStop(0.5, warmup ? "rgba(255,93,115,0.6)" : "rgba(255,150,170,0.9)");
  g.addColorStop(1, "rgba(255,93,115,0)");
  ctx.fillStyle = g;
  ctx.fillRect(boss.beam.x - bw/2, boss.y, bw, VH);
  if(!warmup){
    // White-hot core with a flicker, so a live beam reads as lethal.
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.75 + Math.random()*0.25;
    const core = ctx.createLinearGradient(boss.beam.x-bw*0.16, 0, boss.beam.x+bw*0.16, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.5, "rgba(255,255,255,0.95)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.fillRect(boss.beam.x - bw*0.16, boss.y, bw*0.32, VH);
  }
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

  // The panel sits inside the flight envelope, so the ship can end up BEHIND
  // it mid-fight. When the player is anywhere near, the panel ducks to a
  // whisper - a message is never worth hiding the thing you're steering.
  let duck = 1;
  const pl = SF.game.world && SF.game.world.player;
  if(pl && pl.alive &&
     pl.x > x - 40 && pl.x < x + W + 40 &&
     pl.y > y - 50 && pl.y < y + H + 50) duck = 0.25;

  ctx.save();
  ctx.globalAlpha = outT * duck;

  ctx.fillStyle = "rgba(6,10,24,0.82)";
  ctx.strokeStyle = msg.color;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, W, H, 12);
  ctx.fill(); ctx.stroke();
  // A speaker tab so it reads as someone talking, not a system message.
  ctx.fillStyle = msg.color;
  ctx.fillRect(x, y, 3, H);

  // The speaker: their installed portrait if the family added one, their
  // ship otherwise.
  ctx.save();
  ctx.beginPath(); ctx.arc(x + 30, y + H/2, 22, 0, TAU); ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x + 8, y + 9, 44, 44);
  if(!(msg.pilot && SF.pilotart.paint(ctx, x + 30, y + H/2, 42, msg.pilot))){
    SF.shipart.drawShip(ctx, x + 30, y + H/2 + 2, 42,
      { color: msg.shipColor, levels: msg.levels, t: msg.life, idle: false });
  }
  ctx.restore();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = msg.color;
  ctx.font = "bold 10px Rajdhani, Arial, sans-serif";
  ctx.fillText(msg.speaker.toUpperCase(), x + 60, y + 11);
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "13px Rajdhani, Arial, sans-serif";
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

/** A filled heart - the universal "lives" glyph, no caption required. */
function drawHeart(ctx, x, y, r, color){
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, r*0.85);
  ctx.bezierCurveTo(-r*1.25, 0, -r*0.7, -r, 0, -r*0.35);
  ctx.bezierCurveTo(r*0.7, -r, r*1.25, 0, 0, r*0.85);
  ctx.fill();
  ctx.restore();
}
/** A shield outline; filled while the charge is up, hollow once spent. */
function drawShieldPip(ctx, x, y, r, up){
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r*0.9, -r*0.45);
  ctx.lineTo(r*0.9, r*0.2);
  ctx.quadraticCurveTo(r*0.9, r*0.75, 0, r);
  ctx.quadraticCurveTo(-r*0.9, r*0.75, -r*0.9, r*0.2);
  ctx.lineTo(-r*0.9, -r*0.45);
  ctx.closePath();
  if(up){ ctx.fillStyle = "rgba(120,200,255,0.9)"; ctx.fill(); }
  ctx.strokeStyle = "rgba(120,200,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/* Combo pop: the multiplier physically bumps when it climbs. */
let hudLastCombo = 0, hudComboPop = 0, hudLastMs = 0;
let hudPanelGrad = null;   // identical every frame - built once

function drawHud(ctx, game){
  const p = game.world.player;
  const run = game.run;
  const nowM = performance.now();
  const hdt = Math.min(0.05, (nowM - hudLastMs)/1000); hudLastMs = nowM;
  ctx.save();
  ctx.textBaseline = "top";

  /* On a tablet the HUD can breathe: score sits left, mission and difficulty
     centre, wallet right, with lives and the mission bar on a second row -
     rather than everything crammed into one phone-width strip. */
  const PAD = Math.round(VW*0.03), TOP_H = 84;
  // Glass panel: a gradient that fades out rather than a hard slab, with a
  // single cyan hairline - the game's HUD accent - underneath.
  if(!hudPanelGrad){
    hudPanelGrad = ctx.createLinearGradient(0, 0, 0, TOP_H + 26);
    hudPanelGrad.addColorStop(0, "rgba(4,8,20,0.78)");
    hudPanelGrad.addColorStop(0.72, "rgba(4,8,20,0.42)");
    hudPanelGrad.addColorStop(1, "rgba(4,8,20,0)");
  }
  ctx.fillStyle = hudPanelGrad;
  ctx.fillRect(0, 0, VW, TOP_H + 26);
  ctx.fillStyle = "rgba(110,200,255,0.28)";
  ctx.fillRect(0, TOP_H-1, VW, 1);
  ctx.fillStyle = "rgba(110,200,255,0.75)";
  ctx.fillRect(PAD, TOP_H-1, 34, 1);
  ctx.fillRect(VW-PAD-34, TOP_H-1, 34, 1);

  // The pause / mute buttons are DOM circles pinned to the top corners, so
  // the score and wallet start inboard of them.
  const CLEAR = 52;
  ctx.fillStyle = "rgba(140,200,255,0.55)";
  ctx.font = "bold 9px Rajdhani, Arial, sans-serif";
  ctx.fillText("SCORE", PAD + CLEAR, 8);
  ctx.fillStyle = "white";
  ctx.shadowColor = "rgba(120,200,255,0.55)"; ctx.shadowBlur = 8;
  ctx.font = "bold 22px 'Courier New', monospace";
  ctx.fillText(String(run.score).padStart(6, "0"), PAD + CLEAR, 19);
  ctx.shadowBlur = 0;

  ctx.textAlign = "center";
  ctx.fillStyle = run.difficulty.color;
  ctx.font = "bold 14px Rajdhani, Arial, sans-serif";
  ctx.fillText(run.mission.name.toUpperCase(), VW/2, 10);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "bold 10px Rajdhani, Arial, sans-serif";
  ctx.fillText(run.difficulty.name, VW/2, 28);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,210,63,0.55)";
  ctx.font = "bold 9px Rajdhani, Arial, sans-serif";
  ctx.fillText(run.dailyDouble ? "CREDITS \u00d72" : "CREDITS", VW-PAD-CLEAR, 8);
  ctx.fillStyle = "#ffd23f";
  ctx.shadowColor = "rgba(255,180,40,0.5)"; ctx.shadowBlur = 8;
  ctx.font = "bold 20px 'Courier New', monospace";
  ctx.fillText("£" + run.money, VW-PAD-CLEAR, 19);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";

  // Lives and shields, labelled like every other readout. These were bare
  // triangles and circles - the game's own designer had to be told what they
  // meant, which settles whether they were readable.
  if(p){
    ctx.font = "bold 8px Rajdhani, Arial, sans-serif";
    ctx.fillStyle = "rgba(255,120,140,0.7)";
    ctx.fillText("LIVES", PAD + CLEAR, 40);
    for(let i=0;i<p.lives;i++){
      drawHeart(ctx, PAD + CLEAR + 7 + i*19, 56, 7, "#ff5d73");
    }
    const sx = PAD + CLEAR + Math.max(p.lives, 3)*19 + 18;
    if(p.shieldMax > 0){
      ctx.fillStyle = "rgba(120,200,255,0.7)";
      ctx.fillText("SHIELD", sx, 40);
      for(let i=0;i<p.shieldMax;i++){
        drawShieldPip(ctx, sx + 7 + i*17, 56, 6.5, i < p.shield);
      }
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
  ctx.font = "10px Rajdhani, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(run.bossActive ? "BOSS FIGHT" : "MISSION " + Math.round(prog*100) + "%", VW-PAD, 58);
  ctx.textAlign = "left";

  // Live objective tracker. It used to collapse to a three-star strip after
  // seven seconds - which meant the one moment you wanted to check "am I
  // still clean?" the labels were gone. It stays up now: bright and full-size
  // through the opening, then smaller and quieter, but always legible. During
  // a boss it steps below the boss bar instead of fighting it.
  const intro = run.time < 7 || performance.now() < run.objectiveFlashUntil;
  const oySize = intro ? 12 : 11;
  ctx.font = oySize + "px Rajdhani, Arial, sans-serif";
  let oy = run.bossActive ? 152 : 92;
  for(let i=0;i<run.objectiveDefs.length;i++){
    const def = run.objectiveDefs[i];
    const met = def.test(run.stats);
    ctx.fillStyle = met ? (intro ? "#4ade80" : "rgba(74,222,128,0.85)")
                        : (intro ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.45)");
    ctx.fillText((met ? "\u2605 " : "\u2606 ") + def.label + "  " + def.progress(run.stats), PAD, oy);
    oy += oySize + 3;
  }

  // Active power-ups tick down in plain sight, right under the objectives. A
  // 9-second buff nobody can see the end of just reads as "my guns went weird
  // for a bit" - the draining bar is what makes it a resource kids race.
  if(p){
    const nowT = performance.now();
    const boosts = [];
    if(nowT < p.overdriveUntil)
      boosts.push({ label:"OVERDRIVE", color:"#ff8a3d", left:(p.overdriveUntil-nowT)/(p.overdriveTime*1000) });
    if(nowT < p.tempRapidUntil)
      boosts.push({ label:"RAPID", color:"#ffd23f", left:(p.tempRapidUntil-nowT)/9000 });
    if(nowT < p.tempSpreadUntil)
      boosts.push({ label:"SPREAD", color:"#3399ff", left:(p.tempSpreadUntil-nowT)/9000 });
    if(nowT < p.tempScoreUntil)
      boosts.push({ label:"SCORE \u00d72", color:"#ff66b3", left:(p.tempScoreUntil-nowT)/9000 });
    if(nowT < p.tempHomingUntil)
      boosts.push({ label:"HOMING", color:"#22d3ee", left:(p.tempHomingUntil-nowT)/9000 });
    for(let i=0;i<boosts.length;i++){
      const b = boosts[i], bx = PAD, by = oy + 4 + i*17, w = 76;
      ctx.fillStyle = "rgba(10,14,34,0.55)";
      ctx.fillRect(bx, by, w, 13);
      ctx.fillStyle = b.color + "44";
      ctx.fillRect(bx, by, w * clamp(b.left, 0, 1), 13);
      ctx.strokeStyle = b.color + "88"; ctx.lineWidth = 1;
      ctx.strokeRect(bx+0.5, by+0.5, w-1, 12);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 8px Rajdhani, Arial, sans-serif";
      ctx.fillText(b.label, bx+5, by+9.5);
    }
  }

  // Combo - bumps up in scale for a beat every time it climbs.
  if(run.combo >= 3){
    if(run.combo !== hudLastCombo){
      if(run.combo > hudLastCombo) hudComboPop = 1;
      hudLastCombo = run.combo;
    }
    hudComboPop = Math.max(0, hudComboPop - hdt*5);
    const pop = 1 + easeOutCubic(hudComboPop)*0.35;
    ctx.save();
    ctx.translate(VW/2, 106);
    ctx.scale(pop, pop);
    ctx.textAlign = "center";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(6,8,18,0.7)";
    ctx.font = "bold 22px Rajdhani, Arial, sans-serif";
    ctx.strokeText("x" + run.combo + " COMBO", 0, -10);
    ctx.fillStyle = run.combo >= 10 ? "#ff8a3d" : "#ffd23f";
    ctx.fillText("x" + run.combo + " COMBO", 0, -10);
    ctx.restore();
    ctx.textAlign = "left";
  } else hudLastCombo = run.combo || 0;

  // Boss entrance: while it descends, the screen letterboxes and the name
  // card lands - dread with a byline, not just a health bar appearing.
  const bossIn = game.world.boss;
  if(bossIn && bossIn.alive && bossIn.entering){
    const pulse = 0.5 + Math.sin(nowM/160)*0.5;
    ctx.save();
    const bandY = VH*0.30, bandH = 120;
    const band = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
    band.addColorStop(0, "rgba(10,2,6,0)");
    band.addColorStop(0.3, "rgba(10,2,6,0.82)");
    band.addColorStop(0.7, "rgba(10,2,6,0.82)");
    band.addColorStop(1, "rgba(10,2,6,0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, bandY, VW, bandH);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,93,115," + (0.55 + pulse*0.4) + ")";
    ctx.font = "bold 12px Rajdhani, Arial, sans-serif";
    ctx.fillText("\u26a0 ALERT \u26a0", VW/2, bandY + 26);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = bossIn.tint; ctx.shadowBlur = 18;
    ctx.font = "bold 34px Rajdhani, Arial, sans-serif";
    ctx.fillText(bossIn.name, VW/2, bandY + 62);
    ctx.shadowBlur = 0;
    if(bossIn.def.epithet){
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "italic 14px Rajdhani, Arial, sans-serif";
      ctx.fillText(bossIn.def.epithet, VW/2, bandY + 88);
    }
    ctx.textAlign = "left";
    // Red edge pulse while the alarm sounds
    const vg = ctx.createRadialGradient(VW/2, VH/2, VH*0.35, VW/2, VH/2, VH*0.75);
    vg.addColorStop(0, "rgba(255,30,60,0)");
    vg.addColorStop(1, "rgba(255,30,60," + (0.10 + pulse*0.10) + ")");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  // Boss bar: a glass capsule with the boss's own tint, phase ticks, and a
  // fill that goes from tint to warning amber to red.
  const boss = game.world.boss;
  if(boss && boss.alive){
    const w = VW - Math.round(VW*0.2), barY = 122, bh = 14, bx0 = (VW-w)/2;
    const pct = clamp(boss.hp/boss.maxHp, 0, 1);
    ctx.save();
    roundRect(ctx, bx0-2, barY-2, w+4, bh+4, 7);
    ctx.fillStyle = "rgba(4,8,18,0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
    ctx.stroke();
    if(pct > 0){
      const col = pct > 0.5 ? boss.tint : (pct > 0.25 ? "#ffa726" : "#ff3b30");
      roundRect(ctx, bx0, barY, Math.max(bh, w*pct), bh, 5);
      ctx.clip();
      const fg = ctx.createLinearGradient(0, barY, 0, barY+bh);
      fg.addColorStop(0, "#ffffff");
      fg.addColorStop(0.18, col);
      fg.addColorStop(1, col);
      ctx.fillStyle = fg;
      ctx.fillRect(bx0, barY, w*pct, bh);
    }
    ctx.restore();
    boss.def.phases.forEach(ph => {
      if(ph.at >= 1) return;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(bx0 + w*ph.at, barY, 2, bh);
    });
    ctx.textAlign = "center";
    ctx.font = "bold 11px Rajdhani, Arial, sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(6,8,18,0.8)";
    ctx.strokeText(boss.name, VW/2, barY-14);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = boss.tint; ctx.shadowBlur = 6;
    ctx.fillText(boss.name, VW/2, barY-14);
    ctx.shadowBlur = 0;
    // Sealed bosses say so, and count down: the goal is never a mystery.
    if(SF.bosses.isSealed(boss)){
      const left = SF.bosses.partsLeft(boss);
      ctx.font = "bold 11px Rajdhani, Arial, sans-serif";
      ctx.fillStyle = "#ffd23f";
      ctx.fillText("ARMOURED — " + left + " PART" + (left === 1 ? "" : "S") + " LEFT",
                   VW/2, barY + 22);
    }
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

  // Centre banner: full-width cinematic band with accent rules, not a grey box.
  // A boss entrance owns the centre of the screen; the banner yields.
  // A banner never sits on top of an attack warning - the warning is the one
  // the player has to read RIGHT NOW.
  const arenaBusy = bossIn && (bossIn.lanes || bossIn.nova || bossIn.lance || bossIn.claw);
  if(run.bannerText && performance.now() < run.bannerUntil && !arenaBusy &&
     !(bossIn && bossIn.alive && bossIn.entering)){
    const remain = (run.bannerUntil - performance.now())/1000;
    // A long hold needs a long fade: the band draws OVER the traffic, so it
    // spends its last second and a half going see-through rather than
    // sitting opaque and then vanishing.
    const a = clamp(remain/1.5, 0, 1);
    ctx.globalAlpha = a;
    const cy = VH*0.36, bandH = 92;
    const band = ctx.createLinearGradient(0, cy, 0, cy+bandH);
    band.addColorStop(0, "rgba(3,6,16,0)");
    band.addColorStop(0.28, "rgba(3,6,16,0.78)");
    band.addColorStop(0.72, "rgba(3,6,16,0.78)");
    band.addColorStop(1, "rgba(3,6,16,0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, cy, VW, bandH);
    const accent = run.bannerColor || "#fff";
    const rule = ctx.createLinearGradient(0, 0, VW, 0);
    rule.addColorStop(0, "rgba(255,255,255,0)");
    rule.addColorStop(0.5, accent);
    rule.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rule;
    ctx.fillRect(VW*0.1, cy+16, VW*0.8, 1);
    ctx.fillRect(VW*0.1, cy+bandH-16, VW*0.8, 1);
    ctx.textAlign = "center";
    ctx.fillStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = 14;
    ctx.font = "bold 27px Rajdhani, Arial, sans-serif";
    ctx.fillText(run.bannerText, VW/2, cy + 24);
    ctx.shadowBlur = 0;
    if(run.bannerSub){
      // The sub-line carries the mission's actual instruction, so it is sized
      // to be READ from a tablet on a lap - 14px was a footnote.
      ctx.fillStyle = "#fff";
      ctx.font = "600 19px Rajdhani, Arial, sans-serif";
      ctx.fillText(run.bannerSub, VW/2, cy + 60);
    }
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

SF.render = {
  loadAssets, assets, isReady: () => assetsReady,
  initBackground, updateBackground, drawBackground, drawForeground,
  drawPlayer, drawEnemies, drawBullets, drawPickups, drawBoss, drawHud, drawComms,
  drawArena, drawFleet, drawFinaleIntro, drawBossIntro, drawHaulers, drawBlackout,
  // The campaign map borrows this to draw the Devourer looming at the final
  // stop - the same hull the fight uses, so the destination IS the monster.
  drawDevourerHull,
  tinted,
};
})();
