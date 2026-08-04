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
  kill90:    { label:"Destroy 90% of enemies", icon:"💥",
               test: s => s.killRatio >= 0.9,
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
  keepLives: { label:"Don't lose a single life", icon:"❤️",
               test: s => s.livesLost === 0,
               progress: s => s.livesLost === 0 ? "clean" : (s.livesLost + " lost") },
  convoy:    { label:"Every hauler survives", icon:"🛡️",
               test: s => s.convoyTotal > 0 && s.convoyLost === 0,
               progress: s => (s.convoyTotal || 0) - (s.convoyLost || 0) + "/" + (s.convoyTotal || 0) },
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
      { id:"core",      x:  0, y:-40, r:24, hp:220, disables:"sweepBeam" },
      { id:"leftPod",   x:-96, y:  6, r:20, hp:150, disables:"spiralArms" },
      { id:"rightPod",  x: 96, y:  6, r:20, hp:150, disables:"ringBurst" },
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
    brief:"Fly with your finger or the arrow keys. Your guns shoot all by themselves.",
    waves: [
      // Act 1 - one shape at a time, with room to breathe
      w(1,   "grunt", 5, "line"),
      w(8,   "grunt", 6, "vee"),
      w(16,  "grunt", 6, "arc"),
      // Act 2 - two lanes, then three
      w(24,  "grunt", 6, "twinColumns"),
      w(32,  "grunt", 8, "tripleColumns"),
      w(40,  "grunt", 7, "arc"),
      // Act 3 - first taste of density
      w(48,  "grunt", 8, "wall"),
      w(56,  "grunt", 8, "pincer"),
      w(64,  "grunt", 9, "line"),
      w(72,  "grunt", 9, "scatter"),
      // Finale
      w(81,  "grunt", 10, "vee"),
      w(89,  "grunt", 12, "wall"),
    ],
    objectives: ["complete","kill90","noDamage"],
  },
  {
    id:2, name:"Weaving Through", subtitle:"Moving targets",
    brief:"These ones slide left and right. Shoot where they are going, not where they are.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:3, name:"Return Fire", subtitle:"They shoot back",
    brief:"These ones stop and aim at you. Keep moving and they will miss!",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:4, name:"Heavy Metal", subtitle:"First boss",
    brief:"Brutes wear thick armour - Plasma Rounds chew through it. Then something HUGE shows up.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:5, name:"Kamikaze Run", subtitle:"Dodge or die",
    brief:"Kamikazes pick a spot and rocket at it. Let them come close, then swerve away.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:6, name:"The Storm", subtitle:"Fly the wind",
    brief:"A nebula squall is tearing through the Belt. The wind comes in gusts - watch for the streaks, lean against the push, and don't let it shove you into a rock.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:7, name:"Prison Break", subtitle:"Rescue mission",
    brief:"Those big ships have our friends locked inside. Blast them before they get away!",
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
    id:8, name:"The Gauntlet", subtitle:"Elites inbound",
    brief:"The gold glowing ones are elites. Really tough, but they pay FOUR times as much.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:9, name:"The Convoy", subtitle:"Bring them home",
    brief:"Three supply haulers are crossing to the front with everything the squadron needs. They can't dodge and they can't shoot back - YOU are their shield. Every hauler home, pilot.",
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
    objectives: ["complete","convoy","kill90"],
  },
  {
    id:10, name:"Sky Sentinel", subtitle:"Their flagship",
    brief:"Everything they have in this sector, plus their giant flagship. You have got this.",
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
      w(70,  "boulder",  3, "tripleColumns"),
      w(65,  "swooper",  9, "pincer", { elite: 2 }),
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
    objectives: ["complete","kill90","rescueAll"],
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
    id:11, name:"Silent Running", subtitle:"Guns down. Just fly.",
    brief:"The Sentinel's last blast broke your guns! Sneak through the blockade while the crew fixes them - dodge everything, catch coins and drifting pilots.",
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

  /* =========================================================
     ACT TWO
     The Sentinel falling doesn't end the war, it starts the
     chase: 9-14 run the other way up the lane, into their
     space. Every mission here assumes you own several upgrades
     and knows every archetype by sight, so they lead with
     combinations rather than introductions.
     ========================================================= */
  {
    id:12, name:"The Wreck Line", subtitle:"Through the debris",
    brief:"The Sentinel left a whole field of scrap behind. Rocks do not shoot - they just do not move either.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:13, name:"The Hatchery", subtitle:"It keeps growing",
    brief:"Hives spit out new ships forever. Kill the hive first and the rest stops coming.",
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
    id:14, name:"The Warden", subtitle:"Their jailer",
    brief:"This one lays mines instead of shooting. Blow the hatches off its sides and it runs out of them.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  /*
   * The breather between the two hardest bosses - the customer's rule is a
   * good one: never two boss missions in a row. It's the heist level: the
   * roster leans on thieves (who steal your coins and pay them back double
   * when caught), turret-and-guardian vaults, and boulders full of pay. The
   * one mission whose third star is greed itself.
   */
  {
    id:15, name:"Their Treasury", subtitle:"Rob the robbers",
    brief:"This is where they keep everything they stole! Crack the vaults, grab EVERY coin - and watch the thieves who want them back.",
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
    objectives: ["complete","kill90","coinRush"],
  },
  {
    id:16, name:"Cold Approach", subtitle:"Line up the shot",
    brief:"Snipers draw a line before they fire. If the line is on you, move - simple as that.",
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
  {
    id:17, name:"The Trench Run", subtitle:"Thread the walls",
    brief:"Straight down the supply trench of their star fortress. The walls come in waves - read each gate, find the gap, and thread it. Or blast your own door through, if your guns are up to it.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:18, name:"All Hands", subtitle:"Everyone who is left",
    brief:"Every prisoner they still hold is on these ships. Bring all of them home.",
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
    id:19, name:"The Leviathan", subtitle:"The last one",
    brief:"Their biggest ship, and the last thing between us and home. Four weak points. Take your time.",
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
    objectives: ["complete","kill90","rescueAll"],
  },

  /* =========================================================
     ACT THREE - THE LAST STAR
     Two missions. The first is quiet on purpose: the Devourer
     hangs in the sky the whole way, too big to fight and
     getting closer, and the mission is the dread. The second
     is the fight the whole campaign has been walking toward.
     ========================================================= */
  {
    id:20, name:"The Searchlight", subtitle:"Your glow is the only light",
    brief:"They cut the power to this whole sector. Your ship's glow is the only lamp left - and there are stranded pilots drifting out there in the dark, waiting for somebody to come looking.",
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
    objectives: ["complete","rescueAll","kill90"],
  },
  {
    id:21, name:"The Long Dark", subtitle:"Something is out there",
    brief:"Their star went out last night. Fly quiet, keep your eyes open - and look at what is sitting where the light used to be.",
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
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:22, name:"The Devourer", subtitle:"The last star",
    brief:"This is the one, {you}. It ate their sun and it is coming for ours. Everything you have learned, everything you have built - all of it, right now.",
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
];

/** Missions unlock one at a time; stars gate the harder difficulty tiers instead. */
function isMissionUnlocked(profile, index){
  if(index === 0) return true;
  const prev = MISSIONS[index-1];
  const record = profile.missions && profile.missions[prev.id];
  return !!(record && record.cleared);
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

SF.missions = { MISSIONS, BOSSES, OBJECTIVES, isMissionUnlocked, rescueCount, enemyCount };
})();
