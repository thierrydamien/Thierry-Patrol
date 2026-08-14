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
let { VW, VH } = SF.entityConst;
/*
 * The field is measured once at load and can be wrong then - an iOS
 * home-screen app runs its scripts before it knows its own safe-area insets.
 * When it is re-measured (only ever at the start of a mission, see
 * startMission), the touch mapping and the canvas both have to follow it.
 */
SF.field.onChange(w => {
  VW = w;
  SF.input.setField(VW, VH);
  resize();
});
const { MISSIONS, BOSSES, OBJECTIVES } = SF.missions;
const { DIFFICULTY_BY_ID, POWERUPS, SUPPLIES } = SF.config;
const fx = SF.fx;
const audio = SF.audio;
const P = SF.profile;

let canvas, ctx, gameFrame, scale = 1;
const shakeVec = { x:0, y:0 };

/*
 * THE MISSION CLOCK.
 *
 * Section 8b states the rule - "no gameplay timing on the wall clock" - and
 * the temp powerups broke it. Rapid Fire and friends were stored as
 * `simMs + 9000`, so real time kept burning against a nine-second
 * buff while the game sat paused. Pause for longer than the buff and it was
 * simply gone, with no shot fired; the HUD bar visibly drained behind the
 * pause overlay. And it wasn't opt-in - `visibilitychange` auto-pauses, so
 * app-switching or locking the iPad did it too.
 *
 * So there is one clock, and it only advances while a mission is actually
 * running. Everything downstream already took `timeMs` as a parameter and
 * therefore became pause-correct for free; the handful of direct
 * `simMs` calls in here now read this instead.
 *
 * It deliberately never resets. Nothing needs it to - every deadline is
 * relative - and a clock that restarts at zero would leave any deadline
 * outliving the mission that set it sitting in the future forever.
 */
let simMs = 0;

const game = {
  world: new SF.World(),
  run: null,
  state: "idle",          // idle | playing | paused | ending
  profile: null,
  onMissionEnd: null,     // set by the UI layer
  onTestFlightEnd: null,  // set by the UI layer - the range exits to the Armory
  godMode: false,         // test hook only
  get VW(){ return VW; }, get VH(){ return VH; },
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
  /*
   * The one safe moment to re-measure the playfield: nothing is on it yet.
   * Mid-mission every entity holds coordinates in the old space, and at load
   * the answer can't be trusted on iOS - a standalone app's insets aren't
   * known until after its scripts have run. Everything below builds the world
   * from VW, so this has to come first.
   */
  SF.field.refresh();

  /*
   * One seed per run, drawn before anything else can consume a number: the
   * loadout, the wave director and every spawn from here on read the same
   * deterministic stream, so a run is reproducible from its seed alone and
   * nothing that happened before launch can lean on it. `nextRunSeed` lets a
   * test (or a future daily-style mode) pin the roll; it is consumed once.
   */
  const seed = game.nextRunSeed != null ? game.nextRunSeed
             : Math.floor(Math.random() * 2147483647);
  game.nextRunSeed = null;
  SF.core.seedSim(seed);

  const profile = game.profile;
  // "wacky" is the WACKY SKY - an endless generated mission that rolls two or
  // three silly modifiers per flight (see wacky.js). "test" is the Armory's
  // firing range, "rush" the boss gauntlet, "vault" the secret.
  const wacky = missionIndex === "wacky";
  const test = missionIndex === "test";
  const rush = missionIndex === "rush";
  const vault = missionIndex === "vault";
  // A mission OBJECT is a Drawing Board sky: the family draws them, so they
  // arrive as data rather than as an index into the campaign.
  const custom = !!missionIndex && typeof missionIndex === "object";
  // Replayable on request: the door never locks. Only the SOLAR GOLD paint
  // is one-time (see endMission) - `vaultDone` still gates that, it just no
  // longer gates the mission itself.
  const mission = custom ? missionIndex
                : wacky ? SF.wacky.build()
                : test  ? buildTestRange()
                : rush  ? buildBossRush()
                : vault ? buildStarVault()
                        : MISSIONS[clamp(missionIndex, 0, MISSIONS.length-1)];
  const difficulty = test ? TEST_DIFF
                          : DIFFICULTY_BY_ID[difficultyId] || DIFFICULTY_BY_ID.pilot;

  game.world.reset();
  fx.reset();
  SF.finale.reset();                      // no intro/fleet/death left running
  SF.backstage.reset();                   // the workshop sleeps until asked
  if(mission.backstage) SF.backstage.begin();
  SF.papadeath.reset();                   // no mini-Papas left over from last time
  SF.sky29.reset();                       // the easel waits for its mission
  if(mission.sky29) SF.sky29.begin();
  SF.bossintro.reset();
  SF.rewind.arm();                        // a blank tape for this run
  game.world.silent = !!mission.noGuns;   // nobody shoots on a silent run
  game.world.mods = mission.mods || {};   // the Wacky Sky's roll; {} elsewhere
  game.world.cover = !!mission.cover;     // rocks stop their bullets on this one
  game.world.mirror = !!mission.mirror;   // the Glass Sea: a second gun, far side
  game.world.wrap = !!mission.wrap;       // the Ring: the sky joins up at the edges
  game.world.wrapped = 0;
  SF.render.initBackground(custom ? (mission.skyIndex || 0)
                          : wacky ? SF.wacky.skyIndex() : test ? 0 : rush ? 7
                          : vault ? 8 : missionIndex);   // the vault flies gold
  const loadout = buildLoadout(profile, difficulty);
  /*
   * LENT DRONES (mission flag). On the very first patrol the squadron flies
   * with you: two escort drones, on the house, whoever else is on the device.
   * Three things at once - nobody's first ninety seconds are flown alone, the
   * level has an identity that isn't "grunts but more of them", and a kid
   * sees what a Wingman Drone does before ever being asked to buy one. Never
   * takes anything away: it only tops the count up.
   */
  if(mission.lentDrones)
    loadout.drones = Math.max(loadout.drones, mission.lentDrones);
  game.world.createPlayer(loadout);

  /*
   * The player-side modifiers are applied here, not in createPlayer: the
   * loadout is the pilot's own gear, and the roll is the sky's joke on top of
   * it. `artScale` is what the renderer draws the hull at, kept separate from
   * the collision radius so TINY SHIP shrinks both, honestly, in one place.
   */
  if(game.world.mods.tiny){
    // Third cut. Half a ship was still "not really noticeable"; a THIRD of a
    // ship is a gnat with a gun, which is the joke. The hitbox shrinks with
    // it - tiny is the one modifier where matching art and collision makes
    // the game strictly easier, so no cartoon split is needed.
    game.world.player.r = 4;              // stock is 11
    game.world.player.artScale = 0.32;
  }
  if(game.world.mods.mega){
    // The other half of "tiny and huge ships": drawn at nearly double,
    // colliding at stock. Art-only on purpose - a genuinely doubled hitbox
    // would be the one modifier that makes the game harder, and the fun is
    // LOOKING like a parade float, not dying like one. The wingman drones
    // scale with the hull, which is its own joke.
    game.world.player.artScale = 1.9;
  }
  if(game.world.mods.turbo){
    // 1.45x read as "a good thruster upgrade". 1.7x reads as TURBO - and the
    // background streaks harder with it (see updateBackground), so the speed
    // is visible even when the thumb is still.
    game.world.player.accel *= 1.7;
    game.world.player.maxSpeed *= 1.7;
  }

  const director = new SF.systems.WaveDirector(mission, difficulty, game.world);
  const wavesEndT = mission.waves.reduce((t, wv) => Math.max(t, wv.t), 0) + 10;
  const stats = {
    spawned: 0, kills: 0, escaped: 0, killRatio: 0, coins: 0,
    rescues: 0, rescuesTotal: director.rescuesPlanned + (mission.podDrops || 0),
    // damageTaken: hits that got PAST the shield. hitsTaken: every contact,
    // absorbed or not - the coach wants the second, the flawless star the first.
    damageTaken: 0, hitsTaken: 0, livesLost: 0, completed: false,
    convoyTotal: mission.convoy ? 1 : 0, convoyLost: 0,
    partsDenied: 0, serpentAte: 0, serpentSlain: false, painted: 0,
    // The six newer stops each count their own thing.
    delivered: 0, dropped: 0, wraps: 0, limpetsShaken: 0,
    flareHits: 0, crushed: 0, mirrorKills: 0,
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
    skyWasBusy: false,       // wave-clear edge detector, for the shield refill
    /*
     * Per-kill payout, damped by the tier's density. A hard tier now sends
     * three times as many enemies, so paying `pay` per head would have made
     * one NIGHTMARE run worth £30k against a £70k Armory - the tier would buy
     * the game out in two flights. The square root keeps hard tiers clearly
     * more lucrative without letting headcount run the economy. Completion and
     * rescue bonuses are per-mission, not per-head, so they keep the full rate.
     */
    payScale: (difficulty.pay / Math.sqrt(difficulty.density || 1))
              * (mission.mods && mission.mods.gold ? 2 : 1),   // DOUBLE COINS
    mods: mission.mods || {},
    // The roll, spelled out for the HUD (it replaces the tier label - the
    // Wacky Sky is always PILOT, so that line was dead weight) and queued for
    // the slot-machine reveal that pops each name in its own colour.
    modLine: mission.modList ? mission.modList.map(m => m.name).join(" + ") : null,
    modReveal: mission.modList ? { queue: mission.modList.slice(), t: 1.1 } : null,
    seed,
    score: 0, money: 0, combo: 0, comboTimer: 0, maxCombo: 0,
    time: 0, phase: "intro", phaseTimer: 2.2,
    bossActive: false, bossSpawned: false, bossCleared: false, progress: 0,
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
    bannerColor: "#ffd23f", bannerUntil: simMs + 6000,
    objectiveDefs: mission.objectives.map(id => OBJECTIVES[id]),
    objectiveIds: mission.objectives.slice(),   // for the map's star hunt
    // The upgrade bought since the last flight, if there is one - named at
    // launch and reported on the results card, then cleared. Set below.
    freshGear: null,
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
    /*
     * Shake Them Off: the bases are CACHED, not multiplied per frame.
     * buildLoadout has already applied the tune multipliers and the Wacky
     * Sky TURBO mod also writes maxSpeed, so a per-frame multiply would decay
     * both toward zero over a two-minute mission and never come back.
     */
    limpets: mission.limpets ? { wig: 0, lastSign: 0, prompted: false,
      baseSpeed: 0, baseAccel: 0 } : null,
    // The Bright Side: the star underneath throws a sheet of fire up the
    // screen. The Storm's clock with one extra beat.
    flare: mission.flare ? { y: VH + 60, mode:"calm", timer: 6, top: VH,
      hitThisBurn: false } : null,
    // The Stampede: three or four Sky Oxen on the field at all times.
    stampede: mission.stampede ? { next: 3 } : null,
    /*
     * The Lifeline: you ARE the hauler. doorX drifts so the drop point is
     * never the same twice, and the crate hangs under the hull so a child can
     * SEE they are loaded. baseSpeed is cached after every modifier, for the
     * same reason the limpets cache theirs.
     */
    ferry: mission.ferry ? { left: mission.ferry, carried: false, delivered: 0,
      dropped: 0, spawnIn: 3, doorX: VW*0.5, doorDir: 1, baseSpeed: 0,
      done: false } : null,
    /* --- Act 4's rule-breakers. Each is a small state machine ticked in the
       main update, the same pattern as the storm above. --- */
    // The Undertow: drifting gravity wells that curve every loose thing.
    wells: mission.wells ? { list: [], next: 6, mawAt: wavesEndT * 0.60, maw: null } : null,
    // The Chorus: one metronome, and every gun in the sky obeys it.
    beat: mission.beat ? { t: 0, count: 0, window: 0, silenceUntil: 0, pulseMs: 0 } : null,
    // The Foundry: parts ride belts toward the assembler. Deny or fight.
    foundry: mission.foundry ? {
      belts: [ { y: 112, dir: 1, speed: 76 }, { y: 174, dir: -1, speed: 94 } ],
      next: 7, built: 0 } : null,
    // The Tithe Serpent: spawns once, eats coins, grows, and must be slain.
    serpent: mission.serpent ? { at: 14, head: null, eaten: 0, eatenValue: 0,
      grown: 0, tailGoneSaid: false, fleeAt: 0 } : null,
    rushList: rush ? rushBossList(profile) : [],
    rushIndex: 0,
    ended: false,
  };

  /*
   * First flight of the day pays double. It is the "come back tomorrow" hook:
   * one banner, one doubled payScale, and a date on the profile. Deliberately
   * per-pilot, so each brother gets his own morning bonus.
   */
  /*
   * The day is CLAIMED here but only STAMPED in endMission. Stamping it at
   * launch meant quitting from the pause menu, dying on the first wave, or
   * closing the tab burnt the bonus with nothing banked and nothing to show
   * for it until tomorrow - which for a seven-year-old opening the wrong
   * mission is a silent, unrecoverable loss of the best thing in their day.
   */
  // The range must not burn the real first-flight-of-the-day bonus.
  const today = new Date().toDateString();
  if(!mission.testFlight && profile.lastFlightDay !== today){
    game.run.payScale *= 2;
    game.run.dailyDouble = true;
    // A money note must never take the instruction's place: the goal line is
    // the only thing telling a child what to DO, and the first flight of the
    // day - which is every day, for these two - is exactly when they need it.
    // The bonus gets its own popup underneath instead.
    fx.text(VW/2, VH*0.52, "FIRST FLIGHT TODAY — DOUBLE PAY!", "#ffd23f", 20, true);
  }
  /*
   * FIRST FLIGHT WITH THE NEW PART.
   *
   * Buying something now genuinely changes how the sky behaves - that was the
   * point of the whole balance repair - but a change nobody points at is a
   * change nobody credits. So the flight after a purchase says what is new,
   * once, under the mission card, and the results screen reports what it did.
   * Not on the test range, which is where you go to try things out anyway.
   */
  if(profile.freshGear && !mission.testFlight){
    const fg = SF.config.UPGRADE_BY_ID[profile.freshGear.id];
    if(fg){
      game.run.freshGear = { id: fg.id, name: fg.name, cat: fg.cat,
                             level: profile.freshGear.level,
                             effect: fg.effect(profile.freshGear.level) };
      fx.text(VW/2, VH*0.60, "NEW: " + fg.name.toUpperCase(), "#4ade80", 19, true);
    }
    profile.freshGear = null;
    P.save(profile);
  }
  // Shake Them Off caches the ship as it flies TODAY, once, after every
  // modifier has been applied. Everything else here would be a moving target.
  if(game.run.limpets){
    game.run.limpets.baseSpeed = game.world.player.maxSpeed;
    game.run.limpets.baseAccel = game.world.player.accel;
  }
  if(game.run.ferry) game.run.ferry.baseSpeed = game.world.player.maxSpeed;
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
             : mission.wells ? "wellsStart"
             : mission.beat ? "chorusStart"
             : mission.foundry ? "foundryStart"
             : mission.serpent ? "serpentStart"
             : mission.backstage ? "backstageStart"
             : mission.sky29 ? "sky29Start"
             : mission.ferry ? "ferryStart"
             : mission.wrap ? "wrapStart"
             : mission.limpets ? "limpetStart"
             : mission.flare ? "flareStart"
             : mission.stampede ? "stampedeStart"
             : mission.mirror ? "mirrorStart"
             // The early-mission rules sit below the set pieces, so a mission
             // carrying both announces the bigger thing.
             : mission.lentDrones ? "dronesStart"
             : mission.bounty ? "bountyStart"
             : mission.cover ? "coverStart"
             : mission.nearMiss ? "nearMissStart"
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
  run.bannerUntil = simMs + 2200;
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
  // Sky 29 pays the same way: paint the sky once, wear its dawn forever.
  // The mission stays replayable - only the memento is one-time.
  if(run.mission.sky29 && completed && !profile.sky29Done){
    profile.sky29Done = true;
    if(!profile.cosmetics.paints.includes("sky29")) profile.cosmetics.paints.push("sky29");
    run.sky29Won = true;
  }
  // Crossing the 84-star line is the moment the gift stop opens - worth a
  // toast, because the map is the last place a player looks after a win.
  const starsBefore = P.totalStars(profile);

  // The double-pay day is spent only once a flight has actually ENDED, so a
  // quit or a first-wave death leaves tomorrow's bonus still on the table.
  if(run.dailyDouble) profile.lastFlightDay = new Date().toDateString();

  /*
   * A rolling read on HOW the last few flights went, so the garage can answer
   * the question fourteen upgrade tracks pose to a seven-year-old: which one?
   * Decayed rather than summed, so it tracks how they are flying NOW and a bad
   * afternoon three weeks ago does not still be advising them. Cheap, and it
   * costs the save nothing worth measuring.
   */
  if(!run.mission.testFlight){
    const co = profile.coach = profile.coach || { runs:0, livesLost:0, escaped:0, hits:0 };
    const decay = 0.7;
    co.runs     = co.runs*decay + 1;
    co.livesLost= co.livesLost*decay + (run.stats.livesLost || 0);
    co.escaped  = co.escaped*decay + (run.stats.escaped || 0);
    co.hits     = co.hits*decay + (run.stats.hitsTaken || 0);
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
  // The Wacky Sky keeps its own book: one all-time best score and one
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
  } else if(run.mission.vault){
    /*
     * THE STAR VAULT KEEPS OUT OF THE CAMPAIGN LEDGER.
     *
     * It is a secret joke level that rains gold and barely shoots back, and it
     * used to fall through to the campaign branch below - so it wrote
     * `profile.missions.vault` into the ledger, set `lastMission` to an id that
     * is not on the map (which is what the map's "next stop" hint reads), and
     * handed its enormous star-rain score to `highscore`, where no real mission
     * could ever beat it. Its own reward - the SOLAR GOLD paint - is booked
     * further up and is untouched by this.
     */
    P.save(profile);
  } else if(run.mission.custom){
    // A Drawing Board sky keeps its own book: best score per sky, per pilot,
    // synced with the profile - so a brother's record chip is stealable. The
    // campaign ledger (records, lastMission, stories) never hears about it.
    if(completed){
      const wb = profile.workshopBest = profile.workshopBest || {};
      const prev = wb[run.mission.id];
      if(!prev || run.score > prev.score)
        wb[run.mission.id] = { score: run.score, at: Date.now() };
    }
    P.save(profile);
  } else {
    profile.lastMission = run.mission.id;
    profile.lastDifficulty = run.difficulty.id;
    // Captured BEFORE the save: once recordMission runs, this run's score IS
    // the record and "did I beat anything?" can no longer be answered.
    // Like for like: the record you are being told about is the one set on the
    // tier you just flew, not somebody's NIGHTMARE number.
    prevFamilyBest = P.familyBest(run.mission.id, run.difficulty.id);
    const prevRec = profile.missions[run.mission.id];
    firstClear = completed && !(prevRec && prevRec.cleared);
    prevSelfBest = prevRec && prevRec.best
      ? Math.max.apply(null, [0].concat(Object.values(prevRec.best).map(Number))) : 0;
    // The ids that were actually ticked ride along, so the campaign map can
    // tell a pilot WHICH star is still out there rather than just how many.
    const metIds = completed
      ? (run.objectiveIds || []).filter((id, i) => run.objectiveDefs[i].test(run.stats))
      : [];
    P.recordMission(profile, run.mission.id, run.difficulty.id, completed ? stars : 0,
                    run.score, completed, metIds);
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
      sky29Won: !!run.sky29Won,
      allStarsNow: starsBefore < P.maxStars() && P.totalStars(profile) >= P.maxStars(),
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

  /*
   * `noPay` is for kills that are not yours. The Bright Side is the only
   * caller: the star burns whatever is low when it flares, and that must
   * cost the enemy its life without paying you a penny or advancing your
   * combo - "get them before the fire does" then teaches itself, with no
   * words. It still routes through HERE rather than setting e.alive = false,
   * because this function owns two things the level depends on: the kill
   * ledger, and freeing the pilot out of a carrier. Bypass it and a burned
   * carrier never drops its pilot, so rescueAll - the level's own second
   * star, with three carriers deliberately diving toward the flame - becomes
   * unreachable through no fault of the player.
   */
  onEnemyKilled(e, bullet, byRamming, noPay){
    const run = game.run;
    e.alive = false;
    /*
     * `!e.fromBoss` as well as `e.counted`. A boss add is spawned outside the
     * WaveDirector, so it never increments `spawnedCount` - but it arrived here
     * with `counted` already true (the flag is set on the returned object,
     * after spawnEnemy has decided), so killing one incremented `kills` against
     * a total it was never part of. onEnemyEscaped has always had this guard;
     * the kill side did not, so the ratio could be inflated past 100% by
     * farming adds - the mirror image of the bug that made it unreachable.
     */
    if(e.counted && !e.fromBoss){ run.stats.kills++; }
    // The Glass Sea: the twin earns its own tally, which is a whole star.
    if(bullet && bullet.fromMirror) run.stats.mirrorKills++;
    if(run.mission.sky29) SF.sky29.splash(e.x, e.y);   // every kill, a drop of paint

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
      run.bannerUntil = simMs + 3200;
      SF.comms.say("rivalDown");
    }

    // A thief drops everything it lifted. Killing one mid-run is a real save,
    // so it pays back visibly rather than silently.
    if(e.loot > 0){
      game.world.dropCoins(e.x, e.y, e.loot);
      fx.text(e.x, e.y - 26, "+£" + e.loot + " BACK!", "#ffd23f", 18, true);
      SF.comms.say("thiefDown");
    }

    // The Foundry: a popped part is a ship that never gets born.
    if(e.typeId === "part"){
      run.stats.partsDenied++;
      fx.text(e.x, e.y - 20, "DENIED!", "#4ade80", 14, true);
    }
    // The Chorus: silencing a conductor makes the whole choir forget the
    // words - four full seconds where not one gun in the sky may fire.
    if(run.beat && e.elite && e.type.fire){
      run.beat.silenceUntil = simMs + 4000;
      run.bannerText = "THE CHOIR FALLS SILENT";
      run.bannerSub = "four seconds — go!";
      run.bannerColor = "#c026d3";
      run.bannerUntil = simMs + 2000;
      fx.ring(e.x, e.y, 120, "#e879f9", 5, 0.6);
      audio.play("victory");
    }
    // The Tithe Serpent's rings pop one at a time; the head pays out.
    if(e.typeId === "serpent" && run.serpent){
      run.stats.serpentSlain = true;
      const back = Math.max(60, run.serpent.eatenValue);
      game.world.dropCoins(e.x, e.y, back);
      run.bannerText = "EVERY PENNY BACK!";
      run.bannerSub = "the serpent coughs up £" + back;
      run.bannerColor = "#2fbf9a";
      run.bannerUntil = simMs + 3000;
      fx.explosion(e.x, e.y, 110, "#2fbf9a", true);
      for(let i = 0; i < 3; i++) fx.ring(e.x, e.y, 60 + i*50, "#7ef0cf", 4 - i, 0.5);
      fx.shake(16); fx.hitStop(100);
      audio.play("bossExplode");
      SF.comms.say("serpentDown");
      // The rings die with the head, nose to tail.
      const es = game.world.enemies.items;
      for(let i = 0; i < es.length; i++){
        const seg = es[i];
        if(seg.alive && seg.typeId === "serpentSeg"){
          seg.alive = false;
          fx.spark(seg.x, seg.y, 0, -40, "#7ef0cf", 0.4, 3);
        }
      }
    }

    /*
     * Splitters burst into shards that immediately come at you - the kill is
     * the start of the problem, not the end of it.
     *
     * `noSplit` is the exception, and Smart Bombs are why. The shop sells them
     * as "BOOM - wipes out the whole screen", and the bomb killed splitters the
     * ordinary way: the screen cleared and then refilled with a cloud of
     * kamikaze shards, which is the opposite of what a panic button is for and
     * exactly when a child presses one. (It was non-deterministic too: the bomb
     * walks the pool while the shards are being spawned into it, so whether a
     * new shard also died depended on which slot it landed in.)
     */
    const split = e.type.splitsInto;
    if(split && !byRamming && !e.noSplit){
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

    if(!noPay){
    run.combo++;
    run.comboTimer = 1.4;
    if(run.combo > run.maxCombo) run.maxCombo = run.combo;
    const comboMult = 1 + Math.min(Math.floor(run.combo/4), 5)*0.4;   // caps at x3
    const scoreMult = comboMult * run.difficulty.pay * (simMs < game.world.player.tempScoreUntil ? 2 : 1);

    run.score += Math.round(e.score * scoreMult);
    let coin = Math.max(1, Math.round(e.money * run.payScale * game.world.player.moneyMult * comboMult));
    // A WANTED ship pays five times, loudly. Picking one target out of a
    // moving crowd is a skill, and this is the level that pays for it.
    if(e.bounty){
      coin *= 5;
      run.stats.bounties = (run.stats.bounties || 0) + 1;
      fx.ring(e.x, e.y, 46, "#ffd23f", 4, 0.4);
      fx.text(e.x, e.y - 30, "WANTED! +£" + coin, "#ffd23f", 19, true);
      audio.play("coin", true);
    }
    game.world.dropCoins(e.x, e.y, coin);
    }

    if(run.mods.confetti){
      // CONFETTI BLASTS: every pop is the celebration firework. The plain
      // explosion still runs underneath so the hit keeps its physical punch.
      // Math.random on purpose: a confetti colour is decoration, and
      // decoration must not consume the seeded simulation stream.
      fx.firework(e.x, e.y, ["#ff5d73","#ffd23f","#4ade80","#3fc9ff","#c084fc"]
        [Math.floor(Math.random()*5)]);
    }
    fx.explosion(e.x, e.y, e.size, e.elite ? "#ffd23f" : "#ffb03d", e.elite || e.maxHp >= 5);
    fx.shake(e.elite ? 9 : (e.maxHp >= 5 ? 6 : 3));
    if(e.elite || e.maxHp >= 6) fx.hitStop(55);
    audio.play("enemyExplode", e.elite || e.maxHp >= 5);

    if(!noPay && run.combo > 0 && run.combo % 5 === 0){
      fx.text(e.x, e.y - 20, "x" + run.combo + "!", "#ffd23f", 19);
      audio.play("combo", run.combo);
      if(run.combo >= 10) SF.comms.say("bigCombo", { n: run.combo });
    }
    if(noPay){
      // Nothing falls out of a ship the star took. Not even luck.
    } else if(e.elite){
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

    /*
     * CHAIN REACTION: a pop takes its neighbours with it, and theirs. The
     * depth cap is the whole safety design - three hops is enough for a
     * packed formation to go up like a string of firecrackers, and it stops
     * one lucky shot from clearing the sky (and stops this from recursing
     * forever). Chained kills score and pay exactly like shot ones, because
     * a kid who set off a nine-enemy cascade earned all nine.
     */
    if(run.mods.chain && (e.chainDepth || 0) < 3 && !run.ended){
      const depth = (e.chainDepth || 0) + 1;
      const first = !e.chainDepth;          // this kill STARTED the cascade
      if(first) run.chainCount = 0;
      const R = 96;
      /*
       * The blast has to be legible, not merely real. The first version was
       * one thin ring in the middle of the explosion that caused it, and it
       * measured fine - three-deep cascades, more chained kills than shot
       * ones - while reading as nothing at all: "I don't see anything special
       * about it". So the blast now says what it did. A shockwave, an arc of
       * sparks reaching each neighbour it sets off, and the size of the
       * cascade shouted at the end of it.
       */
      fx.ring(e.x, e.y, R, "#fb923c", 5, 0.34);
      fx.ring(e.x, e.y, R*0.55, "#ffd23f", 3, 0.22);
      const list = game.world.enemies.items;
      const caught = [];
      for(let i = 0; i < list.length; i++){
        const o = list[i];
        if(!o.alive || o === e || o.entering) continue;
        const dx = o.x - e.x, dy = o.y - e.y;
        if(dx*dx + dy*dy > R*R) continue;
        o.hp -= 3; o.flash = 1;
        if(o.hp <= 0){ o.chainDepth = depth; caught.push(o); }
      }
      // The arc: you can see the blast reach across and take the next one.
      caught.forEach(o => {
        const dx = o.x - e.x, dy = o.y - e.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        for(let k = 1; k <= 5; k++){
          const u = k/6;
          fx.spark(e.x + dx*u, e.y + dy*u, dx/d*90, dy/d*90,
                   k % 2 ? "#ffd23f" : "#fb923c", 0.22, 2.6);
        }
      });
      // Killed outside the scan, so the list can't change under the loop.
      caught.forEach(o => { run.chainCount++; callbacks.onEnemyKilled(o, null, false); });
      // ...and once the whole cascade has resolved, how big it was.
      if(first && run.chainCount >= 2){
        fx.text(e.x, e.y - 34, "CHAIN ×" + (run.chainCount + 1) + "!", "#fb923c", 21, true);
        fx.shake(Math.min(13, 3 + run.chainCount*1.5));
        audio.play("combo", run.chainCount);
      }
    }
  },

  /*
   * A diver went past your wingtip and missed. On the level that teaches
   * "let them come, THEN swerve", that is the skill, so it gets paid and
   * shouted about - a near miss you don't notice teaches nothing.
   */
  onGraze(e){
    const run = game.run;
    if(!run || run.ended) return;
    run.stats.grazes = (run.stats.grazes || 0) + 1;
    const coin = Math.max(1, Math.round(4 * run.payScale * game.world.player.moneyMult));
    game.world.dropCoins(e.x, e.y, coin);
    fx.ring(e.x, e.y, 26, "#7cc4ff", 2.5, 0.22);
    fx.text(e.x, e.y - 22, "CLOSE!", "#7cc4ff", 16, true);
    audio.play("coin");
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
    /*
     * On a "destroy every enemy" mission a single escape ends the star, right
     * there, and nothing said so - the pips just quietly never lit. A child
     * cannot learn from a rule they never saw fire. Said once, on the first
     * one, at the bottom of the screen where it left.
     */
    if(run.mission.objectives && run.mission.objectives.indexOf("killAll") >= 0 &&
       run.stats.escaped === 1){
      fx.text(VW/2, VH*0.62, "ONE GOT AWAY!", "#ff5d73", 20, true);
      run.bannerText = "ONE GOT AWAY";
      run.bannerSub = "clean sweep is off — but finish the job";
      run.bannerColor = "#ff5d73";
      run.bannerUntil = game.now() + 2400;
      audio.play("alarm");
      SF.comms.say("oneGotAway");
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
    return res;                 // the collision layer needs to know what fell
  },

  onPlayerHit(source, ent){
    const run = game.run;
    const p = game.world.player;
    if(!p || !p.alive || p.invuln > 0) return;
    // Every contact, absorbed or not. The garage's coach reads this to notice
    // "you're taking a lot of hits" - a shield eating them is still evidence.
    run.stats.hitsTaken = (run.stats.hitsTaken || 0) + 1;

    /*
     * THE LIFELINE: a hit makes you drop the load - and this is the softest
     * version of that rule that still costs something. The crate pops out and
     * FLOATS where it was for four seconds inside a bright ring before it
     * begins to sink, so the price of being hit is the trip back, never the
     * crate. A rule that takes the whole delivery away on one graze is a rule
     * a seven-year-old stops trying.
     */
    if(run.ferry && run.ferry.carried){
      run.ferry.carried = false;
      run.ferry.dropped++;
      run.stats.dropped++;
      p.maxSpeed = run.ferry.baseSpeed;
      const c = game.world.spawnPickup("crate", p.x, p.y + 16);
      c.vy = 0; c.floatFor = 4;
      fx.ring(p.x, p.y, 52, "#7dd3fc", 4, 0.5);
      fx.text(p.x, p.y - 30, "DROPPED IT!", "#7dd3fc", 19, true);
    }

    if(p.shield > 0){
      /*
       * A HIT THE SHIELD ATE IS NOT DAMAGE TAKEN.
       *
       * `damageTaken` used to be incremented above this branch, so the bubble
       * that "eats a hit for you" ate the hit and you were charged for it
       * anyway. That killed "Take no damage at all" - a required star on Cold
       * Approach, which is 136 seconds of waves followed by the Phantom, so
       * roughly 190 seconds of never being touched - and it meant the armour
       * shelf could not help with the one star it exists for. Owning a shield
       * was strictly no better than not owning one.
       *
       * Which is the same fault the whole balance repair was about: a thing
       * you saved up for, not changing the outcome.
       */
      p.shield--;
      p.invuln = Math.max(0.9, p.invulnTime*0.5);
      fx.ring(p.x, p.y, 60, "#7cc4ff", 3, 0.35);
      fx.sparks(p.x, p.y, 14, "#7cc4ff", 180);
      fx.shake(7);
      fx.flash(0.5, "80,180,255");
      audio.play("shieldBreak");
      return;
    }

    // Past the shield: this one actually landed.
    run.stats.damageTaken++;
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
      /*
       * The last life is not another dent - the ship is GONE, and it has to
       * look it. A lost life gets the standard 58px pop above; this is the
       * boss-sized send-off, in the pilot's own colour so it is unmistakably
       * THEIR ship coming apart: a big fireball, three rings rolling off it,
       * a shower of wreckage, and the screen kicked hard.
       */
      fx.explosion(p.x, p.y, 150, p.color, true);
      for(let i = 0; i < 3; i++)
        fx.ring(p.x, p.y, 80 + i*60, i % 2 ? "#ffd23f" : p.color, 5 - i, 0.55 + i*0.2);
      fx.debris(p.x, p.y, 26, p.color);
      fx.sparks(p.x, p.y, 26, "#ffe9a8", 260);
      fx.shake(26);
      fx.flash(1, "255,60,40");
      fx.hitStop(160);
      audio.play("bossExplode");
      /*
       * Then the tape: "that's not fair" is nearly always "I never saw it".
       * Started BEFORE endMission so the UI finds it running and parks the
       * results screen behind it - scoring and saving happen on the usual
       * frame either way. Its first beat holds on the wreck above, so the
       * explosion is watched rather than cut away from.
       */
      SF.rewind.capture(source, ent, game.world);
      SF.rewind.begin(p);
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
  // THE FORGERY's titan is only act one: it cracks open, and what crawls
  // out is yours. backstage.js owns everything after this frame.
  if(boss.def.forge){
    fx.explosion(boss.x, boss.y, 170, "#e8c14a", true);
    for(let i = 0; i < 4; i++)
      fx.ring(boss.x, boss.y, 70 + i*60, i%2 ? "#ffd23f" : "#e8c14a", 5 - i, 0.5 + i*0.15);
    fx.debris(boss.x, boss.y, 26, "#e8c14a");
    fx.shake(26); fx.hitStop(160);
    audio.play("bossExplode");
    run.score += Math.round(1500 * run.difficulty.pay);
    game.world.boss = null;
    run.bossActive = true;              // the fight goes on - just not in this slot
    SF.backstage.titanDown();
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

/*
 * Is the squadron due? "The last stretch of the fight" - but a stretch long
 * enough to actually see.
 *
 * A fight can name its own moment with `lastLight` on a phase, and the
 * Devourer does: its finale is hand-choreographed down to the beat and the
 * flag keeps it exactly where it has always been. Every other boss gets the
 * default, which is the earlier of its final phase and 40% health.
 *
 * The 40% floor is not decoration. The family roughly doubles your damage
 * while they are out there, so a trigger on the final phase alone - the
 * Marauder's starts at 20% - would put them on screen for barely two seconds
 * after a three-second arrival: banner, stagger in, boss already dead. Firing
 * at 40% of a 26-second fight buys them a real five seconds of flying beside
 * you, which is the whole point of them turning up.
 */
function squadronDue(boss){
  const phases = boss.def.phases;
  if(phases.some(ph => ph.lastLight)) return !!boss.phase.lastLight;
  return boss.phaseIndex === phases.length - 1 || boss.hp <= boss.maxHp*0.40;
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
    run.bossCleared = true;
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
    run.bossCleared = true;
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
  run.bossCleared = true;
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

  /*
   * Snapshot first, then kill. onEnemyKilled can spawn into this very array
   * (splitters), so walking it live meant the outcome depended on which pool
   * slot a new shard happened to take. Nothing born from the blast is caught
   * by it either way - `noSplit` is what actually stops the cloud.
   */
  const enemies = game.world.enemies.items;
  const caught = [];
  for(let i=0;i<enemies.length;i++) if(enemies[i].alive) caught.push(enemies[i]);
  for(let i=0;i<caught.length;i++){
    const e = caught[i];
    if(!e.alive) continue;
    e.hp = 0;
    e.noSplit = true;
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
  if(simMs < p.overdriveUntil) return false;
  p.overdrives--;
  p.overdriveUntil = simMs + p.overdriveTime*1000;
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

  /*
   * VW/VH are refreshed HERE, every frame, and not merely captured in the
   * object literal where behaviourCtx is declared. The literal copies the
   * numbers, so the field size every behaviour reasoned about - the minelayer's
   * drop band, the hover clamps - was the one measured at page load, and stayed
   * that way through every rotation and resize for the rest of the session.
   */
  behaviourCtx.VW = VW; behaviourCtx.VH = VH;
  behaviourCtx.player = game.world.player;
  behaviourCtx.pickups = game.world.pickups;
  behaviourCtx.world = game.world;
  behaviourCtx.escort = game.world.escortTarget();   // what the hunters aim at
  // The Ring counts on the world (that is where the crossing happens); the
  // star reads it off the run, so the two are reconciled once a frame.
  if(game.world.wrap) run.stats.wraps = game.world.wrapped;
  behaviourCtx.difficulty = run.difficulty;
  behaviourCtx.smart = run.difficulty.smart;
  behaviourCtx.onEscape = callbacks.onEnemyEscaped;
  // A pool-cap eviction is an escape as far as the books are concerned.
  game.world.onEnemyStolen = callbacks.onEnemyEscaped;
  behaviourCtx.onEnemyKilled = callbacks.onEnemyKilled;
  behaviourCtx.onBossHit = callbacks.onBossHit;
  behaviourCtx.onBossDead = finalBossBlast;
  behaviourCtx.onBossPhase = onBossPhase;
  behaviourCtx.onPlayerHit = callbacks.onPlayerHit;
  behaviourCtx.onGraze = run.mission.nearMiss ? callbacks.onGraze : null;
  behaviourCtx.godMode = game.godMode;
  // The Chorus: guns may only release inside the beat's window, and never
  // while the choir has forgotten the words (a conductor just died).
  behaviourCtx.beatGate = run.beat
    ? (() => run.beat.window > 0 && simMs >= run.beat.silenceUntil)
    : null;

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
      // Behind the Sky: the first fake ending plays out before the boss may
      // arrive - backstage.js says when the workshop is ready.
      if(run.mission.backstage && !SF.backstage.readyForBoss()){ /* hold */ }
      else if(run.mission.boss){
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
      } else if(run.mission.sky29 && !SF.sky29.readyToClear()){
        /* Sky 29 holds here for the last stroke and the photo. */
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
        run.bannerUntil = simMs + 2000;
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
      run.bannerUntil = simMs + 2200;
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

  /*
   * Progress readout: waves spawned, then boss health, then done. The bug
   * report was exact - "sometime I end a level and it's not 100%" - and the
   * cause was that the "multiply by 0.65 because this mission HAS a boss"
   * rule kept firing after the boss was already dead: bossActive drops to
   * false the instant it dies, so the readout fell straight back to ~65%
   * for the whole victory lap. `bossCleared` remembers that the boss for
   * THIS mission is done, so the number holds at 100% from the kill onward
   * - and in a Boss Rush, a fresh boss spawning flips bossActive back to
   * true, which still wins the first branch and resumes the health-based
   * readout for the next fight.
   */
  let progressNow;
  if(run.mission.backstage && run.bossActive && SF.backstage.active()){
    /*
     * Behind the sky, boss health stops being the story: the Forgery dies,
     * RE-FORGES to full, and then stands there invulnerable while the real
     * fight moves into the three acts. Measured on a live run, the bar climbed
     * to 97%, snapped back to 65% and froze there for the rest of the mission -
     * so the longest and strangest fight in the game was the one place the
     * player was told nothing at all about how it was going. The act's own
     * progress drives it instead (see backstage.progress01()).
     */
    progressNow = 0.65 + 0.35*clamp(SF.backstage.progress01(), 0, 1);
  } else if(run.bossActive && game.world.boss){
    progressNow = 0.65 + 0.35*(1 - game.world.boss.hp/game.world.boss.maxHp);
  } else if(run.bossCleared){
    progressNow = 1;
  } else {
    const timeline = clamp(run.director.time / run.wavesEndT, 0, 1);
    const cleared = run.director.totalPlanned
      ? clamp(run.stats.kills / run.director.totalPlanned, 0, 1) : 0;
    progressNow = Math.max(timeline, cleared) * (run.mission.boss ? 0.65 : 1);
  }
  /*
   * A progress bar goes one way. Every backwards jump this game has had came
   * from the readout faithfully following something that legitimately reset -
   * a boss re-forging, a scripted stage handing over - and a bar that falls
   * tells a seven-year-old their work was undone when it wasn't.
   *
   * Boss Rush is the one place a reset is honest: each round is its own fight,
   * and the bar is meant to restart with the next boss.
   */
  run.progress = run.mission.bossRush ? progressNow
                                      : Math.max(run.progress || 0, progressNow);

  /*
   * THE SKY GOES EMPTY: a wave is cleared, and the Energy Shield refills.
   *
   * The shop has promised this since the upgrade was written - "a bubble that
   * eats a hit for you, it refills when you clear a wave" - and nothing in the
   * game ever did it. Shields were topped up between boss-rush rounds, by the
   * rare supply crate and by the pickup, and nowhere else, so £2,050 of armour
   * shelf bought four charges for an entire mission. A child cannot read the
   * source to find that out; they just learn that saving up doesn't work.
   *
   * "Cleared a wave" is defined the way a seven-year-old sees it: the sky was
   * busy, and now it is empty, and there is more coming. Not while a boss is
   * up (that is one long fight, and a free refill every time its adds die
   * would trivialise it), and not on the last wave (that is the mission).
   */
  if(run.phase === "waves" && !run.bossActive){
    const busy = game.world.countEnemies() > 0;
    if(busy) run.skyWasBusy = true;
    else if(run.skyWasBusy && !run.director.finishedSpawning){
      run.skyWasBusy = false;
      const pl = game.world.player;
      if(pl && pl.shieldMax > 0 && pl.shield < pl.shieldMax){
        pl.shield = pl.shieldMax;
        fx.text(pl.x, pl.y - 46, "SHIELD UP", "#2ecc71", 17, true);
        fx.ring(pl.x, pl.y, pl.r + 26, "#2ecc71", 3, 0.45);
        audio.play("pickup");
        SF.comms.say("shieldRefill");
      }
    }
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
  /*
   * THE SQUADRON. The rest of the family arrives and fights the last stretch
   * of the boss with you, then leaves the sky alongside you at the fly-off.
   *
   * This used to be a one-off flag on the Devourer's final phase. It is now
   * every boss in the campaign: when a fight enters its LAST phase - the same
   * moment the old flag marked, so the finale is beat-for-beat unchanged -
   * the household shows up. Seven bosses, seven arrivals, and the first one
   * lands at mission 4 instead of mission 23.
   *
   * Boss Rush is the deliberate exception. Seven fights back to back with a
   * squadron arrival in each would turn the moment into wallpaper, so there
   * the family only comes for the LAST boss in the queue, exactly as it does
   * today. rushIndex is incremented when a boss SPAWNS, so while the final
   * one is on screen it already equals the queue length.
   *
   * No fanfare on a device with a single pilot - nobody invented shows up.
   */
  if(bossNow && bossNow.alive && !bossNow.entering && !bossNow.dying &&
     bossNow.def && !SF.finale.fleetSize() && squadronDue(bossNow) &&
     (!run.mission.bossRush || run.rushIndex >= run.rushList.length)){
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
  /*
    * The weather stops when the fighting does. Both of these ran through the
    * victory lap and the fly-off - so on The Undertow the wells kept hauling
    * the ship around and clamping it to y=90 while the autopilot was trying to
    * climb out of the sky, and the ship sat pinned at the top being tugged
    * sideways until the 1.6s safety net ended the scene.
    */
  /*
   * SHAKE THEM OFF. Every limpet on the hull makes the ship heavier, and you
   * get it off by waggling - which is a gesture a seven-year-old invents
   * before anyone explains it, and the reason this level exists.
   *
   * Three things keep it from being a punishment. The riders cost speed and
   * never a life (systems.js skips an attached one entirely). They cap at
   * four, so the ship can always still be flown. And the waggle is not the
   * only way off - they are three hit points and your guns fire themselves,
   * so a child who never works out the gesture still finishes, just slowly.
   */
  if(run.limpets && !run.ended && run.phase !== "intro" &&
     run.phase !== "lap" && run.phase !== "outro"){
    const lm = run.limpets;
    const pl = game.world.player;
    const items = game.world.enemies.items;
    let on = 0, oldest = null;
    for(let i = 0; i < items.length; i++){
      const e = items[i];
      if(e.alive && e.attached){ on++; if(!oldest || e.life > oldest.life) oldest = e; }
    }
    if(pl && pl.alive){
      pl.maxSpeed = lm.baseSpeed * (1 - 0.16*on);
      pl.accel    = lm.baseAccel * (1 - 0.12*on);
      /*
       * The detector reads p.vx, which under a finger is a damped SPRING
       * rather than raw input - so the threshold is tuned against the drag
       * model in entities.js, not against a key press.
       */
      const s = Math.sign(pl.vx);
      if(s && s !== lm.lastSign && Math.abs(pl.vx) > 140){ lm.lastSign = s; lm.wig++; }
      lm.wig = Math.max(0, lm.wig - dt*1.2);
      if(on > 0 && !lm.prompted){
        lm.prompted = true;
        run.bannerText = "SHAKE IT OFF!";
        run.bannerSub = "waggle left and right, fast";
        run.bannerColor = "#a3e635";
        run.bannerUntil = simMs + 2600;
      }
      if(lm.wig >= 3 && oldest){
        // Thrown clear, stunned and cheap - the reward for working it out is
        // a free kill, not just the weight coming off.
        oldest.attached = false;
        oldest.behaviour = "dive";
        oldest.vx = rand(-160, 160); oldest.vy = 200; oldest.hp = 1;
        run.stats.limpetsShaken++;
        fx.text(oldest.x, oldest.y - 22, "OFF!", "#a3e635", 18, true);
        fx.ring(pl.x, pl.y, 40, "#a3e635", 3, 0.3);
        audio.play("victory");
        lm.wig = 0;
      }
    }
    // A ship that just died is not carrying anything. Without this the riders
    // stay latched to a corpse and reappear on the respawned hull for free.
    if(pl && !pl.alive && on > 0){
      for(let i = 0; i < items.length; i++){
        const e = items[i];
        if(e.alive && e.attached){ e.attached = false; e.behaviour = "dive"; e.vy = 220; }
      }
      pl.maxSpeed = lm.baseSpeed; pl.accel = lm.baseAccel; lm.wig = 0;
    }
    // Nothing may hold the field open: a rider still counts toward the clear,
    // so once the last wave is done they let go rather than stall the mission.
    if(run.phase === "clearing" || run.phase === "gone"){
      for(let i = 0; i < items.length; i++){
        const e = items[i];
        if(e.alive && e.attached){ e.attached = false; e.behaviour = "dive"; e.vy = 220; }
      }
      if(pl){ pl.maxSpeed = lm.baseSpeed; pl.accel = lm.baseAccel; }
    }
  }

  /*
   * THE BRIGHT SIDE. The star underneath flares, and everything low burns -
   * them as readily as you. It is the Storm's clock with one extra beat, and
   * it inherits the Storm's guard verbatim for the reason that guard exists:
   * the weather used to keep running through the victory lap and pin the
   * autopilot to the top of the sky.
   *
   * The WARN beat is the whole fairness of the level. A bright line is drawn
   * at the height the fire will reach, for over a second, doing no damage at
   * all - so being burned is always something you watched coming.
   */
  if(run.flare && !run.ended && run.phase !== "intro" &&
     run.phase !== "lap" && run.phase !== "outro"){
    const fl = run.flare;
    const pl = game.world.player;
    fl.timer -= dt;
    if(fl.mode === "calm"){
      if(fl.timer <= 0){
        fl.mode = "warn"; fl.timer = 1.2;
        fl.top = rand(VH*0.42, VH*0.70);
        fl.hitThisBurn = false;
        audio.play("telegraph");
      }
    } else if(fl.mode === "warn"){
      if(fl.timer <= 0){ fl.mode = "rise"; fl.timer = 0.45; fx.shake(4); }
    } else if(fl.mode === "rise"){
      const k = 1 - Math.max(0, fl.timer)/0.45;
      fl.y = (VH + 60) + (fl.top - (VH + 60)) * (k*k*(3 - 2*k));
      if(fl.timer <= 0){ fl.mode = "burn"; fl.timer = 1.3; fl.y = fl.top; audio.play("gust"); }
    } else if(fl.mode === "burn"){
      if(pl && pl.alive && pl.y > fl.y && !fl.hitThisBurn && pl.invuln <= 0){
        fl.hitThisBurn = true;
        run.stats.flareHits++;
        callbacks.onPlayerHit("flare", null);
      }
      /*
       * Everything alive below the line goes with it - and pays NOTHING.
       * Routed through onEnemyKilled with the no-pay flag so the ledger stays
       * honest and a burned carrier still lets its pilot out.
       */
      const items = game.world.enemies.items;
      const caught = [];
      for(let i = 0; i < items.length; i++){
        const e = items[i];
        if(e.alive && !e.fromBoss && e.y > fl.y) caught.push(e);
      }
      // Killed outside the scan, so the list can't change under the loop.
      for(let i = 0; i < caught.length; i++){
        const e = caught[i];
        fx.spark(e.x, e.y, rand(-40, 40), -rand(120, 220), "#ffd08a", 0.5, 3);
        callbacks.onEnemyKilled(e, null, false, true);
      }
      if(fl.timer <= 0){ fl.mode = "fall"; fl.timer = 0.7; }
    } else if(fl.mode === "fall"){
      const k = 1 - Math.max(0, fl.timer)/0.7;
      fl.y = fl.top + ((VH + 60) - fl.top) * k;
      if(fl.timer <= 0){ fl.mode = "calm"; fl.timer = rand(4, 7); fl.y = VH + 60; }
    }
  }

  /*
   * THE STAMPEDE. The biggest thing on screen is a tool rather than a target.
   *
   * `hazard:true` on the archetype is doing nearly all the work and needs no
   * special cases: it keeps the ox out of the kill ledger, out of Guardian
   * bubbles, out of the hauler-ram loop, and it makes ramming one cost YOU a
   * life while the animal walks on. All four are exactly this level's rule.
   */
  if(run.stampede && !run.ended && run.phase === "waves"){
    const items = game.world.enemies.items;
    let herd = 0;
    for(let i = 0; i < items.length; i++)
      if(items[i].alive && items[i].typeId === "grazer") herd++;

    run.stampede.next -= dt;
    if(herd < 4 && run.stampede.next <= 0){
      game.world.spawnEnemy("grazer", rand(80, VW - 80), -60,
                            { difficulty: run.difficulty });
      run.stampede.next = rand(4, 7);
    }

    /*
     * THE CRUSH. Collected first, killed second - because onEnemyKilled may
     * spawn (splitter shards, a rescue pod) into the very list being walked.
     * The chain-reaction block solved this exact problem already and says so
     * in its own comment; this is the same shape.
     *
     * Routing through onEnemyKilled is also what makes an ox flattening a
     * prison hauler free its pilot: funny AND kind, for free.
     */
    const caught = [];
    for(let i = 0; i < items.length; i++){
      const g = items[i];
      if(!g.alive || g.typeId !== "grazer") continue;
      for(let j = 0; j < items.length; j++){
        const o = items[j];
        if(!o.alive || o === g || o.type.hazard || o.fromBoss) continue;
        const reach = g.r + o.r*0.7;
        if((o.x-g.x)*(o.x-g.x) + (o.y-g.y)*(o.y-g.y) < reach*reach && caught.indexOf(o) < 0)
          caught.push(o);
      }
    }
    for(let i = 0; i < caught.length; i++){
      const o = caught[i];
      run.stats.crushed++;
      fx.text(o.x, o.y - 18, "SQUASH!", "#e7d8c9", 16, true);
      // Paid in full: the ox is a tool the player AIMED, so this is their kill.
      callbacks.onEnemyKilled(o, null, true);
    }
  }

  /*
   * THE LIFELINE. Mission 9 you protect the ship that carries; here you ARE
   * the ship that carries.
   *
   * The drop is deliberately soft, and it is the difference between a rule
   * and a punishment. Take a hit and the crate does not fall to the floor -
   * it pops out and FLOATS where it was, inside a bright ring, for four full
   * seconds before it starts to sink. You lose ground. You never lose the
   * crate, unless you decide to leave it.
   */
  if(run.ferry && !run.ended && run.phase === "waves"){
    const fr = run.ferry;
    const pl = game.world.player;
    const TOP = SF.entityConst.PLAY_TOP;

    // The door drifts, so the run up the screen is never the same twice.
    fr.doorX += fr.doorDir * 40 * dt;
    if(fr.doorX < 90){ fr.doorX = 90; fr.doorDir = 1; }
    if(fr.doorX > VW - 90){ fr.doorX = VW - 90; fr.doorDir = -1; }

    let crate = null;
    const pk = game.world.pickups.items;
    for(let i = 0; i < pk.length; i++)
      if(pk[i].alive && pk[i].kind === "crate"){ crate = pk[i]; break; }

    if(!fr.carried && !crate && fr.left > 0){
      fr.spawnIn -= dt;
      if(fr.spawnIn <= 0){
        const c = game.world.spawnPickup("crate", rand(70, VW - 70), -30);
        c.vy = 60;
        fr.left--;
        fr.spawnIn = 999;   // the next one waits until this one is delivered
        fx.text(VW/2, VH*0.30, "CRATE INBOUND", "#7dd3fc", 20, true);
        audio.play("telegraph");
      }
    }

    if(fr.carried && pl && pl.alive){
      pl.maxSpeed = fr.baseSpeed * 0.86;          // loaded, and it shows
      if(Math.abs(pl.x - fr.doorX) < 62 && pl.y < TOP + 34){
        fr.carried = false;
        fr.delivered++;
        fr.spawnIn = 2.5;
        pl.maxSpeed = fr.baseSpeed;
        run.stats.delivered++;
        game.world.dropCoins(fr.doorX, TOP + 20, 60);
        fx.ring(fr.doorX, TOP + 14, 60, "#7dd3fc", 4, 0.45);
        fx.text(VW/2, VH*0.34, "DELIVERED!", "#7dd3fc", 24, true);
        audio.play("rescue");
        /*
         * The only stop in the campaign that can end because you FINISHED the
         * job. It can never dead-end: miss the crates and the waves simply
         * run out as usual - you clear the level, you just lose the star.
         */
        if(fr.delivered >= (run.mission.ferry || 4) && !fr.done){
          fr.done = true;
          run.bannerText = "ALL FOUR HOME — GO!";
          run.bannerSub = "everything still up here is someone else's problem";
          run.bannerColor = "#7dd3fc";
          run.bannerUntil = simMs + 2600;
          run.phase = "clearing"; run.phaseTimer = 1.2;
        }
      }
    } else if(pl && pl.alive && !fr.carried){
      pl.maxSpeed = fr.baseSpeed;
    }
  }

  if(run.storm && !run.ended && run.phase !== "intro" &&
     run.phase !== "lap" && run.phase !== "outro"){
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
      /*
       * The wind may not blow an enemy somewhere you cannot follow it.
       *
       * The clamp used to be -60..VW+60, and the cull threshold is -80..VW+80 -
       * so a gust could park a ship in the gap between them: fully off-screen,
       * not far enough out to be culled, and unreachable. A hovering type
       * (Turret, Hive, Mender) does not advance on its own, so it sat there
       * holding the field open until the 28-second leash finally carried it
       * off - up to half a minute of a mission you cannot finish or even see.
       *
       * Anything already ON the field is now kept on it. Anything still staging
       * off-edge - a `sides` or `pincer` formation flies in from out there - is
       * left alone, because yanking those inward would break their entrance.
       */
      const es = game.world.enemies.items;
      for(let i = 0; i < es.length; i++){
        const e = es[i];
        if(!e.alive) continue;
        const onField = e.x > -20 && e.x < VW + 20;
        e.x = onField
          ? clamp(e.x + st.dir*st.str*0.5*dt, 16, VW - 16)
          : e.x + st.dir*st.str*0.5*dt;
      }
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
   * THE UNDERTOW. Gravity wells drift through the field and curve every
   * loose thing - your bolts, their bolts, the coins. Nothing else in the
   * game bends a bullet, which is exactly why this level exists: aiming
   * stops being a straight line and starts being a swing. Wells EAT what
   * falls all the way in, so an orbit is never forever.
   */
  if(run.wells && !run.ended && run.phase !== "intro" &&
     run.phase !== "lap" && run.phase !== "outro"){
    const wl = run.wells;
    wl.next -= dt;
    if(wl.next <= 0 && wl.list.length < 3){
      wl.next = rand(7, 11);
      wl.list.push({
        x: rand(VW*0.2, VW*0.8), y: rand(140, 420),
        vx: rand(-14, 14), vy: rand(6, 16),
        r: 15, R: rand(190, 240), G: rand(430, 560),
        life: rand(14, 20), spin: rand(0, Math.PI*2),
      });
      audio.play("telegraph");
    }
    // THE MAW: once, past the midpoint - a well too big to share a sky with.
    if(!wl.maw && run.time >= wl.mawAt){
      wl.maw = { x: -100, y: 300, vx: 52, vy: 0, r: 26, R: 400, G: 980,
                 life: 18, spin: 0, maw: true };
      wl.list.push(wl.maw);
      run.bannerText = "THE MAW";
      run.bannerSub = "nothing flies straight past THAT";
      run.bannerColor = "#2dd4bf";
      run.bannerUntil = simMs + 3000;
      audio.play("alarm");
      fx.shake(10);
    }
    const pullList = (items, eatR) => {
      for(let i = 0; i < items.length; i++){
        const b = items[i];
        if(!b.alive) continue;
        for(let k = 0; k < wl.list.length; k++){
          const w = wl.list[k];
          const dx = w.x - b.x, dy = w.y - b.y;
          const d = Math.hypot(dx, dy);
          if(d > w.R || d < 1) continue;
          if(d < w.r + eatR){          // fell all the way in: the well eats it
            b.alive = false;
            fx.spark(b.x, b.y, dx*2, dy*2, "#7ef0e6", 0.25, 2);
            break;
          }
          const f = w.G * (1 - d/w.R);
          b.vx += dx/d * f * dt;
          b.vy += dy/d * f * dt;
        }
      }
    };
    pullList(game.world.bullets.items, 4);
    pullList(game.world.enemyBullets.items, 4);
    // Coins spiral beautifully; give them drift velocity the pickup update
    // integrates via its own wobble - here we just shove positions gently.
    const pk = game.world.pickups.items;
    for(let i = 0; i < pk.length; i++){
      const c = pk[i];
      if(!c.alive) continue;
      for(let k = 0; k < wl.list.length; k++){
        const w = wl.list[k];
        const dx = w.x - c.x, dy = w.y - c.y;
        const d = Math.hypot(dx, dy);
        if(d > w.R*0.8 || d < w.r + 6) continue;
        const f = w.G * 0.55 * (1 - d/(w.R*0.8));
        c.x += dx/d * f * dt * dt * 12;
        c.y += dy/d * f * dt * dt * 12;
      }
    }
    // The ship feels the pull too - readable, never a trap.
    const pl = game.world.player;
    if(pl && pl.alive){
      for(let k = 0; k < wl.list.length; k++){
        const w = wl.list[k];
        const dx = w.x - pl.x, dy = w.y - pl.y;
        const d = Math.hypot(dx, dy);
        if(d > w.R || d < 1) continue;
        const f = (w.maw ? 130 : 85) * (1 - d/w.R);
        pl.x = clamp(pl.x + dx/d * f * dt, 24, VW - 24);
        pl.y = clamp(pl.y + dy/d * f * dt, 90, SF.entityConst.PLAY_BOTTOM);
      }
    }
    for(let k = wl.list.length - 1; k >= 0; k--){
      const w = wl.list[k];
      w.x += w.vx * dt; w.y += w.vy * dt;
      w.spin += dt * 1.6;
      w.life -= dt;
      if(w.life <= 0 || w.x < -140 || w.x > VW + 140){
        if(w === wl.maw && w.life > 0) continue;
        wl.list.splice(k, 1);
        fx.ring(w.x, w.y, w.R*0.5, "#2dd4bf", 3, 0.5);
      }
    }
  }

  /*
   * THE CHORUS. One metronome; every gun in the sky waits for it. The gate
   * itself lives in entities (beatGate) - this block is the conductor's
   * hands: it counts the beat, opens the release window, pulses the sky,
   * and while an elite conductor lives it snaps EVERY ready gun to the same
   * beat so the volley arrives as a wall with a dodge-window after it.
   */
  if(run.beat && !run.ended && run.phase !== "intro"){
    const bt = run.beat;
    const interval = 60 / 64;                    // 64 bpm: readable, dancing
    bt.window = Math.max(0, bt.window - dt);
    if(simMs >= bt.silenceUntil){
      bt.t += dt;
      if(bt.t >= interval){
        bt.t -= interval;
        bt.count++;
        bt.window = 0.16;
        bt.pulseMs = simMs;
        audio.play(bt.count % 4 === 0 ? "shootHeavy" : "telegraph");
        // A live conductor turns the beat into a full choir: every ready
        // gun releases together.
        let conductor = false;
        const es = game.world.enemies.items;
        for(let i = 0; i < es.length; i++){
          const e = es[i];
          if(e.alive && e.elite && e.type.fire){ conductor = true; break; }
        }
        if(conductor){
          for(let i = 0; i < es.length; i++){
            const e = es[i];
            if(e.alive && e.type.fire && e.y > 10 && e.y < VH - 60)
              e.fireTimer = Math.min(e.fireTimer, 0.02);
          }
        }
      }
    } else {
      bt.t = 0;   // silence resets the bar, so the choir re-enters cleanly
    }
  }

  /*
   * THE FOUNDRY. Parts ride the belts; the assembler at each belt's end
   * turns whatever survives into a live elite, with a fanfare the player
   * learns to dread. The mission's whole question: shoot the fight in
   * front of you, or the future coming down the belt?
   */
  if(run.foundry && !run.ended && run.phase === "waves"){
    const fd = run.foundry;
    fd.next -= dt;
    const es = game.world.enemies.items;
    let parts = 0;
    for(let i = 0; i < es.length; i++)
      if(es[i].alive && es[i].typeId === "part") parts++;
    if(fd.next <= 0 && parts < 5){
      fd.next = rand(4.2, 6.5);
      const belt = fd.belts[randInt(0, fd.belts.length - 1)];
      const e = game.world.spawnEnemy("part",
        belt.dir > 0 ? -28 : VW + 28, belt.y, { difficulty: run.difficulty });
      e.beltDir = belt.dir; e.beltSpeed = belt.speed * rand(0.9, 1.15); e.beltY = belt.y;
      audio.play("telegraph");
    }
    for(let i = 0; i < es.length; i++){
      const e = es[i];
      if(!e.alive || e.typeId !== "part") continue;
      const arrived = (e.beltDir > 0 && e.x > VW - 44) || (e.beltDir < 0 && e.x < 44);
      if(!arrived) continue;
      e.alive = false;
      fd.built++;
      const mouthX = e.beltDir > 0 ? VW - 60 : 60;
      const kind = ["striker", "brute", "interceptor"][fd.built % 3];
      game.world.spawnEnemy(kind, mouthX, -36, { difficulty: run.difficulty, elite: true });
      fx.ring(mouthX, e.beltY, 60, "#fb923c", 5, 0.5);
      fx.text(mouthX, e.beltY - 26, "BUILT!", "#ff5d73", 17, true);
      fx.shake(6);
      audio.play("alarm");
      if(fd.built === 1) SF.comms.say("foundryBuilt");
    }
  }

  /*
   * THE TITHE SERPENT. One creature, alive for most of the level: it chases
   * the nearest loose coin, eats it, and grows a ring for every sixth
   * mouthful. Its tail-most ring is the weak one - pop rings until the tail
   * is gone and the head itself finally opens up. Kill it and every stolen
   * penny comes back; dawdle and it slithers home with the lot.
   */
  if(run.serpent && !run.ended && run.phase !== "intro"){
    const sp = run.serpent;
    if(!sp.head && run.time >= sp.at){
      const head = game.world.spawnEnemy("serpent", VW*0.5, -30, { difficulty: run.difficulty });
      sp.head = head;
      for(let i = 0; i < 6; i++){
        const seg = game.world.spawnEnemy("serpentSeg", VW*0.5, -30 - (i+1)*24,
          { difficulty: run.difficulty });
        seg.headRef = head; seg.segIndex = i;
      }
      sp.grown = 6;
      run.bannerText = "THE TITHE SERPENT";
      run.bannerSub = "it eats coins — hit the glowing ring!";
      run.bannerColor = "#2fbf9a";
      run.bannerUntil = simMs + 3600;
      audio.play("bossWake");
      SF.comms.say("serpentSeen");
    }
    const head = sp.head;
    if(head && head.alive && !head.fleeing){
      // Hunger: the nearest loose coin inside its reach.
      let best = null, bd = 300*300;
      const pk = game.world.pickups.items;
      for(let i = 0; i < pk.length; i++){
        const c = pk[i];
        if(!c.alive || c.kind !== "coin") continue;
        const d = (c.x-head.x)*(c.x-head.x) + (c.y-head.y)*(c.y-head.y);
        if(d < bd){ bd = d; best = c; }
      }
      head.hungry = !!best;
      head.huntX = best ? best.x : null;
      head.huntY = best ? best.y : null;
      // The bite.
      if(best && bd < (head.r + 15)*(head.r + 15)){
        best.alive = false;
        sp.eaten++;
        sp.eatenValue += best.value || 2;
        run.stats.serpentAte = sp.eaten;
        fx.spark(head.x, head.y + 14, 0, 60, "#ffd23f", 0.3, 3);
        audio.play("armourClang");
        // Every sixth coin grows a new ring on the tail.
        const rings = game.world.enemies.items.filter(x => x.alive && x.typeId === "serpentSeg");
        if(sp.eaten % 6 === 0 && rings.length < 14){
          const seg = game.world.spawnEnemy("serpentSeg", head.x, head.y,
            { difficulty: run.difficulty });
          seg.headRef = head;
          seg.segIndex = sp.grown++;
          fx.text(head.x, head.y - 26, "IT GREW!", "#2fbf9a", 16, true);
        }
      }
      // The weak ring is the tail: last alive ring drops its armour and glows.
      const rings = [];
      const es = game.world.enemies.items;
      for(let i = 0; i < es.length; i++)
        if(es[i].alive && es[i].typeId === "serpentSeg") rings.push(es[i]);
      rings.sort((a, b) => a.segIndex - b.segIndex);
      for(let i = 0; i < rings.length; i++){
        const weak = i === rings.length - 1;
        rings[i].weak = weak;
        rings[i].armoured = !weak;
      }
      // No rings left: the head itself is finally soft.
      head.armoured = rings.length > 0;
      if(!rings.length && !sp.tailGoneSaid){
        sp.tailGoneSaid = true;
        run.bannerText = "ITS TAIL IS GONE!";
        run.bannerSub = "the head is soft — finish it!";
        run.bannerColor = "#ffd23f";
        run.bannerUntil = simMs + 2600;
        audio.play("victory");
      }
      // Everything else is dead and the waves are done: it makes for home
      // with the takings unless the player stops it.
      if(run.director.finishedSpawning){
        const others = game.world.countEnemies() - 1 - rings.length;
        if(others <= 0){
          sp.fleeAt = sp.fleeAt || run.time + 9;
          if(run.time >= sp.fleeAt){
            head.fleeing = true;
            run.bannerText = "IT MAKES FOR HOME!";
            run.bannerSub = sp.eatenValue > 0 ? ("with £" + sp.eatenValue + " of yours") : "stop it!";
            run.bannerColor = "#ff5d73";
            run.bannerUntil = simMs + 2600;
            audio.play("alarm");
          }
        }
      }
    }
  }

  // Behind the Sky: the workshop's whole theatre lives in backstage.js.
  if(run.mission.backstage) SF.backstage.update(dt, run, game.world, simMs);
  // Sky 29: the painting, the last stroke and the photo live in sky29.js.
  if(run.mission.sky29) SF.sky29.update(dt, run, game.world, simMs);

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
  /*
   * The Wacky Sky's slot-machine reveal. The banner lists the whole roll, but
   * a list is a sentence, and a seven-year-old reads a POP: each modifier
   * name bursts up in its own colour, one per beat, under the banner.
   */
  if(run.modReveal && run.modReveal.queue.length && !run.ended){
    run.modReveal.t -= dt;
    if(run.modReveal.t <= 0){
      const m = run.modReveal.queue.shift();
      run.modReveal.t = 0.9;
      fx.text(VW/2, VH*0.60, m.name + "!", m.color, 30, true);
      fx.firework(VW/2 + rand(-60, 60), VH*0.56, m.color);
      audio.play("uiBuy");
    }
  }

  // SLEEPY ENEMIES snore. The 0.35x speed is the mechanic; the drifting
  // "z z z" is what makes a kid SEE it instead of wondering why the sky is
  // quiet. One snorer every beat and a half, picked at random.
  if(run.mods.sleepy && !run.ended){
    run.zzzTimer = (run.zzzTimer == null ? 1.2 : run.zzzTimer) - dt;
    if(run.zzzTimer <= 0){
      run.zzzTimer = 1.6;
      const alive = game.world.enemies.items.filter(e => e.alive && e.y > 0 && e.y < VH*0.7);
      if(alive.length){
        const e = alive[Math.floor(rand(0, alive.length))];
        fx.text(e.x + e.size*0.3, e.y - e.size*0.4, "z z z", "#9bb0ff", 15, true);
      }
    }
  }

  // DOUBLE COINS doesn't just double the ledger - it visibly RAINS money.
  // The doubled payScale was invisible ("I can barely tell the difference"),
  // and an economy modifier a kid can't see isn't a party trick, it's
  // accounting. A little shower of free coins every few seconds is the party.
  if(run.mods.gold && run.phase !== "intro" && !run.ended){
    run.goldRainTimer = (run.goldRainTimer == null ? 2.5 : run.goldRainTimer) - dt;
    if(run.goldRainTimer <= 0){
      run.goldRainTimer = rand(4.5, 7);
      const n = randInt(3, 4);
      for(let i = 0; i < n; i++){
        const c = game.world.spawnPickup("coin", rand(40, VW - 40), rand(-60, -15),
                                         { value: randInt(6, 12) });
        c.vx = rand(-35, 35);
      }
    }
  }

  // PAPA RAIN: the Wacky Sky's best joke, stolen from the Star Vault. A Papa
  // head drifts in every several seconds - worth money, a boing, and a line
  // of French. The cadence is a drip, not a downpour: each one should be an
  // event a kid points at, and the vault's blast stays the only flood.
  if(run.mods.papaRain && run.phase !== "intro" && !run.ended){
    run.papaRainTimer = (run.papaRainTimer == null ? 3 : run.papaRainTimer) - dt;
    if(run.papaRainTimer <= 0){
      run.papaRainTimer = rand(6, 11);
      const hd = game.world.spawnPickup("papahead", rand(40, VW - 40), -30);
      hd.vx = rand(-50, 50);
    }
  }

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
  // Last thing in the tick, so the tape holds the world as it was left -
  // including the frame the killing blow lands on.
  SF.rewind.record(dt, game.world);

  const stats = run.stats;
  // Clamped: a ratio is a share of the sky, and a share above 1 is a bug
  // report, not a score. Belt and braces behind the accounting fixes above.
  stats.killRatio = stats.spawned
    ? clamp(stats.kills / Math.max(stats.spawned, run.director.totalPlanned), 0, 1) : 0;

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
      run.bannerUntil = simMs + 4200;
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
      run.bannerUntil = simMs + 2400;
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
  } else if(item.kind === "crate"){
    // Picked up, not consumed: it rides under the hull until it is delivered.
    if(run.ferry && !run.ferry.carried){
      run.ferry.carried = true;
      audio.play("supplyGet");
      fx.ring(item.x, item.y, 34, "#7dd3fc", 3, 0.3);
      fx.text(item.x, item.y - 20, "LOADED", "#7dd3fc", 17, true);
    }
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
    const now = simMs;
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
  SF.backstage.drawSky(ctx, timeMs, VW, VH);         // the blueprint under everything
  SF.sky29.drawSky(ctx, timeMs, VW, VH);             // the pencil veil, until it's painted
  /*
   * The rewind owns the whole frame while it runs: the live world is over,
   * and drawing it under the replay would show two contradictory skies.
   * No HUD and no radio either - this is a replay, not a moment of play.
   */
  if(SF.rewind.active() && SF.rewind.draw(ctx, timeMs, VW, VH)){ ctx.restore(); return; }
  SF.render.drawHaulers(ctx, world, timeMs);         // under the traffic they're crossing
  if(game.run) SF.render.drawAct4(ctx, game.run, world, timeMs);   // wells, belts, spine, beat
  SF.render.drawPickups(ctx, world, timeMs);
  SF.render.drawEnemies(ctx, world, timeMs);
  SF.render.drawBoss(ctx, world.boss, timeMs);
  SF.backstage.drawActors(ctx, timeMs);              // the mirror, the brush, the letters
  SF.render.drawArena(ctx, world.boss, timeMs);      // the Devourer's screen-wide attacks
  SF.render.drawFleet(ctx, timeMs);                  // the rescued pilots, phase five
  SF.render.drawBullets(ctx, world);
  /*
   * THE GLASS SEA: your reflection, drawn UNDER you so it never competes with
   * the ship a child is actually steering. It is a picture of a gun and
   * nothing else - no collision, no health, no hitbox - so it costs one extra
   * drawPlayer call with a mirrored transform and not one line anywhere else.
   *
   * THE RING: the same trick for a different reason. Within 70px of a seam a
   * half-alpha copy pokes in from the far side, so a child SEES himself
   * already arriving over there before he commits to flying off the edge.
   */
  if(world.mirror && world.player.alive){
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.translate(VW, 0); ctx.scale(-1, 1);
    SF.render.drawPlayer(ctx, world.player, timeMs);
    ctx.restore();
  }
  if(world.wrap && world.player.alive){
    const p = world.player;
    const near = p.x < 70 ? VW : (p.x > VW - 70 ? -VW : 0);
    if(near){
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(near, 0);
      SF.render.drawPlayer(ctx, p, timeMs);
      ctx.restore();
    }
  }
  SF.render.drawPlayer(ctx, world.player, timeMs);
  /*
   * SHAKE THEM OFF: a pair of pulsing chevrons flank the ship while anything
   * is riding it. The prompt IS the tutorial - a child who has not read a
   * word of the briefing still sees "go this way, then that way".
   *
   * The riders themselves need no drawing here. They ride at p.r + 10 from
   * the centre, which is outside the hull, so drawEnemies has already put
   * them where they can be seen.
   */
  if(game.run && game.run.limpets && world.player.alive){
    const items = world.enemies.items;
    let on = 0;
    for(let i = 0; i < items.length; i++)
      if(items[i].alive && items[i].attached) on++;
    if(on > 0){
      const p = world.player, puls = 0.45 + Math.sin(timeMs/90)*0.35;
      ctx.save();
      ctx.globalAlpha = puls; ctx.fillStyle = "#a3e635";
      [-1, 1].forEach(s => {
        const x = p.x + s*46;
        ctx.beginPath();
        ctx.moveTo(x + s*12, p.y); ctx.lineTo(x, p.y - 11); ctx.lineTo(x, p.y + 11);
        ctx.closePath(); ctx.fill();
      });
      ctx.restore();
    }
  }
  fx.drawParticles(ctx);
  SF.render.drawForeground(ctx);
  // The Searchlight: the world above is finished, now the dark eats all of it
  // except what glows. HUD and texts draw after - instruments still work.
  if(game.run && game.run.mission.blackout && !game.run.ended)
    SF.render.drawBlackout(ctx, world, timeMs, game.run.mission.blackout === "soft");
  // DISCO SKY: over the world, under the HUD - it recolours the sky and never
  // hides a bullet.
  if(game.run && game.run.mods.disco && !game.run.ended)
    SF.render.drawDisco(ctx, timeMs);
  fx.drawTexts(ctx);
  // The arrival is a cutscene: no HUD, no radio, no buttons over it.
  const cinema = game.run &&
    (game.run.phase === "finaleIntro" || game.run.phase === "bossIntro");
  if(game.run && !cinema){ SF.backstage.drawOver(ctx, timeMs); SF.sky29.drawOver(ctx, timeMs); SF.render.drawHud(ctx, game); SF.render.drawComms(ctx); }
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
    // Advances through the death sequence as well as play: fx's own hit-stop
    // deadline rides this clock, and freezing it there would strand one.
    simMs += dt * 1000;
    if(SF.input.consumePause() && game.state === "playing" && SF.ui) SF.ui.togglePause();
    if(SF.input.consumeBomb()) useBomb();
    if(SF.input.consumeOverdrive()) useOverdrive();
    if(game.state === "playing") update(dt, simMs);
    else {
      // fx keeps ticking through the rewind or the screen would hold the
      // death's shake as a permanent offset, and the sky would stop drifting.
      if(SF.rewind.active()) SF.rewind.update(dt);
      fx.update(dt, simMs);
      SF.render.updateBackground(dt);
    }
    draw(simMs);
    if(SF.ui) SF.ui.syncAbilityButtons();
  } else if(game.state === "paused"){
    // simMs deliberately does NOT advance here. This is the whole fix.
    /*
     * The input latches must still be DRAINED while paused, or they queue.
     * They did: `pausePressed` was only ever consumed in the playing branch,
     * so pressing P a second time did nothing at all (the keyboard could not
     * un-pause), and the latched press was then spent on the very next frame
     * after clicking RESUME - which paused the game again, instantly, and read
     * as the game being broken. Anything pressed while paused - space, B, V -
     * came out the same way: a bomb burnt the moment play resumed.
     *
     * So: P un-pauses, and the ability keys are swallowed rather than banked.
     */
    if(SF.input.consumePause() && SF.ui) SF.ui.togglePause();
    SF.input.consumeBomb();
    SF.input.consumeOverdrive();
    fx.update(0, simMs);
    draw(simMs);
  }
}

function start(){
  requestAnimationFrame(frame);
}

// Backstage's contact hazards (the mirror's hull, the eraser, a landed
// letter) hurt through the same one door every enemy bullet uses.
game.hurtPlayer = source => callbacks.onPlayerHit(source, null);

SF.game = game;
Object.assign(game, {
  attach, resize, start, startMission, endMission, useBomb, useOverdrive,
  // The mission clock, for the UI and the renderer: both read deadlines that
  // are set in here, and all three have to agree about what time it is.
  now: () => simMs,
  buildLoadout, squadronDue, callbacks,
});
})();
