/*
 * THE GLASS SEA'S DUEL - the reflection turns.
 *
 * The whole level teaches one idea: the sky is a mirror, and the second ship
 * out there is YOURS - it flies your flight backwards, it fires when you
 * fire, and the brief promises it cannot be hurt and cannot be hit. That
 * promise holds right up until the last wave falls. Then the glass gives up
 * pretending: the ghost peels off the sky exactly where it was flying,
 * climbs to the top of the field, and opens fire with everything you own.
 *
 * The fight itself came from Behind the Sky, where it was act two of three
 * and belonged to the workshop. It belongs here more: a mirror boss at the
 * end of the mirror level is a punchline the whole mission sets up, and the
 * finale it left behind is better for being one fight instead of three.
 *
 * Same contract as prologue.js and backstage.js: a mission flag
 * (`mirrorDuel`) plus hooks game.js already calls - reset/begin/update, a
 * hold before "clearing" (readyToClear), one draw pass at boss depth and one
 * over the world for the bar. All state lives in S; reset() clears it.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, lerp } = SF.core;
const TAU = Math.PI*2;
const T = s => (SF.i18n ? SF.i18n.t(s) : s);

let S = null;
const VW = () => (SF.game && SF.game.VW) || 600;

function reset(){ S = null; }
function begin(){ S = { stage: "waves", t: 0, mirror: null }; }
function active(){ return !!S; }

/* The waves may end, but the duel is the level's last word. */
function readyToClear(){ return !S || S.stage === "done"; }

function update(dt, run, world, simMs){
  if(!S || run.ended) return;
  const fx = SF.fx, audio = SF.audio;
  const W = SF.game.VW || 600;
  S.t += dt;

  // The last wave falls, and the reflection stops reflecting.
  if(S.stage === "waves" && run.director && run.director.finishedSpawning &&
     world.countEnemies() === 0){
    S.stage = "turn"; S.t = 0;
    // The ghost gun is gone from this frame on - it is not helping any more.
    world.mirror = false;
    audio.play("telegraph");
    fx.shake(8);
  }

  if(S.stage === "turn" && S.t > 1.0){
    const p = world.player;
    const lv = id => SF.profile.upgradeLevel(SF.game.profile, id);
    const dps = p ? p.dps : 60;
    /*
     * Sized exactly as the duel was behind the sky (see the note there
     * about hitboxes and dps-derived pools): a ship-sized boss only ever
     * catches a sliver of a fanned spread, so the pool is set from what
     * actually lands. Measured at ~22s on PILOT.
     */
    const diff = (SF.game.run && SF.game.run.difficulty) || { bossHp: 1 };
    const pool = Math.round(dps * 3.2 * (diff.bossHp || 1));
    S.mirror = {
      // It peels off the glass where the reflection was: your x, mirrored.
      x: p ? clamp(W - p.x, 50, W - 50) : W/2,
      y: p ? p.y : 500, r: 34,
      hp: pool, maxHp: pool,
      holdY: 190, vx: 0,
      fireTimer: 1.4, dodgeCool: 0, tell: 0, dodgeDir: 0,
      spread: lv("spread"), rapid: lv("rapid"),
      bombs: 2, nextBombAt: 0.66,
      // The duel breathes: it mirrors and shoots, then it OPENS - drifts to
      // the middle, holds still, stops firing - and that is your turn.
      mode: "mirror", modeT: 3.2, taught: false,
      flash: 0, t: 0,
    };
    S.stage = "duel"; S.t = 0;
    run.bannerText = T("THE MIRROR PILOT");
    run.bannerSub = T("it bought everything you bought");
    run.bannerColor = "#7dd3fc";
    run.bannerUntil = simMs + 3400;
    audio.play("bossWake");
    audio.setMusic("boss");
    fx.ring(S.mirror.x, S.mirror.y, 70, "#7dd3fc", 5, 0.5);
    fx.ring(S.mirror.x, S.mirror.y, 40, "#ffffff", 3, 0.4);
    SF.comms.say("mirrorSeen");
  }

  if(S.stage === "duel" && S.mirror){
    const m = S.mirror, p = world.player;
    m.t += dt;
    m.flash = Math.max(0, m.flash - dt*4);
    /*
     * THE FIGHT'S RHYTHM (unchanged from its first home).
     *
     * Mirroring your lane is the whole idea of this boss, and on its own it
     * made the duel unwinnable: your guns fire straight up from your x, and
     * it sits at W - x, so the ONLY place you are lined up with it is dead
     * centre - which is also the only place its volley lands on you. So it
     * breathes: mirror and shoot, then OPEN - middle, hold, guns cold - and
     * that is your turn. Wait, then hit.
     */
    if(m.y <= m.holdY){
      m.modeT -= dt;
      if(m.modeT <= 0){
        if(m.mode === "mirror"){
          m.mode = "open"; m.modeT = 3.0;
          m.dodgeDir = 0; m.dodgeUsed = 0;
          audio.play("telegraph");
          if(!m.taught){                 // teach the window the first time
            m.taught = true;
            run.bannerText = T("IT'S WIDE OPEN");
            run.bannerSub = T("when it stops, SHOOT IT");
            run.bannerColor = "#4ade80";
            run.bannerUntil = simMs + 2600;
          }
        } else {
          m.mode = "mirror"; m.modeT = 3.2;
          m.fireTimer = Math.max(m.fireTimer, 0.7);   // room to slide away
        }
      }
    }
    // It rises out of the sea to its lane at the top, then holds it: your x,
    // reflected - except when it is open, where it waits in the middle.
    if(m.y > m.holdY) m.y -= 150 * dt;
    else if(m.mode === "open"){
      m.x = lerp(m.x, W/2, Math.min(1, dt*1.6));
      m.y = m.holdY + Math.sin(m.t*1.3)*10;
    }
    else if(p){
      const lane = W - p.x;
      m.x = lerp(m.x, lane, Math.min(1, dt*2.2));
      m.y = m.holdY + Math.sin(m.t*1.3)*22;
    }
    // It shoots YOUR guns back: your spread pattern, your fire rate.
    m.fireTimer -= dt;
    if(m.fireTimer <= 0 && m.y <= m.holdY + 60 && m.mode === "mirror"){
      const angles = SF.config.spreadPattern(m.spread);
      for(let i = 0; i < angles.length; i++){
        const a = Math.PI/2 + angles[i]/600;      // down, fanned like yours
        world.spawnEnemyBullet(m.x, m.y + 24,
          Math.cos(a)*330, Math.sin(a)*330, "aimed", 4.5);
      }
      m.fireTimer = 0.62 * SF.config.fireRateMult(m.rapid) * 2.4;
      audio.play("shoot", true);
    }
    // It dodges like the rival - on a cooldown, with a tell.
    m.dodgeCool = Math.max(0, m.dodgeCool - dt);
    m.tell = Math.max(0, m.tell - dt);
    if(!m.dodgeDir && m.dodgeCool <= 0 && m.mode === "mirror"){
      const bs = world.bullets.items;
      for(let i = 0; i < bs.length; i++){
        const b = bs[i];
        if(!b.alive || b.vy >= 0) continue;
        if(Math.abs(b.x - m.x) < m.r + 26 && b.y > m.y && b.y - m.y < 170){
          m.dodgeDir = b.x < m.x ? 1 : -1;
          if(m.x < 90) m.dodgeDir = 1;
          if(m.x > W - 90) m.dodgeDir = -1;
          m.tell = 0.14;
          break;
        }
      }
    }
    if(m.dodgeDir && m.tell <= 0){
      m.x = clamp(m.x + m.dodgeDir * 460 * dt, 40, W - 40);
      m.dodgeUsed = (m.dodgeUsed || 0) + 460 * dt;
      if(m.dodgeUsed > 120){ m.dodgeDir = 0; m.dodgeUsed = 0; m.dodgeCool = 1.5; }
    }
    // Your bullets vs it. An open guard is worth double - the payout for the
    // thing the fight is teaching.
    const bs = world.bullets.items;
    for(let i = 0; i < bs.length; i++){
      const b = bs[i];
      if(!b.alive) continue;
      const dx = b.x - m.x, dy = b.y - m.y;
      if(dx*dx + dy*dy < (m.r + 5)*(m.r + 5)){
        b.alive = false;
        const mult = m.mode === "open" ? 2 : 1;
        // `b.dmg`, NOT `b.damage` - see the pool factory in entities.js.
        const hit = (b.dmg || 1) * mult;
        m.hp -= hit;
        m.flash = 1;
        fx.spark(b.x, b.y, 0, -60, mult > 1 ? "#4ade80" : "#7dd3fc", 0.3, 2);
        if(SF.game.run) SF.game.run.stats.damageDealt =
          (SF.game.run.stats.damageDealt || 0) + hit;
      }
    }
    // At each third of health it plays YOUR panic button: a bomb that
    // clears YOUR bullets off the screen.
    if(m.bombs > 0 && m.hp <= m.maxHp * m.nextBombAt){
      m.bombs--; m.nextBombAt -= 0.33;
      for(let i = 0; i < bs.length; i++)
        if(bs[i].alive){ fx.spark(bs[i].x, bs[i].y, 0, 40, "#7dd3fc", 0.25, 2); bs[i].alive = false; }
      fx.ring(m.x, m.y, 180, "#7dd3fc", 6, 0.6);
      fx.shake(10);
      audio.play("bomb");
      SF.comms.say("mirrorBomb");
    }
    // Ram guard: standing under it hurts (gently - it is still a duel). Not
    // while it is open: the window is the one moment the fight tells you to
    // come and get it.
    if(m.mode === "mirror" && p && p.alive &&
       Math.hypot(p.x - m.x, p.y - m.y) < m.r + 16)
      SF.game.hurtPlayer && SF.game.hurtPlayer("mirror");
    if(m.hp <= 0){
      S.stage = "shatter"; S.t = 0;
      // The glass breaks the way glass breaks: white, then everywhere.
      fx.explosion(m.x, m.y, 150, "#7dd3fc", true);
      for(let i = 0; i < 3; i++)
        fx.ring(m.x, m.y, 60 + i*55, i % 2 ? "#ffffff" : "#7dd3fc", 5 - i, 0.5 + i*0.14);
      fx.debris(m.x, m.y, 26, "#bfe8ff");
      fx.shake(26); fx.hitStop(160);
      fx.flash(0.8, "220,240,255");
      audio.play("bossExplode");
      world.enemyBullets.killAll();
      run.bannerText = T("THE GLASS BREAKS");
      run.bannerSub = T("there was only ever one of you");
      run.bannerColor = "#7dd3fc";
      run.bannerUntil = simMs + 3200;
      const pay = run.difficulty.pay * (world.player ? world.player.moneyMult : 1);
      world.dropCoins(m.x, Math.min(m.y, 300), Math.round(650 * pay));
      run.score += Math.round(2500 * run.difficulty.pay);
      SF.game.profile && SF.game.profile.bossesDefeated++;
      SF.comms.say("mirrorDown");
    }
  }

  if(S.stage === "shatter" && S.t > 1.6) S.stage = "done";
}

/* At boss depth: the pilot itself - your ship, upside down, in sea glass. */
function drawActors(ctx, timeMs){
  if(!S || S.stage !== "duel" && S.stage !== "shatter") return;
  const m = S.mirror;
  if(!m || S.stage === "shatter") return;
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(Math.PI);
  SF.shipart.drawShip(ctx, 0, 0, 62, {
    color: "#28455e",
    levels: SF.shipart.levelsOf(SF.game.profile),
    t: m.t, idle: false,
    tune: SF.game.profile && SF.game.profile.tune,
    hull: SF.game.profile && SF.game.profile.hull,
  });
  ctx.restore();
  // A glass sheen down the hull, so it still reads as the reflection even
  // now that it has a mind of its own.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.16 + Math.sin(timeMs/300)*0.06;
  const g = ctx.createLinearGradient(m.x - 30, m.y - 30, m.x + 30, m.y + 30);
  g.addColorStop(0, "rgba(190,230,255,0)");
  g.addColorStop(0.5, "rgba(190,230,255,0.9)");
  g.addColorStop(1, "rgba(190,230,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(m.x, m.y, 34, 0, TAU); ctx.fill();
  ctx.restore();
  if(m.flash > 0){
    ctx.globalAlpha = Math.min(0.5, m.flash*0.5);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(m.x, m.y, 34, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Its tell, so a dodge is always something you watched it decide.
  if(m.tell > 0){
    ctx.strokeStyle = "rgba(125,211,252,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 30, 0, TAU);
    ctx.stroke();
  }
  /*
   * The open window, said in green - the game's own colour for "this is
   * good for you". Guns cold, a target ring, and a countdown arc that runs
   * out, so a seven-year-old can see the turn coming and see it ending.
   */
  if(m.mode === "open"){
    const k = clamp(m.modeT / 3.0, 0, 1);
    const pulse = 0.55 + Math.sin(m.t*9)*0.45;
    ctx.save();
    ctx.strokeStyle = "rgba(74,222,128," + (0.45 + pulse*0.45).toFixed(2) + ")";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(m.x, m.y, 40 + pulse*5, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(74,222,128,0.95)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(m.x, m.y, 52, -Math.PI/2, -Math.PI/2 + TAU*k);
    ctx.stroke();
    ctx.fillStyle = "rgba(74,222,128,0.95)";
    ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(T("OPEN!"), m.x, m.y - 62);
    ctx.restore();
  }
}

/* Above the scene, below the HUD: the duel's bar, in sea glass. */
function drawOver(ctx, timeMs){
  if(!S || S.stage !== "duel" || !S.mirror) return;
  const W = VW(), m = S.mirror;
  const w = W*0.62, x = (W - w)/2, y = 96;
  ctx.fillStyle = "rgba(4,8,18,0.72)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(x, y, w, 10, 5);
  else ctx.rect(x, y, w, 10);
  ctx.fill(); ctx.stroke();
  const k = clamp(m.hp/m.maxHp, 0, 1);
  const g = ctx.createLinearGradient(0, y, 0, y + 10);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.35, "#7dd3fc");
  g.addColorStop(1, "#7dd3fc");
  ctx.fillStyle = g;
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(x + 1.5, y + 1.5, Math.max(3, (w - 3)*k), 7, 3.5);
  else ctx.rect(x + 1.5, y + 1.5, Math.max(3, (w - 3)*k), 7);
  ctx.fill();
  const label = T("THE MIRROR PILOT");
  ctx.font = "700 13px Rajdhani, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(6,8,18,0.75)";
  ctx.lineWidth = 3;
  ctx.strokeText(label, W/2, y - 6);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, W/2, y - 6);
}

/** 0..1 for the HUD's mission bar while the duel owns the ending. */
function progress01(){
  if(!S || !S.mirror || S.stage === "waves" || S.stage === "turn") return 0;
  if(S.stage !== "duel") return 1;
  return 1 - S.mirror.hp/S.mirror.maxHp;
}

SF.mirrorduel = { _state: () => S,
                  reset, begin, active, readyToClear, update, progress01,
                  drawActors, drawOver };
})();
