/*
 * ParticleManager + screen effects: the "juice" layer.
 *
 * Everything here is pooled and allocation-free in the hot path. Gameplay code
 * never news up an effect - it calls SF.fx.explosion(...) and forgets.
 *
 * Screen-level feel lives here too: shake, hit-stop (a few frozen frames on a
 * big impact, the single cheapest trick for making hits land) and full-screen
 * flashes.
 */
(function(){
"use strict";
const SF = window.SF;
const { Pool, rand, randInt, clamp, TAU } = SF.core;

const particles  = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,life:0,max:1,size:2,color:"#fff",
                                     kind:"spark", drag:0.94, gravity:0, spin:0, angle:0 }), 900);
const texts      = new Pool(() => ({ alive:false, x:0,y:0,vy:-34,life:0,max:0.9,text:"",color:"#fff",size:14,bold:true }), 80);
const rings      = new Pool(() => ({ alive:false, x:0,y:0,life:0,max:0.45,r0:6,r1:60,color:"#fff",width:3 }), 40);

let shakeMag = 0, shakeDecay = 26;
let flashAlpha = 0, flashColor = "255,60,80";
let hitStopUntil = 0;
let nowMs = 0;

/* ---------------------------------------------------------
   EMITTERS
   --------------------------------------------------------- */
function spark(x, y, vx, vy, color, life, size){
  const p = particles.spawn();
  p.x=x; p.y=y; p.vx=vx; p.vy=vy; p.color=color; p.life=0; p.max=life; p.size=size;
  p.kind="spark"; p.drag=0.93; p.gravity=0; p.spin=0; p.angle=0;
  return p;
}

/** A burst of sparks - the generic "something got hit" puff. */
function sparks(x, y, n, color, speed){
  speed = speed || 120;
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), s = rand(speed*0.3, speed);
    spark(x, y, Math.cos(a)*s, Math.sin(a)*s, color, rand(0.18,0.42), rand(1.5,3));
  }
}

/** Chunky wreckage that tumbles and falls - sells a kill far better than dots. */
function debris(x, y, n, color){
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), s = rand(40, 190);
    const p = particles.spawn();
    p.x=x; p.y=y; p.vx=Math.cos(a)*s; p.vy=Math.sin(a)*s - 30;
    p.color=color; p.life=0; p.max=rand(0.5,1.0); p.size=rand(2.5,5.5);
    p.kind="debris"; p.drag=0.985; p.gravity=210; p.angle=rand(0,TAU); p.spin=rand(-9,9);
  }
}

function smoke(x, y, n, color){
  for(let i=0;i<n;i++){
    const p = particles.spawn();
    p.x=x+rand(-6,6); p.y=y+rand(-6,6); p.vx=rand(-18,18); p.vy=rand(10,44);
    p.color=color||"#6b6b78"; p.life=0; p.max=rand(0.5,1.1); p.size=rand(3,7);
    p.kind="smoke"; p.drag=0.97; p.gravity=0; p.spin=0; p.angle=0;
  }
}

/** Expanding shockwave ring - reserved for big events so it stays special. */
function ring(x, y, r1, color, width, life){
  const r = rings.spawn();
  r.x=x; r.y=y; r.life=0; r.max=life||0.45; r.r0=6; r.r1=r1; r.color=color; r.width=width||3;
}

/** The standard enemy death: flash, sparks, wreckage, smoke, ring for big ones. */
function explosion(x, y, size, color, big){
  sparks(x, y, big ? 26 : 14, color, big ? 220 : 150);
  debris(x, y, big ? 12 : 6, color);
  smoke(x, y, big ? 8 : 3);
  const flash = particles.spawn();
  flash.x=x; flash.y=y; flash.life=0; flash.max=0.16; flash.size=size*0.7;
  flash.color="#ffffff"; flash.kind="flash"; flash.vx=0; flash.vy=0; flash.drag=1; flash.gravity=0;
  if(big) ring(x, y, size*1.9, color, 3, 0.5);
}

/** Muzzle flash at a gun port - tiny, but it's what makes shooting feel physical. */
function muzzle(x, y, color, scale){
  const p = particles.spawn();
  p.x=x; p.y=y; p.life=0; p.max=0.07; p.size=(scale||1)*7;
  p.color=color||"#ffe9a8"; p.kind="flash"; p.vx=0; p.vy=-40; p.drag=1; p.gravity=0;
}

function text(x, y, str, color, size, rise){
  const t = texts.spawn();
  t.x=x; t.y=y; t.text=str; t.color=color||"#fff"; t.size=size||14;
  t.life=0; t.max= rise ? 1.3 : 0.9; t.vy = rise ? -46 : -34;
}

/** Small drifting number on a hit - reads as "my shots are doing something". */
function damageNumber(x, y, amount, crit){
  const t = texts.spawn();
  t.x=x+rand(-4,4); t.y=y; t.text=String(amount); t.color = crit ? "#ffd23f" : "rgba(255,255,255,0.9)";
  t.size = crit ? 18 : 14; t.life=0; t.max=0.55; t.vy=-52;
}

/* ---------------------------------------------------------
   SCREEN EFFECTS
   --------------------------------------------------------- */
function shake(mag){ shakeMag = Math.max(shakeMag, mag); }
function flash(alpha, rgb){ flashAlpha = Math.max(flashAlpha, alpha); if(rgb) flashColor = rgb; }
/** Freeze the world for a few ms so a heavy hit registers physically. */
function hitStop(ms){ hitStopUntil = Math.max(hitStopUntil, nowMs + ms); }
function isHitStopped(){ return nowMs < hitStopUntil; }

function reset(){
  particles.killAll(); texts.killAll(); rings.killAll();
  shakeMag = 0; flashAlpha = 0; hitStopUntil = 0;
}

/* ---------------------------------------------------------
   UPDATE / DRAW
   --------------------------------------------------------- */
function update(dt, timeMs){
  nowMs = timeMs;
  const items = particles.items;
  for(let i=0;i<items.length;i++){
    const p = items[i];
    if(!p.alive) continue;
    p.life += dt;
    if(p.life >= p.max){ p.alive = false; continue; }
    p.x += p.vx*dt; p.y += p.vy*dt;
    p.vy += p.gravity*dt;
    const d = Math.pow(p.drag, dt*60);
    p.vx *= d; p.vy *= d;
    if(p.spin) p.angle += p.spin*dt;
  }
  const ts = texts.items;
  for(let i=0;i<ts.length;i++){
    const t = ts[i];
    if(!t.alive) continue;
    t.life += dt;
    if(t.life >= t.max){ t.alive = false; continue; }
    t.y += t.vy*dt;
    t.vy *= Math.pow(0.94, dt*60);
  }
  const rs = rings.items;
  for(let i=0;i<rs.length;i++){
    const r = rs[i];
    if(!r.alive) continue;
    r.life += dt;
    if(r.life >= r.max) r.alive = false;
  }
  shakeMag = Math.max(0, shakeMag - shakeDecay*dt*2.2);
  flashAlpha = Math.max(0, flashAlpha - dt*2.4);
}

/** Camera offset for this frame; the renderer applies it around everything. */
function shakeOffset(out){
  if(shakeMag <= 0.25){ out.x = 0; out.y = 0; return out; }
  out.x = (Math.random()-0.5)*shakeMag;
  out.y = (Math.random()-0.5)*shakeMag;
  return out;
}

function drawParticles(ctx){
  const items = particles.items;
  for(let i=0;i<items.length;i++){
    const p = items[i];
    if(!p.alive) continue;
    const t = 1 - p.life/p.max;
    if(p.kind === "flash"){
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size*(0.4 + (1-t)*0.9), 0, TAU);
      ctx.fill();
    } else if(p.kind === "smoke"){
      ctx.globalAlpha = t*0.5;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size*(1.6 - t*0.6), 0, TAU);
      ctx.fill();
    } else if(p.kind === "debris"){
      ctx.globalAlpha = Math.min(1, t*1.6);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.7);
      ctx.restore();
    } else {
      ctx.globalAlpha = Math.min(1, t*1.8);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;

  const rs = rings.items;
  for(let i=0;i<rs.length;i++){
    const r = rs[i];
    if(!r.alive) continue;
    const t = r.life/r.max;
    ctx.globalAlpha = (1-t)*0.85;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width*(1-t*0.6);
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r0 + (r.r1-r.r0)*SF.core.easeOutCubic(t), 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawTexts(ctx){
  const ts = texts.items;
  ctx.textAlign = "center";
  for(let i=0;i<ts.length;i++){
    const t = ts[i];
    if(!t.alive) continue;
    const k = 1 - t.life/t.max;
    ctx.globalAlpha = Math.min(1, k*1.7);
    ctx.fillStyle = t.color;
    ctx.font = "bold " + t.size + "px Arial, sans-serif";
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

function drawFlash(ctx, w, h){
  if(flashAlpha <= 0.01) return;
  ctx.fillStyle = "rgba(" + flashColor + "," + (flashAlpha*0.4) + ")";
  ctx.fillRect(0, 0, w, h);
}

SF.fx = {
  sparks, debris, smoke, ring, explosion, muzzle, text, damageNumber,
  shake, flash, hitStop, isHitStopped, reset,
  update, shakeOffset, drawParticles, drawTexts, drawFlash,
  _pools: { particles, texts, rings },
};
})();
