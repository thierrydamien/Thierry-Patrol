/*
 * GameStateManager: owns the canvas, the run lifecycle and the main loop.
 *
 * A "run" is one attempt at one mission on one difficulty. Everything about
 * scoring, objectives and mission flow lives here; spawning lives in the wave
 * director, drawing in the renderer, persistence in the profile store. The
 * loop is fixed-order and allocation-free: input -> world -> collisions ->
 * mission rules -> effects -> draw.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, rand, randInt, chance, pick } = SF.core;
const { VW, VH } = SF.entityConst;
const { MISSIONS, BOSSES, OBJECTIVES } = SF.missions;
const { DIFFICULTY_BY_ID, POWERUPS } = SF.config;
const fx = SF.fx;
const audio = SF.audio;
const P = SF.profile;

let canvas, ctx, gameFrame, scale = 1;
const shakeVec = { x:0, y:0 };

const game = {
  world: new SF.World(),
  run: null,
  state: "idle",          // idle | playing | paused | ending
  profile: null,
  onMissionEnd: null,     // set by the UI layer
  godMode: false,         // test hook only
};

/* ---------------------------------------------------------
   CANVAS
   --------------------------------------------------------- */
function attach(canvasEl, frameEl, screenEl){
  canvas = canvasEl; gameFrame = frameEl;
  ctx = canvas.getContext("2d");
  game._screenEl = screenEl;
  SF.input.attach(canvas, VW, VH);
  window.addEventListener("resize", resize);
}

function resize(){
  const screenEl = game._screenEl;
  if(!screenEl) return;
  const style = getComputedStyle(screenEl);
  const padX = parseFloat(style.paddingLeft || 0) + parseFloat(style.paddingRight || 0);
  const padY = parseFloat(style.paddingTop || 0) + parseFloat(style.paddingBottom || 0);
  const availW = screenEl.clientWidth - padX;
  const availH = screenEl.clientHeight - padY;
  if(availW <= 0 || availH <= 0) return;
  let w = availW, h = w * VH/VW;
  if(h > availH){ h = availH; w = h * VW/VH; }
  gameFrame.style.width = w + "px";
  gameFrame.style.height = h + "px";
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w*dpr);
  canvas.height = Math.round(h*dpr);
  scale = canvas.width / VW;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

/* ---------------------------------------------------------
   LOADOUT - profile upgrades become concrete ship stats.
   --------------------------------------------------------- */
function buildLoadout(profile, difficulty){
  const lv = id => P.upgradeLevel(profile, id);
  return {
    lives: 3 + lv("life") + difficulty.bonusLives,
    shieldMax: lv("shield"),
    invulnTime: 1.7 + lv("armor")*0.6,
    speedMult: 1 + lv("thrusters")*0.14,
    fireInterval: 0.30 * SF.config.fireRateMult(lv("rapid")),
    spreadLvl: lv("spread"),
    damage: 1 + lv("damage"),
    pierce: lv("pierce"),
    homingLvl: lv("homing"),
    magnetRange: 40 + lv("magnet")*45,
    moneyMult: 1 + lv("fortune")*0.15,
    drones: lv("wingman"),
    bombs: lv("bomb"),
    overdrives: lv("overdrive"),
    overdriveTime: 4 + lv("overdrive"),
    color: profile.shipColor,
  };
}

/* ---------------------------------------------------------
   RUN LIFECYCLE
   --------------------------------------------------------- */
function startMission(missionIndex, difficultyId){
  const profile = game.profile;
  const mission = MISSIONS[clamp(missionIndex, 0, MISSIONS.length-1)];
  const difficulty = DIFFICULTY_BY_ID[difficultyId] || DIFFICULTY_BY_ID.pilot;

  game.world.reset();
  fx.reset();
  SF.render.initBackground(missionIndex);
  const loadout = buildLoadout(profile, difficulty);
  game.world.createPlayer(loadout);

  const director = new SF.systems.WaveDirector(mission, difficulty, game.world);
  const stats = {
    spawned: 0, kills: 0, escaped: 0, killRatio: 0,
    rescues: 0, rescuesTotal: director.rescuesPlanned,
    damageTaken: 0, livesLost: 0, completed: false,
  };

  game.run = {
    mission, missionIndex, difficulty, director, stats,
    score: 0, money: 0, combo: 0, comboTimer: 0, maxCombo: 0,
    time: 0, phase: "intro", phaseTimer: 2.2,
    bossActive: false, bossSpawned: false, progress: 0,
    objectiveFlashUntil: 0, objectivesMet: 0,
    powerupTimer: rand(12, 20),
    bannerText: mission.name.toUpperCase(), bannerSub: mission.brief,
    bannerColor: "#ffd23f", bannerUntil: performance.now() + 2600,
    objectiveDefs: mission.objectives.map(id => OBJECTIVES[id]),
    objectiveIds: mission.objectives.slice(),
    ended: false,
  };
  game.state = "playing";
  SF.input.clearMovement();
  audio.init();
  resize();
}

function endMission(completed){
  const run = game.run;
  if(!run || run.ended) return;
  run.ended = true;
  run.progress = completed ? 1 : run.progress;
  run.stats.completed = completed;
  game.state = "ending";

  const stars = run.objectiveDefs.reduce((n, def) => n + (def.test(run.stats) ? 1 : 0), 0);
  const profile = game.profile;

  // Completing pays, and each star pays again - that's what makes replaying an
  // old mission on a harder tier worth the trip.
  if(completed){
    run.completionBonus = Math.round((200 + stars*100) * run.difficulty.pay * game.world.player.moneyMult);
    run.money += run.completionBonus;
  } else {
    run.completionBonus = 0;
  }

  profile.money += run.money;
  profile.lifetimeMoney += run.money;
  profile.totalKills += run.stats.kills;
  profile.rescues += run.stats.rescues;
  if(run.maxCombo > profile.maxCombo) profile.maxCombo = run.maxCombo;
  if(completed){
    profile.missionsCompleted++;
    if(run.stats.damageTaken === 0) profile.flawlessMissions++;
  }
  profile.lastMission = run.mission.id;
  profile.lastDifficulty = run.difficulty.id;
  P.recordMission(profile, run.mission.id, run.difficulty.id, completed ? stars : 0, run.score, completed);
  const unlocked = P.checkAchievements(profile);

  audio.play(completed ? "missionWin" : "missionFail");
  if(game.onMissionEnd){
    game.onMissionEnd({
      completed, stars, run, unlocked,
      objectives: run.objectiveDefs.map(def => ({ label: def.label, icon: def.icon, met: def.test(run.stats) })),
    });
  }
}

/* ---------------------------------------------------------
   EVENT CALLBACKS used by the collision system
   --------------------------------------------------------- */
const callbacks = {
  godMode: false,

  onEnemyKilled(e, bullet, byRamming){
    const run = game.run;
    e.alive = false;
    if(!e.fromBoss){ run.stats.kills++; }

    run.combo++;
    run.comboTimer = 1.4;
    if(run.combo > run.maxCombo) run.maxCombo = run.combo;
    const comboMult = 1 + Math.min(Math.floor(run.combo/4), 5)*0.4;   // caps at x3
    const scoreMult = comboMult * run.difficulty.pay * (performance.now() < game.world.player.tempScoreUntil ? 2 : 1);

    run.score += Math.round(e.score * scoreMult);
    const coin = Math.max(1, Math.round(e.money * run.difficulty.pay * game.world.player.moneyMult * comboMult));
    game.world.dropCoins(e.x, e.y, coin);

    fx.explosion(e.x, e.y, e.size, e.elite ? "#ffd23f" : "#ffb03d", e.elite || e.maxHp >= 5);
    fx.shake(e.elite ? 9 : (e.maxHp >= 5 ? 6 : 3));
    if(e.elite || e.maxHp >= 6) fx.hitStop(55);
    audio.play("enemyExplode", e.elite || e.maxHp >= 5);

    if(run.combo > 0 && run.combo % 5 === 0){
      fx.text(e.x, e.y - 16, "x" + run.combo + "!", "#ffd23f", 15);
      audio.play("combo", run.combo);
    }
    if(e.elite){
      fx.text(e.x, e.y - 24, "ELITE DOWN", "#ffd23f", 14, true);
      spawnPowerup(e.x, e.y);
    } else if(chance(0.045)){
      spawnPowerup(e.x, e.y);
    }
    if(e.carriesRescue){
      const pod = game.world.spawnPickup("rescue", e.x, e.y);
      pod.vy = 30;
      fx.text(e.x, e.y - 20, "PILOT FREED!", "#ffd23f", 14, true);
    }
  },

  onEnemyEscaped(e){
    const run = game.run;
    if(e.fromBoss) return;
    run.stats.escaped++;
    if(e.carriesRescue){
      fx.text(VW/2, VH*0.5, "HAULER ESCAPED", "#ff5d73", 15, true);
    }
  },

  onBossHit(boss, bullet){
    const run = game.run;
    const res = SF.bosses.damage(boss, bullet.dmg, bullet.x, bullet.y);
    if(res.weakPointDestroyed){
      run.score += Math.round(250 * run.difficulty.pay);
      fx.text(boss.x + res.weakPointDestroyed.ox, boss.y + res.weakPointDestroyed.oy,
              "WEAK POINT DOWN", "#ffd23f", 14, true);
      game.world.dropCoins(boss.x + res.weakPointDestroyed.ox, boss.y + res.weakPointDestroyed.oy,
                           Math.round(40 * run.difficulty.pay * game.world.player.moneyMult));
    }
    if(res.killed) killBoss(boss);
  },

  onPlayerHit(source){
    const run = game.run;
    const p = game.world.player;
    if(!p || !p.alive || p.invuln > 0) return;
    run.stats.damageTaken++;

    if(p.shield > 0){
      p.shield--;
      p.invuln = Math.max(0.9, p.invulnTime*0.5);
      fx.ring(p.x, p.y, 46, "#7cc4ff", 3, 0.35);
      fx.sparks(p.x, p.y, 14, "#7cc4ff", 180);
      fx.shake(7);
      fx.flash(0.5, "80,180,255");
      audio.play("shieldBreak");
      return;
    }

    p.lives--;
    run.stats.livesLost++;
    run.combo = 0;
    p.invuln = p.invulnTime;
    fx.explosion(p.x, p.y, 46, p.color, true);
    fx.shake(16);
    fx.flash(1, "255,40,60");
    fx.hitStop(90);
    audio.play("playerHit");

    if(p.lives <= 0){
      p.alive = false;
      endMission(false);
    }
  },
};

function spawnPowerup(x, y){
  const def = pick(POWERUPS);
  game.world.spawnPickup("power", x, y, def);
}

function killBoss(boss){
  const run = game.run;
  run.score += Math.round(1200 * run.difficulty.pay);
  game.world.dropCoins(boss.x, boss.y, Math.round(220 * run.difficulty.pay * game.world.player.moneyMult));
  game.profile.bossesDefeated++;
  audio.play("bossExplode");
  fx.shake(26);
  fx.flash(0.8, "255,200,120");
  fx.hitStop(140);
  // Comes apart in stages rather than vanishing in one puff.
  const bx = boss.x, by = boss.y, wounds = boss.wounds.slice();
  fx.explosion(bx, by, boss.size, "#ffb03d", true);
  wounds.forEach((w, i) => setTimeout(() => {
    if(game.state !== "playing" && game.state !== "ending") return;
    fx.explosion(bx + w.x, by + w.y, 28, i%2 ? "#ffffff" : "#ff8a3d", false);
    fx.shake(7);
  }, i*70));
  fx.text(bx, by, "BOSS DOWN!", "#ffd23f", 22, true);
  game.world.boss = null;
  run.bossActive = false;
  setTimeout(() => { if(!run.ended) endMission(true); }, 1200);
}

/* ---------------------------------------------------------
   ABILITIES
   --------------------------------------------------------- */
function useBomb(){
  const p = game.world.player;
  if(game.state !== "playing" || !p || !p.alive || p.bombs <= 0) return false;
  p.bombs--;
  audio.play("bomb");
  fx.shake(22);
  fx.flash(0.85, "255,220,140");
  fx.ring(p.x, p.y, VW*1.1, "#ffd23f", 6, 0.6);
  fx.hitStop(80);

  const enemies = game.world.enemies.items;
  for(let i=0;i<enemies.length;i++){
    const e = enemies[i];
    if(!e.alive) continue;
    e.hp = 0;
    callbacks.onEnemyKilled(e, null, false);
  }
  game.world.enemyBullets.killAll();
  if(game.world.boss && game.world.boss.alive){
    const res = SF.bosses.damage(game.world.boss, Math.round(game.world.boss.maxHp*0.12), game.world.boss.x, game.world.boss.y);
    if(res.killed) killBoss(game.world.boss);
  }
  fx.text(VW/2, VH*0.45, "BOOM!", "#ffd23f", 26, true);
  return true;
}

function useOverdrive(){
  const p = game.world.player;
  if(game.state !== "playing" || !p || !p.alive || p.overdrives <= 0) return false;
  if(performance.now() < p.overdriveUntil) return false;
  p.overdrives--;
  p.overdriveUntil = performance.now() + p.overdriveTime*1000;
  audio.play("overdrive");
  fx.ring(p.x, p.y, 90, "#ff8a3d", 4, 0.5);
  fx.text(p.x, p.y - 30, "OVERDRIVE!", "#ff8a3d", 17, true);
  return true;
}

/* ---------------------------------------------------------
   UPDATE
   --------------------------------------------------------- */
const behaviourCtx = {
  VW, VH, player: null, difficulty: null, smart: 0,
  onEscape: null,
  onEnemyKilled: null, onBossHit: null, onPlayerHit: null, godMode: false,
};

function update(dt, timeMs){
  const run = game.run;
  if(!run) return;

  // Hit-stop: freeze the simulation for a few frames on heavy impacts, but
  // keep effects and audio running so it reads as impact, not a stall.
  if(fx.isHitStopped()) dt *= 0.12;

  run.time += dt;

  behaviourCtx.player = game.world.player;
  behaviourCtx.difficulty = run.difficulty;
  behaviourCtx.smart = run.difficulty.smart;
  behaviourCtx.onEscape = callbacks.onEnemyEscaped;
  behaviourCtx.onEnemyKilled = callbacks.onEnemyKilled;
  behaviourCtx.onBossHit = callbacks.onBossHit;
  behaviourCtx.onPlayerHit = callbacks.onPlayerHit;
  behaviourCtx.godMode = game.godMode;

  // Mission phases
  if(run.phase === "intro"){
    run.phaseTimer -= dt;
    if(run.phaseTimer <= 0) run.phase = "waves";
  } else if(run.phase === "waves"){
    run.director.update(dt);
    run.stats.spawned = run.director.spawnedCount;
    if(run.director.finishedSpawning && game.world.countEnemies() === 0){
      if(run.mission.boss){
        run.phase = "boss";
        run.bossActive = true;
        run.bossSpawned = true;
        game.world.boss = SF.bosses.create(run.mission.boss, run.difficulty);
        run.bannerText = "⚠ WARNING ⚠";
        run.bannerSub = BOSSES[run.mission.boss].name + " INCOMING";
        run.bannerColor = "#ff5d73";
        run.bannerUntil = performance.now() + 2400;
        audio.play("alarm");
      } else {
        run.phase = "clearing";
        run.phaseTimer = 1.2;
      }
    }
  } else if(run.phase === "clearing"){
    run.phaseTimer -= dt;
    if(run.phaseTimer <= 0 && !run.ended) endMission(true);
  }

  // Progress readout: waves spawned, then boss health.
  if(run.bossActive && game.world.boss){
    run.progress = 1 - 0.35*(game.world.boss.hp/game.world.boss.maxHp);
  } else {
    run.progress = run.director.totalPlanned
      ? clamp(run.stats.kills / run.director.totalPlanned, 0, 0.65)
      : 0;
  }

  game.world.updatePlayer(dt, timeMs);
  game.world.updateBullets(dt);
  game.world.updateEnemies(dt, behaviourCtx);
  if(game.world.boss) SF.bosses.update(game.world.boss, dt, game.world, behaviourCtx, timeMs);

  game.world.updatePickups(dt, onPickupCollected);

  // Occasional free power-up so a mission always has something to chase.
  if(run.phase === "waves"){
    run.powerupTimer -= dt;
    if(run.powerupTimer <= 0){
      spawnPowerup(rand(40, VW-40), -20);
      run.powerupTimer = rand(16, 26);
    }
  }

  SF.systems.resolve(game.world, behaviourCtx, dt);

  if(run.comboTimer > 0){
    run.comboTimer -= dt;
    if(run.comboTimer <= 0) run.combo = 0;
  }

  fx.update(dt, timeMs);
  SF.render.updateBackground(dt);

  const stats = run.stats;
  stats.killRatio = stats.spawned ? stats.kills / Math.max(stats.spawned, run.director.totalPlanned) : 0;

  let met = 0;
  for(let i=0;i<run.objectiveDefs.length;i++) if(run.objectiveDefs[i].test(stats)) met++;
  if(met > run.objectivesMet){
    run.objectiveFlashUntil = timeMs + 2600;   // show the full list again briefly
    fx.text(VW/2, VH*0.28, "OBJECTIVE COMPLETE", "#4ade80", 15, true);
    audio.play("star", met);
  }
  run.objectivesMet = met;
}

function onPickupCollected(item, lost){
  const run = game.run;
  const p = game.world.player;
  if(lost){
    if(item.kind === "rescue") fx.text(VW/2, VH*0.55, "PILOT LOST", "#ff5d73", 14, true);
    return;
  }
  if(item.kind === "coin"){
    run.money += item.value;
    audio.play("coin");
    fx.sparks(item.x, item.y, 3, "#ffd23f", 90);
  } else if(item.kind === "rescue"){
    run.stats.rescues++;
    run.score += Math.round(150 * run.difficulty.pay);
    run.money += Math.round(40 * run.difficulty.pay * p.moneyMult);
    audio.play("rescue");
    fx.ring(item.x, item.y, 40, "#ffd23f", 3, 0.4);
    fx.text(item.x, item.y-14, "PILOT RESCUED", "#ffd23f", 14, true);
  } else {
    const def = item.data;
    const now = performance.now();
    game.profile.powerupsCollected++;
    audio.play("pickup");
    fx.text(p.x, p.y-28, def.label + "!", def.color, 15, true);
    if(def.id === "rapid") p.tempRapidUntil = now + 9000;
    else if(def.id === "spread") p.tempSpreadUntil = now + 9000;
    else if(def.id === "shield") p.shield = Math.min(p.shield+1, Math.max(1, p.shieldMax)+1);
    else if(def.id === "score2x") p.tempScoreUntil = now + 9000;
    else if(def.id === "homing") p.tempHomingUntil = now + 9000;
  }
}

/* ---------------------------------------------------------
   DRAW
   --------------------------------------------------------- */
function draw(timeMs){
  if(!ctx) return;
  const world = game.world;
  ctx.save();
  fx.shakeOffset(shakeVec);
  ctx.translate(shakeVec.x, shakeVec.y);
  ctx.clearRect(-30, -30, VW+60, VH+60);
  SF.render.drawBackground(ctx);
  SF.render.drawPickups(ctx, world, timeMs);
  SF.render.drawEnemies(ctx, world);
  SF.render.drawBoss(ctx, world.boss, timeMs);
  SF.render.drawBullets(ctx, world);
  SF.render.drawPlayer(ctx, world.player, timeMs);
  fx.drawParticles(ctx);
  fx.drawTexts(ctx);
  if(game.run) SF.render.drawHud(ctx, game);
  fx.drawFlash(ctx, VW, VH);
  ctx.restore();
}

/* ---------------------------------------------------------
   MAIN LOOP
   --------------------------------------------------------- */
let last = 0;
function frame(now){
  // Queue the next frame first: one bad frame can never freeze the game.
  requestAnimationFrame(frame);
  let dt = (now - last)/1000;
  last = now;
  if(dt > 0.05) dt = 0.05;         // tab-switch guard

  if(game.state === "playing" || game.state === "ending"){
    if(SF.input.consumePause() && game.state === "playing" && SF.ui) SF.ui.togglePause();
    if(SF.input.consumeBomb()) useBomb();
    if(SF.input.consumeOverdrive()) useOverdrive();
    if(game.state === "playing") update(dt, now);
    else { fx.update(dt, now); SF.render.updateBackground(dt); }
    draw(now);
    if(SF.ui) SF.ui.syncAbilityButtons();
  } else if(game.state === "paused"){
    fx.update(0, now);
    draw(now);
  }
}

function start(){
  requestAnimationFrame(frame);
}

SF.game = game;
Object.assign(game, {
  attach, resize, start, startMission, endMission, useBomb, useOverdrive,
  buildLoadout, callbacks,
});
})();
