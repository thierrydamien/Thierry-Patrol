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
const { DIFFICULTY_BY_ID, POWERUPS, SUPPLIES } = SF.config;
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
  onTestFlightEnd: null,  // set by the UI layer - the range exits to the Armory
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
  // Flight tuning: a whole-ship stat trade chosen in MY SHIP. `fire` scales
  // the fire interval (above 1 = slower guns), and dps is scaled to match so
  // boss HP sizing stays honest about what the ship actually puts out.
  const tune = SF.config.TUNE_BY_ID[profile.tune] || SF.config.TUNES[0];
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
    lives: 3 + lv("life") + difficulty.bonusLives + tune.lives,
    shieldMax: lv("shield"),
    invulnTime: (1.7 + lv("armor")*0.6) * (tune.invuln || 1),
    speedMult: (1 + lv("thrusters")*0.14) * tune.speed,
    fireInterval: 0.30 * SF.config.fireRateMult(lv("rapid")) * tune.fire,
    spreadLvl: lv("spread"),
    damage: 1 + lv("damage"),
    pierce: lv("pierce"),
    homingLvl: lv("homing"),
    magnetRange: (60 + lv("magnet")*68) * (tune.magnet || 1),
    moneyMult: (1 + lv("fortune")*0.15) * (tune.money || 1),
    drones: lv("wingman"),
    bombs: lv("bomb"),
    overdrives: lv("overdrive"),
    overdriveTime: 4 + lv("overdrive"),
    color: profile.shipColor,
    trail: profile.trail || null,     // Style Shop engine trail, burns in flight
    decal: profile.decal || null,     // Style Shop nose art, painted on the hull
    // The same levels object the hangar draws from, so the ship you fly is
    // the ship you built - every bought part visible in combat.
    levels: SF.shipart.levelsOf(profile),
    dps: singleTargetDps(lv) / tune.fire,
    tune: tune.id,
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
/*
 * The Armory's firing range: twenty seconds of targets that never shoot
 * back, flown with the player's real loadout. It exists so a freshly bought
 * cannon can be FELT ten seconds after the purchase, not next mission. No
 * records, no money, no death - it leaves the profile exactly as it found it.
 */
const TEST_DIFF = { id:"test", name:"TEST", color:"#3fc9ff",
  speed:0.9, density:1, hpMult:1, bossHp:1, pay:0,
  aimed:0, fireRate:99, smart:0, bonusLives:0 };
const TEST_SECONDS = 20;
function buildTestRange(){
  return {
    id:"test", testFlight:true,
    name:"Test Range", subtitle:"Free fire",
    brief:"Twenty seconds of target practice. See what your ship can do!",
    waves: [
      { t:0.5,  type:"grunt",  n:8,  form:"wall" },
      { t:3,    type:"weaver", n:7,  form:"arc" },
      { t:5.5,  type:"brute",  n:3,  form:"tripleColumns" },
      { t:8,    type:"grunt",  n:9,  form:"pincer" },
      { t:10.5, type:"boulder",n:2,  form:"twinColumns" },
      { t:12.5, type:"weaver", n:8,  form:"scatter" },
      { t:15,   type:"brute",  n:4,  form:"twinColumns" },
      { t:17,   type:"grunt",  n:10, form:"wall" },
    ],
    objectives: [],
  };
}

/*
 * Boss Rush: every boss the pilot has already beaten, back to back. The
 * campaign hands them out one per act-chapter; the rush is where you prove
 * you've actually learned them. Shields recharge between rounds - lives
 * don't. Fixed PILOT difficulty so the family record means one thing.
 */
const RUSH_ORDER = [
  { missionId: 4,  boss: "marauder"  },
  { missionId: 7,  boss: "jailer"    },
  { missionId: 10, boss: "sentinel"  },
  { missionId: 15, boss: "warden"    },
  { missionId: 17, boss: "phantom"   },
  { missionId: 20, boss: "leviathan" },
  { missionId: 23, boss: "devourer"  },
];
function rushBossList(profile){
  return RUSH_ORDER.filter(r => profile.missions && profile.missions[r.missionId] &&
                                profile.missions[r.missionId].cleared)
                   .map(r => r.boss);
}
function buildBossRush(){
  return {
    id:"rush", bossRush:true,
    name:"Boss Rush", subtitle:"All of them. Back to back.",
    brief:"Every boss you've beaten, one after another. Shields recharge between rounds - lives don't!",
    waves: [], objectives: [],
  };
}

function spawnRushBoss(){
  const run = game.run;
  const id = run.rushList[run.rushIndex++];
  const p = game.world.player;
  if(run.rushIndex > 1 && p && p.shieldMax > 0){
    p.shield = p.shieldMax;                    // the breather between rounds
    fx.text(p.x, p.y - 40, "SHIELDS RESTORED", "#7cc4ff", 16, true);
  }
  // Rush bosses arrive with the full cinematic too - seven names, seven
  // cards. The "BOSS n OF m" score line waits until the fight starts.
  run.phase = "bossIntro";
  run.bossActive = true;
  run.bossSpawned = true;
  game.world.boss = SF.bosses.create(id, run.difficulty, p ? p.dps : 60);
  game.world.enemyBullets.killAll();
  // The queue escalates: each stage is tougher and attacks faster than the
  // campaign version, so a deep rush is earned, not endured.
  const stage = run.rushIndex - 1;
  if(stage > 0){
    const b = game.world.boss;
    b.hp = b.maxHp = Math.round(b.maxHp * (1 + 0.15*stage));
    b.hurry = 1 + 0.10*stage;
  }
  SF.bossintro.begin();
  audio.setMusic(null);
}

/*
 * THE STAR VAULT - the game's one secret. Launched only by the hidden tap
 * ritual on the campaign map (see ui.js); it appears in no list, no menu and
 * no hint text, and once won it can never be flown again. A short golden
 * scramble: coins rain, thieves circle, boulders crack open - and the prize
 * is the SOLAR GOLD paint, which the Paint Shop refuses to sell.
 */
function buildStarVault(){
  /*
   * v2, after playtest: "just a normal level with enemies" missed the point
   * of a secret. Now it is pure delight - the sky RAINS golden stars and
   * almost nothing shoots back - and then the punchline arrives: KING PAPA,
   * a giant photograph of their actual dad on a tiny gold rocket, who pops
   * like a pinata into fireworks and even more stars. The level is a joke
   * the family is in on; nobody else will ever find the door.
   */
  return {
    id:"vault", vault:true,
    name:"The Star Vault", subtitle:"Nobody was supposed to find this",
    brief:"You found it. Catch every star you can!",
    goal:"Catch the STARS!",
    starRain:true,
    boss: "papa",
    waves: [
      { t:2,  type:"asteroid", n:4, form:"scatter" },
      { t:14, type:"asteroid", n:5, form:"scatter" },
      { t:26, type:"asteroid", n:4, form:"scatter" },
    ],
    objectives: [],
  };
}

function startMission(missionIndex, difficultyId){
  const profile = game.profile;
  // "daily" is the endless Daily Patrol - a generated mission, not a campaign
  // slot. Same day = same seed = same waves on every device. "test" is the
  // Armory's firing range, "rush" the boss gauntlet, "vault" the secret.
  const daily = missionIndex === "daily";
  const test = missionIndex === "test";
  const rush = missionIndex === "rush";
  const vault = missionIndex === "vault";
  // Replayable on request: the door never locks. Only the SOLAR GOLD paint
  // is one-time (see endMission) - `vaultDone` still gates that, it just no
  // longer gates the mission itself.
  const mission = daily ? SF.daily.build()
                : test  ? buildTestRange()
                : rush  ? buildBossRush()
                : vault ? buildStarVault()
                        : MISSIONS[clamp(missionIndex, 0, MISSIONS.length-1)];
  const difficulty = test ? TEST_DIFF
                          : DIFFICULTY_BY_ID[difficultyId] || DIFFICULTY_BY_ID.pilot;

  game.world.reset();
  fx.reset();
  SF.finale.reset();                      // no intro/fleet/death left running
  SF.bossintro.reset();
  game.world.silent = !!mission.noGuns;   // nobody shoots on a silent run
  SF.render.initBackground(daily ? SF.daily.skyIndex() : test ? 0 : rush ? 7
                          : vault ? 8 : missionIndex);   // the vault flies gold
  const loadout = buildLoadout(profile, difficulty);
  game.world.createPlayer(loadout);

  const director = new SF.systems.WaveDirector(mission, difficulty, game.world);
  const wavesEndT = mission.waves.reduce((t, wv) => Math.max(t, wv.t), 0) + 10;
  const stats = {
    spawned: 0, kills: 0, escaped: 0, killRatio: 0, coins: 0,
    rescues: 0, rescuesTotal: director.rescuesPlanned + (mission.podDrops || 0),
    damageTaken: 0, livesLost: 0, completed: false,
    convoyTotal: mission.convoy ? 1 : 0, convoyLost: 0,
    stars: 0,
  };

  // Free-drifting pilots (no carrier to open): their entry times are fixed up
  // front, spread across the early/middle of the timeline so the last one has
  // resolved - caught or lost - before the waves run out.
  const podTimes = [];
  for(let i = 0; i < (mission.podDrops || 0); i++)
    podTimes.push(wavesEndT * (0.12 + 0.66 * i / Math.max(1, mission.podDrops - 1)));

  // Supply drops: the rare tier. One, sometimes two, somewhere in the middle
  // stretch of a real mission - never on the test range (profile-neutral by
  // contract) and never scheduled in a rush (each boss kill drops one there).
  const supplyTimes = [];
  if(!mission.testFlight && !mission.bossRush){
    const n = 1 + (rand(0, 1) < 0.35 ? 1 : 0);
    for(let i = 0; i < n; i++)
      supplyTimes.push(wavesEndT * rand(0.25, 0.8));
    supplyTimes.sort((a, b) => a - b);
  }

  game.run = {
    mission, missionIndex, difficulty, director, stats, wavesEndT,
    halfwayShown: false, boulderShown: false, rivalShown: false,
    /*
     * Per-kill payout, damped by the tier's density. A hard tier now sends
     * three times as many enemies, so paying `pay` per head would have made
     * one NIGHTMARE run worth £30k against a £70k Armory - the tier would buy
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
    /*
     * The opening card is for a seven-year-old, so it says ONE thing and it
     * stays put. It used to print the full `brief` - two clauses of adult
     * prose - for 2.6 seconds, which is neither readable nor read. Now it
     * shows the mission's `goal`: a handful of plain words, held for six
     * seconds, which comfortably outlasts the launch and the first wave. The
     * brief still exists in full on the briefing screen, where there is time.
     */
    bannerText: mission.name.toUpperCase(), bannerSub: mission.goal || mission.brief,
    bannerColor: "#ffd23f", bannerUntil: performance.now() + 6000,
    objectiveDefs: mission.objectives.map(id => OBJECTIVES[id]),
    objectiveIds: mission.objectives.slice(),
    // The ship LAUNCHES - rockets up from below the screen for the first
    // second, engines wide open, before control is handed over.
    introFly: 1.1,
    coinTimer: 2.0,
    podTimes,
    supplyTimes,
    // The Storm: gusts cycle calm -> warn (streaks, no push) -> blow.
    storm: mission.storm ? { mode:"calm", timer: 5, dir: 1, str: 0 } : null,
    // The Convoy: ONE hauler, escorted the whole way.
    convoy: mission.convoy ? { launched: false, released: false } : null,
    rushList: rush ? rushBossList(profile) : [],
    rushIndex: 0,
    ended: false,
  };

  /*
   * First flight of the day pays double. It is the "come back tomorrow" hook:
   * one banner, one doubled payScale, and a date on the profile. Deliberately
   * per-pilot, so each brother gets his own morning bonus.
   */
  // The range must not burn the real first-flight-of-the-day bonus.
  const today = new Date().toDateString();
  if(!mission.testFlight && profile.lastFlightDay !== today){
    profile.lastFlightDay = today;
    P.save(profile);
    game.run.payScale *= 2;
    game.run.dailyDouble = true;
    // A money note must never take the instruction's place: the goal line is
    // the only thing telling a child what to DO, and the first flight of the
    // day - which is every day, for these two - is exactly when they need it.
    // The bonus gets its own popup underneath instead.
    fx.text(VW/2, VH*0.52, "FIRST FLIGHT TODAY — DOUBLE PAY!", "#ffd23f", 20, true);
  }
  // The guns-cold run keeps its blue card; its goal already says "just DODGE".
  if(mission.noGuns) game.run.bannerColor = "#3fc9ff";

  const p0 = game.world.player;
  p0.y = SF.entityConst.PLAY_BOTTOM + 150;   // start off-screen for the launch
  game.state = "playing";
  audio.setMusic("combat");
  SF.comms.begin(profile, loadout.crew);
  SF.comms.say(mission.noGuns ? "silentStart"
             : mission.rival ? "rivalStart"
             : mission.storm ? "stormStart"
             : mission.convoy ? "convoyStart"
             : mission.trench ? "trenchStart"
             : mission.blackout ? "blackoutStart"
             : "missionStart");
  SF.input.clearMovement();
  audio.init();
  resize();
}

/*
 * A won mission doesn't cut to a menu - the fight ends, you get a few seconds
 * of open sky (and the last coins), then the ship opens the throttle and
 * leaves the screen on its own. Only once it's gone do the results appear.
 */
function beginVictoryLap(){
  const run = game.run;
  if(!run || run.ended || run.lapStarted) return;
  run.lapStarted = true;
  run.phase = "lap";
  run.phaseTimer = 5.0;   // a real stretch of open sky, not a blink
  const p = game.world.player;
  if(p) p.invuln = Math.max(p.invuln, 30);   // no stray bullet ruins the ending
  run.bannerText = "AREA CLEAR!";
  run.bannerSub = "grab the last coins — then head home";
  run.bannerColor = "#4ade80";
  run.bannerUntil = performance.now() + 2200;
  audio.play("victory");
  audio.setMusic("menu");                  // the fight is over - let it breathe
  SF.comms.say("headHome");
}

function endMission(completed){
  const run = game.run;
  if(!run || run.ended) return;
  document.body.classList.remove("cinema");
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

  // The Star Vault pays once, then seals forever: the flag is what stops a
  // second visit, and the paint is the part they'll actually remember.
  if(run.mission.vault && completed && !profile.vaultDone){
    profile.vaultDone = true;
    if(!profile.cosmetics.paints.includes("solar")) profile.cosmetics.paints.push("solar");
    profile.shipColor = SF.config.PAINT_BY_ID.solar.hex;   // applied on the spot
    run.vaultWon = true;
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
  // The Daily Patrol keeps its own book: one all-time best score and one
  // longest run, no campaign record, no lastMission (the campaign hint must
  // keep pointing at a real map stop).
  let prevFamilyBest = null, prevSelfBest = 0;
  let endlessNewBest = false, prevEndlessBest = 0, firstClear = false;
  // A rush books how deep the queue got - a boss mid-fight doesn't count.
  const rushBeaten = run.mission.bossRush
    ? run.rushIndex - (game.world.boss ? 1 : 0) : 0;
  if(run.mission.bossRush){
    if(rushBeaten > (profile.bossRushBest || 0)) profile.bossRushBest = rushBeaten;
    P.save(profile);
  } else if(run.mission.endless){
    prevEndlessBest = profile.endlessBest || 0;
    endlessNewBest = run.score > prevEndlessBest;
    if(endlessNewBest) profile.endlessBest = run.score;
    const sec = Math.round(run.time);
    if(sec > (profile.endlessLongest || 0)) profile.endlessLongest = sec;
    P.save(profile);
  } else {
    profile.lastMission = run.mission.id;
    profile.lastDifficulty = run.difficulty.id;
    // Captured BEFORE the save: once recordMission runs, this run's score IS
    // the record and "did I beat anything?" can no longer be answered.
    prevFamilyBest = P.familyBest(run.mission.id);
    const prevRec = profile.missions[run.mission.id];
    firstClear = completed && !(prevRec && prevRec.cleared);
    prevSelfBest = prevRec && prevRec.best
      ? Math.max.apply(null, [0].concat(Object.values(prevRec.best).map(Number))) : 0;
    P.recordMission(profile, run.mission.id, run.difficulty.id, completed ? stars : 0, run.score, completed);
  }
  const unlocked = P.checkAchievements(profile);

  // A Daily Patrol never "fails" - the run simply ends, so its sound is a
  // fanfare on a new best and a neutral chime otherwise.
  audio.play(run.mission.endless ? (endlessNewBest ? "missionWin" : "waveClear")
                                 : (completed ? "missionWin" : "missionFail"));
  if(game.onMissionEnd){
    game.onMissionEnd({
      completed, stars, run, unlocked,
      endless: !!run.mission.endless, endlessNewBest, prevEndlessBest,
      rush: !!run.mission.bossRush, rushBeaten, rushTotal: run.rushList.length,
      firstClear,
      vaultWon: !!run.vaultWon,
      durationSec: Math.round(run.time),
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

    // Beating the rival is the level, so it gets a boss-sized send-off - it
    // just isn't a boss, and never blocks the mission the way one would.
    if(e.type.named){
      fx.explosion(e.x, e.y, 130, "#ff4fd8", true);
      for(let i = 0; i < 4; i++)
        fx.ring(e.x, e.y, 70 + i*55, i%2 ? "#ffd23f" : "#ff9de0", 5 - i, 0.5 + i*0.2);
      fx.debris(e.x, e.y, 22, "#ff4fd8");
      fx.shake(22); fx.hitStop(120);
      fx.text(VW/2, VH*0.4, e.type.named + " IS DOWN!", "#ff9de0", 26, true);
      audio.play("bossExplode");
      run.bannerText = e.type.named + " DOWN";
      run.bannerSub = "you out-flew her, " + pilotName();
      run.bannerColor = "#ff4fd8";
      run.bannerUntil = performance.now() + 3200;
      SF.comms.say("rivalDown");
    }

    // A thief drops everything it lifted. Killing one mid-run is a real save,
    // so it pays back visibly rather than silently.
    if(e.loot > 0){
      game.world.dropCoins(e.x, e.y, e.loot);
      fx.text(e.x, e.y - 26, "+£" + e.loot + " BACK!", "#ffd23f", 18, true);
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
      fx.text(VW/2, VH*0.42, "THIEF GOT AWAY WITH £" + e.loot, "#ff5d73", 19, true);
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
      // The Jailer's cells hold OUR pilots: blowing one open frees them,
      // mid-fight - the boss is the rescue mission.
      if(boss.def.rescuePods){
        game.world.spawnPickup("rescue",
          boss.x + res.weakPointDestroyed.ox, boss.y + res.weakPointDestroyed.oy + 26);
        fx.text(boss.x + res.weakPointDestroyed.ox, boss.y + res.weakPointDestroyed.oy + 40,
                "CELL OPEN!", "#4ade80", 17, true);
      }
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

/*
 * The rare tier above powerups: a glowing crate carrying an ability charge,
 * a full shield recharge, or - rarest - an extra life. On a silent (no-gun)
 * run only the `calm` entries drop; a bomb you can't fire is no prize.
 */
function pickSupply(){
  const run = game.run;
  const pool = SUPPLIES.filter(s => !(run && run.mission.noGuns) || s.calm);
  let roll = rand(0, pool.reduce((n, s) => n + s.weight, 0));
  for(let i = 0; i < pool.length; i++){
    roll -= pool[i].weight;
    if(roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function spawnSupply(x, y){
  const def = pickSupply();
  const s = game.world.spawnPickup("supply", x, y === undefined ? -26 : y, { supply: def });
  s.vx = 0;
  fx.text(VW/2, VH*0.22, "SUPPLY DROP!", def.color, 18, true);
  audio.play("supplyDrop");
  return s;
}

function spawnPowerup(x, y){
  const def = pick(POWERUPS);
  game.world.spawnPickup("power", x, y, def);
}

/*
 * Killing a boss is the game's biggest moment, so it gets a two-act death:
 * killBoss() only STARTS it - the hulk goes dark and a drumroll of chain
 * detonations runs across it (see bosses.update) - and finalBossBlast()
 * ends it with the screen-clearing explosion the fight earned.
 */
function killBoss(boss){
  const run = game.run;
  if(boss.dying) return;
  boss.dying = true;
  boss.deathT = 0;
  boss.deathDur = 2.3;
  boss.deathFx = 0;
  boss.hp = 0;
  // KING PAPA doesn't die, he does a BIT: twelve seconds, five acts, two
  // fake-outs (see papadeath.js). The loot lands in the middle of it.
  if(boss.def.photo){
    boss.papaDeath = true;
    SF.papadeath.begin(boss);
    run.score += Math.round(2500 * run.difficulty.pay);
    game.profile.bossesDefeated++;
    fx.hitStop(180);
    fx.shake(20);
    return;
  }
  // The Devourer dies for eight seconds, in five stages, on its own clock.
  if(boss.def.finale){
    boss.finaleDeath = true;
    SF.finale.beginDeath(boss);
    audio.setMusic(null);
    run.score += Math.round(4000 * run.difficulty.pay);
    game.profile.bossesDefeated++;
    fx.hitStop(200);
    fx.shake(30);
    return;
  }
  run.score += Math.round(1200 * run.difficulty.pay);
  game.profile.bossesDefeated++;
  audio.play("bossExplode");
  fx.shake(18);
  fx.flash(0.5, "255,200,120");
  fx.hitStop(110);
}

/*
 * A boss escalating a phase sheds a supply crate on the finale only. Measured:
 * a careful pilot was reaching 4% health on the Devourer and STILL running out
 * of lives, which is the "so close, then dead, again" loop the fight must not
 * have. The crates land exactly at the moments the pressure steps up.
 */
function onBossPhase(boss){
  if(!boss.def.finale) return;
  spawnSupply(clamp(boss.x + rand(-90, 90), 60, VW - 60), boss.y + 60);
}

function finalBossBlast(boss){
  const run = game.run;
  const bx = boss.x, by = boss.y;
  // The finale already spent eight seconds blowing itself apart; all that is
  // left here is the payout and the ride home.
  if(boss.finaleDeath){
    game.world.dropCoins(bx, Math.min(by, VH*0.4),
      Math.round(900 * run.difficulty.pay * game.world.player.moneyMult));
    fx.text(VW/2, VH*0.34, "THE SKY IS OURS", "#ffd23f", 34, true);
    game.world.boss = null;
    run.bossActive = false;
    run.finishTimer = 1.4;
    return;
  }
  /*
   * KING PAPA pops like a pinata: fireworks in every colour, a storm of
   * collectable stars flung in a ring, and the silliest text in the game.
   * Over-the-top is the specification - this one exists to make two kids
   * laugh, and then hand them the loot.
   */
  /*
   * KING PAPA has already spent twelve seconds exploding in five different
   * ways (papadeath.js). All that is left is the long, calm finish so the
   * kids can hoover up the stars and the tiny papa heads.
   */
  if(boss.def && boss.def.photo){
    fx.text(VW/2, VH*0.46, "ramasse tout !", "#ffd23f", 24, true);
    game.world.enemyBullets.killAll();
    game.world.boss = null;
    run.bossActive = false;
    // Long on purpose: after twelve seconds of routine there is still a
    // skyful of stars and souvenirs to hoover up, and the victory lap comes
    // after THIS. Rushing the payoff would waste the joke.
    run.finishTimer = 7.0;
    return;
  }
  // The blast itself: white-out, a triple shockwave, a debris storm, and a
  // long hit-stop so the frame it happens on physically lands.
  fx.flash(1, "255,230,160");
  fx.hitStop(200);
  fx.shake(36);
  fx.explosion(bx, by, boss.size*1.5, "#ffd23f", true);
  fx.explosion(bx - boss.size*0.4, by + 14, 48, "#ffffff", true);
  fx.explosion(bx + boss.size*0.4, by - 10, 48, "#ff8a3d", true);
  fx.ring(bx, by, boss.size*2.6, "#ffffff", 5, 0.55);
  fx.ring(bx, by, boss.size*3.6, "#ffd23f", 3, 0.8);
  fx.ring(bx, by, boss.size*4.6, "#ff8a3d", 2, 1.05);
  fx.debris(bx, by, 30, "#ff8a3d");
  fx.embers(bx, by, 26);
  fx.smoke(bx, by, 14);
  audio.play("megaBoom");

  // The shockwave clears the sky: every minion and every bullet still flying
  // goes with the ship that brought them. Causal, and deeply satisfying.
  const items = game.world.enemies.items;
  for(let i=0;i<items.length;i++){
    const e = items[i];
    if(!e.alive) continue;
    e.alive = false;
    fx.explosion(e.x, e.y, e.size || 22, "#ffb03d", false);
  }
  game.world.enemyBullets.killAll();

  game.world.dropCoins(bx, by, Math.round(220 * run.difficulty.pay * game.world.player.moneyMult));
  // In a rush with more bosses queued, the wreck yields a supply crate - the
  // mercy that makes a deep run survivable.
  if(run.mission.bossRush && run.rushIndex < run.rushList.length) spawnSupply(bx, by);
  fx.text(bx, by, "BOSS DOWN!", "#ffd23f", 34, true);
  game.world.boss = null;
  run.bossActive = false;
  // Hold the results back for a beat so the blast lands. This is a
  // simulation timer, not a wall-clock setTimeout: a real-time timer would
  // fire behind the pause overlay, and if it were ever dropped the mission
  // could never finish at all.
  run.finishTimer = 1.2;
}

function pilotName(){
  const p = game.profile;
  return ((p && (p.callsign || p.name)) || "PILOT").toUpperCase();
}

/* ---------------------------------------------------------
   ABILITIES
   --------------------------------------------------------- */
function useBomb(){
  if(game.run && game.run.mission.noGuns) return false;
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
  if(game.run && game.run.mission.noGuns) return false;
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
  escort: null,           // the Convoy's hauler, when there is one to hunt
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
  behaviourCtx.escort = game.world.escortTarget();   // what the hunters aim at
  behaviourCtx.difficulty = run.difficulty;
  behaviourCtx.smart = run.difficulty.smart;
  behaviourCtx.onEscape = callbacks.onEnemyEscaped;
  behaviourCtx.onEnemyKilled = callbacks.onEnemyKilled;
  behaviourCtx.onBossHit = callbacks.onBossHit;
  behaviourCtx.onBossDead = finalBossBlast;
  behaviourCtx.onBossPhase = onBossPhase;
  behaviourCtx.onPlayerHit = callbacks.onPlayerHit;
  behaviourCtx.godMode = game.godMode;

  // The test range: immune, timed, and it exits to the Armory - never to the
  // results screen. Nothing here may touch records, money or medals.
  if(run.mission.testFlight){
    const pl = game.world.player;
    if(pl) pl.invuln = Math.max(pl.invuln, 5);
    const targetsGone = run.phase === "waves" &&
      run.director.finishedSpawning && game.world.countEnemies() === 0;
    if(run.time >= TEST_SECONDS + 2.5 || targetsGone){
      game.state = "idle";
      if(game.onTestFlightEnd) game.onTestFlightEnd({ kills: run.stats.kills });
      return;
    }
  }

  // Mission phases
  if(run.phase === "intro"){
    run.phaseTimer -= dt;
    if(run.phaseTimer <= 0) run.phase = "waves";
  } else if(run.phase === "waves"){
    if(run.mission.bossRush){
      spawnRushBoss();                      // no waves here - straight to work
      return;
    }
    run.director.update(dt);
    run.stats.spawned = run.director.spawnedCount;
    if(run.director.finishedSpawning && game.world.countEnemies() === 0){
      if(run.mission.boss){
        run.bossActive = true;
        run.bossSpawned = true;
        game.world.boss = SF.bosses.create(run.mission.boss, run.difficulty, game.world.player.dps);
        if(BOSSES[run.mission.boss].finale){
          // The Devourer gets an arrival instead of a banner: the sky goes
          // out, it comes down, it is named. finale.js owns the timeline.
          run.phase = "finaleIntro";
          game.world.enemyBullets.killAll();
          SF.finale.beginIntro();
          audio.setMusic(null);          // silence is the loudest cue there is
        } else {
          // Every other boss arrives the same way, scaled down: the sky
          // dims, it descends, it is named. bossintro.js owns the timeline.
          run.phase = "bossIntro";
          game.world.enemyBullets.killAll();
          SF.bossintro.begin();
          audio.setMusic(null);
        }
      } else {
        run.phase = "clearing";
        run.phaseTimer = 1.2;
      }
    }
  } else if(run.phase === "bossIntro"){
    // Theatre, the everyday size: guns cold, HUD away, the boss flies its
    // entrance - then the alarm and the fight.
    document.body.classList.add("cinema");
    if(SF.bossintro.update(dt, game.world.boss)){
      document.body.classList.remove("cinema");
      run.phase = "boss";
      audio.play("bossAlarm");
      audio.setMusic("boss");
      SF.comms.say("bossIncoming");    // after the cutscene - comms are hidden during it
      if(run.mission.bossRush){
        run.bannerText = "⚠ BOSS " + run.rushIndex + " OF " + run.rushList.length + " ⚠";
        run.bannerSub = game.world.boss ? game.world.boss.name : "";
        run.bannerColor = "#ff5d73";
        run.bannerUntil = performance.now() + 2000;
      }
    }
  } else if(run.phase === "finaleIntro"){
    // Theatre. Nothing spawns, nothing shoots, the boss flies its entrance -
    // and then the fight starts for real.
    document.body.classList.add("cinema");
    if(SF.finale.updateIntro(dt, game.world.boss)){
      document.body.classList.remove("cinema");
      run.phase = "boss";
      audio.play("bossAlarm");
      audio.setMusic("boss");
      run.bannerText = "ALL WINGS — ENGAGE";
      run.bannerSub = "everything you have, " + pilotName();
      run.bannerColor = "#ff5d73";
      run.bannerUntil = performance.now() + 2200;
      SF.comms.say("devourerStart");
    }
  } else if(run.phase === "clearing"){
    run.phaseTimer -= dt;
    if(run.phaseTimer <= 0 && !run.ended) beginVictoryLap();
  } else if(run.phase === "lap"){
    // The victory lap: the sky is yours for a few seconds. Free flight, the
    // last coins still falling, nothing that can hurt you - and fireworks,
    // because a cleared sky deserves applause.
    run.phaseTimer -= dt;
    run.fwTimer = (run.fwTimer || 0.001) - dt;
    if(run.fwTimer <= 0){
      const FW = (SF.config.FIREWORK_BY_ID[game.profile.fireworks] ||
                  SF.config.FIREWORKS[0]).colors;   // their bought show, or classic
      fx.firework(rand(70, VW-70), rand(VH*0.12, VH*0.45),
                  FW[Math.floor(rand(0, FW.length))]);
      audio.play("firework");
      run.fwTimer = rand(0.35, 0.7);
    }
    if(run.phaseTimer <= 0){
      run.phase = "outro";
      run.outroFly = 1.6;          // safety net - the fly-off ends it sooner
      audio.play("flyoff");
      fx.shake(5);
      SF.finale.beginFlyoff();     // the family leaves the sky with you
    }
  } else if(run.phase === "outro"){
    // Autopilot has the ship now (see updatePlayer): throttle pinned, climbing
    // hard. Once it has actually left the sky, hold on the empty screen.
    run.outroFly -= dt;
    const pl = game.world.player;
    if((pl && pl.y < -70) || run.outroFly <= 0){
      run.phase = "gone";
      run.phaseTimer = 1.2;
    }
  } else if(run.phase === "gone"){
    // The beat after the exit: stars drifting, the last fireworks still
    // popping over an empty sky, ship long gone - THEN the results.
    run.phaseTimer -= dt;
    run.fwTimer = (run.fwTimer || 0.001) - dt;
    if(run.fwTimer <= 0){
      const FW = (SF.config.FIREWORK_BY_ID[game.profile.fireworks] ||
                  SF.config.FIREWORKS[0]).colors;   // their bought show, or classic
      fx.firework(rand(70, VW-70), rand(VH*0.15, VH*0.5),
                  FW[Math.floor(rand(0, FW.length))]);
      audio.play("firework");
      run.fwTimer = rand(0.5, 0.9);
    }
    if(run.phaseTimer <= 0 && !run.ended) endMission(true);
  }

  // Boss defeated: run out the celebration - then the next boss if this is a
  // rush with more in the queue, else the same lap home.
  if(run.finishTimer > 0){
    run.finishTimer -= dt;
    if(run.finishTimer <= 0 && !run.ended){
      if(run.mission.bossRush && run.rushIndex < run.rushList.length) spawnRushBoss();
      else beginVictoryLap();
    }
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
    run.bannerSub = "+£" + bonus + " · keep going, " + pilotName() + "!";
    run.bannerColor = "#4ade80";
    run.bannerUntil = timeMs + 2000;
    audio.play("waveClear");
    SF.comms.say("halfway");
  }

  game.world.updatePlayer(dt, timeMs);
  /*
   * Paint Shop engine trails. The whole point of a trail is that everyone in
   * the room can see it, so it burns every frame the ship is alive - two
   * motes a frame, short-lived, from just behind the engines. Rainbow cycles
   * hue on the clock; stardust twinkles white with an occasional gold fleck.
   */
  {
    const pl = game.world.player;
    if(pl && pl.alive && pl.trailFx){
      const def = SF.config.TRAIL_BY_ID[pl.trailFx];
      if(def){
        for(let k = 0; k < 3; k++){
          const col = pl.trailFx === "rainbow"
            ? "hsl(" + Math.floor((timeMs/6 + k*40) % 360) + ",95%,62%)"
            : pl.trailFx === "stardust" && chance(0.2) ? "#ffd23f" : def.color;
          // Sized to be seen from a sofa: this is the thing they paid for.
          fx.spark(pl.x + rand(-8, 8), pl.y + 20,
                   rand(-16, 16), rand(50, 110), col,
                   rand(0.4, 0.6), pl.trailFx === "stardust" ? rand(1.6, 2.8) : rand(2.6, 4.2));
        }
      }
    }
  }
  game.world.updateBullets(dt);
  game.world.updateEnemies(dt, behaviourCtx);
  // The Devourer's arrival and its death are choreographed by finale.js; the
  // fight engine only drives it in between.
  const bossNow = game.world.boss;
  if(bossNow && run.phase !== "finaleIntro" && run.phase !== "bossIntro" &&
     !bossNow.finaleDeath && !bossNow.papaDeath)
    SF.bosses.update(bossNow, dt, game.world, behaviourCtx, timeMs);
  if(bossNow && bossNow.finaleDeath && SF.finale.updateDeath(dt, bossNow, game.world))
    finalBossBlast(bossNow);
  if(bossNow && bossNow.papaDeath && SF.papadeath.update(dt, bossNow, game.world))
    finalBossBlast(bossNow);
  // Phase five: the rest of the family arrives, and they fight with you.
  // No fanfare on a device with a single pilot - nobody invented shows up.
  if(bossNow && bossNow.phase && bossNow.phase.lastLight && !SF.finale.fleetSize()){
    if(SF.finale.summonFleet(game.world, game.profile).length){
      run.bannerText = "THE SQUADRON IS WITH YOU";
      run.bannerSub = "the whole family came";
      run.bannerColor = "#7cc4ff";
      run.bannerUntil = timeMs + 3000;
      SF.comms.say("fleetArrives");
    }
  }
  SF.finale.updateFleet(dt, game.world, timeMs);

  game.world.updatePickups(dt, onPickupCollected);

  // Occasional free power-up so a mission always has something to chase.
  if(run.phase === "waves"){
    run.powerupTimer -= dt;
    if(run.powerupTimer <= 0){
      spawnPowerup(rand(40, VW-40), -20);
      run.powerupTimer = rand(16, 26);
    }
  }

  // Supply drops enter at their scheduled times, announced - rare enough
  // that the callout means something.
  if(run.supplyTimes.length && run.phase !== "intro" && run.time >= run.supplyTimes[0]){
    run.supplyTimes.shift();
    spawnSupply(rand(60, VW - 60));
  }

  // Free-drifting pilots: they enter at their scripted times and sink slowly
  // through whatever the mission is throwing at you. Catching one is flying,
  // not shooting, which is what lets the no-guns mission keep rescues.
  if(run.podTimes.length && run.phase === "waves" && run.director.time >= run.podTimes[0]){
    run.podTimes.shift();
    game.world.spawnPickup("rescue", rand(60, VW - 60), -24);
    fx.text(VW/2, VH*0.2, "PILOT ADRIFT — CATCH THEM!", "#ffd23f", 17, true);
  }

  /*
   * THE STORM. Gusts cycle calm -> warn -> blow. The warn beat is the game
   * design: 0.9s of wind streaks with NO push, so the player reads the
   * direction and leans before the shove arrives. The blow moves the SHIP,
   * not the target - under a finger the ship visibly drags off your line,
   * which is what wind should feel like. Enemies drift at half strength so
   * the whole sky agrees about the weather.
   */
  if(run.storm && !run.ended && run.phase !== "intro"){
    const st = run.storm;
    st.timer -= dt;
    if(st.mode === "calm"){
      if(st.timer <= 0){
        st.mode = "warn"; st.timer = 0.9;
        st.dir = chance(0.5) ? -1 : 1;
        st.str = rand(200, 300);
        audio.play("telegraph");
      }
    } else if(st.mode === "warn"){
      if(chance(0.55))
        fx.spark(st.dir < 0 ? VW + 10 : -10, rand(50, VH - 80),
                 st.dir*rand(600, 850), rand(-25, 25), "#9fd8ff", 0.32, 1.6);
      if(st.timer <= 0){ st.mode = "blow"; st.timer = rand(1.4, 2.2); audio.play("gust"); }
    } else if(st.mode === "blow"){
      const pl = game.world.player;
      if(pl && pl.alive) pl.x = clamp(pl.x + st.dir*st.str*dt, 24, VW - 24);
      const es = game.world.enemies.items;
      for(let i = 0; i < es.length; i++)
        if(es[i].alive) es[i].x = clamp(es[i].x + st.dir*st.str*0.5*dt, -60, VW + 60);
      // Loose pickups ride the wind hardest of all - coins scatter and the
      // Treasury remix becomes "chase the money through the gale".
      const pk = game.world.pickups.items;
      for(let i = 0; i < pk.length; i++)
        if(pk[i].alive) pk[i].x = clamp(pk[i].x + st.dir*st.str*0.85*dt, 12, VW - 12);
      if(chance(0.9))
        fx.spark(st.dir < 0 ? VW + 10 : -10, rand(50, VH - 80),
                 st.dir*rand(500, 800), rand(-30, 30), "#bfe3ff", 0.3, 2.1);
      if(st.timer <= 0){ st.mode = "calm"; st.timer = rand(3.5, 6.5); }
    }
  }

  /*
   * THE CONVOY. Three haulers cross bottom-to-top over ~34s each, staggered
   * so there is nearly always someone to protect. They can't dodge and they
   * can't shoot - the mission is what the player does about that.
   */
  if(run.convoy && !run.convoy.launched && run.phase === "waves"){
    run.convoy.launched = true;
    // Sized so it can absorb a real beating: this ship is on screen for the
    // whole mission, so its health bar is the level's tension - it must drain
    // visibly under pressure without ever dying to one bad moment.
    game.world.spawnHauler(VW*0.5, Math.round(260 * run.difficulty.hpMult));
    fx.text(VW/2, VH*0.46, "GUARD THE HAULER!", "#7cc4ff", 22, true);
    audio.play("supplyDrop");
  }
  // The sky is clear: it runs for home, and arriving is the win.
  if(run.convoy && !run.convoy.released && run.phase !== "intro" &&
     run.director.finishedSpawning && game.world.countEnemies() === 0){
    run.convoy.released = true;
    game.world.releaseHaulers();
    audio.play("flyoff");
  }
  game.world.updateHaulers(dt, {
    onHaulerDown: (h) => {
      run.stats.convoyLost++;
      fx.explosion(h.x, h.y, 120, "#ff8a3d", true);
      fx.shake(24);
      fx.text(VW/2, VH*0.42, "HAULER LOST", "#ff5d73", 24, true);
      audio.play("enemyExplode", true);
      SF.comms.say("haulerDown");
    },
    onHaulerHurt: () => {
      fx.text(VW/2, VH*0.42, "THE HAULER IS BREAKING UP!", "#ffd23f", 20, true);
      audio.play("alarm");
      SF.comms.say("haulerHurt");
    },
    onHaulerSafe: (h) => {
      run.score += 1500;
      fx.text(VW/2, VH*0.4, "HAULER HOME SAFE!", "#4ade80", 24, true);
      audio.play("rescue");
      SF.comms.say("haulerSafe");
    },
  });

  // The Star Vault: the sky rains golden stars, thick during the free-fly
  // and still falling (thinner) through the KING PAPA fight, so the whole
  // level glitters end to end.
  if(run.mission.starRain && run.phase !== "intro" && !run.ended){
    run.starTimer = (run.starTimer == null ? 0.5 : run.starTimer) - dt;
    if(run.starTimer <= 0){
      run.starTimer = run.bossActive ? rand(0.8, 1.3) : rand(0.28, 0.5);
      const n = run.bossActive ? 1 : randInt(2, 3);
      for(let i = 0; i < n; i++)
        game.world.spawnPickup("star", rand(30, VW - 30), rand(-40, -12));
    }
  }

  // Silent running: coins rain down a random lane every few seconds. With the
  // guns cold this IS the game - greed pulls you into traffic, and the coin
  // objective is scored on how much of the temptation you survive taking.
  if(run.mission.coinRain && run.phase !== "intro"){
    run.coinTimer -= dt;
    if(run.coinTimer <= 0){
      const laneX = rand(50, VW - 50);
      const drift = rand(-40, 40);
      for(let i = 0; i < 6; i++){
        const c = game.world.spawnPickup("coin",
          clamp(laneX + drift*i/5 + rand(-8, 8), 30, VW - 30),
          -24 - i*46, { value: Math.max(2, Math.round(4 * run.difficulty.pay)) });
        c.vx = 0; c.vy = 128;
      }
      run.coinTimer = rand(2.2, 3.4);
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
    /*
     * The rival announces herself. Not the full boss cutscene - she is an
     * equal, not a fortress, and stopping the game dead would make her a
     * boss in everything but name. A card, a colour and a taunt is the right
     * weight for a duel that starts mid-flight.
     */
    if(e.type.named && !run.rivalShown){
      run.rivalShown = true;
      run.bannerText = e.elite ? e.type.named + " RETURNS" : e.type.named;
      run.bannerSub = e.elite ? "she remembers you — sharper this time"
                              : "she copies you — make her commit";
      run.bannerColor = "#ff4fd8";
      run.bannerUntil = performance.now() + 4200;
      fx.flash(0.3, "255,79,216");
      fx.shake(10);
      audio.play("bossAlarm");
      SF.comms.say(e.elite ? "rivalReturns" : "rivalArrives");
    }
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
    run.stats.coins++;
    audio.play("coin");
    fx.sparks(item.x, item.y, 3, "#ffd23f", 90);
  } else if(item.kind === "supply"){
    const def = item.data.supply;
    if(def.id === "bomb"){
      p.bombsMax = Math.max(p.bombsMax, 1);      // the button must exist to shine
      p.bombs = Math.min(p.bombs + 1, 9);
    } else if(def.id === "overdrive"){
      p.overdrivesMax = Math.max(p.overdrivesMax, 1);
      p.overdrives = Math.min(p.overdrives + 1, 9);
    } else if(def.id === "life"){
      p.lives = Math.min(p.lives + 1, 8);
    } else if(def.id === "shieldFull"){
      p.shield = Math.max(p.shield, Math.max(1, p.shieldMax));
    }
    if(SF.ui && SF.ui.syncAbilityButtons) SF.ui.syncAbilityButtons(true);
    audio.play("supplyGet");
    fx.ring(item.x, item.y, 70, def.color, 4, 0.5);
    fx.sparks(item.x, item.y, 20, def.color, 240);
    fx.text(p.x, p.y - 40, def.label + "!", def.color, 21, true);
    fx.flash(0.35, "255,255,255");
  } else if(item.kind === "papahead"){
    // Souvenirs from the Star Vault. Worth real money, and worth a giggle.
    run.stats.papaHeads = (run.stats.papaHeads || 0) + 1;
    run.score += 400;
    run.money += Math.round(60 * p.moneyMult);
    audio.play("papaBoing");
    fx.sparks(item.x, item.y, 12, "#ffd23f", 200);
    // Same voice as the send-off: Papa talks to his kids in French.
    fx.text(item.x, item.y - 16,
            ["Bien joué !","Amuse-toi bien !","Je t'aime !","Bravo !"][run.stats.papaHeads % 4],
            "#ffd23f", 17, true);
  } else if(item.kind === "star"){
    run.stats.stars = (run.stats.stars || 0) + 1;
    run.score += 150;
    run.money += Math.round(25 * p.moneyMult);
    audio.play("star", run.stats.stars % 5);
    fx.sparks(item.x, item.y, 10, "#ffd23f", 190);
    fx.text(item.x, item.y - 14, "★", "#ffd23f", 20, true);
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
  SF.render.drawHaulers(ctx, world, timeMs);         // under the traffic they're crossing
  SF.render.drawPickups(ctx, world, timeMs);
  SF.render.drawEnemies(ctx, world, timeMs);
  SF.render.drawBoss(ctx, world.boss, timeMs);
  SF.render.drawArena(ctx, world.boss, timeMs);      // the Devourer's screen-wide attacks
  SF.render.drawFleet(ctx, timeMs);                  // the rescued pilots, phase five
  SF.render.drawBullets(ctx, world);
  SF.render.drawPlayer(ctx, world.player, timeMs);
  fx.drawParticles(ctx);
  SF.render.drawForeground(ctx);
  // The Searchlight: the world above is finished, now the dark eats all of it
  // except what glows. HUD and texts draw after - instruments still work.
  if(game.run && game.run.mission.blackout && !game.run.ended)
    SF.render.drawBlackout(ctx, world, timeMs, game.run.mission.blackout === "soft");
  fx.drawTexts(ctx);
  // The arrival is a cutscene: no HUD, no radio, no buttons over it.
  const cinema = game.run &&
    (game.run.phase === "finaleIntro" || game.run.phase === "bossIntro");
  if(game.run && !cinema){ SF.render.drawHud(ctx, game); SF.render.drawComms(ctx); }
  SF.render.drawFinaleIntro(ctx, timeMs);            // letterbox + name card, over everything
  SF.render.drawBossIntro(ctx, timeMs);              // same grammar, everyday size
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
