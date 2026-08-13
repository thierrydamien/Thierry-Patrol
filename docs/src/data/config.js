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

/* A pilot's own badge - picked, not earned. Rank is what the game gives you;
   this is the bit that's yours. */
/* Pickable squadron insignia, drawn in src/insignia.js. These were emoji; they
   rendered differently on every device and looked like clip art next to
   hand-drawn ships. */
const BADGES = ["star","chevrons","wings","bolt","comet","trident",
                "orbit","flame","crown","target","crescent","arrowhead",
                "hex","sixstar"];

const SHIP_COLORS = ["#3399ff", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#ff66b3"];

/* ---------------------------------------------------------
   THE PAINT SHOP
   Cosmetics with one hard rule from the customer: "if kids
   spend money it needs to be an obvious difference." So the
   shop sells only things you can see from across the room -
   whole-hull paints (the ship recolours EVERYWHERE: in
   flight, on the map, in the fleet, on the pilot card) and
   engine trails that follow you through every fight.
   The `secret` paint is never sold: it is the Star Vault's
   prize, and the shop doesn't admit it exists.
   --------------------------------------------------------- */
const PAINTS = [
  { id:"hotpink",  name:"HOT PINK",   hex:"#ff4fd8", cost:2400 },
  { id:"icewhite", name:"ICE WHITE",  hex:"#e8f4ff", cost:2400 },
  { id:"lime",     name:"LASER LIME", hex:"#a3e635", cost:2400 },
  { id:"aqua",     name:"DEEP AQUA",  hex:"#2dd4bf", cost:2400 },
  { id:"tangerine",name:"TANGERINE",  hex:"#ff7a1a", cost:2400 },
  { id:"solar",    name:"SOLAR GOLD", hex:"#f5c518", secret:true },
  // Sky 29's memento: the dawn rose off Papa's last canvas. Never sold -
  // painting the sky is the only way to wear it.
  { id:"sky29",    name:"SKY 29",     hex:"#ff9e7d", secret:true },
];
const PAINT_BY_ID = Object.fromEntries(PAINTS.map(p => [p.id, p]));
const TRAILS = [
  { id:"ember",    name:"EMBER TRAIL", color:"#ff8a3d", cost:5200,
    desc:"A river of hot sparks behind your engines." },
  { id:"ion",      name:"ION STREAM",  color:"#3fc9ff", cost:5200,
    desc:"A cool blue ribbon of charged light." },
  { id:"stardust", name:"STARDUST",    color:"#ffffff", cost:6800,
    desc:"Twinkling star-stuff wherever you fly." },
  { id:"rainbow",  name:"RAINBOW BURN", color:"rainbow", cost:9800,
    desc:"Every colour at once. The whole sky watches." },
];
const TRAIL_BY_ID = Object.fromEntries(TRAILS.map(t => [t.id, t]));
/*
 * Liveries: whole-hull paint jobs drawn by shipart. Deliberately big and
 * simple - see LIVERY_ART for why the small version was scrapped - so the
 * difference is obvious in flight, in the hangar, on the map and in the
 * finale fleet.
 */
const DECALS = [
  { id:"stripes",  name:"RACING STRIPES", cost:3200,
    desc:"Two fat white stripes, nose to tail." },
  { id:"flames",   name:"FLAME JOB",      cost:3600,
    desc:"Fire pouring up the hull from the engines." },
  { id:"bolt",     name:"LIGHTNING",      cost:3600,
    desc:"One giant gold bolt across the whole ship." },
  { id:"checkers", name:"CHEQUERED",      cost:4200,
    desc:"A racing flag painted round the middle." },
];
const DECAL_BY_ID = Object.fromEntries(DECALS.map(d => [d.id, d]));
/*
 * Victory firework shows: the palette the sky claps in after every win.
 * Classic is free and fitted from birth; the rest are bought once.
 */
const FIREWORKS = [
  { id:"classic",  name:"CLASSIC",        free:true,
    colors:["#ffd23f","#ff5d73","#4ade80","#3fc9ff","#c084fc"] },
  { id:"goldrain", name:"GOLD RAIN",      cost:3400,
    colors:["#ffd23f","#ffe9a8","#f5c518","#ff8a3d"] },
  { id:"emerald",  name:"EMERALD SKY",    cost:3400,
    colors:["#4ade80","#a3e635","#2dd4bf","#d1fae5"] },
  { id:"rainbow",  name:"RAINBOW SALUTE", cost:5200,
    colors:["#ff4fd8","#ffd23f","#4ade80","#3fc9ff","#c084fc","#ff8a3d"] },
];
const FIREWORK_BY_ID = Object.fromEntries(FIREWORKS.map(f => [f.id, f]));

/* ---------------------------------------------------------
   UPGRADES
   Four colour-coded shelves. Every upgrade has several levels
   and each level costs more than the last, so maxing the
   Armory out (~£70k) is a long-haul goal rather than an
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

/*
 * COST CURVE
 *
 * Each level costs COST_GROWTH times the last. One constant, because the
 * fourteen hand-written price lists could not be reasoned about together: a
 * simulated career (fly, bank, buy the cheapest thing, repeat) maxed the whole
 * Armory in 17 runs / 55 minutes, which is not a long-term goal, it is an
 * afternoon.
 *
 * The growth is steep on purpose. The first level of anything stays pocket
 * money so a new pilot gets a win in their first mission or two; it is the
 * last level of each track that is meant to be a trophy you fly a campaign
 * for. Prices round to 10 so they stay readable to a child.
 */
const COST_GROWTH = 4.6;   // how much steeper each level is than the last
const COST_BASE   = 1.6;   // flat multiplier on every price
function costCurve(first, levels){
  const out = [];
  for(let i=0;i<levels;i++){
    out.push(Math.round(first * COST_BASE * Math.pow(COST_GROWTH, i) / 10) * 10);
  }
  return out;
}

const UPGRADES = [
  { id:"spread", cat:"guns", name:"Spread Shot", icon:"🔱", max:5, costs:costCurve(150,5),
    desc:"Shoot more bullets at once, in a wider fan",
    effect: lvl => spreadPattern(lvl).length + "-way fire" },
  { id:"rapid", cat:"guns", name:"Rapid Fire", icon:"⚡", max:5, costs:costCurve(120,5),
    desc:"Your guns shoot way faster",
    effect: lvl => "+" + Math.round((1/fireRateMult(lvl) - 1)*100) + "% fire rate" },
  { id:"damage", cat:"guns", name:"Plasma Rounds", icon:"💥", max:5, costs:costCurve(200,5),
    desc:"Every bullet hits much harder",
    effect: lvl => (1+lvl) + " damage per hit" },
  { id:"pierce", cat:"guns", name:"Piercing Rounds", icon:"🗡️", max:3, costs:costCurve(600,3),
    desc:"Bullets punch straight through anything they blow up",
    effect: lvl => "blasts through " + (lvl === 1 ? "1 enemy" : lvl + " enemies") + " and keeps going" },
  { id:"homing", cat:"guns", name:"Seeker Rounds", icon:"🎯", max:3, costs:costCurve(500,3),
    desc:"Your bullets bend through the air to chase enemies",
    effect: lvl => "tracking " + lvl + "/3" },

  { id:"shield", cat:"armour", name:"Energy Shield", icon:"🛡️", max:4, costs:costCurve(100,4),
    desc:"A bubble that eats a hit for you. It refills when you clear a wave",
    effect: lvl => lvl + (lvl===1 ? " charge" : " charges") },
  { id:"life", cat:"armour", name:"Extra Life", icon:"❤️", max:5, costs:costCurve(80,5),
    desc:"Start every mission with extra lives",
    effect: lvl => (3+lvl) + " starting lives" },
  { id:"armor", cat:"armour", name:"Hull Plating", icon:"🧱", max:3, costs:costCurve(250,3),
    desc:"After a hit you flash and nothing can hurt you - this makes it last longer",
    effect: lvl => "+" + (lvl*0.6).toFixed(1) + "s recovery" },

  { id:"thrusters", cat:"ship", name:"Ion Thrusters", icon:"🚀", max:4, costs:costCurve(130,4),
    desc:"Zoom around faster and turn on a dime",
    effect: lvl => "+" + (lvl*14) + "% speed" },
  { id:"magnet", cat:"ship", name:"Tractor Beam", icon:"🧲", max:3, costs:costCurve(220,3),
    desc:"Coins, power-ups and rescue pods fly straight to you",
    effect: lvl => (60 + lvl*68) + "px pull range" },

  { id:"fortune", cat:"extras", name:"Salvage Rig", icon:"💰", max:5, costs:costCurve(300,5),
    desc:"Everything you blow up drops more money. Get this early!",
    effect: lvl => "+" + (lvl*15) + "% money" },
  { id:"wingman", cat:"extras", name:"Wingman Drone", icon:"🛩️", max:2, costs:costCurve(1200,2),
    desc:"Little robot buddies fly next to you and shoot too",
    effect: lvl => lvl + (lvl===1 ? " drone" : " drones") },
  { id:"bomb", cat:"extras", name:"Smart Bombs", icon:"💣", max:3, costs:costCurve(400,3),
    desc:"BOOM - wipes out the whole screen. Tap 💣 or press B",
    effect: lvl => lvl + (lvl===1 ? " bomb per mission" : " bombs per mission") },
  { id:"overdrive", cat:"extras", name:"Overdrive", icon:"🔥", max:3, costs:costCurve(600,3),
    desc:"Super mode: double speed guns and double damage. Tap 🔥 or press V",
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
  { at:0,  name:"ROOKIE CADET",   badge:"chevrons", color:"#8fd3a7" },
  { at:4,  name:"WING CADET",     badge:"wings", color:"#7fc4ff" },
  { at:10, name:"SQUADRON PILOT", badge:"star", color:"#3399ff" },
  { at:17, name:"FLIGHT LEADER",  badge:"sixstar", color:"#f39c12" },
  { at:24, name:"STAR ACE",       badge:"flame", color:"#ff8a3d" },
  { at:32, name:"WING COMMANDER", badge:"arrowhead", color:"#e74c3c" },
  { at:41, name:"SPACE LEGEND",   badge:"crown", color:"#9b59b6" },
  { at:53, name:"THIERRY LEGEND", badge:"trident", color:"#ffd23f" },
];

/* ---------------------------------------------------------
   DIFFICULTY TIERS
   Harder tiers pay far more, so grinding a hard tier funds the
   upgrades that make it comfortable. `aimed` is the share of
   shooting enemies that lead their shots; `fireRate` scales how
   often anything shoots; `smart` unlocks the cleverer enemy
   behaviours (dodging, flanking) rather than just more health.

   `density` is how many enemies a wave actually puts on the
   screen, as a multiple of what the mission script says. It
   matters more than any other knob: instrumented at the old
   settings a maxed ship on NIGHTMARE faced an average of THREE
   enemies at a time, because it deleted everything on arrival.
   Health can't fix an empty screen. (This replaces a `spawn`
   field that was declared on every tier and never read by
   anything - hard tiers had never actually been denser.)

   `hpMult` is the flat health multiplier. `hpTrack` is the part
   that follows the player's own firepower: at 0 (ROOKIE, PILOT)
   enemies stay exactly as written, so buying guns visibly makes
   them melt - that is the reward for upgrading. On the hard
   tiers it rises, so a maxed ship on NIGHTMARE meets enemies
   scaled to what it is actually carrying and the tier stays a
   test rather than a victory lap.
   --------------------------------------------------------- */
const DIFFICULTIES = [
  { id:"rookie", name:"ROOKIE", tag:"Easy", color:"#2ecc71",
    blurb:"Slow enemies, hardly any shooting, and a free extra life.",
    speed:0.72, density:0.75, hpMult:0.8, bossHp:0.8, pay:0.7,
    aimed:0, fireRate:1.6, smart:0, bonusLives:1, unlockStars:0 },
  { id:"pilot", name:"PILOT", tag:"Normal", color:"#3399ff",
    blurb:"The normal mission. Fair fight, normal pay.",
    // "Normal" is what a first-timer judges the game by. The real fix for
    // "nothing shoots back" was cadence (see enemies.js / entities.js): the
    // fleet now fires sooner and more often at every tier. On top of that
    // PILOT only aims slightly more than before - stacking density and
    // fireRate here as well measurably tipped mission 2 from comfortable to
    // failed. ROOKIE stays gentle on purpose.
    speed:1.00, density:1.00, hpMult:1.0, bossHp:1.0, pay:1.0,
    aimed:0.12, fireRate:1.15, smart:0, bonusLives:0, unlockStars:0 },
  { id:"ace", name:"ACE", tag:"Hard", color:"#f39c12",
    blurb:"Tougher enemies that aim right at you. Pays 1.8x.",
    speed:1.26, density:2.05, hpMult:2.6, bossHp:1.15, pay:1.8, hpTrack:0.35,
    aimed:0.28, fireRate:0.95, smart:1, bonusLives:0, unlockStars:6 },
  { id:"veteran", name:"VETERAN", tag:"Brutal", color:"#e74c3c",
    blurb:"Thick armour, clever attackers, bullets everywhere. Pays 2.8x.",
    speed:1.50, density:2.80, hpMult:4.4, bossHp:1.3, pay:2.8, hpTrack:0.6,
    aimed:0.45, fireRate:0.82, smart:2, bonusLives:0, unlockStars:14 },
  { id:"nightmare", name:"NIGHTMARE", tag:"Insane", color:"#9b59b6",
    blurb:"All of it at once. Bring your very best gear. Pays 4.5x.",
    speed:1.80, density:3.60, hpMult:7.5, bossHp:1.5, pay:4.5, hpTrack:0.85,
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
  { id:"high_roller",  icon:"🤑", name:"High Roller",     desc:"Earn £1,000 (lifetime)",              check:p=>p.lifetimeMoney>=1000 },
  { id:"warchest",     icon:"🏦", name:"War Chest",       desc:"Earn £25,000 (lifetime)",             check:p=>p.lifetimeMoney>=25000 },
  { id:"first_upgrade",icon:"🔧", name:"Kitted Out",      desc:"Buy your first Armory upgrade",       check:p=>p.gearLevel>=1 },
  { id:"maxed_one",    icon:"🌟", name:"Specialist",      desc:"Max out any single upgrade",          check:p=>p.anyUpgradeMaxed },
  { id:"quartermaster",icon:"📦", name:"Quartermaster",   desc:"Buy 20 upgrade levels in total",      check:p=>p.gearLevel>=20 },
  { id:"big_spender",  icon:"💰", name:"Fully Loaded",    desc:"Max out every Armory upgrade",        check:p=>p.allUpgradesMaxed },
  { id:"ace_pilot",    icon:"🥇", name:"Ace Pilot",       desc:"Complete a mission on ACE",           check:p=>p.hardestCleared>=2 },
  { id:"veteran_wings",icon:"🎗️", name:"Veteran Wings",   desc:"Complete a mission on VETERAN",       check:p=>p.hardestCleared>=3 },
  { id:"nightmare",    icon:"👑", name:"Nightmare Fuel",  desc:"Complete a mission on NIGHTMARE",     check:p=>p.hardestCleared>=4 },
  { id:"campaign",     icon:"🏆", name:"Thierry Patrol", desc:"Complete every mission",              check:p=>p.campaignComplete },
  // ids stay "daily_*": medals are stored on profiles by id, and renaming the
  // id would silently un-earn them. Only the flavour moved to the Wacky Sky.
  { id:"daily_ace",    icon:"🎲", name:"Sky Spinner",     desc:"Score 3,000 in the Wacky Sky",        check:p=>p.endlessBest>=3000 },
  { id:"daily_iron",   icon:"⏱️", name:"Iron Wings",      desc:"Last 4 minutes in the Wacky Sky",     check:p=>p.endlessLongest>=240 },
  { id:"gauntlet",     icon:"☠️", name:"Gauntlet Runner", desc:"Beat 3 bosses in one Boss Rush",      check:p=>p.bossRushBest>=3 },
  { id:"devourer",     icon:"🌟", name:"The Last Star",   desc:"Destroy the Devourer",                check:p=>p.devourerDown },
  { id:"rush_master",  icon:"🏴", name:"Rush Master",     desc:"Beat 5 bosses in one Boss Rush",      check:p=>p.bossRushBest>=5 },
];

/*
 * Every medal pays a one-time cash reward, claimed by hand on the Medals
 * screen. Two reasons it is a claim rather than an automatic credit: pressing
 * the button IS the reward ceremony, and an unclaimed medal is a concrete
 * reason to visit a screen that used to be a scoreboard of things that had
 * already happened.
 */
const MEDAL_PAY_DEFAULT = 500;
const MEDAL_PAY = {
  first_blood: 200, sharpshooter: 400, boss_slayer: 800,
  maxed_one: 1500, quartermaster: 2000, big_spender: 6000, rush_master: 2500,
  devourer: 10000,
  ace_pilot: 1200, veteran_wings: 2500, nightmare: 5000, campaign: 5000,
};
ACHIEVEMENTS.forEach(a => { a.pay = MEDAL_PAY[a.id] || MEDAL_PAY_DEFAULT; });

/* ---------------------------------------------------------
   SUPPLY DROPS
   The rare tier above powerups: one or two per mission,
   announced when they enter, worth flying into traffic for.
   Weights are relative; silent (no-gun) missions only draw
   from the entries marked `calm`, because a bomb you cannot
   fire is a prize that insults the winner.
   --------------------------------------------------------- */
const SUPPLIES = [
  { id:"bomb",       label:"SMART BOMB +1",  color:"#ff8a3d", weight:30 },
  { id:"overdrive",  label:"OVERDRIVE +1",   color:"#ffd23f", weight:30 },
  { id:"shieldFull", label:"SHIELDS FULL",   color:"#7cc4ff", weight:25, calm:true },
  { id:"life",       label:"EXTRA LIFE",     color:"#ff5d73", weight:15, calm:true },
];

/* ---------------------------------------------------------
   FLIGHT TUNING
   Three tunes of the same hull, chosen in MY SHIP. Stats
   only - the art stays the one good ship (code-drawn hull
   variants would hit the same quality ceiling the drawn
   faces did). Rule: every tune that gains something gives
   something up, so there is no "best", only a playstyle.
   `fire` multiplies the fire INTERVAL - above 1 = slower.
   --------------------------------------------------------- */
const TUNES = [
  { id:"vanguard", name:"VANGUARD",
    blurb:"The ship as the yard built it.",
    pros:["ready for anything"], cons:[],
    speed:1.00, fire:1.00, lives:0 },
  { id:"falcon",   name:"FALCON", unlockMission:4,
    blurb:"The Marauder's engines, bolted on. Swept fins, hot twin plumes.",
    pros:["+22% speed"], cons:["slower guns"],
    speed:1.22, fire:1.12, lives:0 },
  { id:"titan",    name:"TITAN", unlockMission:7,
    blurb:"The Jailer's armour plates. A spare seat and slabs down the flanks.",
    pros:["+1 life"], cons:["-12% speed","slower guns"],
    speed:0.88, fire:1.05, lives:1 },
  { id:"viper",    name:"VIPER", unlockMission:10,
    blurb:"The Sentinel's overclocked cannons on twin rails.",
    pros:["+14% fire rate"], cons:["-8% speed"],
    speed:0.92, fire:0.88, lives:0 },
  { id:"scavenger",name:"SCAVENGER", unlockMission:15,
    blurb:"The Warden's collector rig. A golden scoop under the nose.",
    pros:["coins fly to you","+12% pay"], cons:["slower guns"],
    speed:1.00, fire:1.06, lives:0, magnet:1.7, money:1.12 },
  { id:"ghost",    name:"GHOST", unlockMission:17,
    blurb:"The Phantom's phase plating. A shimmer that shrugs off trouble.",
    pros:["+5% speed","longer safety after a hit"], cons:["slower guns"],
    speed:1.05, fire:1.08, lives:0, invuln:1.5 },
  /* The final boss's trophy breaks the every-gain-has-a-cost rule on
     purpose: it is THE reward for finishing the campaign. */
  { id:"nova",     name:"NOVA", unlockMission:23, apex:true,
    blurb:"The Devourer's own core, cut down and caged in your hull. It hums.",
    pros:["+12% speed","+10% fire rate","+1 life","coins fly to you"], cons:[],
    speed:1.12, fire:0.90, lives:1, magnet:1.5 },
  { id:"apex",     name:"APEX", unlockMission:20, apex:true,
    blurb:"The Leviathan's core, fitted to your ship. Gold trim. No trade-offs - you earned it.",
    pros:["+8% speed","+5% fire rate","+1 life"], cons:[],
    speed:1.08, fire:0.95, lives:1 },
];
const TUNE_BY_ID = {};
TUNES.forEach(t => TUNE_BY_ID[t.id] = t);

SF.config = {
  SHIP_COLORS, PAINTS, PAINT_BY_ID, TRAILS, TRAIL_BY_ID,
  DECALS, DECAL_BY_ID, FIREWORKS, FIREWORK_BY_ID,
  BADGES, CATEGORIES, UPGRADES, UPGRADE_BY_ID, MAX_UPGRADE_LEVELS, TOTAL_UPGRADE_COST,
  RANKS, DIFFICULTIES, DIFFICULTY_BY_ID, POWERUPS, ACHIEVEMENTS, TUNES, TUNE_BY_ID, SUPPLIES,
  spreadPattern, fireRateMult,
};
})();
