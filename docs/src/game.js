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
  // Wingman drones are flown by the *other* pilots in the household, in their
  // own ship colours and under their own callsigns. Buying a Wingman Drone
  // doesn't summon a nameless escort - it calls your brother in.
  // `levels` rides along so the comms portrait draws their ship as *they*
  // have built it, not a stock hull in their colour.
  const crew = P.squadmates(profile.name).slice(0, 2).map(m => ({
    callsign: m.callsign || m.name, color: m.shipColor, levels: SF.shipart.levelsOf(m),
    pilot: { name: m.name, avatar: m.avatar, shipColor: m.shipColor, badge: m.badge },
  }));
  return {
    crew,
    lives: 3 + lv("life") + difficulty.bonusLives,
    shieldMax: lv("shield"),
    invulnTime: 1.7 + lv("armor")*0.6,
    speedMult: 1 + lv("thrusters")*0.14,
    fireInterval: 0.30 * SF.config.fireRateMult(lv("rapid")),
    spreadLvl: lv("spread"),
    damage: 1 + lv("damage"),
    pierce: lv("pierce"),
    homingLvl: lv("homing"),
    magnetRange: 60 + lv("magnet")*68,
    moneyMult: 1 + lv("fortune")*0.15,
    drones: lv("wingman"),
    bombs: lv("bomb"),
    overdrives: lv("overdrive"),
    overdriveTime: 4 + lv("overdrive"),
    color: profile.shipColor,
    // The same levels object the hangar draws from, so the ship you fly is
    // the ship you built - every bought part visible in combat.
    levels: SF.shipart.levelsOf(profile),
    dps: singleTargetDps(lv),
  };
}

/*
 * Sustained damage-per-second this loadout can put into ONE target.
 *
 * Bosses are sized from this rather than from a fixed number, because player
 * firepower spans ~70x between a stock ship and a maxed one while a fixed HP
 * pool spans 1x: measured, a maxed ship killed the Sky Sentinel in five
 * seconds. Piercing is deliberately excluded - it hits *more* enemies, not the
 * same one harder - and drones count at their real 60% damage.
 */
function singleTargetDps(lv){
  const shots = SF.config.spreadPattern(lv("spread")).length;
  const interval = 0.30 * SF.config.fireRateMult(lv("rapid"));
  const dmg = 1 + lv("damage");
  const drones = lv("wingman") * Math.max(1, Math.round(dmg*0.6));
  return (shots*dmg + drones) / interval;
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
  const wavesEndT = mission.waves.reduce((t, wv) => Math.max(t, wv.t), 0) + 10;
  const stats = {
    spawned: 0, kills: 0, escaped: 0, killRatio: 0,
    rescues: 0, rescuesTotal: director.rescuesPlanned,
    damageTaken: 0, livesLost: 0, completed: false,
  };

  game.run = {
    mission, missionIndex, difficulty, director, stats, wavesEndT,
    halfwayShown: false, boulderShown: false,
    /*
     * Per-kill payout, damped by the tier's density. A hard tier now sends
     * three times as many enemies, so paying `pay` per head would have made
     * one NIGHTMARE run worth $30k against a $70k Armory - the tier would buy
     * the game out in two flights. The square root keeps hard tiers clearly
     * more lucrative without letting headcount run the economy. Completion and
     * rescue bonuses are per-mission, not per-head, so they keep the full rate.
     */
    payScale: difficulty.pay / Math.sqrt(difficulty.density || 1),
    score: 0, money: 0, combo: 0, comboTimer: 0, maxCombo: 0,
    time: 0, phase: "intro", phaseTimer: 2.2,
    bossActive: false, bossSpawned: false, progress: 0,
    objectiveFlashUntil: 0, objectivesMet: 0, finishTimer: 0,
    powerupTimer: rand(12, 20),
    bannerText: mission.name.toUpperCase(), bannerSub: mission.brief,
    bannerColor: "#ffd23f", bannerUntil: performance.now() + 2600,
    objectiveDefs: mission.objectives.map(id => OBJECTIVES[id]),
    objectiveIds: mission.objectives.slice(),
    ended: false,
  };
  game.state = "playing";
  SF.comms.begin(profile, loadout.crew);
  SF.comms.say("missionStart");
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
  // Captured BEFORE the save: once recordMission runs, this run's score IS
  // the record and "did I beat anything?" can no longer be answered.
  const prevFamilyBest = P.familyBest(run.mission.id);
  const prevRec = profile.missions[run.mission.id];
  const prevSelfBest = prevRec && prevRec.best
    ? Math.max.apply(null, [0].concat(Object.values(prevRec.best).map(Number))) : 0;
  P.recordMission(profile, run.mission.id, run.difficulty.id, completed ? stars : 0, run.score, completed);
  const unlocked = P.checkAchievements(profile);

  audio.play(completed ? "missionWin" : "missionFail");
  if(game.onMissionEnd){
    game.onMissionEnd({
      completed, stars, run, unlocked,
      prevFamilyBest, prevSelfBest,
      objectives: run.objectiveDefs.map(def => ({
        label: def.label, icon: def.icon, met: def.test(run.stats),
        progress: def.progress(run.stats),
      })),
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
    if(e.counted){ run.stats.kills++; }

    // A thief drops everything it lifted. Killing one mid-run is a real save,
    // so it pays back visibly rather than silently.
    if(e.loot > 0){
      game.world.dropCoins(e.x, e.y, e.loot);
      fx.text(e.x, e.y - 26, "+$" + e.loot + " BACK!", "#ffd23f", 18, true);
      SF.comms.say("thiefDown");
    }

    // Splitters burst into shards that immediately come at you - the kill is
    // the start of the problem, not the end of it.
    const split = e.type.splitsInto;
    if(split && !byRamming){
      for(let i=0;i<split.n;i++){
        const a = (i/split.n)*Math.PI - Math.PI/2;
        const shard = game.world.spawnEnemy(split.type, e.x, e.y, {
          difficulty: run.difficulty,
          vx: Math.cos(a)*120, vy: Math.sin(a)*120 + 60,
        });
        shard.fromBoss = e.fromBoss;
      }
      fx.ring(e.x, e.y, 34, "#86efac", 3, 0.3);
    }

    run.combo++;
    run.comboTimer = 1.4;
    if(run.combo > run.maxCombo) run.maxCombo = run.combo;
    const comboMult = 1 + Math.min(Math.floor(run.combo/4), 5)*0.4;   // caps at x3
    const scoreMult = comboMult * run.difficulty.pay * (performance.now() < game.world.player.tempScoreUntil ? 2 : 1);

    run.score += Math.round(e.score * scoreMult);
    const coin = Math.max(1, Math.round(e.money * run.payScale * game.world.player.moneyMult * comboMult));
    game.world.dropCoins(e.x, e.y, coin);

    fx.explosion(e.x, e.y, e.size, e.elite ? "#ffd23f" : "#ffb03d", e.elite || e.maxHp >= 5);
    fx.shake(e.elite ? 9 : (e.maxHp >= 5 ? 6 : 3));
    if(e.elite || e.maxHp >= 6) fx.hitStop(55);
    audio.play("enemyExplode", e.elite || e.maxHp >= 5);

    if(run.combo > 0 && run.combo % 5 === 0){
      fx.text(e.x, e.y - 20, "x" + run.combo + "!", "#ffd23f", 19);
      audio.play("combo", run.combo);
      if(run.combo >= 10) SF.comms.say("bigCombo", { n: run.combo });
    }
    if(e.elite){
      fx.text(e.x, e.y - 30, "ELITE DOWN", "#ffd23f", 17, true);
      spawnPowerup(e.x, e.y);
    } else if(chance(0.045)){
      spawnPowerup(e.x, e.y);
    }
    if(e.carriesRescue){
      const pod = game.world.spawnPickup("rescue", e.x, e.y);
      pod.vy = 30;
      fx.text(e.x, e.y - 26, "PILOT FREED!", "#ffd23f", 17, true);
    }
  },

  onEnemyEscaped(e){
    const run = game.run;
    if(e.fromBoss) return;
    if(e.loot > 0){
      fx.text(VW/2, VH*0.42, "THIEF GOT AWAY WITH $" + e.loot, "#ff5d73", 19, true);
      SF.comms.say("thiefEscaped", { n: e.loot });
    }
    if(!e.counted) return;
    run.stats.escaped++;
    if(e.carriesRescue){
      fx.text(VW/2, VH*0.5, "HAULER ESCAPED", "#ff5d73", 19, true);
    }
  },

  onBossHit(boss, bullet){
    const run = game.run;
    const res = SF.bosses.damage(boss, bullet.dmg, bullet.x, bullet.y);
    if(res.weakPointDestroyed){
      run.score += Math.round(250 * run.difficulty.pay);
      fx.text(boss.x + res.weakPointDestroyed.ox, boss.y + res.weakPointDestroyed.oy,
              "WEAK POINT DOWN", "#ffd23f", 14, true);
      SF.comms.say("bossWeakPoint");
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
      fx.ring(p.x, p.y, 60, "#7cc4ff", 3, 0.35);
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
    fx.explosion(p.x, p.y, 58, p.color, true);
    fx.shake(16);
    fx.flash(1, "255,40,60");
    fx.hitStop(90);
    audio.play("playerHit");

    if(p.lives <= 0){
      p.alive = false;
      endMission(false);
    } else if(p.lives === 1){
      SF.comms.say("lowLives");
    } else {
      SF.comms.say("lifeLost");
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
    fx.explosion(bx + w.x, by + w.y, 36, i%2 ? "#ffffff" : "#ff8a3d", false);
    fx.shake(7);
  }, i*70));
  fx.text(bx, by, "BOSS DOWN!", "#ffd23f", 30, true);
  game.world.boss = null;
  run.bossActive = false;
  // Hold the results back for a beat so the death animation lands. This is a
  // simulation timer, not a wall-clock setTimeout: a real-time timer would
  // fire behind the pause overlay, and if it were ever dropped the mission
  // could never finish at all.
  run.finishTimer = 1.3;
}

function pilotName(){
  const p = game.profile;
  return ((p && (p.callsign || p.name)) || "PILOT").toUpperCase();
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
  fx.text(VW/2, VH*0.45, "BOOM!", "#ffd23f", 34, true);
  return true;
}

function useOverdrive(){
  const p = game.world.player;
  if(game.state !== "playing" || !p || !p.alive || p.overdrives <= 0) return false;
  if(performance.now() < p.overdriveUntil) return false;
  p.overdrives--;
  p.overdriveUntil = performance.now() + p.overdriveTime*1000;
  audio.play("overdrive");
  fx.ring(p.x, p.y, 120, "#ff8a3d", 4, 0.5);
  fx.text(p.x, p.y - 38, "OVERDRIVE!", "#ff8a3d", 22, true);
  return true;
}

/* ---------------------------------------------------------
   UPDATE
   --------------------------------------------------------- */
const behaviourCtx = {
  VW, VH, player: null, difficulty: null, smart: 0,
  pickups: null,          // the Coin Thief hunts loose coins
  world: null,            // minelayers, hives and menders reach into the field
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
  behaviourCtx.pickups = game.world.pickups;
  behaviourCtx.world = game.world;
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
        game.world.boss = SF.bosses.create(run.mission.boss, run.difficulty, game.world.player.dps);
        run.bannerText = "⚠ WARNING ⚠";
        run.bannerSub = BOSSES[run.mission.boss].name + " INCOMING";
        run.bannerColor = "#ff5d73";
        run.bannerUntil = performance.now() + 2400;
        audio.play("alarm");
        SF.comms.say("bossIncoming");
      } else {
        run.phase = "clearing";
        run.phaseTimer = 1.2;
      }
    }
  } else if(run.phase === "clearing"){
    run.phaseTimer -= dt;
    if(run.phaseTimer <= 0 && !run.ended) endMission(true);
  }

  // Boss defeated: run out the celebration, then hand over to the results.
  if(run.finishTimer > 0){
    run.finishTimer -= dt;
    if(run.finishTimer <= 0 && !run.ended){ endMission(true); return; }
  }

  // Progress readout: waves spawned, then boss health.
  if(run.bossActive && game.world.boss){
    run.progress = 0.65 + 0.35*(1 - game.world.boss.hp/game.world.boss.maxHp);
  } else {
    const timeline = clamp(run.director.time / run.wavesEndT, 0, 1);
    const cleared = run.director.totalPlanned
      ? clamp(run.stats.kills / run.director.totalPlanned, 0, 1) : 0;
    run.progress = Math.max(timeline, cleared) * (run.mission.boss ? 0.65 : 1);
  }

  // Long missions need a beat in the middle: a callout, and a bonus for
  // getting there, so the second half feels like a new stretch rather than
  // more of the same.
  if(!run.halfwayShown && run.phase === "waves" && run.director.time >= run.wavesEndT*0.5){
    run.halfwayShown = true;
    const bonus = Math.round(60 * run.difficulty.pay * game.world.player.moneyMult);
    run.money += bonus;
    run.bannerText = "HALFWAY";
    run.bannerSub = "+$" + bonus + " · keep going, " + pilotName() + "!";
    run.bannerColor = "#4ade80";
    run.bannerUntil = timeMs + 2000;
    audio.play("waveClear");
    SF.comms.say("halfway");
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
    if(run.comboTimer <= 0){
      if(run.combo >= 5) SF.comms.say("comboBreak", { n: run.combo });
      run.combo = 0;
    }
  }
  SF.comms.update(dt);
  checkCloseCall();
  announceNewThreats();

  fx.update(dt, timeMs);
  SF.render.updateBackground(dt);

  const stats = run.stats;
  stats.killRatio = stats.spawned ? stats.kills / Math.max(stats.spawned, run.director.totalPlanned) : 0;

  let met = 0;
  for(let i=0;i<run.objectiveDefs.length;i++) if(run.objectiveDefs[i].test(stats)) met++;
  if(met > run.objectivesMet){
    run.objectiveFlashUntil = timeMs + 2600;   // show the full list again briefly
    fx.text(VW/2, VH*0.28, "OBJECTIVE COMPLETE", "#4ade80", 20, true);
    audio.play("star", met);
  }
  run.objectivesMet = met;
}

/*
 * A near miss is a bullet that gets inside a small ring around the ship
 * without ever touching it. Cheap to spot (enemy bullets are a bounded pool)
 * and it's the moment kids actually feel - so it gets a line.
 */
/*
 * The first Guardian, thief, splitter or rock of a run gets a line explaining
 * what it wants from you. A new mechanic that nobody explains just reads as
 * the game being broken ("why aren't my bullets working?").
 */
const THREAT_LINES = { shielder:"guardian", thief:"thiefSpotted", splitter:"splitter",
                       asteroid:"asteroids", boulder:"boulders", sniper:"sniper",
                       mender:"mender", hive:"hive", bomber:"bomber",
                       interceptor:"interceptor" };
function announceNewThreats(){
  const run = game.run;
  const items = game.world.enemies.items;
  for(let i=0;i<items.length;i++){
    const e = items[i];
    if(!e.alive || e.y < 0) continue;
    const line = THREAT_LINES[e.typeId];
    if(line) SF.comms.say(line);
    // A boulder is a set piece, so it gets the full banner treatment once.
    if(e.typeId === "boulder" && !run.boulderShown){
      run.boulderShown = true;
      run.bannerText = "⚠ ASTEROID FIELD ⚠";
      run.bannerSub = "Break the big ones up - they pay";
      run.bannerColor = "#cbd5e1";
      run.bannerUntil = performance.now() + 2400;
      audio.play("alarm");
    }
  }
}

const CLOSE_R = 26;
function checkCloseCall(){
  const p = game.world.player;
  if(!p || !p.alive || p.invuln > 0) return;
  const items = game.world.enemyBullets.items;
  for(let i=0;i<items.length;i++){
    const b = items[i];
    if(!b.alive || b.vy <= 0) continue;
    // Only count it once it's level with or past the ship: still-approaching
    // bullets aren't near misses yet, they're threats.
    if(b.y < p.y) continue;
    if(b.y > p.y + 24) continue;
    const dx = b.x - p.x, dy = b.y - p.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if(d < CLOSE_R + b.r && d > p.r + b.r){
      SF.comms.say("closeCall");
      return;
    }
  }
}

function onPickupCollected(item, lost){
  const run = game.run;
  const p = game.world.player;
  if(lost){
    if(item.kind === "rescue") fx.text(VW/2, VH*0.55, "PILOT LOST", "#ff5d73", 18, true);
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
    fx.text(item.x, item.y-18, "PILOT RESCUED", "#ffd23f", 17, true);
    SF.comms.say("rescue");
  } else {
    const def = item.data;
    const now = performance.now();
    game.profile.powerupsCollected++;
    audio.play("pickup");
    fx.text(p.x, p.y-34, def.label + "!", def.color, 19, true);
    if(def.id === "rapid") p.tempRapidUntil = now + 9000;
    else if(def.id === "spread") p.tempSpreadUntil = now + 9000;
    else if(def.id === "shield") p.shield = Math.min(p.shield+1, Math.max(1, p.shieldMax)+1);
    else if(def.id === "score2x") p.tempScoreUntil = now + 9000;
    else if(def.id === "homing") p.tempHomingUntil = now + 9000;
    SF.comms.say(def.id === "shield" ? "pickupShield"
               : def.id === "score2x" ? "pickupScore" : "pickupGun");
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
  SF.render.drawEnemies(ctx, world, timeMs);
  SF.render.drawBoss(ctx, world.boss, timeMs);
  SF.render.drawBullets(ctx, world);
  SF.render.drawPlayer(ctx, world.player, timeMs);
  fx.drawParticles(ctx);
  SF.render.drawForeground(ctx);
  fx.drawTexts(ctx);
  if(game.run){ SF.render.drawHud(ctx, game); SF.render.drawComms(ctx); }
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
