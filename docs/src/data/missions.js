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
  keepLives: { label:"Don't lose a single life", icon:"❤️",
               test: s => s.livesLost === 0,
               progress: s => s.livesLost === 0 ? "clean" : (s.livesLost + " lost") },
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
    name: "THE MARAUDER",
    hp: 380, size: 132, tint: "#ff2d55", entryY: 150,
    weakPoints: [
      { id:"leftGun",  x:-44, y:14, r:18, hp:70, disables:"spreadVolley" },
      { id:"rightGun", x: 44, y:14, r:18, hp:70, disables:"spreadVolley" },
    ],
    phases: [
      { at:1.00, speed: 70, telegraph:0.55, gap:[1.5,2.1], attacks:["spreadVolley","aimedBurst"] },
      { at:0.50, speed:110, telegraph:0.45, gap:[1.0,1.5], attacks:["spreadVolley","aimedBurst","callMinions"] },
      { at:0.20, speed:145, telegraph:0.35, gap:[0.7,1.1], attacks:["ringBurst","aimedBurst"], enrage:true },
    ],
  },
  sentinel: {
    name: "SKY SENTINEL",
    hp: 820, size: 150, tint: "#a855f7", entryY: 158,
    weakPoints: [
      { id:"core",     x:  0, y:-8, r:20, hp:150, disables:"sweepBeam" },
      { id:"leftPod",  x:-52, y:18, r:17, hp:95, disables:"ringBurst" },
      { id:"rightPod", x: 52, y:18, r:17, hp:95, disables:"callMinions" },
    ],
    phases: [
      { at:1.00, speed: 80, telegraph:0.55, gap:[1.4,1.9], attacks:["spreadVolley","sweepBeam"] },
      { at:0.66, speed:120, telegraph:0.45, gap:[1.0,1.4], attacks:["ringBurst","aimedBurst","callMinions"] },
      { at:0.33, speed:165, telegraph:0.32, gap:[0.6,1.0], attacks:["ringBurst","sweepBeam","aimedBurst"], enrage:true },
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
    brief:"Fly with your finger or the arrow keys. Your guns fire on their own.",
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
    brief:"Weavers slide side to side. Lead your shots and use the whole width.",
    waves: [
      w(1,   "grunt",  6, "line"),
      w(8,   "weaver", 5, "arc"),
      w(15,  "weaver", 6, "tripleColumns"),
      w(23,  "grunt",  8, "vee"),
      w(31,  "weaver", 7, "twinColumns"),
      w(39,  "grunt",  9, "wall"),
      w(47,  "carrier",1, "column"),        // first rescue
      w(52,  "weaver", 7, "arc"),
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
    brief:"Strikers hold station and aim at you. Keep moving - never sit still.",
    waves: [
      w(1,   "grunt",   7, "arc"),
      w(8,   "striker", 3, "line"),
      w(16,  "weaver",  7, "twinColumns"),
      w(24,  "striker", 4, "vee"),
      w(32,  "grunt",  10, "scatter"),
      w(40,  "striker", 4, "sides"),
      w(48,  "carrier", 1, "column"),
      w(53,  "weaver",  8, "wall"),
      w(61,  "striker", 5, "tripleColumns"),
      w(69,  "grunt",  10, "pincer"),
      w(77,  "striker", 5, "arc"),
      w(85,  "weaver",  9, "line"),
      w(93,  "carrier", 1, "column"),
      w(98,  "striker", 6, "sides"),
      w(106, "grunt",  12, "wall"),
      w(114, "striker", 6, "vee"),
    ],
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:4, name:"Heavy Metal", subtitle:"First boss",
    brief:"Brutes are armoured - Plasma Rounds help. Then something big arrives.",
    waves: [
      w(1,   "grunt",   8, "line"),
      w(8,   "brute",   2, "twinColumns"),
      w(16,  "striker", 4, "arc"),
      w(24,  "brute",   3, "tripleColumns"),
      w(32,  "grunt",  10, "wall"),
      w(40,  "turret",  2, "sides"),
      w(49,  "carrier", 1, "column"),
      w(54,  "striker", 5, "vee"),
      w(62,  "brute",   4, "line"),
      w(70,  "grunt",  11, "pincer"),
      w(78,  "turret",  3, "tripleColumns"),
      w(87,  "striker", 6, "scatter"),
      w(95,  "brute",   4, "twinColumns"),
      w(103, "grunt",  12, "wall"),
    ],
    boss: "marauder",
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:5, name:"Kamikaze Run", subtitle:"Dodge or die",
    brief:"Kamikazes lock onto where you are and accelerate. Bait them, then slide away.",
    waves: [
      w(1,   "kamikaze", 3, "arc"),
      w(8,   "swooper",  4, "line"),
      w(15,  "kamikaze", 5, "sides"),
      w(23,  "weaver",   8, "tripleColumns"),
      w(31,  "swooper",  6, "vee"),
      w(39,  "kamikaze", 6, "pincer"),
      w(47,  "carrier",  1, "column"),
      w(52,  "swooper",  7, "arc"),
      w(60,  "grunt",   11, "wall"),
      w(68,  "kamikaze", 7, "scatter"),
      w(76,  "swooper",  7, "twinColumns"),
      w(84,  "carrier",  1, "column"),
      w(89,  "kamikaze", 8, "sides"),
      w(97,  "weaver",  10, "line"),
      w(105, "swooper",  8, "pincer"),
      w(113, "kamikaze", 9, "arc"),
      w(121, "grunt",   12, "wall"),
    ],
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:6, name:"Prison Break", subtitle:"Rescue mission",
    brief:"Haulers are carrying our people. Shoot them down before they escape.",
    waves: [
      w(1,   "carrier", 1, "column"),
      w(7,   "striker", 4, "line"),
      w(15,  "carrier", 2, "twinColumns"),
      w(23,  "swooper", 6, "arc"),
      w(31,  "carrier", 2, "sides"),
      w(39,  "brute",   3, "tripleColumns", { elite: 1 }),
      w(48,  "grunt",  11, "wall"),
      w(56,  "carrier", 2, "twinColumns"),
      w(64,  "striker", 6, "vee"),
      w(72,  "swooper", 8, "pincer"),
      w(80,  "carrier", 3, "tripleColumns"),
      w(89,  "weaver",  9, "arc"),
      w(97,  "brute",   4, "line", { elite: 1 }),
      w(105, "carrier", 2, "sides"),
      w(113, "grunt",  12, "scatter"),
      w(121, "striker", 7, "wall"),
      w(129, "carrier", 3, "tripleColumns"),
    ],
    objectives: ["complete","rescueAll","killAll"],
  },
  {
    id:7, name:"The Gauntlet", subtitle:"Elites inbound",
    brief:"Elite enemies glow gold - they hit hard and pay out four times as much.",
    waves: [
      w(1,   "weaver",   8, "arc"),
      w(8,   "striker",  5, "sides", { elite: 1 }),
      w(16,  "kamikaze", 6, "pincer"),
      w(24,  "turret",   2, "twinColumns", { elite: 1 }),
      w(33,  "brute",    4, "vee"),
      w(41,  "grunt",   12, "wall"),
      w(49,  "carrier",  2, "twinColumns"),
      w(57,  "swooper",  8, "scatter", { elite: 2 }),
      w(65,  "striker",  7, "line"),
      w(73,  "kamikaze", 8, "sides"),
      w(81,  "brute",    4, "tripleColumns", { elite: 2 }),
      w(90,  "weaver",  10, "pincer"),
      w(98,  "turret",   3, "arc", { elite: 1 }),
      w(107, "carrier",  2, "sides"),
      w(115, "swooper",  9, "vee", { elite: 2 }),
      w(123, "grunt",   13, "wall"),
      w(131, "striker",  8, "tripleColumns", { elite: 2 }),
      w(139, "kamikaze",10, "scatter"),
    ],
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:8, name:"Sky Sentinel", subtitle:"Final stand",
    brief:"Everything they have left, and their flagship. Good luck out there.",
    waves: [
      w(1,   "grunt",   10, "arc"),
      w(8,   "swooper",  6, "vee", { elite: 1 }),
      w(16,  "striker",  6, "line"),
      w(24,  "kamikaze", 7, "sides"),
      w(32,  "brute",    4, "tripleColumns", { elite: 1 }),
      w(41,  "weaver",  10, "wall"),
      w(49,  "carrier",  2, "twinColumns"),
      w(57,  "turret",   3, "arc"),
      w(65,  "swooper",  9, "pincer", { elite: 2 }),
      w(73,  "striker",  7, "sides"),
      w(81,  "brute",    5, "line", { elite: 2 }),
      w(90,  "kamikaze", 9, "scatter"),
      w(98,  "weaver",  11, "tripleColumns"),
      w(106, "grunt",   13, "wall"),
      w(114, "striker",  8, "vee", { elite: 2 }),
      w(122, "turret",   4, "twinColumns", { elite: 1 }),
      w(130, "swooper", 10, "arc", { elite: 2 }),
      w(138, "kamikaze",11, "pincer"),
    ],
    boss: "sentinel",
    objectives: ["complete","kill90","rescueAll"],
  },
];

/** Missions unlock one at a time; stars gate the harder difficulty tiers instead. */
function isMissionUnlocked(profile, index){
  if(index === 0) return true;
  const prev = MISSIONS[index-1];
  const record = profile.missions && profile.missions[prev.id];
  return !!(record && record.cleared);
}

/** Total rescue pods a mission can yield (one per hauler). */
function rescueCount(mission){
  return mission.waves.reduce((n, wv) =>
    n + (SF.enemyData.ENEMY_TYPES[wv.type].carriesRescue ? wv.n : 0), 0);
}

/** Every enemy the mission will spawn, boss minions excluded. */
function enemyCount(mission){
  return mission.waves.reduce((n, wv) => n + wv.n, 0);
}

SF.missions = { MISSIONS, BOSSES, OBJECTIVES, isMissionUnlocked, rescueCount, enemyCount };
})();
