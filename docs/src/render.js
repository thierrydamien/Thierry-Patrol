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
let { VW, VH, BULLET_TIERS } = SF.entityConst;
/*
 * Several buffers here are sized to the field and built once, lazily, then
 * kept for the session. If the field is re-measured (see entities.js) they are
 * suddenly the wrong shape, so they are dropped rather than stretched - a
 * vignette or a blackout veil cut for a narrower field leaves an unlit strip
 * down the right-hand edge, which is worse than the cost of rebuilding them.
 * `skyIndex` is reset too, so the next initBackground() regenerates the sky at
 * the new width instead of short-circuiting on an unchanged mission index.
 */
SF.field.onChange(w => {
  VW = w;
  vignette = null;
  darkCv = null; darkCtx = null;
  skyIndex = -1;
});

/* ---------------------------------------------------------
   ASSETS
   --------------------------------------------------------- */
const ASSET_PATHS = {
  ship: "assets/orange.png",
  enemy: "assets/red.png",
  playfieldBg: "assets/BackNew.jpg",
  backAlt: "assets/BackBack.jpg",
};
/*
 * Everything that uses these has procedural art to fall back on, so a missing
 * file must not hold the readiness gate hostage.
 *
 * `ship` joined the list because it is not drawn ANYWHERE. Its only two uses
 * are as the probe image in canReadPixels() and as a cache-key discriminator
 * string in tinted(); `tinted(assets.ship, ...)` is never called - every ship
 * in the game comes from shipart.js. So 187KB was being fetched at boot and,
 * because it was mandatory, one 404 silently killed the briefing hero art for
 * all 29 missions (isReady()'s only consumer). `enemy` is likewise a fallback
 * for when enemyArt has no silhouette, which it currently always does.
 */
const OPTIONAL_ASSETS = { enemy: true, ship: true };
const assets = {};
let assetsReady = false;

function loadAssets(cb){
  /*
   * Warm Papa's photo at boot, deliberately OUTSIDE the gate below. It used to
   * be first requested the moment KING PAPA landed - mid-fight, the worst
   * moment for a hiccup and the most visible - and now it is fetched (and
   * service-worker cached) while the pilot picker is still up. It must not
   * join ASSET_PATHS: a family that hasn't uploaded a photo yet would fail the
   * `ok` flag and gate the whole game on a picture it is designed to live
   * without.
   */
  papaPhoto();
  const keys = Object.keys(ASSET_PATHS);
  let remaining = keys.length, ok = true;
  keys.forEach(key => {
    const img = new Image();
    img.onload = () => { if(--remaining === 0){ assetsReady = ok; cb(); } };
    img.onerror = () => {
      if(OPTIONAL_ASSETS[key]) assets[key] = null;   // fall back to drawn art
      else ok = false;
      if(--remaining === 0){ assetsReady = ok; cb(); }
    };
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

// The page ships Rajdhani 500/600/700 only - never ask canvas for 800/900.
const FONT = "Rajdhani, 'Avenir Next Condensed', system-ui, sans-serif";
// Bake sprites at device resolution (capped - past 2x the cost buys nothing)
// and blit at logical size, so nothing baked goes soft on a retina screen.
const BAKE = Math.min(window.devicePixelRatio || 1, 2);

/*
 * Every label that lives IN the playfield goes through here: a dark stroke
 * under the fill, so callsigns, prompts and prices survive a bright sky.
 */
function label(ctx, text, x, y, fill, px, weight){
  ctx.save();
  ctx.font = (weight || 700) + " " + px + "px " + FONT;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(6,8,18,0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/*
 * enemyart bakes hulls at its own RES with PAD margin around them for the
 * elite glow. The on-screen box must inherit that ratio from the sprite
 * itself or the two drift - a hard-coded 1.16 encoded a long-dead RES/PAD
 * pair and clipped wide elites' auras flat. The hull lands at exactly `size`;
 * the glow margin rides along.
 */
function artBox(sprite, size){
  return size * sprite.width / ((SF.enemyArt && SF.enemyArt.RES) || 128);
}

let pixelsReadable = null;
function canReadPixels(){
  if(pixelsReadable !== null) return pixelsReadable;
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 2;
    const pctx = probe.getContext("2d");
    // Any same-origin image will do; use whichever tintable art actually
    // loaded rather than requiring one particular file to be present.
    const probeImg = assets.enemy || assets.ship || assets.playfieldBg;
    if(!probeImg) return (pixelsReadable = false);
    pctx.drawImage(probeImg, 0, 0, 2, 2);
    pctx.getImageData(0, 0, 1, 1);
    pixelsReadable = true;
  } catch(e){ pixelsReadable = false; }
  return pixelsReadable;
}

const tintCache = {};
/** Recolours a sprite to a target hue while keeping its shading. */
function tinted(img, hex){
  if(!img || !(img.naturalWidth || img.width)) return null;  // optional art missing
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
    // Built at device resolution (4th arg) and blitted back down to VW x VH;
    // the explicit destination size below keeps this working even if build
    // ignores the dpr argument.
    skyCanvas = skyPhoto ? null : SF.skygen.build(idx, VW, VH, BAKE);
    skyIndex = idx;
  }
  skyScroll = 0;
  stars = [];
  // Star counts are per-area, not per-layer-constant: the playfield is 2.5x
  // the area it used to be, so a fixed count would read as empty space.
  // Layer speeds fan out well clear of the sky's crawl, so the parallax
  // stack reads as depth instead of one welded sheet.
  const density = (VW*VH) / (390*620);
  [{n:18,s:24,size:1.1,a:0.38},{n:11,s:60,size:1.7,a:0.55},{n:6,s:130,size:2.6,a:0.8}]
    .forEach((L, li) => {
      const count = Math.round(L.n * density);
      for(let i=0;i<count;i++){
        // Warmth belongs to the star, decided at birth - only brightness
        // twinkles. A time-driven colour made every star strobe amber.
        stars.push({ x: rand(0,VW), y: rand(0,VH), speed:L.s, size:L.size, alpha:L.a,
                     layer:li, twinkle: rand(0,TAU), warm: Math.random() < 0.18 });
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
  // TURBO ENGINES streak the whole sky: stars and dust at nearly double
  // speed, so the boost is visible even when the thumb is still.
  const wf = warp * (SF.game && SF.game.world && SF.game.world.mods &&
                     SF.game.world.mods.turbo ? 1.9 : 1);
  bgPhase += dt*0.08*wf;
  // The backdrop is vertically tileable, so it can genuinely scroll rather
  // than drift - you are flying through it, not past a photograph. Slow on
  // purpose: the nebula is the far plane the star layers measure against.
  skyScroll = (skyScroll + dt*7.5*wf) % VH;
  for(let i=0;i<stars.length;i++){
    const s = stars[i];
    s.y += s.speed*wf*dt;
    s.twinkle += dt*2.5;
    if(s.y > VH){ s.y -= VH; s.x = rand(0, VW); }
  }
  for(let i=0;i<dust.length;i++){
    const d = dust[i];
    d.y += d.speed*wf*dt;
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

/* Two tiny radial-falloff star sprites - one warm, one cool - baked once.
   Hard axis-aligned squares read as stuck pixels; a soft dot reads as light. */
const starSprites = (() => {
  const make = (mid, edge) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = Math.ceil(6*BAKE);
    const c = cv.getContext("2d");
    if(c){
      const r = cv.width/2;
      const g = c.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.4, mid);
      g.addColorStop(1, edge);
      c.fillStyle = g;
      c.fillRect(0, 0, cv.width, cv.height);
    }
    return cv;
  };
  return { warm: make("rgba(255,233,196,0.9)", "rgba(255,204,130,0)"),
           cool: make("rgba(207,232,255,0.85)", "rgba(160,205,255,0)") };
})();

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
    // Drawn twice, offset by a screen height, so the wrap is seamless. The
    // explicit VW x VH destination folds away whatever dpr build() baked at.
    const y = skyScroll;
    ctx.drawImage(skyCanvas, 0, y, VW, VH);
    ctx.drawImage(skyCanvas, 0, y - VH, VW, VH);
  } else {
    ctx.fillStyle = "#05040f"; ctx.fillRect(0,0,VW,VH);
  }
  for(let i=0;i<stars.length;i++){
    const s = stars[i];
    // Real starfields aren't monochrome: a fixed scatter of warm among the
    // blue-white, with only the brightness twinkling.
    ctx.globalAlpha = Math.min(1, s.alpha*1.3) * (0.75 + Math.sin(s.twinkle)*0.25);
    const spr = s.warm && s.layer !== 2 ? starSprites.warm : starSprites.cool;
    const d = s.size*3;
    ctx.drawImage(spr, s.x - d/2, s.y - d/2, d, d + (s.layer===2 ? 3 : 0));
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

  // TINY SHIP draws smaller through artScale, set with the shrunken hitbox in
  // startMission so the eye and the collision agree about what "tiny" means.
  const size = 58 * (p.artScale || 1);
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
    if(mate) label(ctx, mate.callsign.toUpperCase(), p.x+dx, y+6+ds*0.95, mate.color, 10);
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
    // The rim IS the gameplay shield radius - the bubble may soften but the
    // edge must sit exactly where the collision does.
    const rad = g.type.shieldRadius * (0.4 + 0.6*easeOutCubic(g.spawnAnim));
    const col = hexToRgbStr(g.type.tint || "#22d3ee");
    const pulse = 0.5 + Math.sin(t*1.4)*0.5;      // slow breath, sim-time
    const grad = ctx.createRadialGradient(g.x, g.y, rad*0.2, g.x, g.y, rad);
    grad.addColorStop(0, "rgba(" + col + ",0)");
    grad.addColorStop(0.6, "rgba(" + col + ",0.05)");
    grad.addColorStop(1, "rgba(" + col + "," + (0.10 + pulse*0.04).toFixed(3) + ")");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(g.x, g.y, rad, 0, TAU); ctx.fill();
    // A 2px energy rim, brighter toward the light, never a dashed survey line.
    const rim = ctx.createLinearGradient(g.x, g.y - rad, g.x, g.y + rad);
    rim.addColorStop(0, "rgba(" + col + "," + (0.38 + pulse*0.14).toFixed(3) + ")");
    rim.addColorStop(1, "rgba(" + col + "," + (0.16 + pulse*0.08).toFixed(3) + ")");
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.x, g.y, rad, 0, TAU); ctx.stroke();
  }

  // Telegraphs and beams go under the sprites, so nothing is ever hidden by
  // the warning about it.
  for(let i=0;i<items.length;i++){
    const e = items[i];
    if(!e.alive) continue;
    /*
     * WANTED. A bounty target has to be pickable out of a moving crowd from
     * the sofa, so it gets a spinning gold ring UNDER the hull and a chevron
     * over it - never a tint on the sprite, which would fight the type
     * colours a kid has already learned to read.
     */
    if(e.bounty){
      const R = e.r + 12 + Math.sin(t*4)*2;
      ctx.save();
      ctx.strokeStyle = "rgba(255,210,63,0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -t*26;
      ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,210,63,0.95)";
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - R - 11);
      ctx.lineTo(e.x - 6, e.y - R - 3);
      ctx.lineTo(e.x + 6, e.y - R - 3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // A Marksman draws the line it is about to fire down, filling as it aims.
    if(e.type.chargeTime && e.state === 1 && world.player){
      const k = clamp(e.charge/e.chargeTime, 0, 1);
      const dx = world.player.x - e.x, dy = world.player.y - e.y;
      const l = Math.max(1, Math.hypot(dx, dy));
      // A solid thread that fades with distance - the dashes read as a
      // debug ray. Brightness still ramps with the charge, so the warning
      // keeps its urgency.
      const ex = e.x + dx/l*VH, ey = e.y + dy/l*VH;
      const lg = ctx.createLinearGradient(e.x, e.y, ex, ey);
      lg.addColorStop(0, "rgba(244,114,182," + (0.25 + k*0.55).toFixed(2) + ")");
      lg.addColorStop(1, "rgba(244,114,182,0)");
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1 + k*2.5;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
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
      const box = artBox(drawn, size);          // the sprite carries its own padding
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
    if(e.carriesRescue)                           // marker so you know what to shoot
      label(ctx, "SOS", e.x, e.y - e.r - 8, "#ffd23f", 13);
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
    if(e.loot > 0)                                // what this thief is carrying
      label(ctx, "£" + e.loot, e.x, e.y - e.r - 8, "#ffd23f", 12);
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
    label(ctx, e.type.named, e.x, e.y - R - 22, "#ff9de0", 13);
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
  cv.width = Math.ceil((w + m*2)*BAKE); cv.height = Math.ceil((h + m*2)*BAKE);
  const c = cv.getContext("2d");
  if(!c) return null;
  c.scale(BAKE, BAKE);                           // geometry stays in logical px
  const cx = (w + m*2)/2, cy = (h + m*2)/2;
  // Halo - tight, or the additive pass turns every volley into fog.
  const halo = c.createRadialGradient(cx, cy, 1, cx, cy, Math.max(w, h*0.6));
  halo.addColorStop(0, color); halo.addColorStop(1, "rgba(0,0,0,0)");
  c.globalAlpha = 0.34; c.fillStyle = halo;
  c.fillRect(0, 0, w + m*2, h + m*2);
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
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(16*BAKE); cv.height = Math.ceil(64*BAKE);
  const c = cv.getContext("2d");
  if(c){
    c.scale(BAKE, BAKE);
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
  cv.width = cv.height = Math.ceil(m*2*BAKE);
  const c = cv.getContext("2d");
  if(!c) return null;
  c.scale(BAKE, BAKE);
  const col = kind === "orb" ? "255,124,229" : "255,93,115";
  const halo = c.createRadialGradient(m, m, 1, m, m, m);
  halo.addColorStop(0, "rgba(" + col + ",0.85)");
  halo.addColorStop(0.45, "rgba(" + col + ",0.28)");
  halo.addColorStop(1, "rgba(" + col + ",0)");
  c.fillStyle = halo; c.fillRect(0, 0, m*2, m*2);
  c.fillStyle = "rgb(" + col + ")";
  c.beginPath(); c.arc(m, m, R, 0, TAU); c.fill();
  /*
   * A white-hot centre, concentric rather than an offset highlight. Offset
   * reads as a lit ball with a light source somewhere; centred reads as
   * something burning - and it puts the brightest pixel exactly on the point
   * that will actually hit you, which is the pixel you want to be tracking.
   */
  const hot = c.createRadialGradient(m, m, 0, m, m, R*0.82);
  hot.addColorStop(0, "rgba(255,255,255,0.98)");
  hot.addColorStop(0.42, "rgba(255,255,255,0.6)");
  hot.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = hot;
  c.beginPath(); c.arc(m, m, R*0.82, 0, TAU); c.fill();
  enemyBoltCache[key] = cv;
  return cv;
}

/*
 * The tail that trails an enemy bolt, drawn behind it along its travel.
 * Enemy fire used to be a dot, and a dot tells you where a shot IS but not
 * where it is GOING - which is the only question that matters when you are
 * choosing which way to dodge. The tail is tinted with the bolt's own colour
 * and never white, so at a glance it can't be mistaken for your own fire.
 */
const enemyTailCache = {};
function enemyTail(kind){
  if(enemyTailCache[kind]) return enemyTailCache[kind];
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(16*BAKE); cv.height = Math.ceil(48*BAKE);
  const c = cv.getContext("2d");
  if(!c) return null;
  c.scale(BAKE, BAKE);
  const col = kind === "orb" ? "255,124,229" : "255,93,115";
  const g = c.createLinearGradient(0, 0, 0, 48);
  g.addColorStop(0, "rgba(" + col + ",0.6)");
  g.addColorStop(0.5, "rgba(" + col + ",0.2)");
  g.addColorStop(1, "rgba(" + col + ",0)");
  c.fillStyle = g;
  // A wedge, full width at the bolt and pinched to nothing at the far end.
  c.beginPath();
  c.moveTo(1, 0); c.lineTo(15, 0); c.lineTo(8.7, 48); c.lineTo(7.3, 48);
  c.closePath(); c.fill();
  enemyTailCache[kind] = cv;
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
    const dw = spr.width/BAKE, dh = spr.height/BAKE;   // logical size, retina bake
    ctx.drawImage(spr, -dw*0.5*k, -dh*0.5*k, dw*k, dh*k);
    ctx.restore();
  }
  ctx.restore();

  const ebs = world.enemyBullets.items;
  for(let i=0;i<ebs.length;i++){
    const b = ebs[i];
    if(!b.alive) continue;
    // BUBBLE SHOTS draws its own thing: a soap bubble with a highlight, no
    // comet tail. Reusing the bolt sprite would have made a slow shot look
    // like a fast one, which is a lie about how much time the kid has.
    if(b.kind === "bubble"){
      const r = b.r*1.5, wob = Math.sin(b.age*7 + b.x*0.05)*0.12;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(1 + wob, 1 - wob);
      const g = ctx.createRadialGradient(-r*0.3, -r*0.3, r*0.1, 0, 0, r);
      g.addColorStop(0, "rgba(255,255,255,0.75)");
      g.addColorStop(0.45, "rgba(165,243,252,0.30)");
      g.addColorStop(1, "rgba(56,189,248,0.55)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "rgba(224,252,255,0.8)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(-r*0.34, -r*0.36, r*0.20, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      continue;
    }
    const kind = b.kind === "orb" ? "orb" : "aimed";
    const sp = Math.hypot(b.vx || 0, b.vy || 0);
    /*
     * Only a bolt that is genuinely travelling earns a tail: hang a long
     * comet trail off a slow drifting orb and it looks fast, which is a lie
     * about how much time you have. Length follows speed for the same
     * reason, so how quick a shot looks is how quick it is.
     */
    const tail = sp > 40 ? enemyTail(kind) : null;
    if(tail){
      const len = (9 + Math.min(sp, 620)*0.055) * (b.r/4);
      // Wide enough at the base to read as the bolt's own wake. Narrower than
      // the bolt and it looks like a pin stuck through it.
      const w = b.r*2.6;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(b.x, b.y);
      // The sprite's tail runs down its +Y; aim that AWAY from the travel.
      ctx.rotate(Math.atan2(b.vx, -b.vy));
      ctx.drawImage(tail, -w/2, 0, w, len);
      ctx.restore();
    }
    const spr = enemyBolt(kind, b.r);
    if(spr){
      const d = spr.width/BAKE;                  // logical size, retina bake
      ctx.drawImage(spr, b.x - d/2, b.y - d/2, d, d);
    }
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
      cv.width = cv.height = Math.ceil(26*BAKE);
      const c = cv.getContext("2d");
      if(!c) break;
      c.scale(BAKE, BAKE);
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
 * The survivor pod, baked once: a proper little craft in the fleet's drawing
 * style - hull capsule, glass visor with the astronaut inside, the gold
 * rescue ring kept - instead of the white blob the first pass shipped. Only
 * the beacon glow animates, blitted live over the bake.
 */
let podSprite = null, podGlowSprite = null;
function bakePod(){
  if(podSprite) return podSprite;
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.ceil(44*BAKE);
  const c = cv.getContext("2d");
  if(!c) return null;
  c.scale(BAKE, BAKE);
  c.translate(22, 22);
  // the gold rescue ring, dark-edged so it holds on a bright sky
  c.strokeStyle = "rgba(138,95,8,0.9)"; c.lineWidth = 3.6;
  c.beginPath(); c.arc(0, 0, 16, 0, TAU); c.stroke();
  c.strokeStyle = "#ffd23f"; c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, 16, 0, TAU); c.stroke();
  // hull capsule, lit from the upper left like everything else on screen
  const hull = c.createLinearGradient(-8, -12, 8, 12);
  hull.addColorStop(0, "#e8eef8");
  hull.addColorStop(0.55, "#aebdd6");
  hull.addColorStop(1, "#66779a");
  c.fillStyle = hull;
  c.strokeStyle = "rgba(18,26,44,0.9)"; c.lineWidth = 1.4;
  roundRect(c, -7.5, -12, 15, 24, 7);
  c.fill(); c.stroke();
  // glass visor with the survivor: dark glass, white helmet, blue visor
  c.fillStyle = "#0c1428";
  c.beginPath(); c.ellipse(0, -4.5, 5.6, 5.2, 0, 0, TAU); c.fill();
  c.fillStyle = "#e8ecf4";
  c.beginPath(); c.arc(0, -5.2, 2.6, 0, TAU); c.fill();
  c.fillStyle = "#2b6ea8";
  c.beginPath(); c.ellipse(0, -5.4, 1.7, 1.3, 0, 0, TAU); c.fill();
  c.fillStyle = "#cfd8e8";                              // shoulders
  c.beginPath(); c.ellipse(0, -1.6, 2.8, 1.6, 0, 0, TAU); c.fill();
  c.strokeStyle = "rgba(150,200,255,0.6)"; c.lineWidth = 1;
  c.beginPath(); c.ellipse(0, -4.5, 5.6, 5.2, 0, 0, TAU); c.stroke();
  c.fillStyle = "rgba(255,255,255,0.55)";               // glass gleam
  c.beginPath(); c.ellipse(-2.2, -7.4, 1.8, 0.9, -0.6, 0, TAU); c.fill();
  // hull seam and thruster nub
  c.strokeStyle = "rgba(18,26,44,0.55)"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(-7, 3); c.lineTo(7, 3); c.stroke();
  c.fillStyle = "#3a4a68";
  roundRect(c, -3, 11, 6, 3, 1.5);
  c.fill();
  // the beacon lamp itself; its warm glow is drawn live so it can breathe
  c.fillStyle = "#ff5d43";
  c.beginPath(); c.arc(0, -14.5, 1.8, 0, TAU); c.fill();
  podSprite = cv;
  const g = document.createElement("canvas");
  g.width = g.height = Math.ceil(36*BAKE);
  const gc = g.getContext("2d");
  if(gc){
    const r = g.width/2;
    const grad = gc.createRadialGradient(r, r, 1, r, r, r);
    grad.addColorStop(0, "rgba(255,180,120,0.8)");
    grad.addColorStop(0.5, "rgba(255,120,70,0.28)");
    grad.addColorStop(1, "rgba(255,120,70,0)");
    gc.fillStyle = grad;
    gc.fillRect(0, 0, g.width, g.height);
    podGlowSprite = g;
  }
  return cv;
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
    label(ctx, "OUR HAULER — PROTECT IT", 0, h.r + 26, "#bfe3ff", 13);
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
/*
 * Act 4's furniture, drawn under the traffic: the Undertow's gravity wells,
 * the Foundry's belts and assembler maws, the Tithe Serpent's spine, and
 * the Chorus's beat pulse. One entry point so the frame composition stays
 * one line; each piece draws only when its mission flag is live.
 */
function drawAct4(ctx, run, world, timeMs){
  if(!run || run.ended) return;

  /* --- THE RING: the two seams -------------------------------------------
     A pair of shimmering vertical edges, so the place looks like it has a
     join rather than looking like the walls stopped working. They breathe on
     a slow sine and brighten when the ship is near one. */
  if(world && world.wrap){
    const p = world.player;
    const near = p ? Math.min(p.x, VW - p.x) : 999;
    const heat = near < 70 ? 1 - near/70 : 0;
    const puls = 0.34 + Math.sin(timeMs/420) * 0.08 + heat * 0.42;
    [0, VW].forEach(x => {
      const g = ctx.createLinearGradient(x === 0 ? 0 : VW, 0, x === 0 ? 30 : VW - 30, 0);
      g.addColorStop(0, "rgba(127,233,208," + puls.toFixed(3) + ")");
      g.addColorStop(1, "rgba(127,233,208,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x === 0 ? 0 : VW - 30, 0, 30, VH);
    });
  }

  /* --- THE LIFELINE: the door, and the load ------------------------------
     The dock sits exactly at PLAY_TOP, which is the ship's real ceiling - so
     the target is at the top of the band the ship can actually reach rather
     than somewhere off-screen it can never touch. It drifts, so the run is
     never the same twice. */
  if(run.ferry){
    const fr = run.ferry;
    const TOP = SF.entityConst.PLAY_TOP;
    const open = fr.carried;              // green always; BRIGHT when loaded
    const puls = 0.55 + Math.sin(timeMs/240)*0.35;
    ctx.save();
    // the mouth
    const g = ctx.createLinearGradient(0, TOP - 26, 0, TOP + 22);
    g.addColorStop(0, open ? "rgba(74,222,128,0.60)" : "rgba(74,222,128,0.26)");
    g.addColorStop(1, "rgba(74,222,128,0)");
    ctx.fillStyle = g;
    ctx.fillRect(fr.doorX - 62, TOP - 26, 124, 48);
    ctx.strokeStyle = open
      ? "rgba(74,222,128," + (0.65 + puls*0.35).toFixed(2) + ")"
      : "rgba(74,222,128,0.52)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fr.doorX - 62, TOP + 8); ctx.lineTo(fr.doorX - 62, TOP - 18);
    ctx.lineTo(fr.doorX + 62, TOP - 18); ctx.lineTo(fr.doorX + 62, TOP + 8);
    ctx.stroke();
    // landing lights along the sill
    for(let i = -2; i <= 2; i++){
      ctx.fillStyle = "#4ade80";
      ctx.globalAlpha = 0.35 + (open ? puls*0.6 : 0.2);
      ctx.beginPath(); ctx.arc(fr.doorX + i*26, TOP + 8, 3, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The crate hanging under the hull, so "I am loaded" is visible, not remembered.
    if(open && world && world.player && world.player.alive){
      const p = world.player;
      ctx.translate(p.x, p.y + 26);
      ctx.fillStyle = "#8a6a45";
      roundRect(ctx, -11, -9, 22, 18, 3); ctx.fill();
      ctx.strokeStyle = "#5c4526"; ctx.lineWidth = 1.4;
      roundRect(ctx, -11, -9, 22, 18, 3); ctx.stroke();
      ctx.strokeStyle = "#cfe9fb"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(11, -1); ctx.stroke();
      // two short straps back up to the ship
      ctx.strokeStyle = "rgba(207,233,251,0.6)"; ctx.lineWidth = 1.6;
      [-7, 7].forEach(x => {
        ctx.beginPath(); ctx.moveTo(x, -9); ctx.lineTo(x*0.6, -20); ctx.stroke();
      });
    }
    ctx.restore();
  }

  /* --- THE BRIGHT SIDE: the flare ----------------------------------------
     A warning line first, then a sheet of fire with tongues licking off its
     top edge. No new entity and no new collision shape - the lethal thing is
     one y coordinate, and all of this is the picture of it. */
  if(run.flare){
    const fl = run.flare;
    if(fl.mode === "warn"){
      const a = 0.35 + Math.sin(timeMs/60)*0.25;
      ctx.save();
      ctx.strokeStyle = "rgba(255,214,138," + a.toFixed(3) + ")";
      ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.moveTo(0, fl.top); ctx.lineTo(VW, fl.top); ctx.stroke();
      ctx.setLineDash([]);
      const g = ctx.createLinearGradient(0, fl.top, 0, fl.top + 70);
      g.addColorStop(0, "rgba(255,180,90,0.16)");
      g.addColorStop(1, "rgba(255,180,90,0)");
      ctx.fillStyle = g; ctx.fillRect(0, fl.top, VW, 70);
      ctx.restore();
    }
    if(fl.y < VH + 40){
      ctx.save();
      // The body of the fire.
      const body = ctx.createLinearGradient(0, fl.y, 0, VH);
      body.addColorStop(0, "rgba(255,236,190,0.92)");
      body.addColorStop(0.25, "rgba(255,166,64,0.85)");
      body.addColorStop(1, "rgba(180,52,8,0.80)");
      ctx.fillStyle = body;
      ctx.fillRect(0, fl.y, VW, VH - fl.y + 10);
      // Tongues off the top edge, so it never reads as a flat rectangle.
      ctx.beginPath();
      ctx.moveTo(0, fl.y);
      for(let i = 0; i <= 14; i++){
        const x = (i/14) * VW;
        const h = 40 + Math.sin(timeMs/170 + i*1.7) * 26 + Math.sin(timeMs/70 + i) * 18;
        ctx.quadraticCurveTo(x - VW/28, fl.y - h, x, fl.y);
      }
      ctx.lineTo(VW, VH + 10); ctx.lineTo(0, VH + 10); ctx.closePath();
      const lick = ctx.createLinearGradient(0, fl.y - 80, 0, fl.y + 20);
      lick.addColorStop(0, "rgba(255,240,200,0)");
      lick.addColorStop(1, "rgba(255,190,96,0.75)");
      ctx.fillStyle = lick; ctx.fill();
      // A full-screen wash while it is actually lethal.
      if(fl.mode === "burn"){
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,190,110,0.12)";
        ctx.fillRect(0, 0, VW, VH);
      }
      ctx.restore();
    }
  }

  // --- THE UNDERTOW: the wells -------------------------------------------
  if(run.wells){
    const list = run.wells.list;
    for(let i = 0; i < list.length; i++){
      const w = list[i];
      // The reach: a soft dark iris with a teal rim at the influence edge.
      const g = ctx.createRadialGradient(w.x, w.y, w.r, w.x, w.y, w.R);
      g.addColorStop(0, "rgba(4,10,14,0.55)");
      g.addColorStop(0.55, "rgba(6,20,26,0.18)");
      g.addColorStop(1, "rgba(45,212,191,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.R, 0, TAU); ctx.fill();
      // Spiral arms: three broken rings turning at different rates.
      for(let ring = 0; ring < 3; ring++){
        const rr = w.R * (0.30 + ring*0.24);
        const a0 = w.spin * (1.8 - ring*0.5) + ring*2.1;
        ctx.strokeStyle = "rgba(126,240,230," + (0.34 - ring*0.09).toFixed(2) + ")";
        ctx.lineWidth = 2.5 - ring*0.6;
        for(let seg = 0; seg < 3; seg++){
          ctx.beginPath();
          ctx.arc(w.x, w.y, rr, a0 + seg*TAU/3, a0 + seg*TAU/3 + TAU/4.4);
          ctx.stroke();
        }
      }
      // The eye. Anything that touches this is gone.
      const eye = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, w.r*2.2);
      eye.addColorStop(0, "rgba(230,255,252,0.9)");
      eye.addColorStop(0.35, w.maw ? "rgba(45,212,191,0.6)" : "rgba(45,212,191,0.45)");
      eye.addColorStop(1, "rgba(45,212,191,0)");
      ctx.fillStyle = eye;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r*2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = "#04110f";
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r*0.62, 0, TAU); ctx.fill();
    }
  }

  // --- THE FOUNDRY: belts and the assembler maws --------------------------
  if(run.foundry){
    const belts = run.foundry.belts;
    for(let i = 0; i < belts.length; i++){
      const b = belts[i];
      // The lane.
      ctx.fillStyle = "rgba(12,10,8,0.62)";
      ctx.fillRect(0, b.y - 14, VW, 28);
      ctx.strokeStyle = "rgba(251,146,60,0.30)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, b.y - 14); ctx.lineTo(VW, b.y - 14);
      ctx.moveTo(0, b.y + 14); ctx.lineTo(VW, b.y + 14);
      ctx.stroke();
      // Rolling chevrons say which way the future is headed.
      const off = ((timeMs/1000) * b.speed * b.dir) % 34;
      ctx.strokeStyle = "rgba(251,146,60,0.35)";
      ctx.lineWidth = 2;
      for(let x = -34 + off; x < VW + 34; x += 34){
        ctx.beginPath();
        ctx.moveTo(x - 5*b.dir, b.y - 6);
        ctx.lineTo(x + 5*b.dir, b.y);
        ctx.lineTo(x - 5*b.dir, b.y + 6);
        ctx.stroke();
      }
      // The assembler maw at the receiving end: teeth, stripes, appetite.
      const mx = b.dir > 0 ? VW - 40 : 40, flip = b.dir > 0 ? 1 : -1;
      ctx.save();
      ctx.translate(mx, b.y);
      ctx.scale(flip, 1);
      ctx.fillStyle = "#1c1410";
      ctx.fillRect(-6, -26, 46, 52);
      ctx.strokeStyle = "rgba(251,146,60,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-6, -26, 46, 52);
      for(let t = 0; t < 3; t++){
        ctx.fillStyle = "#fb923c";
        ctx.beginPath();
        ctx.moveTo(-6, -20 + t*16);
        ctx.lineTo(-16, -14 + t*16);
        ctx.lineTo(-6, -8 + t*16);
        ctx.closePath(); ctx.fill();
      }
      // hazard stripes on the housing
      ctx.fillStyle = "rgba(255,210,63,0.28)";
      for(let t = 0; t < 4; t++) ctx.fillRect(2 + t*10, -26, 5, 52);
      // the appetite light
      ctx.fillStyle = "rgba(255,93,115," + (0.4 + Math.sin(timeMs/240)*0.3).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(30, -18, 3.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  // --- THE TITHE SERPENT: spine and the weak ring's lantern ---------------
  if(run.serpent && run.serpent.head){
    const es = world.enemies.items;
    const rings = [];
    let head = null;
    for(let i = 0; i < es.length; i++){
      const e = es[i];
      if(!e.alive) continue;
      if(e.typeId === "serpent") head = e;
      else if(e.typeId === "serpentSeg") rings.push(e);
    }
    if(head){
      rings.sort((a, b) => a.segIndex - b.segIndex);
      // The spine: one thick rope from head through every ring, under the art.
      ctx.strokeStyle = "rgba(16,64,54,0.85)";
      ctx.lineWidth = 13;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      for(let i = 0; i < rings.length; i++) ctx.lineTo(rings[i].x, rings[i].y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(47,191,154,0.35)";
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      // The weak ring glows like a lantern - the one thing to aim at.
      for(let i = 0; i < rings.length; i++){
        if(!rings[i].weak) continue;
        const wseg = rings[i];
        const pulse = 0.6 + Math.sin(timeMs/170)*0.4;
        const g = ctx.createRadialGradient(wseg.x, wseg.y, 0, wseg.x, wseg.y, 34);
        g.addColorStop(0, "rgba(255,235,150," + (0.55*pulse).toFixed(2) + ")");
        g.addColorStop(0.5, "rgba(255,210,63," + (0.30*pulse).toFixed(2) + ")");
        g.addColorStop(1, "rgba(255,210,63,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(wseg.x, wseg.y, 34, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(255,210,63," + (0.5 + pulse*0.3).toFixed(2) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(wseg.x, wseg.y, 22 + pulse*3, 0, TAU); ctx.stroke();
      }
    }
  }

  // --- THE CHORUS: the beat, visible --------------------------------------
  if(run.beat){
    const bt = run.beat;
    const k = (timeMs - bt.pulseMs) / 420;
    if(bt.pulseMs && k >= 0 && k < 1){
      // One ring rolls out from the top of the sky on every beat.
      ctx.strokeStyle = "rgba(232,121,249," + (0.4*(1 - k)).toFixed(2) + ")";
      ctx.lineWidth = 3*(1 - k) + 1;
      ctx.beginPath(); ctx.arc(VW/2, 60, 30 + k*VW*0.75, 0, TAU); ctx.stroke();
      // And the whole sky takes a breath.
      ctx.fillStyle = "rgba(253,244,255," + (0.05*(1 - k)).toFixed(3) + ")";
      ctx.fillRect(0, 0, VW, VH);
    }
    // The measure: four little drums under the HUD, the live one lit.
    const silence = timeMs < bt.silenceUntil;
    for(let i = 0; i < 4; i++){
      const on = !silence && bt.count % 4 === i;
      ctx.fillStyle = silence ? "rgba(232,121,249,0.15)"
                    : on ? "rgba(232,121,249,0.9)" : "rgba(232,121,249,0.28)";
      ctx.beginPath();
      ctx.arc(VW/2 + (i - 1.5)*16, 176, on ? 4.5 : 3, 0, TAU);
      ctx.fill();
    }
  }
}

/*
 * DISCO SKY. The Wacky Sky's rule is that a modifier must be visible in
 * seconds, and nothing is more visible than the entire screen changing
 * colour on a beat. Four gel lights sweep the field and the whole frame gets
 * a wash that cycles hue every couple of seconds. It is drawn OVER the world
 * and UNDER the HUD, at low alpha with "overlay" and "lighter", so it recolours
 * the sky without ever hiding a bullet - the one thing the silly mode is not
 * allowed to do.
 */
function drawDisco(ctx, timeMs){
  // Calmer visuals: the hue still rolls (it is the joke), but a quarter as
  // fast and without the pulse, so the sky washes rather than strobes.
  const calm = SF.fx.calmEnabled();
  const t = timeMs/1000 * (calm ? 0.25 : 1);
  const hue = (t*84) % 360;
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = calm ? 0.14 : 0.20 + Math.sin(t*3.2)*0.06;
  ctx.fillStyle = "hsl(" + hue.toFixed(0) + ",90%,55%)";
  ctx.fillRect(0, 0, VW, VH);
  // Gel beams from above, each on its own hue and its own slow sweep.
  ctx.globalCompositeOperation = "lighter";
  for(let i = 0; i < 4; i++){
    const h = (hue + i*90) % 360;
    const x = VW*0.5 + Math.sin(t*0.8 + i*1.7)*VW*0.55;
    const g = ctx.createLinearGradient(x, 0, x + Math.sin(t*0.5 + i)*160, VH);
    g.addColorStop(0, "hsla(" + h.toFixed(0) + ",95%,62%,0.20)");
    g.addColorStop(1, "hsla(" + h.toFixed(0) + ",95%,62%,0)");
    ctx.fillStyle = g;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x - 26, -10);
    ctx.lineTo(x + 26, -10);
    ctx.lineTo(x + 150 + Math.sin(t*0.5 + i)*160, VH + 10);
    ctx.lineTo(x - 150 + Math.sin(t*0.5 + i)*160, VH + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

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
      if(spr) ctx.drawImage(spr, -13, -13, 26, 26);
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
    } else if(it.kind === "papahead"){
      // The souvenir: a tiny crowned Papa, tumbling down after the big one.
      ctx.rotate(it.angle*0.5);
      papaHead(ctx, 13, { crown: true });
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
    } else if(it.kind === "crate"){
      /*
       * THE LIFELINE's cargo. A plain strapped box, deliberately unglamorous
       * next to the powerups - it is not a prize, it is a job. While it is
       * floating after a drop it wears a bright ring so it can be found again
       * in a busy sky, which is the point of the four-second grace.
       */
      const bob = Math.sin(timeMs/260)*2;
      if(it.floatFor > 0){
        const puls = 0.5 + Math.sin(timeMs/110)*0.5;
        ctx.save();
        ctx.strokeStyle = "rgba(125,211,252," + (0.4 + puls*0.5).toFixed(2) + ")";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, bob, 22 + puls*5, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(0, bob);
      ctx.fillStyle = "#8a6a45";
      roundRect(ctx, -13, -11, 26, 22, 3); ctx.fill();
      ctx.strokeStyle = "#5c4526"; ctx.lineWidth = 1.6;
      roundRect(ctx, -13, -11, 26, 22, 3); ctx.stroke();
      ctx.strokeStyle = "#cfe9fb"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-13, -2); ctx.lineTo(13, -2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, -11); ctx.lineTo(-3, 11); ctx.stroke();
      ctx.restore();
    } else if(it.kind === "rescue"){
      // A drifting survivor: capsule, glass visor, gold rescue ring - and a
      // warm beacon that breathes. Baked once; only the glow animates.
      const bob = Math.sin(timeMs/220)*2;
      const pulse = 0.55 + Math.sin(timeMs/380)*0.35;
      const spr = bakePod();
      if(podGlowSprite){
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.28 + pulse*0.22;
        ctx.drawImage(podGlowSprite, -18, -18 + bob - 4, 36, 36);
        ctx.restore();
      }
      if(spr) ctx.drawImage(spr, -22, -22 + bob, 44, 44);
      else { ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.arc(0, bob, 13, 0, TAU); ctx.fill(); }
      // the lamp brightens on the same breath as the glow
      ctx.fillStyle = "rgba(255,120,80," + (0.35 + pulse*0.5).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(0, -14.5 + bob, 2.6, 0, TAU); ctx.fill();
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
  // KING PAPA: the Star Vault's photographed head on a little gold rocket -
  // and, once he is "dying", a twelve-second cartoon instead of a corpse.
  if(boss.def.photo){
    if(boss.papaDeath) drawPapaDeath(ctx, boss, bx, by, size, timeMs);
    else drawPapaBoss(ctx, boss, bx, by, size, damage, timeMs);
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
  const bossPng = !bossArt && assetsReady ? tinted(assets.enemy, boss.tint) : null;
  if(bossArt || bossPng){
    const B = bossBufCtx;
    B.setTransform(1,0,0,1,0,0);
    B.clearRect(0,0,220,220);
    B.save();
    B.translate(110,110);
    if(bossArt){
      const box = artBox(bossArt, size);
      B.drawImage(bossArt, -box/2, -box/2, box, box);
    } else {
      B.rotate(Math.PI);
      B.drawImage(bossPng, -size/2, -size/2, size, size);
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
      /*
       * A blown part is the clearest progress the fight has, and it used to
       * leave a flat dark dot - the same read as a shadow. Now it is a hole
       * that is still burning: soot around it, a molten lip, and a plume
       * streaming back off the hull. You can count how far in you are by how
       * many fires the boss is carrying.
       */
      const R = wp.r*0.8, t = timeMs/1000, flick = 0.5 + Math.sin(t*5.3 + wp.ox)*0.5;
      const soot = ctx.createRadialGradient(wx, wy, 0, wx, wy, R*2.2);
      soot.addColorStop(0, "rgba(10,8,12,0.6)");
      soot.addColorStop(1, "rgba(10,8,12,0)");
      ctx.fillStyle = soot;
      ctx.beginPath(); ctx.arc(wx, wy, R*2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(14,8,10,0.92)";
      ctx.beginPath(); ctx.arc(wx, wy, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(226," + Math.round(100 + flick*70) + ",56,0.75)";
      ctx.lineWidth = Math.max(1, R*0.16);
      ctx.beginPath(); ctx.arc(wx, wy, R, 0, TAU); ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const pl = ctx.createLinearGradient(wx, wy, wx, wy - R*3);
      pl.addColorStop(0, "rgba(255,180,90,0.42)");
      pl.addColorStop(0.45, "rgba(255,110,60,0.16)");
      pl.addColorStop(1, "rgba(120,80,90,0)");
      ctx.fillStyle = pl;
      ctx.beginPath();
      ctx.moveTo(wx - R*0.55, wy);
      ctx.lineTo(wx + R*0.55, wy);
      ctx.lineTo(wx + R*0.14, wy - R*(2.4 + flick*0.8));
      ctx.lineTo(wx - R*0.14, wy - R*(2.4 + flick*0.8));
      ctx.closePath(); ctx.fill();
      ctx.restore();
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

/*
 * The warning grammar, shared: a WARNING column is a transparent gradient
 * wash between animated dashed rails - see the rule above. Everyday boss
 * telegraphs borrow it too, so one language covers the whole game.
 * k ramps 0 -> 1 as the strike approaches.
 */
function warnColumn(ctx, cx, w, yTop, rgb, k, timeMs){
  ctx.save();
  const g = ctx.createLinearGradient(cx - w/2, 0, cx + w/2, 0);
  g.addColorStop(0, "rgba(" + rgb + ",0)");
  g.addColorStop(0.5, "rgba(" + rgb + "," + (0.16 + k*0.3).toFixed(2) + ")");
  g.addColorStop(1, "rgba(" + rgb + ",0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - w/2, yTop, w, VH - yTop);
  ctx.globalAlpha = 0.55 + k*0.25 + Math.sin(timeMs/45)*0.2;
  ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);
  ctx.lineDashOffset = -timeMs/28;
  ctx.beginPath();
  ctx.moveTo(cx - w/2, yTop); ctx.lineTo(cx - w/2, VH);
  ctx.moveTo(cx + w/2, yTop); ctx.lineTo(cx + w/2, VH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.restore();
}

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
        warnColumn(ctx, lx, L.w, 0, "255,93,115", k, timeMs);
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
      // Below the ring when there's room, above when there isn't - either way
      // clear of the centre band where mission banners live.
      const ly = n.cy + n.r + 26 < VH - 40 ? n.cy + n.r + 26 : n.cy - n.r - 16;
      label(ctx, "GET IN THE RING!", n.cx, ly, "#4ade80", 15);
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
      label(ctx, la.side < 0 ? "→ THIS SIDE" : "THIS SIDE ←",
            VW/2 + (la.side < 0 ? 88 : -88), VH*0.72, "#4ade80", 15);
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
    label(ctx, f.name, f.x, f.y + 30, f.color, 9);
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

  // Bars ease in with the alarm and ease away over the resumed fight - the
  // 'out' beat runs after gameplay is already back (see bossintro.js).
  const barK = beat.id === "alarm" ? easeOutCubic(beat.k)
             : beat.id === "out"   ? 1 - easeOutCubic(beat.k) : 1;
  const bar = barK * VH*0.09;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VW, bar);
  ctx.fillRect(0, VH - bar, VW, bar);

  // The dark falls fast, lifts as the hull comes down. Never fully black -
  // that much dark belongs to the Devourer alone.
  let dark = 0;
  if(beat.id === "alarm") dark = beat.k * 0.62;
  else if(beat.id === "rise") dark = 0.62 - beat.k*0.34;
  else if(beat.id === "out") dark = 0.28 * (1 - easeOutCubic(beat.k));
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
    // A hazard sweep along each bar's inner edge, in the boss's colour.
    if(bar > 3){
      const sx = ((timeMs % 1100)/1100) * (VW + 240) - 120;
      const sw = ctx.createLinearGradient(sx - 120, 0, sx + 120, 0);
      sw.addColorStop(0, "rgba(" + rgb + ",0)");
      sw.addColorStop(0.5, "rgba(" + rgb + ",0.55)");
      sw.addColorStop(1, "rgba(" + rgb + ",0)");
      ctx.fillStyle = sw;
      ctx.fillRect(0, bar - 3, VW, 3);
      ctx.fillRect(0, VH - bar, VW, 3);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = clamp(beat.k*2.2, 0, 1);
    label(ctx, "ALL WINGS — CONTACT", VW/2, VH*0.45, "#ffd9de", 20, 600);
    ctx.globalAlpha = 1;
  }
  if(beat.id === "rise"){
    ctx.globalAlpha = clamp(beat.k*1.8, 0, 1);
    label(ctx, "MASS: LARGE   ·   POWER: RISING", VW/2, VH - bar - 24, tint, 13);
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
 * Tries each spelling in turn and keeps the first that loads, so whatever the
 * family actually uploads works: no renaming, no converting, no coming back to
 * ask which extension the code wanted.
 *
 * THE SWEEP HAS TO REPEAT, and that is the whole point of the retry state
 * below. It used to walk the list once and then latch the "?" medallion
 * forever, which conflated two very different things: "this spelling does not
 * exist" (permanent, and 404s instantly) and "that request failed" (transient
 * - a flaky moment, a mid-deploy hiccup, or the service worker's cache-first
 * fetch rejecting while briefly offline). One transient failure on the .png
 * therefore cost the WHOLE SESSION Papa's face: reproduced by serving a single
 * 503, after which the loader burned through all six candidates in a few
 * frames and never asked again, eight healthy seconds later. The kids got a
 * "?" until somebody reloaded the page.
 *
 * So a failed sweep now backs off and tries the list again, a handful of times
 * before accepting that the photo genuinely isn't there. Wall clock on
 * purpose: this is asset loading, not gameplay, and it has to keep ticking
 * while the game is paused.
 */
const PAPA_SRCS = ["assets/papa.png", "assets/papa.jpg", "assets/papa.jpeg",
                   "assets/papa.webp", "assets/papa.PNG", "assets/papa.JPG"];
const PAPA_RETRY_MS = 4000;    // between full sweeps
const PAPA_MAX_SWEEPS = 5;     // ~20s of trying, then it really is missing
let papaTry = 0, papaSweeps = 0, papaRetryAt = 0;
function papaPhoto(){
  if(papaImgReady) return papaImg;
  if(papaImg) return null;                       // one already in flight
  if(papaTry >= PAPA_SRCS.length){
    if(papaSweeps >= PAPA_MAX_SWEEPS) return null;
    if(Date.now() < papaRetryAt) return null;
    papaTry = 0; papaSweeps++;                   // go round again
  }
  try {
    const img = new Image();
    papaImg = img;
    img.onload = () => { papaImgReady = true; };
    img.onerror = () => {
      papaImg = null;
      papaTry++;                                 // next spelling
      if(papaTry >= PAPA_SRCS.length) papaRetryAt = Date.now() + PAPA_RETRY_MS;
    };
    img.src = PAPA_SRCS[papaTry];
  } catch(e){ papaTry = PAPA_SRCS.length; papaSweeps = PAPA_MAX_SWEEPS; }
  return null;
}
/**
 * Just the head: photo (or placeholder) in a gold ring, optional crown.
 * Everything that shows Papa - the boss, the five bouncing minis, the
 * souvenir pickups - draws through here, so his face is consistent.
 */
function papaHead(ctx, R, opts){
  const o = opts || {};
  const img = papaPhoto();
  ctx.beginPath(); ctx.arc(0, 0, R + R*0.09, 0, TAU);
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
    if(R > 60){
      ctx.font = "bold " + Math.round(R*0.20) + "px Rajdhani, Arial, sans-serif";
      ctx.fillText("PAPA'S PHOTO GOES HERE!", 0, R*0.72);
    }
  }
  if(o.blush > 0.02){
    ctx.fillStyle = "rgba(255,70,70," + Math.min(0.55, o.blush).toFixed(2) + ")";
    ctx.fillRect(-R, -R, R*2, R*2);
  }
  ctx.restore();
  if(o.crown !== false) papaCrown(ctx, R);
}
function papaCrown(ctx, R){
  ctx.save();
  ctx.rotate(-0.08);
  ctx.fillStyle = "#ffd23f";
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = Math.max(1, R*0.024);
  const cw = R*0.9, ch = R*0.42, cy = -R - R*0.05;
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
    ctx.arc(-cw/2 + cw*(k + 0.5)/5, cy - ch, Math.max(1.5, R*0.048), 0, TAU);
    ctx.fill();
  });
  ctx.restore();
}

/*
 * The five acts, drawn. The comedy is all in the SCALE curve: swell, pop to
 * nothing, come back bigger, deflate round the room, split, merge, fill the
 * screen. Nothing here is subtle and nothing here is meant to be.
 */
function drawPapaDeath(ctx, boss, bx, by, S, timeMs){
  const P = SF.papadeath;
  const a = P.act(), st = P.state();
  if(!a || !st) return;
  const R0 = S*0.42;

  if(a.id === "ow"){
    // Swells like a balloon, wobbling harder, then vanishes on the pop.
    const k = a.k;
    const swell = k < 0.72 ? 1 + k*1.15 : Math.max(0, 1 - (k-0.72)/0.28)*2.0;
    const wob = 1 + Math.sin(timeMs/45)*0.09*k;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(swell*wob, swell/wob);
    papaHead(ctx, R0, { blush: k*0.55 });
    ctx.restore();

  } else if(a.id === "back"){
    const k = a.k;
    if(k < 0.45){
      // BACK, bigger, spinning, indignant.
      const pop = Math.min(1, k/0.18);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.sin(k*22)*0.22);
      ctx.scale(pop*1.45, pop*1.45);
      papaHead(ctx, R0, { blush: 0.35 });
      ctx.restore();
    } else {
      // Let go: careening round the room, shrinking, crown left behind.
      const d = (k - 0.45)/0.55;
      ctx.save();
      ctx.translate(st.puffX, st.puffY);
      ctx.rotate(timeMs/90);
      const sc = Math.max(0.15, 1.45 - d*1.25);
      ctx.scale(sc, sc);
      papaHead(ctx, R0, { blush: 0.3, crown: false });
      ctx.restore();
    }

  } else if(a.id === "split" || a.id === "merge"){
    st.minis.forEach((m, i) => {
      if(!m.alive) return;          // popped: it is gone until he reassembles
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.rot);
      // A mini on its last hit wears the damage, so you can see which ones
      // still need a tap.
      const hurt = m.hp <= 1 ? 0.55 : 0.25;
      // On the merge they swell together into one enormous head.
      const grow = a.id === "merge" ? 1 + a.k*a.k*4.2 : 1;
      ctx.scale(grow, grow);
      papaHead(ctx, m.r, { blush: hurt, crown: i === 0 });
      ctx.restore();
    });
    if(a.id === "merge" && a.k > 0.82){
      // The wink: a white flash of a closing eye, right before the bang.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (a.k - 0.82)/0.18;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(VW/2, VH*0.42, S*1.1, 0, TAU); ctx.fill();
      ctx.restore();
    }

  } else if(a.id === "kaboom"){
    // He's gone. Only the crown is left, tumbling down.
    ctx.save();
    ctx.translate(st.crownX, st.crownY);
    ctx.rotate(Math.sin(timeMs/260)*0.5);
    papaCrown(ctx, 34);
    ctx.restore();
  }
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
    ctx.fillText("PAPA'S PHOTO GOES HERE!", 0, R*0.72);
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
    // Same warning grammar as the finale's lanes: transparent wash between
    // animated dashed rails - solid means live, outlined means incoming.
    warnColumn(ctx, boss.x, 50, boss.y, "255,93,115", k, timeMs);
    ctx.globalAlpha = 0.4 + k*0.5;
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

   Never drawn on a phone: comms mute themselves there, so
   current() is null for the whole mission (see comms.js).
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
  ctx.strokeStyle = "#a12744";
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0, r*0.85);
  ctx.bezierCurveTo(-r*1.25, 0, -r*0.7, -r, 0, -r*0.35);
  ctx.bezierCurveTo(r*0.7, -r, r*1.25, 0, 0, r*0.85);
  ctx.fill();
  ctx.stroke();
  // an upper-left gloss, so it reads as a lit token rather than flat ink
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath(); ctx.ellipse(-r*0.42, -r*0.42, r*0.3, r*0.2, -0.6, 0, TAU); ctx.fill();
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
  ctx.lineJoin = "round";
  if(up){
    ctx.fillStyle = "rgba(120,200,255,0.9)"; ctx.fill();
    ctx.strokeStyle = "#2f6f9f";              // darker rim on a filled pip
  } else ctx.strokeStyle = "rgba(120,200,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if(up){
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.ellipse(-r*0.35, -r*0.4, r*0.28, r*0.18, -0.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/* Combo pop: the multiplier physically bumps when it climbs, and spends a
   fifth of a second collapsing when it breaks instead of blinking off. */
let hudLastCombo = 0, hudComboPop = 0, hudLastMs = 0;
let hudComboText = "", hudComboHot = false, hudComboOut = 0;
/* Banner entrances are renderer state too: game.js just sets the text, the
   renderer notices it changed and eases the first quarter second in. */
let hudBannerKey = "", hudBannerT0 = 0;
let hudBossCard = "", hudBossCardT0 = 0;
let hudPanelGrad = null;   // identical every frame - built once

/*
 * GLOWING TEXT, BAKED.
 *
 * `shadowBlur` is far and away the most expensive thing you can ask a 2D canvas
 * to do - on older iOS Safari each enable forces a separate offscreen blur pass
 * - and the HUD was asking for five of them on every single frame, to glow
 * strings that change a few times a second at most. Measured on a busy
 * NIGHTMARE frame: 5.8 shadowBlur enables, sixty times a second, for a score
 * that ticks maybe twice.
 *
 * So bake each string once into a small offscreen canvas keyed by everything
 * that affects its pixels, and blit it thereafter. The cache is bounded: the
 * score and the wallet turn over as they count up, so it is swept rather than
 * left to grow.
 */
const glowCache = {};
let glowCacheN = 0;
function glowText(ctx, text, x, y, font, fill, glow, blur, align){
  const key = text + "|" + font + "|" + fill + "|" + glow + "|" + blur;
  let c = glowCache[key];
  if(!c){
    if(glowCacheN > 120){ for(const k in glowCache) delete glowCache[k]; glowCacheN = 0; }
    ctx.save();
    ctx.font = font;
    const w = Math.ceil((ctx.measureText(text).width || 10)) + blur*2 + 8;
    ctx.restore();
    const size = parseInt(/(\d+)px/.exec(font) ? /(\d+)px/.exec(font)[1] : 20, 10) || 20;
    const h = Math.ceil(size * 1.6) + blur*2;
    const off = document.createElement("canvas");
    off.width = Math.max(1, w * BAKE); off.height = Math.max(1, h * BAKE);
    const oc = off.getContext("2d");
    if(!oc) return null;
    oc.scale(BAKE, BAKE);
    oc.textBaseline = "top";
    oc.textAlign = "left";
    oc.font = font;
    oc.fillStyle = fill;
    oc.shadowColor = glow; oc.shadowBlur = blur;
    oc.fillText(text, blur + 4, blur);
    oc.shadowBlur = 0;
    c = glowCache[key] = { cv: off, w, h, pad: blur + 4, top: blur };
    glowCacheN++;
  }
  const dx = align === "right" ? x - (c.w - c.pad*2) - c.pad
           : align === "center" ? x - c.w/2 : x - c.pad;
  ctx.drawImage(c.cv, dx, y - c.top, c.w, c.h);
  return c;
}

function drawHud(ctx, game){
  const p = game.world.player;
  const run = game.run;
  const nowM = SF.game.now();
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
  // Zero-padded in the identity face - the padding is what keeps the column
  // steady now that the digits aren't typewriter-tabular.
  glowText(ctx, String(run.score).padStart(6, "0"), PAD + CLEAR, 19,
           "700 22px " + FONT, "white", "rgba(120,200,255,0.55)", 8, "left");

  ctx.textAlign = "center";
  ctx.fillStyle = run.difficulty.color;
  ctx.font = "bold 14px Rajdhani, Arial, sans-serif";
  ctx.fillText(run.mission.name.toUpperCase(), VW/2, 10);
  if(run.mission.modList && run.mission.modList.length){
    // The Wacky Sky wears its roll all run long. The banner fades after six
    // seconds, and without this the mode looked like a normal mission for
    // the other 24 minutes. It replaces the tier label - the mode is always
    // PILOT, so that line said nothing. One name at a time, cycling every
    // couple of seconds in the modifier's own colour: the full list drawn at
    // once collided with the score on one side and the money on the other.
    const list = run.mission.modList;
    const m = list[Math.floor(nowM / 2000) % list.length];
    ctx.fillStyle = m.color;
    ctx.font = "bold 11px Rajdhani, Arial, sans-serif";
    ctx.fillText(m.name, VW/2, 28);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 10px Rajdhani, Arial, sans-serif";
    ctx.fillText(run.difficulty.name, VW/2, 28);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,210,63,0.55)";
  ctx.font = "bold 9px Rajdhani, Arial, sans-serif";
  ctx.fillText(run.dailyDouble ? "CREDITS \u00d72" : "CREDITS", VW-PAD-CLEAR, 8);
  glowText(ctx, "£" + run.money, VW-PAD-CLEAR, 19,
           "700 20px " + FONT, "#ffd23f", "rgba(255,180,40,0.5)", 8, "right");
  ctx.textAlign = "left";

  // Lives and shields, labelled like every other readout. These were bare
  // triangles and circles - the game's own designer had to be told what they
  // meant, which settles whether they were readable.
  if(p){
    ctx.font = "bold 8px Rajdhani, Arial, sans-serif";
    ctx.fillStyle = "rgba(255,120,140,0.7)";
    ctx.fillText("LIVES", PAD + CLEAR, 40);
    // Five hearts is all the row can afford - a bigger stack becomes a count,
    // so a lucky run never shoves the shield pips off the edge.
    const shown = Math.min(p.lives, 5);
    for(let i=0;i<shown;i++){
      drawHeart(ctx, PAD + CLEAR + 7 + i*19, 56, 7, "#ff5d73");
    }
    let sx = PAD + CLEAR + Math.max(shown, 3)*19 + 18;
    if(p.lives > 5){
      ctx.fillStyle = "#ff8296";
      ctx.font = "700 12px " + FONT;
      ctx.fillText("×" + p.lives, PAD + CLEAR + shown*19 + 4, 50);
      sx += 26;
    }
    if(p.shieldMax > 0){
      ctx.fillStyle = "rgba(120,200,255,0.7)";
      ctx.fillText("SHIELD", sx, 40);
      for(let i=0;i<p.shieldMax;i++){
        drawShieldPip(ctx, sx + 7 + i*17, 56, 6.5, i < p.shield);
      }
    }
  }

  // Mission progress bar, second row right - wide enough to actually read,
  // built from the boss bar's glass-capsule recipe so the HUD speaks one
  // component language.
  const prog = clamp(run.progress, 0, 1);
  const barW = Math.round(Math.min(190, VW*0.33));
  const mbX = VW-PAD-barW, mbY = 44, mbH = 8;
  ctx.save();
  roundRect(ctx, mbX-2, mbY-2, barW+4, mbH+4, 6);
  ctx.fillStyle = "rgba(4,8,18,0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
  ctx.stroke();
  if(prog > 0){
    const mcol = run.bossActive ? "#ff5d73" : "#4ade80";
    roundRect(ctx, mbX, mbY, Math.max(mbH, barW*prog), mbH, 4);
    ctx.clip();
    const mfg = ctx.createLinearGradient(0, mbY, 0, mbY+mbH);
    mfg.addColorStop(0, "#ffffff");
    mfg.addColorStop(0.25, mcol);
    mfg.addColorStop(1, mcol);
    ctx.fillStyle = mfg;
    ctx.fillRect(mbX, mbY, barW*prog, mbH);
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "10px Rajdhani, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(run.bossActive ? "BOSS FIGHT" : "MISSION " + Math.round(prog*100) + "%", VW-PAD, 58);
  ctx.textAlign = "left";

  // Live objective tracker. It used to collapse to a three-star strip after
  // seven seconds - which meant the one moment you wanted to check "am I
  // still clean?" the labels were gone. It stays up now: bright and full-size
  // through the opening, then smaller and quieter, but always legible. It
  // sits on its own soft chip fully below the glass band (which fades out at
  // TOP_H+26), so the lines never straddle the band's bottom edge. During a
  // boss it steps below the boss bar instead of fighting it.
  const intro = run.time < 7 || SF.game.now() < run.objectiveFlashUntil;
  const oySize = intro ? 12 : 11;
  const oLH = oySize + 3;
  ctx.font = oySize + "px Rajdhani, Arial, sans-serif";
  let oy = run.bossActive ? 158 : TOP_H + 34;
  if(run.objectiveDefs.length){
    let chipW = 0;
    for(let i=0;i<run.objectiveDefs.length;i++){
      const def = run.objectiveDefs[i];
      const lw = ctx.measureText("\u2605 " + def.label + "  " + def.progress(run.stats)).width;
      if(lw > chipW) chipW = lw;
    }
    ctx.fillStyle = "rgba(4,8,20,0.45)";
    roundRect(ctx, PAD - 8, oy - 6, chipW + 16, run.objectiveDefs.length*oLH + 10, 8);
    ctx.fill();
    for(let i=0;i<run.objectiveDefs.length;i++){
      const def = run.objectiveDefs[i];
      const met = def.test(run.stats);
      ctx.fillStyle = met ? "rgba(74,222,128,0.9)"
                          : (intro ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.72)");
      ctx.fillText((met ? "\u2605 " : "\u2606 ") + def.label + "  " + def.progress(run.stats), PAD, oy);
      oy += oLH;
    }
    oy += 6;
  }

  // Active power-ups tick down in plain sight, right under the objectives. A
  // 9-second buff nobody can see the end of just reads as "my guns went weird
  // for a bit" - the draining bar is what makes it a resource kids race.
  if(p){
    const nowT = SF.game.now();   // the mission clock, so a pause doesn't drain the bars
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
      const b = boosts[i], bx = PAD, by = oy + 4 + i*17, w = 76, h = 13;
      // Same glass capsule as the boss bar, pill-sized: dark backing, white
      // hairline, a white-topped gradient draining in the power's colour.
      ctx.save();
      roundRect(ctx, bx, by, w, h, 5);
      ctx.fillStyle = "rgba(4,8,18,0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
      ctx.stroke();
      const fw = w * clamp(b.left, 0, 1);
      if(fw > 2){
        roundRect(ctx, bx, by, Math.max(h*0.7, fw), h, 4);
        ctx.clip();
        const pfg = ctx.createLinearGradient(0, by, 0, by+h);
        pfg.addColorStop(0, "rgba(255,255,255,0.75)");
        pfg.addColorStop(0.3, b.color + "8c");
        pfg.addColorStop(1, b.color + "8c");
        ctx.fillStyle = pfg;
        ctx.fillRect(bx, by, fw, h);
      }
      ctx.restore();
      ctx.font = "bold 8px Rajdhani, Arial, sans-serif";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(6,8,18,0.7)";
      ctx.strokeText(b.label, bx+5, by+9.5);
      ctx.fillStyle = "#fff";
      ctx.fillText(b.label, bx+5, by+9.5);
    }
  }

  // Combo - bumps up in scale when it climbs, drains a visible fuse bar, and
  // spends a fifth of a second collapsing when it breaks instead of blinking
  // off. The fuse and the break are renderer state; game.js only owns the
  // 1.4s comboTimer it resets on every kill.
  const comboOn = run.combo >= 3;
  if(comboOn && run.combo !== hudLastCombo){
    if(run.combo > hudLastCombo) hudComboPop = 1;
    hudLastCombo = run.combo;
    hudComboText = "x" + run.combo + " COMBO";
    hudComboHot = run.combo >= 10;
    hudComboOut = 0;
  }
  if(!comboOn && hudLastCombo >= 3){
    hudComboOut = 0.2;                 // the counter we just lost, on its way out
    hudLastCombo = run.combo || 0;
  }
  if(comboOn || hudComboOut > 0){
    hudComboPop = Math.max(0, hudComboPop - hdt*5);
    let a = 1, sc = 1 + easeOutCubic(hudComboPop)*0.35;
    if(!comboOn){
      hudComboOut = Math.max(0, hudComboOut - hdt);
      const k = hudComboOut/0.2;       // 1 -> 0 over the break
      a = k;
      sc = 1 + (1 - k)*0.3;
    }
    if(a > 0){
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(VW/2, 106);
      ctx.scale(sc, sc);
      ctx.textAlign = "center";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(6,8,18,0.7)";
      ctx.font = "bold 22px Rajdhani, Arial, sans-serif";
      ctx.strokeText(hudComboText, 0, -10);
      ctx.fillStyle = hudComboHot ? "#ff8a3d" : "#ffd23f";
      ctx.fillText(hudComboText, 0, -10);
      if(comboOn){
        // The fuse: comboTimer/1.4 draining under the counter, sliding to
        // danger red over the last 0.4s so "about to break" is visible.
        const frac = clamp(run.comboTimer/1.4, 0, 1);
        const u = clamp(1 - run.comboTimer/0.4, 0, 1);
        const g0 = hudComboHot ? 138 : 210, b0 = hudComboHot ? 61 : 63;
        const gc = Math.round(g0 + (59 - g0)*u), bc = Math.round(b0 + (48 - b0)*u);
        ctx.fillStyle = "rgba(6,8,18,0.55)";
        ctx.fillRect(-30, 16, 60, 3);
        ctx.fillStyle = "rgb(255," + gc + "," + bc + ")";
        ctx.fillRect(-30, 16, 60*frac, 3);
      }
      ctx.restore();
      ctx.textAlign = "left";
    }
  }

  // Boss entrance: while it descends, the screen letterboxes and the name
  // card lands - dread with a byline, not just a health bar appearing.
  const bossIn = game.world.boss;
  if(bossIn && bossIn.alive && bossIn.entering){
    // The card eases in over its first quarter second - same pattern as the
    // banner below - rather than landing fully formed in one frame.
    if(hudBossCard !== bossIn.name){ hudBossCard = bossIn.name; hudBossCardT0 = nowM; }
    const cardK = easeOutCubic(clamp((nowM - hudBossCardT0)/250, 0, 1));
    const pulse = 0.5 + Math.sin(nowM/160)*0.5;
    ctx.save();
    const bandY = VH*0.30, bandH = 120;
    ctx.globalAlpha = cardK;
    const cardS = 1.06 - 0.06*cardK;
    ctx.translate(VW/2, bandY + bandH/2);
    ctx.scale(cardS, cardS);
    ctx.translate(-VW/2, -(bandY + bandH/2));
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
  } else hudBossCard = "";

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

    /*
     * ITS SYSTEMS, AND WHICH ONES YOU HAVE TURNED OFF.
     *
     * Shooting a part off a boss permanently removes one of its attacks. That
     * is the biggest tactical reward in the game and it was invisible: the
     * explosion looked like every other explosion, and the payoff was an attack
     * that never came - an absence, which is the one thing you cannot see
     * happen. A child had no way to learn that the parts are worth the detour.
     *
     * One chip per part that switches something off, named in plain words and
     * struck through the moment it goes. It persists, so the answer is still on
     * screen long after the bang, and it doubles as a to-do list: the chips
     * still lit are the things that can still hurt you.
     */
    /*
     * One chip per SYSTEM, not per part. The Warden carries two hatches that
     * both switch off the mine drop, so keying off the parts printed "THE MINE
     * DROP" twice - and struck both out the moment either hatch went, which
     * reads as a bug even though the attack really is gone.
     */
    const seen = {};
    const systems = boss.def.weakPoints.filter(wp => {
      if(!wp.disables || seen[wp.disables]) return false;
      const a = SF.bosses.ATTACKS[wp.disables];
      if(!a || !a.label) return false;
      seen[wp.disables] = 1;
      return true;
    });
    if(systems.length){
      const sy = barY + bh + 7;
      ctx.font = "bold 9px Rajdhani, Arial, sans-serif";
      ctx.textAlign = "left";
      // Measure first so the row can be centred as one block.
      const gap = 9, dot = 5;
      let total = 0;
      const widths = systems.map(wp => {
        const t = SF.bosses.ATTACKS[wp.disables].label;
        const wpx = dot + 4 + ctx.measureText(t).width;
        total += wpx + gap;
        return wpx;
      });
      total -= gap;
      let sx = VW/2 - total/2;
      // A soft plate behind it: the boss parks at roughly this height, and small
      // struck-through type over a lit hull is exactly where legibility goes.
      roundRect(ctx, sx - 8, sy - 3, total + 16, 15, 7);
      ctx.fillStyle = "rgba(4,8,18,0.62)";
      ctx.fill();
      systems.forEach((wp, i) => {
        const off = !!boss.disabled[wp.disables];
        const t = SF.bosses.ATTACKS[wp.disables].label;
        ctx.globalAlpha = off ? 0.42 : 1;
        ctx.fillStyle = off ? "#6ee7a8" : "rgba(255,210,63,0.95)";
        ctx.beginPath(); ctx.arc(sx + dot/2, sy + 4, dot/2, 0, TAU); ctx.fill();
        ctx.fillStyle = off ? "rgba(160,230,190,0.95)" : "rgba(255,255,255,0.88)";
        ctx.fillText(t, sx + dot + 4, sy);
        if(off){
          // Struck through: the same read as a crossed-off list.
          ctx.strokeStyle = "rgba(160,230,190,0.9)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + dot + 3, sy + 5);
          ctx.lineTo(sx + widths[i] + 1, sy + 5);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        sx += widths[i] + gap;
      });
      ctx.textAlign = "center";
    }
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

  // Low-health vignette - on the mission clock, so it freezes under pause
  // with everything else instead of breathing behind the overlay.
  if(p && p.lives === 1 && p.shield === 0){
    const pulse = 0.12 + Math.sin(nowM/260)*0.06;
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
  if(run.bannerText && SF.game.now() < run.bannerUntil && !arenaBusy &&
     !(bossIn && bossIn.alive && bossIn.entering)){
    // The first quarter second eases in - alpha up, a 6% scale settling to
    // rest - so the band arrives instead of teleporting.
    const bKey = run.bannerText + "|" + run.bannerUntil;
    if(bKey !== hudBannerKey){ hudBannerKey = bKey; hudBannerT0 = nowM; }
    const inK = easeOutCubic(clamp((nowM - hudBannerT0)/250, 0, 1));
    const remain = (run.bannerUntil - SF.game.now())/1000;
    // A long hold needs a long fade: the band draws OVER the traffic, so it
    // spends its last second and a half going see-through rather than
    // sitting opaque and then vanishing.
    const a = clamp(remain/1.5, 0, 1) * inK;
    ctx.globalAlpha = a;
    // The Wacky Sky pops its modifier names up from VH*0.60 while this banner
    // is still holding - those runs carry the band higher so the two
    // announcements never collide.
    const cy = run.modReveal ? VH*0.28 : VH*0.36, bandH = 92;
    ctx.save();
    const bs = 1.06 - 0.06*inK;
    ctx.translate(VW/2, cy + bandH/2);
    ctx.scale(bs, bs);
    ctx.translate(-VW/2, -(cy + bandH/2));
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
      // to be READ from a tablet on a lap - 14px was a footnote. But it must
      // also FIT: the Wacky Sky's reveal lists up to three modifier names on
      // this line, and a three-roll on a phone clipped at both edges - the
      // one line the mode exists for, unreadable. Shrink-to-fit, floored at
      // 13px, and the floor is enough for the longest constructible roll.
      ctx.fillStyle = "#fff";
      let subPx = 19;
      ctx.font = "600 " + subPx + "px Rajdhani, Arial, sans-serif";
      const maxW = VW - 24;
      const w = ctx.measureText(run.bannerSub).width;
      if(w > maxW){
        subPx = Math.max(13, Math.floor(subPx * maxW / w));
        ctx.font = "600 " + subPx + "px Rajdhani, Arial, sans-serif";
      }
      ctx.fillText(run.bannerSub, VW/2, cy + 60);
    }
    ctx.restore();
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

SF.render = {
  loadAssets, assets, isReady: () => assetsReady,
  // exposed so the smoke test can watch the retry sweep rather than guess
  _papaPhoto: papaPhoto, _papaState: () => ({ ready: papaImgReady, tryIdx: papaTry, sweeps: papaSweeps }),
  initBackground, updateBackground, drawBackground, drawForeground,
  drawPlayer, drawEnemies, drawBullets, drawPickups, drawBoss, drawHud, drawComms,
  drawArena, drawFleet, drawFinaleIntro, drawBossIntro, drawHaulers, drawBlackout, drawDisco,
  drawAct4,
  // The campaign map borrows this to draw the Devourer looming at the final
  // stop - the same hull the fight uses, so the destination IS the monster.
  drawDevourerHull,
  tinted,
};
})();
