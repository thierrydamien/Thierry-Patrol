/*
 * Player-facing configuration data: ship colours, the upgrade catalogue,
 * pilot ranks, difficulty tiers, power-ups and achievements.
 *
 * This is data, not logic, on purpose - tuning the economy or adding an
 * upgrade means editing a table here, never touching the game loop.
 */
(function(){
"use strict";
const SF = window.SF;

const SHIP_COLORS = ["#3399ff", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#ff66b3"];

/* ---------------------------------------------------------
   UPGRADES
   Four colour-coded shelves. Every upgrade has several levels
   and each level costs more than the last, so maxing the
   Armory out (~$70k) is a long-haul goal rather than an
   afternoon's shopping.
   --------------------------------------------------------- */
const CATEGORIES = [
  { id:"guns",   name:"GUNS",          icon:"🔫", color:"#ff8a3d" },
  { id:"armour", name:"STAYING ALIVE", icon:"🛡️", color:"#3fc9ff" },
  { id:"ship",   name:"SHIP",          icon:"🚀", color:"#9b6bff" },
  { id:"extras", name:"SPECIALS",      icon:"✨", color:"#ffd23f" },
];

/** Horizontal bullet velocities fired at a given Spread Shot level. */
function spreadPattern(lvl){
  return [[0], [-45,45], [-110,0,110], [-150,-50,50,150],
          [-190,-95,0,95,190], [-230,-140,-50,50,140,230]][lvl] || [0];
}
/** Fire-interval multiplier at a given Rapid Fire level (lower = faster). */
function fireRateMult(lvl){ return [1, 0.85, 0.72, 0.62, 0.53, 0.45][lvl] || 1; }

const UPGRADES = [
  { id:"spread", cat:"guns", name:"Spread Shot", icon:"🔱", max:5, costs:[150,400,900,1800,3200],
    desc:"More bullets in every shot",
    effect: lvl => spreadPattern(lvl).length + "-way fire" },
  { id:"rapid", cat:"guns", name:"Rapid Fire", icon:"⚡", max:5, costs:[120,320,750,1500,2800],
    desc:"Shorter gap between shots",
    effect: lvl => "+" + Math.round((1/fireRateMult(lvl) - 1)*100) + "% fire rate" },
  { id:"damage", cat:"guns", name:"Plasma Rounds", icon:"💥", max:5, costs:[200,500,1100,2200,4000],
    desc:"Each bullet hits harder",
    effect: lvl => (1+lvl) + " damage per hit" },
  { id:"pierce", cat:"guns", name:"Piercing Rounds", icon:"🗡️", max:3, costs:[600,1600,3400],
    desc:"Bullets punch through enemies instead of stopping",
    effect: lvl => "hits " + (1+lvl) + " enemies per bullet" },
  { id:"homing", cat:"guns", name:"Seeker Rounds", icon:"🎯", max:3, costs:[500,1400,3000],
    desc:"Bullets curve toward the nearest target",
    effect: lvl => "tracking " + lvl + "/3" },

  { id:"shield", cat:"armour", name:"Energy Shield", icon:"🛡️", max:4, costs:[100,350,900,2000],
    desc:"Absorbs hits; one charge comes back each wave cleared",
    effect: lvl => lvl + (lvl===1 ? " charge" : " charges") },
  { id:"life", cat:"armour", name:"Extra Life", icon:"❤️", max:5, costs:[80,240,600,1400,2600],
    desc:"Start every mission with more lives",
    effect: lvl => (3+lvl) + " starting lives" },
  { id:"armor", cat:"armour", name:"Hull Plating", icon:"🧱", max:3, costs:[250,700,1600],
    desc:"Longer blinking-invincible window after you take a hit",
    effect: lvl => "+" + (lvl*0.6).toFixed(1) + "s recovery" },

  { id:"thrusters", cat:"ship", name:"Ion Thrusters", icon:"🚀", max:4, costs:[130,340,800,1700],
    desc:"Fly faster and turn sharper",
    effect: lvl => "+" + (lvl*14) + "% speed" },
  { id:"magnet", cat:"ship", name:"Tractor Beam", icon:"🧲", max:3, costs:[220,600,1400],
    desc:"Drags nearby coins, pick-ups and rescue pods toward you",
    effect: lvl => (60 + lvl*68) + "px pull range" },

  { id:"fortune", cat:"extras", name:"Salvage Rig", icon:"💰", max:5, costs:[300,700,1500,3000,5500],
    desc:"Every kill pays out more - buy this early, it pays for itself",
    effect: lvl => "+" + (lvl*15) + "% money" },
  { id:"wingman", cat:"extras", name:"Wingman Drone", icon:"🛩️", max:2, costs:[1200,3000],
    desc:"Escort drones that fire alongside you",
    effect: lvl => lvl + (lvl===1 ? " drone" : " drones") },
  { id:"bomb", cat:"extras", name:"Smart Bombs", icon:"💣", max:3, costs:[400,1000,2200],
    desc:"Screen-clearing blast. Tap 💣 or press B",
    effect: lvl => lvl + (lvl===1 ? " bomb per mission" : " bombs per mission") },
  { id:"overdrive", cat:"extras", name:"Overdrive", icon:"🔥", max:3, costs:[600,1500,3200],
    desc:"Doubles your fire rate and damage for a few seconds. Tap 🔥 or press V",
    effect: lvl => lvl + " use" + (lvl===1?"":"s") + " · " + (4 + lvl) + "s each" },
];
const UPGRADE_BY_ID = {};
UPGRADES.forEach(u => UPGRADE_BY_ID[u.id] = u);
const MAX_UPGRADE_LEVELS = UPGRADES.reduce((n,u) => n + u.max, 0);
const TOTAL_UPGRADE_COST = UPGRADES.reduce((n,u) => n + u.costs.reduce((a,b)=>a+b,0), 0);

/* ---------------------------------------------------------
   PILOT RANKS - earned from gear owned, shown everywhere.
   --------------------------------------------------------- */
const RANKS = [
  { at:0,  name:"ROOKIE CADET",   badge:"🌱", color:"#8fd3a7" },
  { at:4,  name:"WING CADET",     badge:"🛩️", color:"#7fc4ff" },
  { at:10, name:"SQUADRON PILOT", badge:"⭐", color:"#3399ff" },
  { at:17, name:"FLIGHT LEADER",  badge:"🌟", color:"#f39c12" },
  { at:24, name:"STAR ACE",       badge:"🔥", color:"#ff8a3d" },
  { at:32, name:"WING COMMANDER", badge:"🚀", color:"#e74c3c" },
  { at:41, name:"SPACE LEGEND",   badge:"👑", color:"#9b59b6" },
  { at:53, name:"THIERRY LEGEND", badge:"🏆", color:"#ffd23f" },
];

/* ---------------------------------------------------------
   DIFFICULTY TIERS
   Harder tiers pay far more, so grinding a hard tier funds the
   upgrades that make it comfortable. `aimed` is the share of
   shooting enemies that lead their shots; `fireRate` scales how
   often anything shoots; `smart` unlocks the cleverer enemy
   behaviours (dodging, flanking) rather than just more health.
   --------------------------------------------------------- */
const DIFFICULTIES = [
  { id:"rookie", name:"ROOKIE", tag:"Easy", color:"#2ecc71",
    blurb:"Slow enemies, sparse fire, a free extra life.",
    speed:0.72, spawn:1.35, hpMult:0.8, bossHp:0.65, pay:0.7,
    aimed:0, fireRate:1.6, smart:0, bonusLives:1, unlockStars:0 },
  { id:"pilot", name:"PILOT", tag:"Normal", color:"#3399ff",
    blurb:"The standard mission. Balanced pay.",
    speed:1.00, spawn:1.00, hpMult:1.0, bossHp:1.00, pay:1.0,
    aimed:0.10, fireRate:1.15, smart:0, bonusLives:0, unlockStars:0 },
  { id:"ace", name:"ACE", tag:"Hard", color:"#f39c12",
    blurb:"Armoured enemies that aim at you. Pays 1.8x.",
    speed:1.26, spawn:0.80, hpMult:1.6, bossHp:1.35, pay:1.8,
    aimed:0.28, fireRate:0.95, smart:1, bonusLives:0, unlockStars:6 },
  { id:"veteran", name:"VETERAN", tag:"Brutal", color:"#e74c3c",
    blurb:"Heavy armour, smarter attackers, lots of return fire. Pays 2.8x.",
    speed:1.50, spawn:0.66, hpMult:2.3, bossHp:1.7, pay:2.8,
    aimed:0.45, fireRate:0.82, smart:2, bonusLives:0, unlockStars:14 },
  { id:"nightmare", name:"NIGHTMARE", tag:"Insane", color:"#9b59b6",
    blurb:"Everything at once. Only worth trying fully kitted out. Pays 4.5x.",
    speed:1.80, spawn:0.52, hpMult:3.2, bossHp:2.2, pay:4.5,
    aimed:0.62, fireRate:0.7, smart:3, bonusLives:0, unlockStars:24 },
];
const DIFFICULTY_BY_ID = {};
DIFFICULTIES.forEach(d => DIFFICULTY_BY_ID[d.id] = d);

/* ---------------------------------------------------------
   FLOATING PICK-UPS
   --------------------------------------------------------- */
const POWERUPS = [
  { id:"rapid",  color:"#ffd23f", glyph:"R",  label:"RAPID FIRE" },
  { id:"spread", color:"#3399ff", glyph:"S",  label:"SPREAD SHOT" },
  { id:"shield", color:"#2ecc71", glyph:"+",  label:"SHIELD UP" },
  { id:"score2x",color:"#ff66b3", glyph:"x2", label:"DOUBLE SCORE" },
  { id:"homing", color:"#22d3ee", glyph:"H",  label:"HOMING SHOT" },
];

/* ---------------------------------------------------------
   ACHIEVEMENTS
   --------------------------------------------------------- */
const ACHIEVEMENTS = [
  { id:"first_blood",  icon:"💥", name:"First Blood",    desc:"Destroy your first enemy",            check:p=>p.totalKills>=1 },
  { id:"sharpshooter", icon:"🎯", name:"Sharpshooter",   desc:"Reach a x5 combo",                    check:p=>p.maxCombo>=5 },
  { id:"combo_master", icon:"⚡", name:"Combo Master",   desc:"Reach a x10 combo",                   check:p=>p.maxCombo>=10 },
  { id:"first_win",    icon:"🎖️", name:"Mission Complete",desc:"Finish your first mission",          check:p=>p.missionsCompleted>=1 },
  { id:"three_star",   icon:"⭐", name:"Full Marks",      desc:"Earn 3 stars on any mission",         check:p=>p.bestStarsOnAnyMission>=3 },
  { id:"star_hoard",   icon:"🌠", name:"Star Collector",  desc:"Collect 15 stars in total",           check:p=>p.totalStars>=15 },
  { id:"rescuer",      icon:"🧑‍🚀", name:"Search & Rescue", desc:"Rescue 25 stranded pilots",        check:p=>p.rescues>=25 },
  { id:"boss_slayer",  icon:"👾", name:"Boss Slayer",     desc:"Defeat a boss",                       check:p=>p.bossesDefeated>=1 },
  { id:"boss_hunter",  icon:"🛡️", name:"Boss Hunter",     desc:"Defeat 5 bosses",                     check:p=>p.bossesDefeated>=5 },
  { id:"untouchable",  icon:"🧿", name:"Untouchable",     desc:"Finish a mission without a scratch",  check:p=>p.flawlessMissions>=1 },
  { id:"century",      icon:"💯", name:"Century Club",    desc:"Destroy 100 enemies (lifetime)",      check:p=>p.totalKills>=100 },
  { id:"thousand",     icon:"☄️", name:"Sky Sweeper",     desc:"Destroy 1000 enemies (lifetime)",     check:p=>p.totalKills>=1000 },
  { id:"high_roller",  icon:"🤑", name:"High Roller",     desc:"Earn $1,000 (lifetime)",              check:p=>p.lifetimeMoney>=1000 },
  { id:"warchest",     icon:"🏦", name:"War Chest",       desc:"Earn $25,000 (lifetime)",             check:p=>p.lifetimeMoney>=25000 },
  { id:"first_upgrade",icon:"🔧", name:"Kitted Out",      desc:"Buy your first Armory upgrade",       check:p=>p.gearLevel>=1 },
  { id:"maxed_one",    icon:"🌟", name:"Specialist",      desc:"Max out any single upgrade",          check:p=>p.anyUpgradeMaxed },
  { id:"quartermaster",icon:"📦", name:"Quartermaster",   desc:"Buy 20 upgrade levels in total",      check:p=>p.gearLevel>=20 },
  { id:"big_spender",  icon:"💰", name:"Fully Loaded",    desc:"Max out every Armory upgrade",        check:p=>p.allUpgradesMaxed },
  { id:"ace_pilot",    icon:"🥇", name:"Ace Pilot",       desc:"Complete a mission on ACE",           check:p=>p.hardestCleared>=2 },
  { id:"veteran_wings",icon:"🎗️", name:"Veteran Wings",   desc:"Complete a mission on VETERAN",       check:p=>p.hardestCleared>=3 },
  { id:"nightmare",    icon:"👑", name:"Nightmare Fuel",  desc:"Complete a mission on NIGHTMARE",     check:p=>p.hardestCleared>=4 },
  { id:"campaign",     icon:"🏆", name:"Sky Force",       desc:"Complete every mission",              check:p=>p.campaignComplete },
];

SF.config = {
  SHIP_COLORS, CATEGORIES, UPGRADES, UPGRADE_BY_ID, MAX_UPGRADE_LEVELS, TOTAL_UPGRADE_COST,
  RANKS, DIFFICULTIES, DIFFICULTY_BY_ID, POWERUPS, ACHIEVEMENTS,
  spreadPattern, fireRateMult,
};
})();
