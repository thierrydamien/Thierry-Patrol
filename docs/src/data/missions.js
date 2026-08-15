/*
 * The campaign: mission definitions, their wave scripts, star objectives, and
 * the boss encounters.
 *
 * A mission is a timeline of waves (`t` = seconds from mission start) plus an
 * optional boss that arrives once the last wave is cleared. Everything is
 * data - the level manager reads this and needs no per-mission code - so a new
 * level is an entry in MISSIONS, not a new branch in the game loop.
 *
 * Difficulty curve: missions 1-3 teach one idea each (fly and shoot, then
 * weaving targets, then enemies that shoot back), 4 pays that off with the
 * first boss, 5-7 layer in kamikazes, rescues and elites, and 8 combines
 * everything behind a three-phase boss.
 */
(function(){
"use strict";
const SF = window.SF;

/* ---------------------------------------------------------
   STAR OBJECTIVES
   `test` receives the run's live stats, so the HUD can show
   progress on the same definition the results screen scores.
   --------------------------------------------------------- */
const OBJECTIVES = {
  complete:  { label:"Complete the mission", icon:"🏁",
               test: s => s.completed,
               progress: s => s.completed ? "done" : "" },
  kill80:    { label:"Destroy 80% of enemies", icon:"💥",
               test: s => s.killRatio >= 0.8,
               progress: s => Math.round(s.killRatio*100) + "%" },
  killAll:   { label:"Destroy every enemy", icon:"☄️",
               test: s => s.spawned > 0 && s.kills >= s.spawned && s.escaped === 0,
               progress: s => s.kills + "/" + s.spawned },
  rescueAll: { label:"Rescue every stranded pilot", icon:"🧑‍🚀",
               test: s => s.rescuesTotal > 0 && s.rescues >= s.rescuesTotal,
               progress: s => s.rescues + "/" + s.rescuesTotal },
  noDamage:  { label:"Take no damage at all", icon:"🧿",
               test: s => s.damageTaken === 0,
               progress: s => s.damageTaken === 0 ? "clean" : "hit" },
  coinRush:  { label:"Grab 60 coins", icon:"🪙",
               test: s => s.coins >= 60,
               progress: s => (s.coins || 0) + "/60" },
  /*
   * FOUR STARS THAT ASK FOR THE LEVEL'S OWN LESSON.
   *
   * Fifteen of the thirty-five stops used to carry the identical trio -
   * finish it, kill 80%, free everyone - including the first six in a row.
   * A star list that never changes is a star list nobody reads, and the
   * briefs were already promising something better: "the ringed one pays
   * five times", "the closer you cut it the more they pay", "the gold
   * glowing ones are elites", "shoot the guns off its arms". Every one of
   * those was a thing the game already counted and never scored.
   *
   * The thresholds are set against the smallest fleet each level can field
   * (measured on ROOKIE, the thinnest tier): 16 ringed ships, 61 divers and
   * 11 elites, so none of these can become unwinnable on an easy tier.
   */
  wanted:    { label:"Bag 10 WANTED ships", icon:"🎯",
               test: s => (s.bounties || 0) >= 10,
               progress: s => (s.bounties || 0) + "/10" },
  nearMiss:  { label:"Cut 20 near misses", icon:"💨",
               test: s => (s.grazes || 0) >= 20,
               progress: s => (s.grazes || 0) + "/20" },
  /*
   * The Anchor's own star, and it deliberately pays for the OTHER answer.
   * A cable has two solutions - fly round it, or shoot an end and cut it -
   * and flying round is the one a child finds without being told. Six is a
   * quarter of the ropes the level flies at its thinnest tier, so it is a
   * nudge toward trying the second answer rather than a demand for it.
   */
  /*
   * One star each for the three newest rules, and each pays for the thing the
   * level is actually teaching rather than for clearing the sky. A generic
   * trio on a level with a rule of its own is a wasted third star - see the
   * ratchet in the smoke test, which is what caught these.
   */
  unseen:    { label:"Destroy 15 unseen", icon:"🫥",
               test: s => (s.darkKills || 0) >= 15,
               progress: s => (s.darkKills || 0) + "/15" },
  squeeze:   { label:"Destroy 10 in the squeeze", icon:"🪨",
               test: s => (s.tightKills || 0) >= 10,
               progress: s => (s.tightKills || 0) + "/10" },
  afterDark: { label:"Destroy 20 after dark", icon:"🌑",
               test: s => (s.lateKills || 0) >= 20,
               progress: s => (s.lateKills || 0) + "/20" },
  ropes:     { label:"Cut 6 ropes", icon:"✂️",
               test: s => (s.ropesCut || 0) >= 6,
               progress: s => (s.ropesCut || 0) + "/6" },
  eliteHunt: { label:"Destroy 8 elites", icon:"🌟",
               test: s => (s.elitesKilled || 0) >= 8,
               progress: s => (s.elitesKilled || 0) + "/8" },
  /*
   * Only worth fitting on a boss that is NOT armoured. An armoured hull is
   * sealed until every plate is off (see bosses.damage), so on the Sentinel
   * or the Leviathan this star would light itself the moment you won.
   */
  stripBoss: { label:"Shoot off every weak point", icon:"🔩",
               test: s => s.partsTotal > 0 && s.partsOff >= s.partsTotal,
               progress: s => (s.partsOff || 0) + "/" + (s.partsTotal || "?") },
  keepLives: { label:"Don't lose a single life", icon:"❤️",
               test: s => s.livesLost === 0,
               progress: s => s.livesLost === 0 ? "clean" : (s.livesLost + " lost") },
  convoy:    { label:"Bring the hauler home", icon:"🛡️",
               test: s => s.convoyTotal > 0 && s.convoyLost === 0,
               progress: s => s.convoyLost ? "lost" : "safe" },
  delivered: { label:"Deliver all 4 crates", icon:"🧰",
               test: s => (s.delivered || 0) >= 4,
               progress: s => (s.delivered || 0) + "/4" },
  roundTheBack: { label:"Go round the back 6 times", icon:"🔄",
               test: s => (s.wraps || 0) >= 6,
               progress: s => (s.wraps || 0) + "/6" },
  shakenOff: { label:"Shake off 10 limpets", icon:"🫧",
               test: s => (s.limpetsShaken || 0) >= 10,
               progress: s => (s.limpetsShaken || 0) + "/10" },
  unburned:  { label:"Never get caught by the flare", icon:"🔥",
               test: s => (s.flareHits || 0) === 0,
               progress: s => s.flareHits ? "burned" : "clean" },
  roundUp:   { label:"Flatten 15 ships with the herd", icon:"🐂",
               test: s => (s.crushed || 0) >= 15,
               progress: s => (s.crushed || 0) + "/15" },
  twin20:    { label:"Let your reflection get 100 kills", icon:"🪞",
               test: s => (s.mirrorKills || 0) >= 100,
               progress: s => (s.mirrorKills || 0) + "/100" },
  /* --- Act 4 --- */
  denyParts: { label:"Stop 10 parts on the belts", icon:"🛠",
               test: s => (s.partsDenied || 0) >= 10,
               progress: s => (s.partsDenied || 0) + "/10" },
  serpent:   { label:"Slay the Tithe Serpent", icon:"🐍",
               test: s => !!s.serpentSlain,
               progress: s => s.serpentSlain ? "done" : (s.serpentAte === 1 ? "1 coin eaten" : s.serpentAte ? s.serpentAte + " coins eaten" : "") },
  paintSix:  { label:"Paint 6 sketches to your side", icon:"🖌",
               test: s => (s.painted || 0) >= 6,
               progress: s => (s.painted || 0) + "/6" },
};

/* ---------------------------------------------------------
   BOSSES
   Phases trigger at health fractions. Each phase has its own
   move speed, attack list and timing, and every attack is
   telegraphed before it fires so a boss is readable, not
   random. Weak points are separate hitboxes: blow them off and
   the attack they power is disabled for the rest of the fight.
   --------------------------------------------------------- */
const BOSSES = {
  /*
   * The Star Vault's secret boss, and the one entry here whose job is a
   * LAUGH. `photo:true` makes the renderer draw him as a giant photographed
   * head on a little gold rocket (assets/papa.png, dropped in by the family -
   * never committed by anyone else). No weak points, no armour: he is a
   * pinata, and the fight is the joke.
   */
  papa: {
    name: "KING PAPA", epithet: "the greatest dad in the galaxy",
    hp: 500, fightSeconds: 22, size: 210, tint: "#ffd23f", entryY: 178,
    photo: true,
    weakPoints: [],
    phases: [
      { at:1.00, speed: 90, telegraph:0.60, gap:[1.2,1.8], attacks:["spreadVolley"] },
      { at:0.55, speed:130, telegraph:0.50, gap:[0.9,1.4], attacks:["spreadVolley","ringBurst"] },
      { at:0.22, speed:170, telegraph:0.40, gap:[0.7,1.1], attacks:["ringBurst","aimedBurst"], enrage:true },
    ],
  },
  marauder: {
    name: "THE MARAUDER", epithet: "first of the raiders",
    hp: 380, fightSeconds: 26, size: 132, tint: "#ff2d55", entryY: 150,
    weakPoints: [
      { id:"leftGun",  x:-62, y:-4, r:18, hp:70, disables:"spreadVolley" },
      { id:"rightGun", x: 62, y:-4, r:18, hp:70, disables:"chargeRam" },
    ],
    phases: [
      { at:1.00, speed: 70, telegraph:0.60, gap:[1.5,2.1], attacks:["spreadVolley","chargeRam","aimedBurst"] },
      { at:0.50, speed:110, telegraph:0.50, gap:[1.0,1.5], attacks:["chargeRam","aimedBurst","callMinions"] },
      { at:0.20, speed:145, telegraph:0.38, gap:[0.7,1.1], attacks:["chargeRam","ringBurst","aimedBurst"], enrage:true },
    ],
  },
  sentinel: {
    name: "SKY SENTINEL", epithet: "their flagship",
    hp: 820, fightSeconds: 33, size: 150, tint: "#a855f7", entryY: 158,
    armoured: true,
    weakPoints: [
      { id:"core",     x:  0, y:-30, r:20, hp:150, disables:"sweepBeam" },
      { id:"leftPod",  x:-68, y: 20, r:17, hp:95, disables:"ringBurst" },
      { id:"rightPod", x: 68, y: 20, r:17, hp:95, disables:"callMinions" },
    ],
    phases: [
      { at:1.00, speed: 80, telegraph:0.55, gap:[1.4,1.9], attacks:["spreadVolley","sweepBeam"] },
      { at:0.66, speed:120, telegraph:0.45, gap:[1.0,1.4], attacks:["ringBurst","aimedBurst","callMinions"] },
      { at:0.33, speed:165, telegraph:0.32, gap:[0.6,1.0], attacks:["ringBurst","sweepBeam","aimedBurst"], enrage:true },
    ],
  },
  /*
   * Prison Break's warden-of-cells. Its whole idea is the tractor beam: the
   * one attack in the game that grabs your SHIP instead of shooting at it -
   * fighting the pull is a new input feel, and the danger is being dragged
   * into the hull. The cells are the weak points, and blowing one open frees
   * a pilot mid-fight (rescuePods) - the boss IS the rescue mission.
   */
  jailer: {
    name: "THE JAILER", epithet: "keeper of the cells",
    hp: 560, fightSeconds: 25, size: 140, tint: "#4ade80", entryY: 152,
    armoured: true,
    rescuePods: true,
    weakPoints: [
      { id:"leftCell",  x:-58, y: 52, r:20, hp:95, disables:"callMinions" },
      { id:"rightCell", x: 58, y: 52, r:20, hp:95, disables:"tractorPull" },
    ],
    phases: [
      { at:1.00, speed: 75, telegraph:0.60, gap:[1.5,2.0], attacks:["tractorPull","spreadVolley"] },
      { at:0.55, speed:112, telegraph:0.50, gap:[1.1,1.6], attacks:["tractorPull","aimedBurst","callMinions"] },
      { at:0.22, speed:150, telegraph:0.38, gap:[0.8,1.2], attacks:["tractorPull","ringBurst","aimedBurst"], enrage:true },
    ],
  },
  /*
   * Act 2's mid-boss. Its whole idea is the arena shrinking: it seeds mines
   * rather than shooting at you, so the longer you take the less room you have.
   * Blow the two hatches off early and it can't do that any more - the fight
   * you get is the one you earn.
   */
  warden: {
    name: "THE WARDEN", epithet: "keeper of the minefields",
    hp: 1150, fightSeconds: 50, size: 158, tint: "#22d3ee", entryY: 152,
    weakPoints: [
      { id:"leftHatch",  x:-58, y: 14, r:18, hp:130, disables:"mineField" },
      { id:"rightHatch", x: 58, y: 14, r:18, hp:130, disables:"mineField" },
      { id:"spine",      x:  0, y:-46, r:21, hp:180, disables:"spiralArms" },
    ],
    phases: [
      { at:1.00, speed: 85, telegraph:0.55, gap:[1.3,1.8], attacks:["mineField","aimedBurst","spreadVolley"] },
      { at:0.60, speed:125, telegraph:0.44, gap:[1.0,1.4], attacks:["spiralArms","mineField","sweepBeam"] },
      { at:0.28, speed:170, telegraph:0.32, gap:[0.6,1.0], attacks:["spiralArms","ringBurst","aimedBurst"], enrage:true },
    ],
  },
  /*
   * Cold Approach's ghost. Between actions it fades to a shimmer - "where is
   * it?" is the fight's question - and its signature is the blink: vanish,
   * reappear over YOUR column marked by a white ring, arrive shooting. Kill
   * the core and it can't jump any more.
   */
  phantom: {
    name: "THE PHANTOM", epithet: "the one you can't see",
    hp: 1300, fightSeconds: 54, size: 150, tint: "#9aa5ff", entryY: 158,
    cloak: true,
    weakPoints: [
      { id:"core",      x:  0, y:-6, r:20, hp:160, disables:"blink" },
      { id:"leftLens",  x:-50, y:14, r:17, hp:110, disables:"ringBurst" },
      { id:"rightLens", x: 50, y:14, r:17, hp:110, disables:"sweepBeam" },
    ],
    phases: [
      { at:1.00, speed: 82, telegraph:0.55, gap:[1.4,1.9], attacks:["blink","aimedBurst","spreadVolley"] },
      { at:0.60, speed:120, telegraph:0.45, gap:[1.0,1.4], attacks:["blink","ringBurst","sweepBeam","aimedBurst"] },
      { at:0.25, speed:165, telegraph:0.32, gap:[0.65,1.0], attacks:["blink","spiralArms","aimedBurst"], enrage:true },
    ],
  },
  /*
   * ===================== THE DEVOURER =====================
   * The grand finale. Everything about it is deliberately one size larger
   * than the game has ever gone: twice the Leviathan's bulk, five phases,
   * a scripted cinematic arrival, attacks that use the WHOLE screen, and a
   * death that takes eight seconds to finish.
   *
   * The design rule that keeps it fair for a seven-year-old: every attack
   * paints where it will land BEFORE it lands, and each phase asks one clear
   * question -
   *   1 AWAKENING   "which columns are lit?"      (step out of the lanes)
   *   2 THE ARMS    "where is the claw sweeping?" (get above/below it)
   *   3 CORE        "where is the gap?"           (walk the spiral)
   *   4 STAR EATER  "which half is safe?"         (pick a side, commit)
   *   5 LAST LIGHT  "all of it - but you're not alone"
   * Phase five is the payoff: every pilot this squadron ever pulled out of
   * the dark flies in to help (see finale.js).
   */
  /*
   * THE FORGERY - the Act 4 finale, and the only boss that isn't one of
   * THEM. It is the workshop itself playing the game back: a titan welded
   * out of every hull the campaign has beaten, and that is only its first
   * act (see backstage.js for what crawls out of the wreck). This def
   * covers the welded-titan phase; the standard controller runs it with a
   * remix pool drawn from every earlier fight.
   */
  forgery: {
    name: "THE FORGERY", epithet: "it plays your game back at you",
    forge: true,
    hp: 2400, fightSeconds: 55, size: 300, tint: "#e8c14a", entryY: 190,
    armoured: true,
    weakPoints: [
      // Three welds hold the stolen hulls together. Each one silences a
      // stolen attack - the fight is an un-welding.
      { id:"leftWeld",  x:-86, y: 10, r:22, hp:200, disables:"clawSweep" },
      { id:"rightWeld", x: 86, y: 10, r:22, hp:200, disables:"sweepBeam" },
      { id:"coreWeld",  x:  0, y:-38, r:24, hp:260, disables:"callMinions" },
    ],
    phases: [
      { at:1.00, speed: 70, telegraph:0.65, gap:[1.6,2.2],
        attacks:["spreadVolley","chargeRam","ringBurst"] },
      { at:0.72, speed:100, telegraph:0.55, gap:[1.2,1.7],
        attacks:["sweepBeam","tractorPull","mineField","aimedBurst"] },
      { at:0.44, speed:132, telegraph:0.45, gap:[1.0,1.4],
        attacks:["clawSweep","spiralArms","callMinions","blink"] },
      { at:0.18, speed:170, telegraph:0.36, gap:[0.8,1.1],
        attacks:["ringBurst","sweepBeam","spiralArms","aimedBurst"], enrage:true },
    ],
  },
  devourer: {
    name: "THE DEVOURER", epithet: "it ate their star. ours is next.",
    finale: true,
    hp: 4200, fightSeconds: 58, size: 360, tint: "#ff3d5a", entryY: 196,
    armoured: true,
    weakPoints: [
      // Four armour plates seal the core. Blow them off to open the fight up -
      // and each one takes an attack with it.
      { id:"plateNW", x:-96, y:-26, r:26, hp:230, disables:"laneBeams" },
      { id:"plateNE", x: 96, y:-26, r:26, hp:230, disables:"hangarLaunch" },
      { id:"plateSW", x:-72, y: 62, r:24, hp:200, disables:"clawSweep" },
      { id:"plateSE", x: 72, y: 62, r:24, hp:200, disables:"starLance" },
      { id:"core",    x:  0, y:  6, r:34, hp:420, disables:"novaSafeZone" },
    ],
    phases: [
      { at:1.00, speed: 44, telegraph:0.75, gap:[1.9,2.5],
        attacks:["laneBeams","spreadVolley"] },
      { at:0.76, speed: 70, telegraph:0.65, gap:[1.5,2.1],
        attacks:["clawSweep","hangarLaunch","aimedBurst"] },
      { at:0.52, speed: 96, telegraph:0.55, gap:[1.2,1.7],
        attacks:["novaSafeZone","spiralArms","ringBurst"] },
      { at:0.30, speed:120, telegraph:0.60, gap:[1.1,1.6],
        attacks:["starLance","laneBeams","mineField"] },
      { at:0.13, speed:150, telegraph:0.45, gap:[0.9,1.3],
        attacks:["novaSafeZone","spiralArms","clawSweep","aimedBurst","starLance"],
        enrage:true, lastLight:true },
    ],
  },
  /*
   * The old finale, and the only four-phase fight before the Devourer. Each
   * phase takes something else away from you: room, then cover, then time.
   * Four weak points means a well-aimed run can strip it down to almost
   * nothing, which is the reward for having learned every earlier boss.
   */
  leviathan: {
    name: "THE LEVIATHAN", epithet: "the last thing between you and home",
    hp: 1700, fightSeconds: 50, size: 250, tint: "#f97316", entryY: 190,
    armoured: true,
    weakPoints: [
      /*
       * These are offsets into the drawn hull, and they were off-register
       * with it - the target rings sat up and out from the panels they mark,
       * which on an armoured fight is the whole mechanic. Data only; the
       * alternative (rescaling bossart) would shrink the largest hull in the
       * game by a third.
       */
      { id:"core",      x:  0, y:-26, r:24, hp:220, disables:"sweepBeam" },
      { id:"leftPod",   x:-88, y: 20, r:20, hp:150, disables:"spiralArms" },
      { id:"rightPod",  x: 88, y: 20, r:20, hp:150, disables:"ringBurst" },
      { id:"hatch",     x:  0, y: 62, r:21, hp:165, disables:"callMinions" },
    ],
    phases: [
      { at:1.00, speed: 88, telegraph:0.55, gap:[1.3,1.8], attacks:["spreadVolley","aimedBurst","sweepBeam"] },
      { at:0.75, speed:120, telegraph:0.46, gap:[1.0,1.4], attacks:["spiralArms","callMinions","spreadVolley"] },
      { at:0.45, speed:158, telegraph:0.36, gap:[0.8,1.1], attacks:["ringBurst","mineField","sweepBeam","aimedBurst"] },
      { at:0.18, speed:200, telegraph:0.28, gap:[0.5,0.85],
        attacks:["spiralArms","ringBurst","aimedBurst","sweepBeam"], enrage:true },
    ],
  },
};

/* ---------------------------------------------------------
   MISSIONS
   w(t, type, n, form, opts) is shorthand for one wave.
   --------------------------------------------------------- */
function w(t, type, n, form, opts){
  return Object.assign({ t, type, n, form: form || "line" }, opts || {});
}

const MISSIONS = [
  {
    id:1, name:"First Patrol", subtitle:"Learn the ropes",
    brief:"Fly with your finger or the arrow keys. Your guns shoot all by themselves - and the squadron is flying this one with you.",
    goal:"Fly with your finger. Shoot!",
    // Nobody's first ninety seconds are flown alone: two escort drones on the
    // house, flown by whoever else is on the device. It also shows a kid what
    // a Wingman Drone does long before they are asked to buy one.
    lentDrones:2,
    /*
     * The most important ninety seconds in the game: if a seven-year-old
     * doesn't love THIS, there is no mission two. The first version was
     * twelve waves of nothing but grunts and a "take no damage" star, so a
     * child's first flight was repetitive AND ended by telling them they
     * had failed. Both fixed:
     *
     *  - Something HAPPENS every twenty seconds. The first prison hauler
     *    arrives at 0:22, not 0:47, so the thing the whole game is about -
     *    flying into a drifting person and hearing "PILOT RESCUED" - lands
     *    inside the first half-minute.
     *  - Three haulers, so a missed one is not a failed run.
     *  - Every star is something you EARN by doing, not something you lose
     *    by being touched. `noDamage` moved out to mission 3, where being
     *    shot at is the lesson.
     */
    waves: [
      // Easy first kills, immediately - the guns fire themselves, so this is
      // "point the ship and things explode" within two seconds.
      w(1,   "grunt", 5, "line"),
      w(8,   "grunt", 6, "vee"),
      w(15,  "grunt", 6, "arc"),
      // The first rescue. The heart of the game, in the first half-minute.
      w(22,  "carrier", 1, "column"),
      w(28,  "grunt", 6, "twinColumns"),
      w(36,  "grunt", 8, "tripleColumns"),
      w(44,  "carrier", 1, "column"),
      w(50,  "grunt", 8, "wall"),
      w(58,  "grunt", 8, "pincer"),
      w(66,  "grunt", 9, "scatter"),
      w(74,  "carrier", 1, "column"),
      // Finale: the biggest crowd yet, and still only grunts, so it reads as
      // "look how good I've got" rather than "this got hard".
      w(80,  "grunt", 10, "vee"),
      w(88,  "grunt", 12, "wall"),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    id:2, name:"Weaving Through", subtitle:"Moving targets",
    brief:"These ones slide left and right. Shoot where they are going, not where they are - and every wave has one WANTED ship in a gold ring that pays five times as much.",
    goal:"Ringed one pays x5 — hunt it down!",
    // The lesson is picking one moving ship out of a crowd and leading it, so
    // the level pays for exactly that instead of for clearing the sky.
    bounty:true,
    waves: [
      w(1,   "grunt",  6, "line"),
      w(8,   "weaver", 5, "arc"),
      w(15,  "weaver", 6, "tripleColumns"),
      w(23,  "grunt",  8, "vee"),
      w(31,  "weaver", 7, "twinColumns"),
      w(39,  "grunt",  9, "wall"),
      w(47,  "carrier",1, "column"),        // first rescue
      w(52,  "weaver", 7, "arc"),
      w(58,  "thief",  1, "column"),        // first thief: your coins are a target now
      w(60,  "grunt",  9, "pincer"),
      w(68,  "weaver", 8, "line"),
      w(76,  "grunt", 10, "scatter"),
      w(85,  "carrier",1, "column"),
      w(90,  "weaver", 9, "tripleColumns"),
      w(98,  "grunt", 11, "wall"),
      w(106, "weaver",10, "pincer"),
    ],
    objectives: ["complete","wanted","rescueAll"],
  },
  /*
   * THE ANCHOR.
   *
   * The third stop, and the first level that is about where you are NOT.
   *
   * Missions 1 and 2 are both "put the ship under the thing and it dies" - the
   * guns fire themselves, so up to here the whole game has been a reading
   * exercise in points. This one puts LINES in the sky. Pairs fly out joined by
   * a cable that costs a life to touch, and suddenly the enemies are not a list
   * of targets, they are the posts holding up a fence: what a child has to read
   * is the GAP. It is the last idea the campaign can teach before mission 4
   * starts shooting back, and every dodging level after it is downstream of
   * this one.
   *
   * The teaching order inside the level is the level:
   *  - `line` first, and only ever four ships. Two short fences side by side,
   *    slow, with the whole width of the field either side of them. You can
   *    fly round without ever understanding what happened, which is the point:
   *    nobody is punished for not having read the manual yet.
   *  - Then `twinColumns`, which is the same flag and a completely different
   *    problem - the pair spawns on OPPOSITE edges, so the cable is a wire
   *    across the entire field and round is not available. That is the moment
   *    the mechanic is actually taught, and it is taught by flying, not by a
   *    sentence in the briefing.
   *  - `sides` and `pincer` late, once cutting an end is an option a child has
   *    thought of by themselves.
   *
   * Loose ships throughout, deliberately: an odd count leaves one untied, and
   * a fence with a hole in it is more interesting than a fence.
   *
   * A new id, not a renumbering. Every star this family has ever earned is
   * filed under a mission's `id`, so inserting a stop in the middle of the
   * campaign has to leave all thirty-five of those numbers alone and take the
   * next free one.
   */
  {
    id:3, name:"The Anchor", subtitle:"Mind the gap",
    brief:"They fly in PAIRS, roped together with a live cable. The cable hurts - go round it, or shoot one end and watch it snap.",
    goal:"Fly the gaps — or cut the rope!",
    waves: [
      // Two short fences, wide apart, slow. Round is free here.
      w(1,   "grunt",  4, "line",  { tether:true }),
      w(10,  "grunt",  6, "vee"),                        // a breather, and free kills
      w(17,  "grunt",  4, "line",  { tether:true }),
      // The lesson: a cable clean across the field. Round is gone.
      w(26,  "grunt",  4, "twinColumns", { tether:true }),
      w(34,  "carrier",1, "column"),                     // the rescue, on time as ever
      w(40,  "grunt",  6, "arc"),
      w(46,  "grunt",  6, "twinColumns", { tether:true }),
      // An odd count: five ships, two ropes, one loose one. The hole moves.
      w(55,  "grunt",  5, "line",  { tether:true }),
      w(63,  "weaver", 6, "scatter"),                    // the old lesson, still marked
      w(70,  "grunt",  6, "sides", { tether:true }),
      w(78,  "carrier",1, "column"),
      w(84,  "grunt",  8, "pincer", { tether:true }),
      // The finale: two fences at once, and the only way through is a gap.
      w(93,  "grunt",  6, "twinColumns", { tether:true }),
      w(97,  "grunt",  6, "line",  { tether:true }),
      w(106, "grunt", 10, "wall"),                       // and then just shooting again
    ],
    objectives: ["complete","ropes","rescueAll"],
  },
  {
    id:4, name:"Return Fire", subtitle:"They shoot back",
    brief:"These ones stop and aim at you. Keep moving and they will miss - and out here the rocks are on your side: their shots cannot get through one.",
    goal:"They shoot back — hide behind rocks!",
    // Cover turns "they shoot back" from a dodging drill into a reason to
    // read the field. The rocks were already here; now they mean something.
    cover:true,
    face:"striker",                   // the level where they shoot back
    waves: [
      w(1,   "grunt",   7, "arc"),
      w(8,   "striker", 3, "line"),
      w(16,  "weaver",  7, "twinColumns"),
      w(24,  "striker", 4, "vee"),
      w(32,  "grunt",  10, "scatter"),
      w(40,  "striker", 4, "sides"),
      w(48,  "carrier", 1, "column"),
      w(50,  "asteroid",4, "scatter"),      // first rocks: dodge them or break them
      w(53,  "weaver",  8, "wall"),
      w(58,  "sniper",  2, "sides"),        // telegraphed shots: move out of the line
      w(61,  "striker", 5, "tripleColumns"),
      w(69,  "grunt",  10, "pincer"),
      w(77,  "striker", 5, "arc"),
      w(85,  "weaver",  9, "line"),
      w(93,  "carrier", 1, "column"),
      w(94,  "boulder", 1, "column"),       // first big one
      w(96,  "asteroid",5, "scatter"),
      w(98,  "striker", 6, "sides"),
      w(106, "grunt",  12, "wall"),
      w(110, "sniper",  3, "arc"),
      w(114, "striker", 6, "vee"),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    id:5, name:"Heavy Metal", subtitle:"First boss",
    brief:"Brutes wear thick armour - Plasma Rounds chew through it. Then something HUGE shows up.",
    goal:"BOSS! Shoot the guns off its arms",
    waves: [
      w(1,   "grunt",   8, "line"),
      w(8,   "brute",   2, "twinColumns"),
      w(16,  "striker", 4, "arc"),
      w(24,  "brute",   3, "tripleColumns"),
      w(32,  "grunt",  10, "wall"),
      w(40,  "turret",  2, "sides"),
      w(44,  "shielder",1, "column"),       // first Guardian, over the next wave
      w(46,  "grunt",   8, "arc"),
      w(49,  "carrier", 1, "column"),
      w(54,  "striker", 5, "vee"),
      w(60,  "mender",  1, "column"),       // it repairs what you shot
      w(62,  "brute",   4, "line"),
      w(70,  "grunt",  11, "pincer"),
      w(78,  "turret",  3, "tripleColumns"),
      w(87,  "striker", 6, "scatter"),
      w(95,  "brute",   4, "twinColumns"),
      w(99,  "shielder",1, "column"),
      w(101, "brute",   3, "vee"),
      w(103, "grunt",  12, "wall"),
    ],
    boss: "marauder",
    objectives: ["complete","stripBoss","rescueAll"],
  },
  {
    id:6, name:"Kamikaze Run", subtitle:"Dodge or die",
    brief:"Kamikazes pick a spot and rocket at it. Let them come close, THEN swerve - the closer you cut it, the more they pay. Every near miss is money.",
    goal:"Cut it fine — near misses pay!",
    // The lesson is nerve: waiting before the swerve. Paying for the graze is
    // what turns "don't get hit" into "get missed by as little as possible".
    nearMiss:true,
    waves: [
      w(1,   "kamikaze", 3, "arc"),
      w(8,   "swooper",  4, "line"),
      w(15,  "kamikaze", 5, "sides"),
      w(23,  "weaver",   8, "tripleColumns"),
      w(28,  "interceptor", 4, "line"),     // this one keeps correcting
      w(31,  "swooper",  6, "vee"),
      w(39,  "kamikaze", 6, "pincer"),
      w(47,  "carrier",  1, "column"),
      w(52,  "swooper",  7, "arc"),
      w(56,  "splitter", 3, "twinColumns"), // they come apart when you shoot them
      w(60,  "grunt",   11, "wall"),
      w(68,  "kamikaze", 7, "scatter"),
      w(76,  "swooper",  7, "twinColumns"),
      w(84,  "carrier",  1, "column"),
      w(89,  "kamikaze", 8, "sides"),
      w(94,  "interceptor", 6, "sides"),
      w(97,  "weaver",  10, "line"),
      w(105, "swooper",  8, "pincer"),
      w(109, "splitter", 4, "arc"),
      w(113, "kamikaze", 9, "arc"),
      w(121, "grunt",   12, "wall"),
    ],
    objectives: ["complete","nearMiss","rescueAll"],
  },
  {
    id:7, name:"The Storm", subtitle:"Fly the wind",
    brief:"A nebula squall is tearing through the Belt. The wind comes in gusts - watch for the streaks, lean against the push, and don't let it shove you into a rock.",
    goal:"WIND! Watch the streaks, then lean",
    storm:true,
    face:"splitter",                  // the wind takes them apart; it wants you too
    waves: [
      w(1,   "grunt",    8, "wall"),
      w(9,   "weaver",   7, "arc"),
      w(17,  "asteroid", 5, "scatter"),
      w(24,  "carrier",  1, "column"),
      w(30,  "kamikaze", 4, "sides"),
      w(38,  "striker",  6, "vee"),
      w(46,  "asteroid", 6, "scatter"),
      w(53,  "carrier",  1, "column"),
      w(59,  "weaver",   8, "pincer"),
      w(68,  "boulder",  2, "twinColumns"),
      w(76,  "grunt",   10, "arc"),
      w(84,  "kamikaze", 5, "scatter"),
      w(92,  "splitter", 3, "line"),
      w(100, "carrier",  1, "column"),
      w(106, "striker",  7, "wall"),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    id:8, name:"Prison Break", subtitle:"Rescue mission",
    brief:"Those big ships have our friends locked inside. Blast them before they get away!",
    goal:"Free our friends from the ships!",
    waves: [
      w(1,   "carrier", 1, "column"),
      w(7,   "striker", 4, "line"),
      w(15,  "carrier", 2, "twinColumns"),
      w(23,  "swooper", 6, "arc"),
      w(31,  "carrier", 2, "sides"),
      w(39,  "brute",   3, "tripleColumns", { elite: 1 }),
      w(48,  "grunt",  11, "wall"),
      w(56,  "carrier", 2, "twinColumns"),
      w(61,  "bomber",  2, "twinColumns"),  // mines across the rescue lane
      w(64,  "striker", 6, "vee"),
      w(72,  "swooper", 8, "pincer"),
      w(80,  "carrier", 3, "tripleColumns"),
      w(84,  "thief",   2, "sides"),
      w(86,  "boulder", 2, "twinColumns"),  // asteroid field, mid-rescue
      w(89,  "weaver",  9, "arc"),
      w(97,  "brute",   4, "line", { elite: 1 }),
      w(105, "carrier", 2, "sides"),
      w(113, "grunt",  12, "scatter"),
      w(117, "thief",   2, "twinColumns"),
      w(121, "striker", 7, "wall"),
      w(129, "carrier", 3, "tripleColumns"),
    ],
    boss: "jailer",
    objectives: ["complete","rescueAll","killAll"],
  },
  {
    id:9, name:"The Gauntlet", subtitle:"Elites inbound",
    brief:"The gold glowing ones are elites. Really tough, but they pay FOUR times as much.",
    goal:"Gold ones are tough — and rich!",
    face:"brute", faceElite:true,     // the gold glowing ones ARE the level
    waves: [
      w(1,   "weaver",   8, "arc"),
      w(8,   "striker",  5, "sides", { elite: 1 }),
      w(16,  "kamikaze", 6, "pincer"),
      w(24,  "turret",   2, "twinColumns", { elite: 1 }),
      w(33,  "brute",    4, "vee"),
      w(41,  "grunt",   12, "wall"),
      w(49,  "carrier",  2, "twinColumns"),
      w(53,  "shielder", 2, "sides"),
      w(55,  "brute",    4, "wall"),        // ...under two Guardians
      w(57,  "swooper",  8, "scatter", { elite: 2 }),
      w(62,  "hive",     2, "sides"),       // shoot it or the screen fills up
      w(65,  "striker",  7, "line"),
      w(73,  "kamikaze", 8, "sides"),
      w(81,  "brute",    4, "tripleColumns", { elite: 2 }),
      w(90,  "weaver",  10, "pincer"),
      w(98,  "turret",   3, "arc", { elite: 1 }),
      w(102, "splitter", 5, "tripleColumns"),
      w(105, "asteroid", 6, "scatter"),
      w(107, "carrier",  2, "sides"),
      w(112, "mender",   2, "twinColumns"),
      w(115, "swooper",  9, "vee", { elite: 2 }),
      w(123, "grunt",   13, "wall"),
      w(131, "striker",  8, "tripleColumns", { elite: 2 }),
      w(139, "kamikaze",10, "scatter"),
    ],
    objectives: ["complete","eliteHunt","rescueAll"],
  },
  {
    id:10, name:"The Convoy", subtitle:"Bring them home",
    brief:"One supply hauler is crossing to the front with everything the squadron needs. It can't dodge and it can't shoot back, and they are coming straight for it. Stay close and keep it alive all the way home.",
    goal:"GUARD our hauler — keep it alive!",
    convoy:true,
    face:"interceptor",               // the hunters the haulers can't outrun
    waves: [
      w(2,   "grunt",       6, "sides"),
      w(10,  "kamikaze",    4, "scatter"),
      w(18,  "striker",     5, "vee"),
      w(26,  "interceptor", 3, "sides"),
      w(34,  "weaver",      7, "arc"),
      w(44,  "kamikaze",    5, "sides"),
      w(52,  "bomber",      2, "twinColumns"),
      w(60,  "striker",     6, "pincer"),
      w(68,  "grunt",       9, "wall"),
      w(76,  "splitter",    3, "line"),
      w(86,  "kamikaze",    6, "scatter"),
      w(94,  "striker",     7, "vee"),
      w(102, "interceptor", 4, "sides"),
      w(110, "brute",       3, "tripleColumns"),
    ],
    objectives: ["complete","convoy","kill80"],
  },
  {
    /*
     * THE LIFELINE. Mission 9 you protect the ship that carries; here you ARE
     * the ship that carries; mission 11 is their flagship. The roster is only
     * things that REACH you - interceptors, swoopers, kamikaze, shard - so a
     * hit on the delivery run is always something that touched you rather
     * than something shelled from across the field. No boulders (they would
     * park in front of the door) and no carriers (the crates are this level's
     * cargo, and a level gets exactly one thing to carry).
     */
    id:11, name:"The Lifeline", subtitle:"you are the delivery",
    brief:"The forward squadron is out of everything. There is no hauler left to send, so you are the hauler: grab each crate, fly it up to the green door, and let go. Take a hit and you will drop the load — it will hang there a moment before it starts to sink, so go back for it.",
    goal:"CARRY 4 crates to the green door",
    ferry:4,
    face:"interceptor",
    waves: [
      w(2,   "interceptor", 4, "sides"),
      w(10,  "swooper",     6, "arc"),
      w(18,  "asteroid",    5, "scatter"),
      w(24,  "sniper",      2, "sides"),
      w(30,  "kamikaze",    5, "pincer"),
      w(38,  "interceptor", 6, "line"),
      w(46,  "grunt",      10, "wall"),
      w(52,  "shard",       6, "scatter"),
      w(58,  "sniper",      3, "arc"),
      w(64,  "swooper",     8, "vee"),
      w(72,  "kamikaze",    7, "scatter"),
      w(80,  "interceptor", 8, "sides"),
      w(88,  "striker",     7, "wall"),
      w(96,  "swooper",     9, "pincer"),
    ],
    objectives: ["complete","delivered","kill80"],
  },
  {
    id:12, name:"Sky Sentinel", subtitle:"Their flagship",
    brief:"Everything they have in this sector, plus their giant flagship. You have got this.",
    goal:"BOSS! Knock its parts off",
    waves: [
      w(1,   "grunt",   10, "arc"),
      w(8,   "swooper",  6, "vee", { elite: 1 }),
      w(16,  "striker",  6, "line"),
      w(24,  "kamikaze", 7, "sides"),
      w(32,  "brute",    4, "tripleColumns", { elite: 1 }),
      w(41,  "weaver",  10, "wall"),
      w(49,  "carrier",  2, "twinColumns"),
      w(57,  "turret",   3, "arc"),
      w(60,  "shielder", 2, "twinColumns"),
      w(62,  "splitter", 5, "wall"),
      /*
       * The swoopers used to be listed AFTER the boulders despite arriving
       * five seconds earlier. The director walks this array in order and
       * queues everything whose time has come, so at t=70 it queued the
       * boulders, then noticed the t=65 swoopers were overdue and queued them
       * too, then the hives - three separate waves, fourteen ships, arriving
       * in one instant on the mission that introduces the Sky Sentinel. Sorted
       * by time now, and _smoketest.js pins that every mission's waves are.
       */
      w(65,  "swooper",  9, "pincer", { elite: 2 }),
      w(70,  "boulder",  3, "tripleColumns"),
      w(70,  "hive",     2, "twinColumns"),
      w(73,  "striker",  7, "sides"),
      w(81,  "brute",    5, "line", { elite: 2 }),
      w(90,  "kamikaze", 9, "scatter"),
      w(98,  "weaver",  11, "tripleColumns"),
      w(106, "grunt",   13, "wall"),
      w(114, "striker",  8, "vee", { elite: 2 }),
      w(118, "sniper",   4, "sides"),
      w(120, "bomber",   3, "arc"),
      w(122, "turret",   4, "twinColumns", { elite: 1 }),
      w(126, "mender",   2, "line"),
      w(128, "interceptor", 8, "wall"),
      w(130, "swooper", 10, "arc", { elite: 2 }),
      w(138, "kamikaze",11, "pincer"),
    ],
    boss: "sentinel",
    objectives: ["complete","kill80","rescueAll"],
  },

  /*
   * The blockade run: the one mission where the guns are cold - the
   * Sentinel's last blast fried them, and the repair yard is on the far side
   * of the blockade. Sky Force has these courier levels and they are the
   * change of texture a long campaign needs - two minutes where the skill is
   * entirely in your thumb. Coins rain in marked lanes so greed pulls you
   * into traffic.
   *
   * Playtest calibration, in two steps: full enemy fire was undodgeable
   * with no gun, and full silence was flat. The rule now: SPARSE fire only.
   * world.silent throttles the whole fleet to one shared shot every couple
   * of seconds, and the only dedicated shooters are a few Marksmen - the
   * telegraphed kind that draw their line first. No minelayers: mines were
   * clutter you couldn't clear.
   *
   * `podDrops` pilots drift down through the traffic on their own - escapees
   * from the blockade, no carrier to shoot open - so freeing people stays an
   * objective even on the mission where you can't fire a shot.
   */
  {
    id:13, name:"Silent Running", subtitle:"Guns down. Just fly.",
    brief:"The Sentinel's last blast broke your guns! Sneak through the blockade while the crew fixes them - dodge everything, catch coins and drifting pilots.",
    goal:"Guns broken — just DODGE!",
    face:"swooper",                   // the thing you spend the level dodging
    noGuns:true, coinRain:true, podDrops:5,
    waves: [
      w(1,   "grunt",    7, "wall"),
      w(8,   "kamikaze", 4, "sides"),
      w(14,  "asteroid", 5, "scatter"),
      w(20,  "swooper",  7, "arc"),
      w(27,  "interceptor", 5, "line"),
      w(34,  "grunt",    9, "wall"),
      w(40,  "sniper",   2, "sides"),
      w(46,  "kamikaze", 6, "pincer"),
      w(52,  "asteroid", 5, "scatter"),
      w(58,  "asteroid", 6, "scatter"),
      w(63,  "boulder",  2, "twinColumns"),
      w(68,  "swooper",  9, "vee"),
      w(75,  "interceptor", 7, "sides"),
      w(82,  "grunt",   10, "wall"),
      w(88,  "sniper",   3, "arc"),
      w(93,  "kamikaze", 8, "scatter"),
      w(100, "boulder",  2, "sides"),
      w(106, "swooper", 10, "pincer"),
      w(113, "grunt",   11, "wall"),
      w(118, "kamikaze", 9, "sides"),
    ],
    objectives: ["complete","coinRush","rescueAll"],
  },
  /*
   * SPOTLIGHT, and the beam is the only light in the sky.
   *
   * The first build had this the other way round: the sky was lit and the beam
   * was a place not to be. It worked, and it was the wrong level - it made the
   * one interesting object on screen a thing you avoid. Inverted, the light is
   * something you WANT, and that is a much better thing to put in a child's
   * way. Outside it you cannot see the sky at all; the sweep is what paints it.
   *
   * The dark fades back in BEHIND the beam over about two seconds, which is
   * where the skill lives. A hard trailing edge would give you only what is
   * lit right now - a reflex test. A tail gives you a memory to fly on, and
   * "read what the light just showed you, then act before it goes" is worth
   * being good at.
   *
   * Both halves at once are the dilemma: the light is the only way to see, AND
   * standing in it makes every gun on the field pick you. So the answer a
   * child finds is to fly just behind the sweep - in what it has lit, out of
   * what it is lighting - which is exactly the line you would want them to
   * find.
   *
   * NOTHING may kill you that you had no way to see: every bullet in the air
   * stays visible through the dark, and your own hull carries a small lamp.
   * What is hidden is the SHIPS. Being frightened of a gun you cannot see is
   * the level; being killed by one is just unfair.
   *
   * No divers in the roster for the same reason - a kamikaze arriving out of
   * black at three hundred pixels a second is not a thing anybody can read.
   */
  {
    id:14, name:"Spotlight", subtitle:"Don't be seen",
    brief:"Their searchlight is the only light out here, {you} - what it sweeps, you see, and everything else is black. But standing in it means they can see YOU, and they all shoot at once. Read the sky it just lit, then get out of the way.",
    goal:"Only the beam shows the sky",
    spot:true,
    face:"sniper",
    waves: [
      // The first half-minute is deliberately almost harmless: the lesson is
      // the SWING, and a child cannot learn a rhythm while being shot at from
      // six directions. The guns arrive once the beam is understood.
      w(1,   "grunt",   6, "line"),
      w(9,   "grunt",   7, "arc"),
      w(17,  "grunt",   7, "twinColumns"),
      w(25,  "carrier", 1, "column"),
      w(31,  "striker", 5, "sides"),
      w(38,  "striker", 6, "vee"),
      w(46,  "grunt",   8, "scatter"),
      w(54,  "sniper",  3, "line"),
      w(62,  "carrier", 1, "column"),
      w(67,  "striker", 7, "pincer"),
      w(75,  "sniper",  4, "twinColumns"),
      w(84,  "grunt",  10, "wall"),
      w(92,  "striker", 8, "arc"),
      w(101, "turret",  4, "tripleColumns"),
      w(110, "grunt",  11, "scatter"),
    ],
    objectives: ["complete","unseen","rescueAll"],
  },

  /* =========================================================
     ACT TWO
     The Sentinel falling doesn't end the war, it starts the
     chase: 9-14 run the other way up the lane, into their
     space. Every mission here assumes you own several upgrades
     and knows every archetype by sight, so they lead with
     combinations rather than introductions.
     ========================================================= */
  {
    id:15, name:"The Wreck Line", subtitle:"Through the debris",
    brief:"The Sentinel left a whole field of scrap behind. Rocks do not shoot, and they do not move - but nothing they fire gets through one either. Put the scrap between you and their guns.",
    goal:"Fly the scrap — it stops their shots",
    cover:true,                       // the debris shelters as well as blocks
    face:"asteroid",                  // the debris is the level, not its escorts
    waves: [
      w(1,   "asteroid", 6, "scatter"),
      w(7,   "grunt",   10, "arc"),
      w(14,  "boulder",  2, "twinColumns"),
      w(18,  "striker",  6, "sides"),
      w(26,  "asteroid", 7, "scatter"),
      w(30,  "weaver",  10, "tripleColumns"),
      w(38,  "boulder",  2, "sides"),
      w(42,  "swooper",  8, "pincer"),
      w(50,  "carrier",  2, "twinColumns"),
      w(55,  "asteroid", 8, "scatter"),
      w(58,  "brute",    4, "wall", { elite: 1 }),
      w(66,  "thief",    2, "sides"),
      w(70,  "boulder",  3, "tripleColumns"),
      w(75,  "striker",  7, "vee"),
      w(83,  "kamikaze", 8, "arc"),
      w(91,  "carrier",  2, "sides"),
      w(96,  "asteroid", 9, "scatter"),
      w(99,  "weaver",  11, "wall"),
      w(107, "boulder",  3, "twinColumns"),
      w(111, "grunt",   13, "pincer"),
      w(119, "brute",    5, "line", { elite: 2 }),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    /*
     * THE RING. A movement toy between the Wreck Line and the Vesper duel -
     * no boss, no health bar, just a rule. The roster is everything whose
     * whole trick is locking onto your lane, so that going round the back
     * BREAKS the lock and the level pays you for using it: interceptors that
     * keep correcting, kamikaze that commit to a point you then leave,
     * turrets patrolling a line, thieves you can cut off the short way. All
     * `sides` and `pincer`, so the fight lives at the edges.
     */
    id:16, name:"The Ring", subtitle:"this sky has no edges",
    brief:"Nobody has ever found the edge of this place. Fly out one side and you come straight back in the other, same height, still going. They cannot do it — their ships are built to hold a lane. You are not.",
    goal:"GO ROUND THE BACK — the sky joins up",
    wrap:true,
    face:"thief",                     // the runner you cut off the short way round
    waves: [
      w(1,   "grunt",      8, "sides"),
      w(8,   "interceptor",5, "sides"),
      w(16,  "weaver",     8, "pincer"),
      w(24,  "turret",     3, "sides"),
      w(31,  "kamikaze",   6, "pincer"),
      w(38,  "carrier",    1, "column"),
      w(44,  "thief",      2, "sides"),
      w(50,  "interceptor",7, "pincer"),
      w(58,  "striker",    7, "sides"),
      w(66,  "swooper",    8, "pincer"),
      w(74,  "turret",     4, "twinColumns"),
      w(80,  "carrier",    1, "column"),
      w(86,  "kamikaze",   8, "sides"),
      w(94,  "weaver",    10, "pincer"),
      w(102, "interceptor",9, "sides"),
      w(110, "grunt",     12, "wall"),
    ],
    objectives: ["complete","rescueAll","roundTheBack"],
  },
  {
    id:17, name:"The Rival", subtitle:"One of them is good",
    brief:"One of their pilots has been shadowing us for weeks. She calls herself VESPER, she flies as well as you do, and today she is waiting. She copies whatever you do - so don't just chase her. Make her move, then shoot where she is GOING.",
    rival:true,
    face:"rival",
    waves: [
      w(1,   "grunt",    7, "arc"),
      w(9,   "weaver",   6, "scatter"),
      w(17,  "striker",  5, "vee"),
      w(25,  "carrier",  1, "column"),
      // She arrives once the escort is thinned out - and again, angrier,
      // after you have had a taste of it.
      w(33,  "rival",    1, "column"),
      w(46,  "kamikaze", 5, "sides"),
      w(55,  "grunt",    9, "wall"),
      w(64,  "interceptor", 3, "sides"),
      w(72,  "carrier",  1, "column"),
      w(80,  "striker",  6, "arc"),
      w(90,  "weaver",   7, "pincer"),
      w(100, "splitter", 3, "line"),
    ],
    objectives: ["complete","kill80","rescueAll"],
    goal:"VESPER copies you — trick her!",
  },
  {
    id:18, name:"The Hatchery", subtitle:"It keeps growing",
    brief:"Hives spit out new ships forever. Kill the hive first and the rest stops coming.",
    goal:"Kill the big purple one first!",
    face:"hive",                      // kill the hive first - so show the hive
    waves: [
      w(1,   "hive",     2, "twinColumns"),
      w(8,   "grunt",   11, "wall"),
      w(15,  "splitter", 5, "arc"),
      w(23,  "hive",     2, "sides"),
      w(28,  "swooper",  9, "vee"),
      w(36,  "splitter", 6, "tripleColumns"),
      w(44,  "hive",     3, "tripleColumns"),
      w(49,  "carrier",  2, "twinColumns"),
      w(54,  "mender",   2, "sides"),
      w(56,  "brute",    5, "wall"),           // ...being patched up as you shoot
      w(64,  "splitter", 6, "pincer"),
      w(72,  "hive",     3, "arc"),
      w(78,  "interceptor", 7, "line"),
      w(86,  "weaver",  11, "scatter"),
      w(94,  "carrier",  2, "sides"),
      w(99,  "mender",   3, "tripleColumns"),
      w(102, "splitter", 7, "wall"),
      w(110, "hive",     3, "twinColumns"),
      w(117, "swooper", 10, "arc", { elite: 2 }),
      w(125, "grunt",   14, "wall"),
      w(133, "splitter", 8, "sides"),
    ],
    objectives: ["complete","killAll","rescueAll"],
  },
  {
    id:19, name:"The Warden", subtitle:"Their jailer",
    brief:"This one lays mines instead of shooting. Blow the hatches off its sides and it runs out of them.",
    goal:"BOSS! Don't touch the mines",
    waves: [
      w(1,   "striker",  7, "arc"),
      w(8,   "bomber",   3, "twinColumns"),
      w(16,  "shielder", 2, "sides"),
      w(18,  "brute",    5, "wall"),
      w(26,  "carrier",  3, "tripleColumns"),
      w(33,  "sniper",   4, "sides"),
      w(38,  "kamikaze", 9, "pincer"),
      w(46,  "bomber",   3, "arc"),
      w(50,  "turret",   4, "twinColumns", { elite: 1 }),
      w(58,  "weaver",  11, "wall"),
      w(64,  "shielder", 2, "twinColumns"),
      w(66,  "striker",  8, "tripleColumns", { elite: 1 }),
      w(74,  "carrier",  2, "sides"),
      w(79,  "mine",     6, "scatter"),
      w(82,  "swooper", 10, "vee"),
      w(90,  "bomber",   4, "sides"),
      w(95,  "brute",    5, "line", { elite: 2 }),
      w(103, "grunt",   13, "wall"),
    ],
    boss: "warden",
    objectives: ["complete","stripBoss","rescueAll"],
  },
  /*
   * The breather between the two hardest bosses - the customer's rule is a
   * good one: never two boss missions in a row. It's the heist level: the
   * roster leans on thieves (who steal your coins and pay them back double
   * when caught), turret-and-guardian vaults, and boulders full of pay. The
   * one mission whose third star is greed itself.
   */
  {
    id:20, name:"Their Treasury", subtitle:"Rob the robbers",
    brief:"This is where they keep everything they stole - and a storm is tearing the vaults open! Chase every coin the wind throws loose, and watch the thieves who want them back.",
    // The weather remix: the Storm's gusts, six missions later, in a level
    // that's about CATCHING things - the wind blows the loot around, so the
    // mechanic reads as chaos-treasure rather than chaos-danger.
    storm:true,
    goal:"Coins in the WIND — catch them!",
    waves: [
      w(1,   "grunt",   10, "arc"),
      w(8,   "thief",    2, "sides"),
      w(12,  "striker",  7, "vee"),
      w(20,  "turret",   3, "tripleColumns"),
      w(28,  "boulder",  3, "twinColumns"),     // the vaults
      w(33,  "weaver",  10, "wall"),
      w(41,  "thief",    3, "tripleColumns"),
      w(45,  "shielder", 2, "sides"),
      w(47,  "brute",    4, "wall", { elite: 1 }),
      w(55,  "swooper",  9, "pincer"),
      w(63,  "turret",   4, "twinColumns", { elite: 1 }),
      w(71,  "boulder",  3, "tripleColumns"),
      w(76,  "thief",    3, "sides"),
      w(80,  "mender",   2, "twinColumns"),
      w(82,  "striker",  8, "wall"),
      w(90,  "kamikaze", 9, "scatter"),
      w(98,  "grunt",   12, "wall"),
      w(104, "thief",    4, "tripleColumns"),
      w(108, "brute",    5, "line", { elite: 2 }),
      w(116, "splitter", 6, "arc"),
      w(122, "interceptor", 8, "sides"),
      w(128, "striker",  9, "tripleColumns", { elite: 2 }),
    ],
    objectives: ["complete","kill80","coinRush"],
  },
  {
    /*
     * SHAKE THEM OFF. You robbed the Treasury last stop; something crawled
     * aboard on the way out. Everything in this roster punishes being slow,
     * which is exactly what the limpets make you: Marksmen drawing lines you
     * can no longer outrun, mines that need speed to leave, mass to steer
     * round with a sluggish rudder. Deliberately NO Guardians, hives or
     * menders - nothing that asks you to prioritise a target, because the
     * level's whole cognitive load is your own ship handling badly.
     */
    id:21, name:"Shake Them Off", subtitle:"they don't shoot — they cling",
    brief:"The yard where they cut up captured hulls has its own vermin, and it has noticed you. These ones carry no guns at all. They grab hold, and every one that sticks makes you heavier and slower — until you waggle hard enough to throw them off.",
    goal:"WAGGLE hard to shake them off",
    limpets:true,
    face:"limpet",
    waves: [
      w(1,   "striker",     6, "vee"),
      w(10,  "limpet",      4, "scatter"),
      w(17,  "sniper",      3, "sides"),
      w(24,  "asteroid",    6, "scatter"),
      w(30,  "limpet",      5, "sides"),
      w(37,  "bomber",      3, "twinColumns"),
      w(44,  "carrier",     1, "column"),
      w(50,  "interceptor", 7, "line"),
      w(57,  "limpet",      6, "scatter"),
      w(64,  "boulder",     2, "twinColumns"),
      w(70,  "sniper",      4, "arc"),
      w(77,  "mine",        6, "scatter"),
      w(84,  "limpet",      6, "sides"),
      w(91,  "striker",     8, "wall", { elite: 1 }),
      w(98,  "carrier",     1, "column"),
      w(104, "limpet",      6, "pincer"),
      w(112, "bomber",      4, "sides"),
      w(118, "grunt",      12, "wall"),
    ],
    objectives: ["complete","shakenOff","rescueAll"],
  },
  {
    id:22, name:"Cold Approach", subtitle:"Line up the shot",
    brief:"Snipers draw a line before they fire. If the line is on you, move - simple as that.",
    goal:"BOSS! It goes invisible — watch",
    waves: [
      w(1,   "sniper",   4, "sides"),
      w(8,   "turret",   3, "tripleColumns"),
      w(16,  "sniper",   5, "arc"),
      w(23,  "interceptor", 7, "line"),
      w(31,  "turret",   4, "twinColumns", { elite: 1 }),
      w(39,  "sniper",   5, "twinColumns"),
      w(46,  "carrier",  2, "sides"),
      w(51,  "shielder", 3, "tripleColumns"),
      w(53,  "sniper",   5, "sides"),         // ...shooting from behind bubbles
      w(61,  "brute",    5, "wall", { elite: 1 }),
      w(69,  "interceptor", 9, "pincer"),
      w(77,  "turret",   5, "arc", { elite: 1 }),
      w(85,  "sniper",   6, "tripleColumns"),
      w(92,  "carrier",  3, "twinColumns"),
      w(97,  "mender",   3, "sides"),
      w(100, "striker",  9, "wall", { elite: 1 }),
      w(108, "sniper",   6, "sides"),
      w(116, "kamikaze",10, "scatter"),
      w(124, "turret",   5, "twinColumns", { elite: 2 }),
    ],
    boss: "phantom",
    // Five carriers fly this route - a mission with people to free always
    // makes freeing them one of its stars.
    objectives: ["complete","rescueAll","noDamage"],
  },
  /*
   * THE NARROWS, and the only level in the game not flown in space.
   *
   * "The walls close in" is a good idea with a bad excuse: there is nothing in
   * open space for a wall to BE. So this one goes down to their world and flies
   * a canyon, where a wall is just rock and the sky narrowing is the gorge
   * doing what gorges do. It is also the campaign's one change of venue -
   * thirty-nine missions above the clouds and one below them - which is worth
   * having on its own.
   *
   * The rock breathes on a slow cycle with a faster one laid over it, so the
   * squeeze never lands on a count you can tune out. Touching it costs a life
   * and the rock is still there afterwards: the boulder rule, for the boulder
   * reason. A wall you can trade a life for is not a wall.
   *
   * Heavy, slow enemies, because the level's pressure comes from the PLACE
   * rather than from the crowd. Nothing here dives at you; the walls do that.
   */
  {
    id:23, name:"The Narrows", subtitle:"Down where the rock is",
    brief:"Below the clouds now, {you} - straight down their canyon. The walls come IN and go out again, and rock does not care how good your guns are. Fly the middle when it squeezes.",
    goal:"The canyon SQUEEZES — fly the middle",
    narrows:true,
    face:"brute",
    waves: [
      w(1,   "grunt",   6, "line"),
      w(10,  "brute",   2, "twinColumns"),
      w(18,  "weaver",  7, "arc"),
      w(26,  "carrier", 1, "column"),
      w(32,  "grunt",   8, "wall"),
      w(41,  "brute",   3, "sides"),
      w(50,  "striker", 6, "vee"),
      w(58,  "weaver",  8, "tripleColumns"),
      w(66,  "carrier", 1, "column"),
      w(72,  "brute",   3, "line"),
      w(81,  "grunt",  10, "scatter"),
      w(90,  "striker", 7, "pincer"),
      w(99,  "brute",   4, "twinColumns"),
      w(108, "grunt",  11, "wall"),
    ],
    objectives: ["complete","squeeze","rescueAll"],
  },
  {
    id:24, name:"The Trench Run", subtitle:"Thread the walls",
    brief:"Straight down the supply trench of their star fortress. The walls come in waves - read each gate, find the gap, and thread it. Or blast your own door through, if your guns are up to it.",
    goal:"WALLS! Find the gap and fly through",
    trench:true,
    face:"turret",                    // the guns bolted to the walls
    waves: [
      w(1,   "grunt",   6, "line"),
      w(8,   "boulder", 4, "gate"),
      w(16,  "striker", 4, "vee"),
      w(22,  "boulder", 4, "gate"),
      w(29,  "turret",  3, "tripleColumns"),
      w(36,  "boulder", 5, "gate"),
      w(43,  "carrier", 1, "column"),
      w(49,  "boulder", 5, "gate"),
      w(56,  "kamikaze",4, "sides"),
      w(62,  "boulder", 5, "gate"),
      w(69,  "sniper",  2, "sides"),
      w(76,  "boulder", 5, "gate"),
      w(83,  "carrier", 1, "column"),
      w(89,  "boulder", 6, "gate"),
      w(96,  "striker", 6, "wall"),
      w(104, "boulder", 6, "gate"),
      w(112, "weaver",  6, "arc"),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    id:25, name:"All Hands", subtitle:"Everyone who is left",
    brief:"Every prisoner they still hold is on these ships. Bring all of them home.",
    face:"carrier",                   // the brief says it: the ships ARE the level
    goal:"Save every last pilot!",
    waves: [
      w(1,   "carrier",  3, "tripleColumns"),
      w(8,   "swooper",  9, "arc", { elite: 1 }),
      w(16,  "carrier",  3, "twinColumns"),
      w(23,  "hive",     3, "sides"),
      w(30,  "brute",    5, "wall", { elite: 1 }),
      w(38,  "carrier",  3, "sides"),
      w(44,  "thief",    3, "tripleColumns"),  // they want the payday, not you
      w(48,  "splitter", 7, "arc"),
      w(56,  "carrier",  4, "tripleColumns"),
      w(62,  "shielder", 3, "twinColumns"),
      w(64,  "sniper",   6, "sides"),
      w(72,  "boulder",  3, "twinColumns"),
      w(77,  "kamikaze",11, "pincer"),
      // THE REMATCH - once in the whole campaign, exactly here. She fell at
      // 13, she's had six missions to be angry about it, and "everyone they
      // have left" should include the one with a grudge. Elite: gold-lit,
      // tougher, and her dodge valve is faster (see the rival behaviour).
      w(82,  "rival",    1, "column", { elite: 1 }),
      w(85,  "carrier",  3, "twinColumns"),
      w(91,  "mender",   3, "arc"),
      w(93,  "brute",    6, "line", { elite: 2 }),
      w(101, "bomber",   4, "sides"),
      w(106, "weaver",  12, "wall"),
      w(114, "carrier",  4, "sides"),
      w(120, "thief",    3, "twinColumns"),
      w(124, "striker",  9, "tripleColumns", { elite: 2 }),
      w(132, "grunt",   14, "scatter"),
      w(140, "carrier",  3, "tripleColumns"),
    ],
    objectives: ["complete","rescueAll","killAll"],
  },
  {
    /*
     * THE BRIGHT SIDE. Their last big ship is refuelling at their sun, so the
     * campaign's brightest sky sits immediately before its darkest stretch.
     * The roster is everything that HOVERS - turret, sniper, shielder, hive,
     * mender - so the fight naturally lives in the top half where the fire is
     * pushing you, with swoopers and kamikaze diving down through it and
     * burning if they dawdle. THREE carriers, deliberately: a carrier dives
     * toward the BOTTOM of the screen, so the flare will take your rescues if
     * you are slow. It is the most legible reason to hurry the game has.
     */
    id:26, name:"The Bright Side", subtitle:"standing on their sun",
    brief:"We are flying over the surface of their star. Every minute or so it throws a sheet of fire up at us — it burns them as happily as it burns you, so anything you were saving for later will be gone. When the warning line lights, climb.",
    goal:"CLIMB when the star flares",
    flare:true,
    face:"turret",
    waves: [
      w(1,   "turret",   3, "sides"),
      w(9,   "sniper",   4, "arc"),
      w(17,  "swooper",  8, "vee"),
      w(25,  "shielder", 2, "twinColumns"),
      w(28,  "striker",  7, "wall"),
      w(36,  "carrier",  1, "column"),
      w(43,  "hive",     2, "sides"),
      w(50,  "kamikaze", 9, "scatter"),
      w(57,  "asteroid", 6, "scatter"),
      w(63,  "mender",   2, "twinColumns"),
      w(66,  "turret",   4, "tripleColumns", { elite: 1 }),
      w(74,  "carrier",  1, "column"),
      w(80,  "sniper",   5, "sides"),
      w(87,  "swooper", 10, "pincer"),
      w(94,  "shielder", 3, "sides"),
      w(97,  "striker",  9, "wall", { elite: 1 }),
      w(105, "carrier",  1, "column"),
      w(111, "hive",     3, "twinColumns"),
    ],
    objectives: ["complete","rescueAll","unburned"],
  },
  {
    id:27, name:"The Leviathan", subtitle:"The last one",
    brief:"Their biggest ship, and the last thing between us and home. Four weak points. Take your time.",
    goal:"BOSS! Break off all four parts",
    waves: [
      w(1,   "grunt",   12, "wall"),
      w(8,   "striker",  8, "arc", { elite: 1 }),
      w(16,  "hive",     3, "twinColumns"),
      w(23,  "brute",    6, "tripleColumns", { elite: 1 }),
      w(31,  "swooper", 10, "pincer", { elite: 1 }),
      w(39,  "shielder", 3, "sides"),
      w(41,  "turret",   5, "twinColumns", { elite: 1 }),
      w(49,  "carrier",  3, "tripleColumns"),
      w(55,  "sniper",   6, "sides"),
      w(60,  "splitter", 8, "wall"),
      w(68,  "boulder",  4, "tripleColumns"),
      w(73,  "kamikaze",11, "scatter"),
      w(81,  "mender",   3, "twinColumns"),
      w(83,  "brute",    6, "wall", { elite: 2 }),
      w(91,  "interceptor", 10, "sides"),
      w(99,  "bomber",   4, "arc"),
      w(104, "weaver",  12, "tripleColumns"),
      w(112, "hive",     3, "sides"),
      w(118, "carrier",  3, "twinColumns"),
      w(123, "striker", 10, "wall", { elite: 2 }),
      w(131, "swooper", 11, "vee", { elite: 2 }),
      w(139, "grunt",   15, "wall"),
    ],
    boss: "leviathan",
    objectives: ["complete","kill80","rescueAll"],
  },

  /* =========================================================
     ACT THREE - THE LAST STAR
     Two missions. The first is quiet on purpose: the Devourer
     hangs in the sky the whole way, too big to fight and
     getting closer, and the mission is the dread. The second
     is the fight the whole campaign has been walking toward.
     ========================================================= */
  {
    id:28, name:"The Searchlight", subtitle:"Your glow is the only light",
    brief:"They cut the power to this whole sector. Your ship's glow is the only lamp left - and there are stranded pilots drifting out there in the dark, waiting for somebody to come looking.",
    goal:"DARK! Find the lost pilots",
    blackout:true, podDrops:4,
    face:"mender",                    // the green glow drifting through the dark
    waves: [
      w(1,   "grunt",    7, "arc"),
      w(10,  "weaver",   6, "scatter"),
      w(18,  "swooper",  4, "sides"),
      w(26,  "carrier",  1, "column"),
      w(33,  "striker",  5, "vee"),
      w(41,  "asteroid", 4, "scatter"),
      w(49,  "kamikaze", 4, "scatter"),
      w(57,  "carrier",  1, "column"),
      w(64,  "grunt",    9, "wall"),
      w(72,  "sniper",   2, "sides"),
      w(80,  "splitter", 3, "line"),
      w(84,  "mender",   2, "sides"),
      w(88,  "weaver",   7, "pincer"),
      w(96,  "carrier",  1, "column"),
      w(103, "striker",  6, "arc"),
    ],
    objectives: ["complete","rescueAll","kill80"],
  },
  /*
   * NIGHTFALL: the bridge between the Searchlight and the Long Dark, made
   * playable instead of narrated.
   *
   * Act three's story is a star going out. Until now that happened BETWEEN two
   * missions - one level is lit, the next one is not - which is a fact you are
   * told rather than a thing that happens to you. Here the light drains over
   * the length of the flight, keyed to the wave script rather than to a clock,
   * so the dark arrives because you are getting through it. The last wave is
   * always the darkest one, whoever is flying and however long they take.
   *
   * It stops short of black. The Long Dark is the level that is actually pitch
   * black, and a child has to be able to finish this one - a wave you genuinely
   * cannot see is not tense, it is unfair.
   *
   * The roster is deliberately ordinary. The whole difficulty curve here is the
   * light: the same ships you have been reading all campaign, getting harder to
   * read, which is a kind of pressure the game has never applied.
   */
  {
    id:29, name:"Nightfall", subtitle:"While the light lasts",
    brief:"Their sun is going out, {you}, and it's going out WHILE we're in here. Everything you can see now, you'll be flying blind against by the end. Learn them early.",
    goal:"It gets DARKER. Learn them early",
    nightfall:true,
    face:"swooper",
    waves: [
      w(1,   "grunt",   7, "line"),
      w(9,   "weaver",  6, "arc"),
      w(17,  "swooper", 5, "vee"),
      w(25,  "carrier", 1, "column"),
      w(31,  "grunt",   9, "twinColumns"),
      w(40,  "swooper", 7, "sides"),
      w(48,  "striker", 6, "scatter"),
      w(57,  "weaver",  8, "tripleColumns"),
      w(65,  "carrier", 1, "column"),
      w(71,  "swooper", 8, "pincer"),
      w(80,  "grunt",  10, "wall"),
      w(89,  "striker", 8, "arc"),
      w(98,  "swooper", 9, "scatter"),
      w(108, "grunt",  12, "wall"),
    ],
    objectives: ["complete","afterDark","rescueAll"],
  },
  {
    id:30, name:"The Long Dark", subtitle:"Something is out there",
    brief:"Their star went out last night. Fly quiet, keep your eyes open - and look at what is sitting where the light used to be.",
    // "soft": the Searchlight's veil at half strength. 21 is the hard black
    // with a job to do; 22 is dread, so the dark here is thinner but the
    // level's own name finally means what it says.
    blackout:"soft",
    goal:"Something is out there. Watch out!",
    face:"sniper",                    // what is watching you out of the dark
    waves: [
      // Deliberately sparse to start. Empty sky is the scariest thing here.
      w(1,   "grunt",    6, "line"),
      w(14,  "asteroid", 6, "scatter"),
      w(24,  "sniper",   3, "sides"),
      w(34,  "interceptor", 6, "line"),
      w(44,  "boulder",  2, "twinColumns"),
      w(52,  "swooper",  8, "arc"),
      // ...and then everything they have left, all at once.
      w(62,  "grunt",   13, "wall"),
      w(68,  "striker",  8, "tripleColumns", { elite: 1 }),
      w(76,  "kamikaze",10, "pincer"),
      w(84,  "carrier",  3, "twinColumns"),
      w(90,  "brute",    5, "wall", { elite: 1 }),
      w(98,  "hive",     3, "sides"),
      w(104, "weaver",  12, "scatter"),
      w(112, "splitter", 7, "arc"),
      w(120, "turret",   5, "twinColumns", { elite: 2 }),
      w(128, "grunt",   14, "wall"),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    id:31, name:"The Devourer", subtitle:"The last star",
    brief:"This is the one, {you}. It ate their sun and it is coming for ours. Everything you have learned, everything you have built - all of it, right now.",
    goal:"THE LAST BOSS. Everything you have!",
    // A short escort screen, then the only thing that matters. The waves are
    // brief by design: nobody wants a chore between them and the finale.
    waves: [
      w(1,   "interceptor", 8, "line"),
      w(9,   "striker",  8, "arc", { elite: 1 }),
      w(17,  "swooper", 10, "pincer", { elite: 1 }),
      w(25,  "brute",    5, "wall", { elite: 2 }),
      w(33,  "carrier",  2, "twinColumns"),
      w(39,  "grunt",   14, "wall"),
    ],
    boss: "devourer",
    objectives: ["complete","rescueAll","keepLives"],
  },
  /*
   * THE CURRENT: a river through the middle of the sky, and the exact opposite
   * of the Storm.
   *
   * A gust is a surprise you react to. A current is always there, always the
   * same way, and every second of the level is a decision: drop into it to
   * cross the field in a heartbeat, or stay above it to be able to aim. It
   * carries everything loose - you, their shots, the coins, the pods - so a
   * shot fired at you from below the band arrives somewhere else entirely, and
   * after a minute a child stops aiming at ships and starts aiming at where
   * the river will have put them.
   *
   * It sits next to The Undertow on purpose. A well BENDS what crosses it and
   * a current TRANSLATES it; flying them back to back is the clearest possible
   * statement of what act four is - the same sky, disobeying a different rule
   * each time.
   */
  {
    id:32, name:"The Current", subtitle:"Ride it or leave it",
    brief:"There's a river running through the middle of this sky, {you} - it carries you, their shots, the money, everything. Drop in to travel fast. Climb out to shoot straight.",
    goal:"A RIVER through the middle",
    current:true,
    face:"thief",
    waves: [
      w(1,   "grunt",   7, "line"),
      w(9,   "striker", 6, "arc"),
      w(18,  "thief",   1, "column"),
      w(20,  "grunt",   8, "twinColumns"),
      w(28,  "carrier", 1, "column"),
      w(34,  "weaver",  7, "sides"),
      w(43,  "striker", 7, "vee"),
      w(52,  "thief",   2, "column"),
      w(55,  "grunt",   9, "scatter"),
      w(64,  "carrier", 1, "column"),
      w(70,  "weaver",  9, "pincer"),
      w(79,  "striker", 8, "tripleColumns"),
      w(88,  "grunt",  11, "wall"),
      w(97,  "thief",   2, "sides"),
      w(100, "weaver", 10, "arc"),
      w(109, "grunt",  12, "scatter"),
    ],
    objectives: ["complete","coinRush","rescueAll"],
  },

  /* =========================================================
     ACT 4 - BEHIND THE SKY
     The Devourer's fall cracked the sky, and the crack leads
     somewhere space doesn't quite work. Each stop breaks one
     rule the first three acts taught; the last stop is where
     the rules are made.
     ========================================================= */
  {
    id:33, name:"The Undertow", subtitle:"Gravity gone wrong",
    brief:"The Devourer's fall tore a hole in the sky, {you}. On the other side gravity runs in whirlpools - YOUR shots curve, THEIR shots curve, even the coins swim. Bend your aim around the wells!",
    goal:"Whirlpools bend your shots!",
    face:"shard",              // glass rain caught in the whirlpools
    wells:true,
    waves: [
      w(1,   "grunt",    7, "line"),
      w(9,   "weaver",   7, "arc"),
      w(17,  "striker",  4, "vee"),
      w(25,  "swooper",  6, "pincer"),
      w(33,  "carrier",  1, "column"),
      w(38,  "asteroid", 6, "scatter"),      // rocks in a whirlpool: chaos, the fun kind
      w(41,  "shard",    5, "scatter"),
      w(44,  "weaver",   8, "twinColumns"),
      // A curved shot is only interesting if there is something worth aiming
      // it AT. The back half is parked, armoured and gold-lit rather than
      // simply more numerous - the whirlpool does the work, not the crowd.
      w(50,  "turret",   4, "sides"),
      w(56,  "striker",  6, "sides", { elite: 2 }),
      w(62,  "grunt",   10, "wall"),
      w(68,  "shielder", 2, "twinColumns"),
      w(70,  "swooper",  8, "arc", { elite: 2 }),
      w(76,  "carrier",  1, "column"),
      w(80,  "boulder",  1, "column"),
      w(84,  "sniper",   4, "sides"),
      w(90,  "hive",     3, "twinColumns"),
      w(96,  "weaver",  10, "tripleColumns", { elite: 2 }),
      w(104, "brute",    5, "pincer", { elite: 1 }),
      w(112, "turret",   5, "twinColumns", { elite: 2 }),
      w(118, "striker",  8, "wall", { elite: 2 }),
      w(126, "grunt",   13, "wall"),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    /*
     * THE STAMPEDE. The cheapest, most tightly packed formations in the game,
     * so there is always something worth flattening - and then the things you
     * would RATHER solve with an ox than with your guns: brutes, gun
     * platforms, an elite or two. Explicitly NO boulders and NO asteroids:
     * the ox must be the only big pale mass in the sky, or the lesson ("the
     * big thing is a tool, not an obstacle") gets muddled.
     */
    id:34, name:"The Stampede", subtitle:"you can't shoot them — push them",
    brief:"Something lives out here, and it is bigger than anything either side flies. Nothing you have will get through that hide — but your rounds still SHOVE. Line one up, push it across the sky, and let it walk through their formation.",
    goal:"STEER the herd into their ships",
    stampede:true,
    face:"grazer",
    waves: [
      w(1,   "grunt",      11, "wall"),
      w(9,   "weaver",     10, "tripleColumns"),
      w(17,  "interceptor", 8, "scatter"),
      w(25,  "swooper",     9, "pincer"),
      w(33,  "carrier",     1, "column"),
      w(39,  "brute",       4, "line", { elite: 1 }),
      w(47,  "grunt",      13, "wall"),
      w(54,  "turret",      5, "tripleColumns", { elite: 1 }),
      w(61,  "weaver",     11, "scatter"),
      w(69,  "interceptor", 9, "sides"),
      w(76,  "carrier",     1, "column"),
      // The back half is the argument for the ox: things you would rather
      // flatten than out-shoot. No rocks - see the note above.
      w(82,  "brute",       6, "wall", { elite: 2 }),
      // Marksmen, not Guardians: a Guardian's bubble is a big pale dome, and
      // the ox has to stay the only big pale thing in this sky.
      w(88,  "sniper",      4, "sides"),
      w(90,  "swooper",    11, "vee"),
      w(98,  "grunt",      14, "wall"),
      w(104, "turret",      5, "twinColumns", { elite: 2 }),
      w(110, "brute",       6, "tripleColumns", { elite: 2 }),
      w(118, "weaver",     12, "tripleColumns"),
    ],
    objectives: ["complete","roundUp","rescueAll"],
  },
  {
    id:35, name:"The Chorus", subtitle:"They fire on the beat",
    brief:"Listen, {you} - out here the whole fleet fires together, ON THE BEAT. Watch the sky pulse, learn the song, and weave between the verses. Silence a conductor and their whole choir forgets the words.",
    goal:"They fire ON THE BEAT — weave!",
    face:"bomber",             // the beat is a drumline of falling bombs
    beat:true,
    waves: [
      w(1,   "grunt",    8, "arc"),
      w(9,   "striker",  4, "line"),
      w(17,  "striker",  5, "vee"),
      w(25,  "turret",   2, "sides"),
      w(31,  "interceptor", 6, "pincer"),
      w(36,  "bomber",   3, "arc"),
      w(39,  "carrier",  1, "column"),
      w(44,  "striker",  6, "twinColumns", { elite:1 }),   // the first conductor
      w(52,  "sniper",   3, "arc"),
      w(58,  "weaver",   8, "wall"),
      w(66,  "turret",   4, "sides", { elite:1 }),
      w(72,  "striker",  7, "tripleColumns", { elite:2 }),
      w(80,  "interceptor", 8, "scatter"),
      w(86,  "shielder", 2, "twinColumns"),
      w(88,  "carrier",  1, "column"),
      // The full choir: a fuller CHORD, not a busier sky. More voices that
      // can hold a note (gold-lit strikers, parked guns, a hive) rather than
      // more bodies - a crowded screen is the one thing that stops a kid
      // hearing the beat they are supposed to weave through.
      w(92,  "striker", 10, "wall", { elite:3 }),
      w(100, "grunt",   12, "pincer"),
      w(106, "hive",     3, "sides"),
      w(112, "turret",   5, "twinColumns", { elite:2 }),
      w(118, "sniper",   6, "sides"),
      w(124, "striker",  9, "vee", { elite:3 }),
    ],
    objectives: ["complete","kill80","rescueAll"],
  },
  {
    /*
     * THE GLASS SEA. Symmetric formations ONLY - twinColumns, sides, pincer,
     * vee, arc. Never `column`, never `scatter`: a lone off-centre ship
     * breaks the picture and gives the twin nothing to do. Every wave arrives
     * as mirrored pairs that line up with your two guns, so "the one I can't
     * reach" always has a partner the reflection can.
     */
    id:36, name:"The Glass Sea", subtitle:"two of you",
    brief:"Nobody can explain this stretch. The sky is a mirror, and so are you — there is a second ship out there flying your flight backwards, and it fires whenever you fire. It cannot be hurt and it cannot be hit. Put yourself where it can do some good.",
    goal:"USE your reflection — it shoots too",
    mirror:true,
    face:"splitter",                  // the one that becomes two, like you
    waves: [
      w(1,   "weaver",      8, "twinColumns"),
      w(9,   "striker",     6, "sides"),
      w(17,  "interceptor", 8, "pincer"),
      w(25,  "sniper",      4, "sides"),
      w(32,  "carrier",     2, "twinColumns"),
      w(38,  "swooper",    10, "vee"),
      w(46,  "shielder",    2, "sides"),
      w(49,  "brute",       4, "twinColumns"),
      w(57,  "splitter",    6, "arc"),
      w(65,  "weaver",     12, "pincer"),
      w(73,  "turret",      5, "sides", { elite: 2 }),
      w(80,  "carrier",     2, "twinColumns"),
      // Mirrored pairs all the way down, and heavier ones late: the twin
      // earns its keep against things that take more than one pass.
      w(86,  "striker",    10, "vee", { elite: 3 }),
      w(92,  "shielder",    2, "sides"),
      w(94,  "interceptor",10, "pincer"),
      w(100, "brute",       6, "twinColumns", { elite: 2 }),
      w(108, "sniper",      6, "sides"),
      w(114, "swooper",    12, "arc", { elite: 3 }),
      w(120, "turret",      6, "sides", { elite: 2 }),
    ],
    objectives: ["complete","rescueAll","twin20"],
  },
  {
    id:37, name:"The Foundry", subtitle:"Stop the production line",
    brief:"They are BUILDING reinforcements right in front of you, {you}. Parts ride the belts toward the assembler - every part you shoot is a ship that never gets born. Starve the machine!",
    goal:"Shoot the parts on the belts!",
    face:"shielder",           // the machine guards its belts
    foundry:true,
    waves: [
      w(1,   "grunt",    8, "line"),
      w(10,  "turret",   2, "sides"),
      w(18,  "brute",    3, "twinColumns"),
      w(26,  "striker",  5, "arc"),
      w(34,  "carrier",  1, "column"),
      w(40,  "shielder", 1, "column"),
      w(42,  "grunt",    9, "pincer"),
      w(50,  "brute",    4, "tripleColumns"),
      w(58,  "mender",   1, "column"),
      w(60,  "striker",  6, "wall"),
      w(68,  "turret",   3, "sides"),
      w(76,  "carrier",  1, "column"),
      // The belts only bite if the escort makes you choose. Late waves are
      // things you cannot afford to leave alive OR ignore, so every part that
      // gets through is a decision rather than an oversight.
      w(82,  "brute",    5, "vee", { elite:2 }),
      w(90,  "grunt",   11, "scatter"),
      w(96,  "hive",     2, "sides"),
      w(98,  "shielder", 2, "column"),
      w(102, "striker",  8, "twinColumns", { elite:2 }),
      w(110, "turret",   5, "tripleColumns", { elite:2 }),
      w(118, "brute",    6, "wall", { elite:2 }),
    ],
    objectives: ["complete","denyParts","rescueAll"],
  },
  {
    id:38, name:"The Serpent's Garden", subtitle:"It eats your coins",
    brief:"Something old lives in this garden, {you}, and it is HUNGRY. The Tithe Serpent eats your coins and grows a new ring for every mouthful. Hit the glowing ring - slay it and get every penny back.",
    goal:"It EATS coins — hit the glow ring!",
    face:"serpent",            // the garden's owner, and the level's
    serpent:true,
    waves: [
      w(1,   "weaver",   7, "arc"),
      w(9,   "grunt",    8, "vee"),
      w(17,  "swooper",  6, "pincer"),
      w(25,  "hive",     1, "column"),
      w(33,  "carrier",  1, "column"),
      w(39,  "splitter", 4, "scatter"),
      w(43,  "thief",    2, "sides"),
      w(47,  "weaver",   8, "twinColumns"),
      w(55,  "swooper",  7, "arc", { elite:1 }),
      w(63,  "mender",   2, "column"),
      w(65,  "grunt",   10, "wall"),
      // The garden gets thicker the deeper in you go, and the serpent is
      // eating your coins the whole time: the late waves are the reason you
      // cannot simply farm it in circles.
      w(73,  "hive",     2, "sides"),
      w(79,  "carrier",  1, "column"),
      w(85,  "splitter", 6, "pincer", { elite:2 }),
      w(91,  "brute",    5, "twinColumns", { elite:2 }),
      w(97,  "weaver",  10, "tripleColumns", { elite:2 }),
      w(105, "turret",   4, "sides", { elite:1 }),
      w(111, "swooper",  9, "wall", { elite:2 }),
    ],
    objectives: ["complete","serpent","rescueAll"],
  },
  {
    id:39, name:"Behind the Sky", subtitle:"Where the game is made",
    brief:"The crack goes all the way through, {you} - BEHIND the sky, where skies get painted and ships get drawn. Something in the workshop has woken up, and it has been watching you play. It knows every trick you know.",
    goal:"The workshop is awake. Fly!",
    face:"rival",
    backstage:true,
    /*
     * Short on purpose, like the Devourer's: the waves are the approach, and
     * backstage.js owns everything after them - the remixes, the fake
     * endings, and the three-act boss. What spawns here is a taste of every
     * act, about to be replayed back at the player in sketch form.
     */
    waves: [
      w(1,   "grunt",   10, "vee"),
      w(9,   "weaver",   8, "twinColumns"),
      w(17,  "striker",  6, "arc", { elite:1 }),
      w(25,  "swooper",  8, "pincer"),
      w(33,  "carrier",  2, "twinColumns"),
      w(39,  "brute",    4, "wall", { elite:1 }),
      w(47,  "interceptor", 10, "scatter"),
    ],
    boss: "forgery",
    objectives: ["complete","paintSix","rescueAll"],
  },
  {
    /*
     * SKY 29 - the gift level. Gated on every star in the campaign (the gift
     * itself is excluded from the count - see profile.totalStars), and it is
     * a celebration, not a test: a parade of everything the family has
     * already beaten, painting Papa's unfinished canvas as they fly. sky29.js
     * owns the pencil veil, the last stroke and the squadron photo.
     */
    id:40, name:"Sky 40", subtitle:"the one Papa never finished",
    brief:"Behind the workshop, one canvas was left on the easel - a sky with your names pencilled in the corner. Every star you earned was a colour, {you}, and you earned ALL of them. Time to paint it. Everyone's coming.",
    goal:"Paint Papa's last sky!",
    gift:true, sky29:true, coinRain:true,
    waves: [
      w(1,  "grunt",       8, "vee"),
      w(8,  "weaver",      8, "twinColumns"),
      w(15, "swooper",     7, "arc"),
      w(21, "mine",        6, "scatter"),
      w(26, "striker",     6, "pincer"),
      w(31, "carrier",     1, "column"),
      w(36, "shielder",    4, "wall"),
      w(42, "bomber",      5, "scatter"),
      w(48, "sniper",      5, "arc"),
      w(53, "carrier",     1, "column"),
      w(58, "thief",       2, "sides"),
      w(63, "brute",       3, "wall", { elite:1 }),
      w(69, "interceptor", 9, "scatter"),
    ],
    objectives: ["complete","rescueAll","coinRush"],
  },
];

/** Missions unlock one at a time; stars gate the harder difficulty tiers instead. */
function isMissionUnlocked(profile, index){
  if(index === 0) return true;
  const prev = MISSIONS[index-1];
  const record = profile.missions && profile.missions[prev.id];
  const prevCleared = !!(record && record.cleared);
  // The gift stop wants more than the road to it: every star in the campaign.
  // (totalStars already excludes gift missions, so the bar can actually be met.)
  if(MISSIONS[index].gift)
    return prevCleared && SF.profile.totalStars(profile) >= SF.profile.maxStars();
  return prevCleared;
}

/** Total rescue pods a mission can yield: one per hauler, plus free drifters. */
function rescueCount(mission){
  return mission.waves.reduce((n, wv) =>
    n + (SF.enemyData.ENEMY_TYPES[wv.type].carriesRescue ? wv.n : 0),
    mission.podDrops || 0);
}

/** Every enemy the mission will spawn, boss minions excluded. */
function enemyCount(mission){
  return mission.waves.reduce((n, wv) => n + wv.n, 0);
}

/*
 * THE GIFT STOP, AS ONE FACT.
 *
 * Its name was written out by hand in a dozen places - the map's caption, the
 * star-hunt line, two node labels, the unlock toast, the paint it awards, the
 * banner when it is finished. Every one of those said "SKY 29", which was true
 * only for as long as the campaign was twenty-nine stops long. Adding a level
 * anywhere before it silently made all of them lie.
 *
 * So it is derived. `GIFT` is whichever mission carries the gift flag, and
 * everything that wants to name it asks here. The next time the campaign grows,
 * the whole game renames itself.
 */
const GIFT = MISSIONS.find(m => m.gift) || MISSIONS[MISSIONS.length - 1];
/** The gift stop's name in caps, for the places that shout it. */
function giftName(){ return (GIFT.name || "").toUpperCase(); }

SF.missions = { MISSIONS, BOSSES, OBJECTIVES, isMissionUnlocked, rescueCount, enemyCount,
                GIFT, giftName };
})();
