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
    hp: 460, size: 104, tint: "#ff2d55", entryY: 108,
    weakPoints: [
      { id:"leftGun",  x:-34, y:10, r:14, hp:70, disables:"spreadVolley" },
      { id:"rightGun", x: 34, y:10, r:14, hp:70, disables:"spreadVolley" },
    ],
    phases: [
      { at:1.00, speed: 70, telegraph:0.55, gap:[1.5,2.1], attacks:["spreadVolley","aimedBurst"] },
      { at:0.50, speed:110, telegraph:0.45, gap:[1.0,1.5], attacks:["spreadVolley","aimedBurst","callMinions"] },
      { at:0.20, speed:145, telegraph:0.35, gap:[0.7,1.1], attacks:["ringBurst","aimedBurst"], enrage:true },
    ],
  },
  sentinel: {
    name: "SKY SENTINEL",
    hp: 980, size: 118, tint: "#a855f7", entryY: 112,
    weakPoints: [
      { id:"core",     x:  0, y:-6, r:16, hp:150, disables:"sweepBeam" },
      { id:"leftPod",  x:-40, y:14, r:13, hp:95, disables:"ringBurst" },
      { id:"rightPod", x: 40, y:14, r:13, hp:95, disables:"callMinions" },
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
      w(0.5,  "grunt", 4, "line"),
      w(5.0,  "grunt", 5, "vee"),
      w(10.0, "grunt", 4, "arc"),
      w(15.0, "grunt", 6, "twinColumns"),
    ],
    objectives: ["complete","kill90","noDamage"],
  },
  {
    id:2, name:"Weaving Through", subtitle:"Moving targets",
    brief:"Weavers slide side to side. Lead your shots and stay under them.",
    waves: [
      w(0.5,  "grunt",  5, "line"),
      w(5.0,  "weaver", 4, "arc"),
      w(10.0, "weaver", 5, "line"),
      w(15.0, "grunt",  6, "vee"),
      w(20.0, "carrier",1, "column"),
      w(23.0, "weaver", 5, "twinColumns"),
    ],
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:3, name:"Return Fire", subtitle:"They shoot back",
    brief:"Strikers hold station and aim at you. Keep moving - never sit still.",
    waves: [
      w(0.5,  "grunt",   5, "arc"),
      w(4.5,  "striker", 3, "line"),
      w(9.0,  "weaver",  5, "twinColumns"),
      w(13.0, "striker", 4, "vee"),
      w(18.0, "carrier", 1, "column"),
      w(21.0, "grunt",   8, "scatter"),
      w(26.0, "striker", 4, "sides"),
    ],
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:4, name:"Heavy Metal", subtitle:"First boss",
    brief:"Brutes are armoured - Plasma Rounds help. Then something big arrives.",
    waves: [
      w(0.5,  "grunt",   6, "line"),
      w(5.0,  "brute",   2, "twinColumns"),
      w(10.0, "striker", 4, "arc"),
      w(15.0, "brute",   3, "line"),
      w(20.0, "carrier", 1, "column"),
      w(24.0, "turret",  2, "sides"),
    ],
    boss: "marauder",
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:5, name:"Kamikaze Run", subtitle:"Dodge or die",
    brief:"Kamikazes lock onto where you are and accelerate. Bait them, then slide away.",
    waves: [
      w(0.5,  "kamikaze", 3, "arc"),
      w(4.0,  "swooper",  4, "line"),
      w(8.5,  "kamikaze", 4, "sides"),
      w(13.0, "weaver",   6, "twinColumns"),
      w(17.5, "swooper",  5, "vee"),
      w(22.0, "carrier",  2, "twinColumns"),
      w(26.0, "kamikaze", 6, "scatter"),
    ],
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:6, name:"Prison Break", subtitle:"Rescue mission",
    brief:"Haulers are carrying our people. Shoot them down before they escape.",
    waves: [
      w(0.5,  "carrier", 1, "column"),
      w(4.0,  "striker", 4, "line"),
      w(8.0,  "carrier", 2, "twinColumns"),
      w(13.0, "swooper", 5, "arc"),
      w(17.0, "carrier", 2, "sides"),
      w(22.0, "brute",   2, "twinColumns", { elite: 1 }),
      w(27.0, "carrier", 2, "twinColumns"),
      w(31.0, "grunt",   8, "scatter"),
    ],
    objectives: ["complete","rescueAll","killAll"],
  },
  {
    id:7, name:"The Gauntlet", subtitle:"Elites inbound",
    brief:"Elite enemies glow gold - they hit hard and pay out four times as much.",
    waves: [
      w(0.5,  "weaver",   6, "arc"),
      w(4.5,  "striker",  4, "sides", { elite: 1 }),
      w(9.0,  "kamikaze", 5, "line"),
      w(13.5, "turret",   2, "twinColumns", { elite: 1 }),
      w(18.0, "brute",    3, "vee"),
      w(23.0, "carrier",  2, "twinColumns"),
      w(27.0, "swooper",  6, "scatter", { elite: 2 }),
      w(32.0, "striker",  5, "line"),
    ],
    objectives: ["complete","kill90","rescueAll"],
  },
  {
    id:8, name:"Sky Sentinel", subtitle:"Final stand",
    brief:"Everything they have left, and their flagship. Good luck out there.",
    waves: [
      w(0.5,  "grunt",    8, "arc"),
      w(4.5,  "swooper",  5, "vee", { elite: 1 }),
      w(9.0,  "striker",  5, "line"),
      w(13.5, "kamikaze", 6, "sides"),
      w(18.0, "brute",    3, "twinColumns", { elite: 1 }),
      w(23.0, "carrier",  2, "twinColumns"),
      w(27.0, "turret",   3, "arc"),
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
