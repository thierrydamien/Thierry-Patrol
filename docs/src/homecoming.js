/*
 * THE LONG WAY HOME - mission 39's ending, played instead of a victory lap.
 *
 * The Titan falls, the war is over, and the game does the one thing it has
 * been promising since Launch Day: it flies the family back DOWN. The launch
 * sequence from Mission 0, run in reverse - stars streaking past, then the
 * sky warming to daylight, then the cloud deck, then the same farmland the
 * whole story took off from, scrolling up to meet the wheels. Nobody flies
 * this bit for score; input stays live so a kid can waggle the wings on the
 * way down, but nothing can hurt anyone and nothing needs doing.
 *
 * Same contract as prologue.js: a mission flag (`homecoming`) plus hooks
 * game.js already calls - reset/begin/update and one draw pass over the sky.
 * The victory lap holds until done() so the results card waits for the
 * wheels. All state lives in S; reset() clears it.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp } = SF.core;
const TAU = Math.PI*2;
const T = s => (SF.i18n ? SF.i18n.t(s) : s);

let S = null;

const DESCENT_SECS = 13.6;    // turn 2s, flood 4s, farm 5s, wheels 2.6s

/* Soft cumulus, baked once per shape - the same trick the prologue's deck
 * uses, cosmetic randomness off Math.random so the sim stream never moves. */
function bakeCloud(){
  const cv = document.createElement("canvas");
  cv.width = 300; cv.height = 150;
  const x = cv.getContext("2d");
  if(!x) return cv;
  const blobs = 9 + Math.floor(Math.random()*6);
  for(let i = 0; i < blobs; i++){
    const bx = 40 + Math.random()*220, by = 55 + Math.random()*50;
    const r = 26 + Math.random()*34;
    const g = x.createRadialGradient(bx, by - r*0.2, r*0.1, bx, by, r);
    g.addColorStop(0, "rgba(255,252,246,0.85)");
    g.addColorStop(0.7, "rgba(244,242,238,0.45)");
    g.addColorStop(1, "rgba(240,238,235,0)");
    x.fillStyle = g;
    x.beginPath(); x.arc(bx, by, r, 0, TAU); x.fill();
  }
  return cv;
}

function reset(){ S = null; }

/** Armed at mission start; the show itself waits for the Titan. */
function begin(){
  S = { started: false, t: 0, clouds: [], stars: [], earth: null,
        scroll: 0, saidFarm: false, saidLights: false, touched: false };
}

function active(){ return !!S; }
function started(){ return !!(S && S.started); }
function done(){ return !S || (S.started && S.t >= DESCENT_SECS); }

/** The Titan is down: turn for home. Called from the boss's death. */
function start(){
  if(!S || S.started) return;
  S.started = true;
  S.t = 0;
  // The ground they are coming home to - Earth's own sky texture, baked here
  // under the death blast's hit-stop so the stall never shows.
  // `still` mode: the descent wants the WHOLE ground in one canvas, farm
  // included - the farm arriving under the wheels is the entire point of the
  // shot, and the split bake leaves it out of the plain tile now.
  try { S.earth = SF.skygen.build(40, SF.game.VW || 600, SF.game.VH || 800, 1, true); }
  catch(e){ S.earth = null; }
  for(let i = 0; i < 9; i++){
    S.clouds.push({ spr: bakeCloud(),
      fx: Math.random(), y: -200 - Math.random()*900,
      sc: 0.8 + Math.random()*1.3, v: 60 + Math.random()*90,
      a: 0.5 + Math.random()*0.4 });
  }
  for(let i = 0; i < 80; i++)
    S.stars.push({ fx: Math.random(), fy: Math.random(), s: Math.random() });
}

function update(dt, run, world, simMs){
  if(!S || !S.started || run.ended) return;
  const H = SF.game.VH || 800;
  S.t += dt;
  const t = S.t;

  // How fast the world still rushes past: full tilt off the turn, feathered
  // to nothing for the wheels.
  const rush = t < 2 ? 1 : t < 11 ? 1 - (t - 2)/9 * 0.85 : Math.max(0, 0.15 - (t - 11)*0.06);
  S.scroll = (S.scroll + (90 + rush*380) * dt) % H;
  for(const c of S.clouds){
    c.y += (c.v + rush*430) * dt;
    if(c.y > H + 160){ c.y = -220; c.fx = Math.random(); }
  }

  if(!S.saidFarm && t > 6.4){
    S.saidFarm = true;
    SF.comms.say("homecomingFarm");
  }
  if(!S.saidLights && t > 10.2){
    S.saidLights = true;
    SF.comms.say("homecomingLights");
  }
  if(!S.touched && t > 12.2){
    S.touched = true;
    run.bannerText = T("WHEELS DOWN");
    run.bannerSub = T("home");
    run.bannerColor = "#ffd23f";
    run.bannerUntil = simMs + 3000;
    SF.fx.flash(0.35, "255,240,210");
    SF.fx.shake(5);
    SF.audio.play("rescue");
  }
}

/* Over the mission's own sky: night thins, clouds pass, the farm arrives. */
function drawSky(ctx, timeMs, VW, VH){
  if(!S || !S.started) return;
  const t = S.t;

  // The sky warms first: space fades under a daylight wash.
  const dayK = clamp((t - 1.6)/4.2, 0, 1);
  if(dayK > 0){
    ctx.save();
    ctx.globalAlpha = dayK;
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, "#8fb7e8");
    g.addColorStop(0.62, "#bcd6ef");
    g.addColorStop(1, "#f0cda2");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  // Stars streak past on the way down, then daylight swallows them.
  const starK = clamp(t/1.2, 0, 1) * (1 - dayK);
  if(starK > 0.01){
    ctx.save();
    ctx.globalAlpha = starK * 0.9;
    ctx.strokeStyle = "#eaf4ff";
    ctx.lineWidth = 1.4;
    for(const st of S.stars){
      const len = 26 + st.s*46;
      const y = ((st.fy*VH + timeMs*0.55*(0.5 + st.s)) % (VH + len)) - len;
      ctx.beginPath();
      ctx.moveTo(st.fx*VW, y);
      ctx.lineTo(st.fx*VW, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The farmland rises to meet them - Launch Day's own ground, same painter.
  const earthK = clamp((t - 5.6)/3.4, 0, 1);
  if(earthK > 0 && S.earth){
    ctx.save();
    ctx.globalAlpha = earthK;
    const y = S.scroll;
    ctx.drawImage(S.earth, 0, y, VW, VH);
    ctx.drawImage(S.earth, 0, y - VH, VW, VH);
    ctx.restore();
  }

  // The cloud deck, punched through on the way down.
  const cloudK = t < 3 ? clamp((t - 2.2)/1.2, 0, 1)
                       : t < 11 ? 1 : clamp(1 - (t - 11)/1.6, 0, 1);
  if(cloudK > 0.01){
    ctx.save();
    for(const c of S.clouds){
      ctx.globalAlpha = c.a * cloudK;
      const w = 300*c.sc, h = 150*c.sc;
      ctx.drawImage(c.spr, c.fx*VW - w/2, c.y - h/2, w, h);
    }
    ctx.restore();
  }

  // Wheels-down: the ships gather shadows, the one tell of real ground.
  const landK = clamp((t - 11.2)/1.6, 0, 1);
  if(landK > 0){
    const p = SF.game.world && SF.game.world.player;
    if(p && p.alive){
      ctx.save();
      ctx.globalAlpha = landK * 0.35;
      ctx.fillStyle = "#1c2410";
      ctx.beginPath();
      ctx.ellipse(p.x + 10, p.y + 26 + (1 - landK)*40, 30, 9, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

SF.homecoming = { _state: () => S,
                  reset, begin, active, started, start, done, update, drawSky };
})();
