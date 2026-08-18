/*
 * SKY 29 - the gift level.
 *
 * The finale's drafting table has this sky's name pencilled in its margin, and
 * this is that canvas: the one Papa never finished, unlocked only
 * when every star in the campaign is home. It is not a challenge level. It is
 * a thank-you - the sky starts as pencil and the player paints it by flying,
 * every kill a splash of colour, and when the last wave falls the final
 * stroke is theirs. Then the squadron lines up for a photo.
 *
 * Same shape as backstage.js and finale.js: a mission flag (`sky29`) plus a
 * small module that owns the theatrics through hooks game.js already calls -
 * begin/update, a hold before "clearing" (readyToClear), one draw pass over
 * the sky and one over the world. All state lives in S; reset() clears it.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp } = SF.core;

let S = null;

/* Every act's voice, one drop at a time: kills splash the campaign's own
 * palette onto the sketch. */
const PAINT_DROPS = ["#7c3aed", "#f59e0b", "#22d3ee", "#4ade80", "#ff5d73",
                     "#ffd23f", "#c084fc", "#2dd4bf"];

function reset(){ S = null; }

function begin(){
  const game = SF.game, P = SF.profile;
  const me = game.profile ? game.profile.name : "";
  // The margin notes are the family's own callsigns - the sky really was
  // sketched for whoever else flies in this squadron.
  let names = [];
  try {
    names = P.listNames().filter(n => n !== me).slice(0, 3)
      .map(n => { const q = P.load(n); return (q && (q.callsign || q.name)) || n; });
  } catch(e){ /* a broken sibling profile must not break the gift */ }
  S = {
    t: 0,
    phase: "sketch",          // sketch -> stroke -> photo -> done
    paint: 0,                 // 0..1, smoothed - drives the veil
    expected: 0,              // total bodies the waves will send (read once)
    saidHalf: false,
    strokeY: -120,
    photoT: 0, flashed: false,
    splashes: [],             // {x, y, r, life, color}
    notes: names,
  };
}

function active(){ return !!S; }

/* The waves may end, but the last stroke and the photo come first. */
function readyToClear(){ return !S || S.phase === "done"; }

/** A kill lands a drop of paint where the enemy was. */
function splash(x, y){
  if(!S || S.phase !== "sketch") return;
  S.splashes.push({ x, y, r: 14, life: 1.25,
    color: PAINT_DROPS[(S.splashes.length + Math.floor(S.t)) % PAINT_DROPS.length] });
  if(S.splashes.length > 40) S.splashes.shift();
}

function update(dt, run, world, simMs){
  if(!S || run.ended) return;
  const fx = SF.fx, audio = SF.audio;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;

  if(!S.expected)
    S.expected = run.mission.waves.reduce((n, wv) => n + wv.n, 0);

  for(let i = S.splashes.length - 1; i >= 0; i--){
    const sp = S.splashes[i];
    sp.life -= dt; sp.r += dt*70;
    if(sp.life <= 0) S.splashes.splice(i, 1);
  }

  if(S.phase === "sketch"){
    // Kills paint the sky - but the last 15% is saved for the final stroke,
    // so the finish is a MOMENT rather than a percentage quietly arriving.
    const target = clamp(run.stats.kills / Math.max(1, S.expected*0.9), 0, 0.85);
    S.paint += (target - S.paint) * Math.min(1, dt*1.6);

    if(!S.saidHalf && S.paint > 0.45){
      S.saidHalf = true;
      SF.comms.say("sky29Half");
    }
    // The last stroke waits for the whole show: on Behind the Sky the waves
    // ending is only the middle of the level - the fake endings, the tear
    // and the Royal Brush all play out before the canvas may finish.
    if(run.director && run.director.finishedSpawning && world.countEnemies() === 0 &&
       (!run.mission.backstage || SF.backstage.readyToClear())){
      S.phase = "stroke"; S.strokeY = -120;
      run.bannerText = "THE LAST STROKE";
      run.bannerSub = "it's yours to finish";
      run.bannerColor = "#ffd23f";
      run.bannerUntil = simMs + 2200;
      audio.play("telegraph");
    }
  }

  if(S.phase === "stroke"){
    // One brush-width of gold sweeps the sketch away top to bottom.
    S.strokeY += dt * (H + 320) / 1.8;
    S.paint = Math.max(S.paint, clamp(S.strokeY / H, 0, 1));
    if(S.strokeY > H + 160){
      S.paint = 1;
      S.phase = "photo"; S.photoT = 0; S.flashed = false;
      run.bannerText = SF.missions.giftName() + " — PAINTED";
      run.bannerSub = "every star became a colour";
      run.bannerColor = "#ffd23f";
      run.bannerUntil = simMs + 3600;
      const pay = run.difficulty.pay * (world.player ? world.player.moneyMult : 1);
      world.dropCoins(W/2, H*0.32, Math.round(500 * pay));
      run.score += Math.round(2000 * run.difficulty.pay);
      for(let i = 0; i < 7; i++)
        fx.firework(40 + Math.random()*(W - 80), H*(0.12 + Math.random()*0.4),
          PAINT_DROPS[i % PAINT_DROPS.length]);
      audio.play("victory");
      SF.comms.say("sky29Photo");
    }
  }

  if(S.phase === "photo"){
    S.photoT += dt;
    if(!S.flashed && S.photoT > 1.1){
      S.flashed = true;
      fx.flash(1.0, "255,255,255");     // the camera
      audio.play("firework");
    }
    if(S.photoT > 3.6) S.phase = "done";  // clearing + the lap take over
  }
  if(S.phase === "done") S.doneT = (S.doneT || 0) + dt;
}

/* ------------------------------------------------------------------ */
/*  DRAW                                                               */
/* ------------------------------------------------------------------ */

/** The pencil veil over the painted sky, drawn right after the background. */
function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;
  const veil = (1 - S.paint) * 0.94;
  if(veil > 0.01){
    ctx.save();
    // During the stroke the brush front is the boundary: above it the sky is
    // finished, below it the sketch is still waiting.
    if(S.phase === "stroke"){
      ctx.beginPath();
      ctx.rect(0, Math.max(0, S.strokeY), VW, VH);
      ctx.clip();
    }
    ctx.fillStyle = "rgba(16,18,28," + veil.toFixed(3) + ")";
    ctx.fillRect(0, 0, VW, VH);

    const a = veil / 0.94;              // furniture fades with the veil
    ctx.strokeStyle = "rgba(120,140,190," + (0.10*a).toFixed(3) + ")";
    ctx.lineWidth = 1;
    for(let x = 0; x <= VW; x += 48){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VH); ctx.stroke(); }
    for(let y = 0; y <= VH; y += 48){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VW, y); ctx.stroke(); }

    // Unpainted prop circles - the plan for planets that never got painted.
    ctx.setLineDash([7, 8]);
    ctx.strokeStyle = "rgba(150,165,210," + (0.16*a).toFixed(3) + ")";
    ctx.lineWidth = 1.5;
    [[0.22, 0.30, 0.16], [0.76, 0.16, 0.10], [0.68, 0.66, 0.20]].forEach(([px, py, pr]) => {
      ctx.beginPath(); ctx.arc(VW*px, VH*py, VW*pr, 0, Math.PI*2); ctx.stroke();
    });
    ctx.setLineDash([]);

    // The margin notes. The first is the one the finale planted.
    ctx.fillStyle = "rgba(195,205,235," + (0.55*a).toFixed(3) + ")";
    ctx.font = "italic 600 14px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(SF.missions.GIFT.name.toLowerCase(), VW*0.07, VH*0.115);
    ctx.font = "italic 600 12px Rajdhani, Arial, sans-serif";
    S.notes.forEach((n, i) => {
      ctx.fillText("for " + n.toLowerCase(), VW*(0.62 + (i%2)*0.13), VH*(0.52 + i*0.045));
    });
    ctx.textAlign = "center";
    ctx.restore();
  }

  // Paint drops splash ON TOP of the sketch - colour arriving.
  for(const sp of S.splashes){
    const a = Math.max(0, sp.life / 1.25) * 0.5;
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sp.r);
    g.addColorStop(0, sp.color + Math.round(a*255).toString(16).padStart(2, "0"));
    g.addColorStop(1, sp.color + "00");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI*2); ctx.fill();
  }

  // The brush itself, sweeping.
  if(S.phase === "stroke"){
    const y = S.strokeY;
    const g = ctx.createLinearGradient(0, y - 90, 0, y + 8);
    g.addColorStop(0, "rgba(255,210,63,0)");
    g.addColorStop(0.8, "rgba(255,210,63,0.30)");
    g.addColorStop(1, "rgba(255,236,150,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 90, VW, 98);
    ctx.fillStyle = "rgba(255,246,200,0.95)";
    ctx.fillRect(0, y + 2, VW, 3);
  }
}

/** The polaroid, over the world but under the HUD. */
function drawOver(ctx, timeMs){
  if(!S || S.phase !== "photo" && S.phase !== "done") return;
  const VW = SF.game.VW || 600, VH = SF.game.VH || 800;
  // Eases in with the flash, holds for the photo, lets go as the lap starts.
  const k = S.phase === "done" ? clamp(1 - (S.doneT || 0) / 0.7, 0, 1)
                               : clamp((S.photoT - 1.1) / 0.5, 0, 1);
  if(k <= 0) return;
  const m = 14;                          // frame margin
  ctx.save();
  ctx.globalAlpha = k * 0.94;
  ctx.fillStyle = "#f5f2ea";
  ctx.fillRect(0, 0, VW, m);                        // the white polaroid frame
  ctx.fillRect(0, 0, m, VH);
  ctx.fillRect(VW - m, 0, m, VH);
  ctx.fillRect(0, VH - 58, VW, 58);                 // the fat bottom edge
  ctx.fillStyle = "#2a2437";
  ctx.font = "italic 700 19px Rajdhani, Arial, sans-serif";
  ctx.textAlign = "center";
  const who = (SF.game.profile && (SF.game.profile.callsign || SF.game.profile.name)) || "us";
  ctx.fillText(SF.missions.GIFT.name.toLowerCase() + " — " + who.toLowerCase() +
               " & the squadron", VW/2, VH - 24);
  ctx.fillStyle = "#b8912f";
  ctx.font = "700 13px Rajdhani, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("★ every star", VW - m - 10, VH - 24);
  ctx.textAlign = "center";
  ctx.restore();
}

SF.sky29 = { _state: () => S,
             reset, begin, active, readyToClear, splash, update, drawSky, drawOver };
})();
