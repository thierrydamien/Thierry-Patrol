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

/**
 * Directional impact: sparks spray *back along the shot*, the way metal
 * actually behaves. An omnidirectional puff reads as "near a hit"; a cone
 * pointing back at the gun reads as "MY shot did that".
 */
function impact(x, y, vx, vy, color, n){
  const l = Math.max(1, Math.hypot(vx, vy));
  const bx = -vx/l, by = -vy/l;                  // back along the bullet
  const base = Math.atan2(by, bx);
  for(let i=0;i<(n||5);i++){
    const a = base + rand(-0.55, 0.55);
    const s = rand(90, 260);
    spark(x, y, Math.cos(a)*s, Math.sin(a)*s, i===0 ? "#ffffff" : color, rand(0.12,0.3), rand(1.5,3));
  }
}

/** Rolling fireball cores - the orange heart of an explosion. */
function fireball(x, y, n, size){
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), d = rand(0, size*0.4);
    const p = particles.spawn();
    p.x=x+Math.cos(a)*d; p.y=y+Math.sin(a)*d;
    p.vx=Math.cos(a)*rand(10,60); p.vy=Math.sin(a)*rand(10,60)-20;
    p.life=0; p.max=rand(0.28,0.55); p.size=rand(size*0.22, size*0.4);
    p.kind="fire"; p.drag=0.95; p.gravity=-30; p.spin=0; p.angle=0; p.color="";
  }
}

/** Glowing embers that linger and flicker after the fireball is gone. */
function embers(x, y, n){
  for(let i=0;i<n;i++){
    const a = rand(0, TAU), s = rand(30, 150);
    const p = particles.spawn();
    p.x=x; p.y=y; p.vx=Math.cos(a)*s; p.vy=Math.sin(a)*s - 40;
    p.color = Math.random() < 0.5 ? "#ffd23f" : "#ff8a3d";
    p.life=0; p.max=rand(0.5,1.1); p.size=rand(1.2,2.6);
    p.kind="ember"; p.drag=0.97; p.gravity=140; p.spin=0; p.angle=rand(0,TAU);
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

/** The standard enemy death: white pop, fireball, wreckage, embers, smoke. */
function explosion(x, y, size, color, big){
  fireball(x, y, big ? 7 : 4, size);
  sparks(x, y, big ? 18 : 10, color, big ? 240 : 160);
  embers(x, y, big ? 10 : 5);
  debris(x, y, big ? 12 : 6, color);
  smoke(x, y, big ? 8 : 3);
  const flash = particles.spawn();
  flash.x=x; flash.y=y; flash.life=0; flash.max=0.14; flash.size=size*0.75;
  flash.color="#ffffff"; flash.kind="flash"; flash.vx=0; flash.vy=0; flash.drag=1; flash.gravity=0;
  if(big) ring(x, y, size*1.9, color, 3, 0.5);
}

/** Muzzle flash: a four-point star, rotated a little every shot. */
function muzzle(x, y, color, scale){
  const p = particles.spawn();
  p.x=x; p.y=y; p.life=0; p.max=0.05; p.size=(scale||1)*6.5;
  p.color=color||"#ffe9a8"; p.kind="muzzle"; p.vx=0; p.vy=-40; p.drag=1; p.gravity=0;
  p.angle=rand(-0.4,0.4); p.spin=0;
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

/*
 * Two passes: solid matter (smoke, debris) with normal blending, then
 * everything hot (sparks, flashes, fire, embers) drawn additively so
 * overlapping light stacks toward white the way real glare does. That one
 * compositing switch is most of the difference between "coloured squares"
 * and "an explosion".
 */
const fireGrad = (() => {          // one radial fireball sprite, drawn once
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  if(g){
    const gr = g.createRadialGradient(32,32,2, 32,32,32);
    gr.addColorStop(0, "rgba(255,245,220,1)");
    gr.addColorStop(0.25, "rgba(255,190,90,0.9)");
    gr.addColorStop(0.6, "rgba(255,100,40,0.45)");
    gr.addColorStop(1, "rgba(180,40,20,0)");
    g.fillStyle = gr; g.fillRect(0,0,64,64);
  }
  return c;
})();

function drawParticles(ctx){
  const items = particles.items;

  // Pass 1: matter.
  for(let i=0;i<items.length;i++){
    const p = items[i];
    if(!p.alive) continue;
    const t = 1 - p.life/p.max;
    if(p.kind === "smoke"){
      ctx.globalAlpha = t*0.45;
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
    }
  }

  // Pass 2: light.
  ctx.globalCompositeOperation = "lighter";
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
    } else if(p.kind === "fire"){
      ctx.globalAlpha = t;
      const s = p.size*(1.1 + (1-t)*0.8);
      ctx.drawImage(fireGrad, p.x - s, p.y - s, s*2, s*2);
    } else if(p.kind === "muzzle"){
      ctx.globalAlpha = t;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      const s = p.size*(0.5 + (1-t)*0.7);
      // Four-point star: two thin crossed diamonds plus a hot core.
      ctx.beginPath();
      ctx.moveTo(0,-s); ctx.lineTo(s*0.18,0); ctx.lineTo(0,s); ctx.lineTo(-s*0.18,0);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s*0.7,0); ctx.lineTo(0,s*0.14); ctx.lineTo(s*0.7,0); ctx.lineTo(0,-s*0.14);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(0, 0, s*0.16, 0, TAU); ctx.fill();
      ctx.restore();
    } else if(p.kind === "ember"){
      const flicker = 0.55 + Math.sin((p.life*31) + p.angle*7)*0.45;
      ctx.globalAlpha = Math.min(1, t*1.6)*flicker;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    } else { // spark
      ctx.globalAlpha = Math.min(1, t*1.8);
      ctx.fillStyle = p.color;
      // Streaked along velocity so fast sparks read as motion, not dots.
      const vl = Math.hypot(p.vx, p.vy);
      if(vl > 60){
        const k = Math.min(2.6, vl/110);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size*k, -p.size/2, p.size*2*k, p.size);
        ctx.restore();
      } else {
        ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      }
    }
  }

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
  ctx.globalCompositeOperation = "source-over";
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
    ctx.font = "bold " + t.size + "px Arial, sans-serif";
    // Outlined, because floating numbers live over explosions.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(6,8,18,0.7)";
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
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
  sparks, impact, fireball, embers, debris, smoke, ring, explosion, muzzle, text, damageNumber,
  shake, flash, hitStop, isHitStopped, reset,
  update, shakeOffset, drawParticles, drawTexts, drawFlash,
  _pools: { particles, texts, rings },
};
})();
