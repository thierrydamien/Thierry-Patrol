(function(){
"use strict";

/* =========================================================
   CONFIG
   ========================================================= */
const VW = 390, VH = 620;

// The ship can fly anywhere in the playfield, but not so high that it sits on
// top of the spawn line (or behind the HUD) - this is the ceiling it stops at.
const PLAY_TOP = 118;

const SHIP_COLORS = ["#3399ff", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#ff66b3"];

/* ---------------------------------------------------------
   UPGRADES
   Every item has several levels and each level costs more than
   the one before it, so fully maxing the Armory is a long-haul
   goal (~$65k of kills) rather than something you finish in an
   afternoon. `effect` describes what owning `lvl` levels does.
   --------------------------------------------------------- */
/* Upgrades are grouped into four colour-coded shelves in the Armory so the
   list reads as a kit to build, not a wall of text. */
const CATEGORIES = [
  { id:"guns",   name:"GUNS",          icon:"🔫", color:"#ff8a3d" },
  { id:"armour", name:"STAYING ALIVE", icon:"🛡️", color:"#3fc9ff" },
  { id:"ship",   name:"SHIP",          icon:"🚀", color:"#9b6bff" },
  { id:"extras", name:"SPECIALS",      icon:"✨", color:"#ffd23f" },
];

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
    desc:"Absorbs hits; one charge comes back each level cleared",
    effect: lvl => lvl + (lvl===1 ? " charge" : " charges") },
  { id:"life", cat:"armour", name:"Extra Life", icon:"❤️", max:5, costs:[80,240,600,1400,2600],
    desc:"Start every run with more lives",
    effect: lvl => (3+lvl) + " starting lives" },
  { id:"thrusters", cat:"ship", name:"Ion Thrusters", icon:"🚀", max:4, costs:[130,340,800,1700],
    desc:"Steer faster — the main way to survive fast enemies",
    effect: lvl => "+" + (lvl*15) + "% ship speed" },
  { id:"armor", cat:"armour", name:"Hull Plating", icon:"🧱", max:3, costs:[250,700,1600],
    desc:"Longer blinking-invincible window after you take a hit",
    effect: lvl => "+" + (lvl*0.6).toFixed(1) + "s recovery" },
  { id:"magnet", cat:"ship", name:"Tractor Beam", icon:"🧲", max:3, costs:[220,600,1400],
    desc:"Drags nearby power-ups toward your ship",
    effect: lvl => (lvl*45) + "px pull range" },
  { id:"fortune", cat:"extras", name:"Salvage Rig", icon:"💰", max:5, costs:[300,700,1500,3000,5500],
    desc:"Every kill pays out more — buy this early, it pays for itself",
    effect: lvl => "+" + (lvl*15) + "% money" },
  { id:"wingman", cat:"extras", name:"Wingman Drone", icon:"🛩️", max:2, costs:[1200,3000],
    desc:"Escort drones that fire alongside you",
    effect: lvl => lvl + (lvl===1 ? " drone" : " drones") },
  { id:"bomb", cat:"extras", name:"Smart Bombs", icon:"💣", max:3, costs:[400,1000,2200],
    desc:"Start each run with screen-clearing bombs (press B, or the 💣 button)",
    effect: lvl => lvl + (lvl===1 ? " bomb per run" : " bombs per run") },
];
const UPGRADE_BY_ID = {};
UPGRADES.forEach(u => UPGRADE_BY_ID[u.id] = u);

function upgLevel(p, id){ return (p.upgrades && p.upgrades[id]) || 0; }
function nextCost(p, u){ const lvl = upgLevel(p, u.id); return lvl >= u.max ? null : u.costs[lvl]; }
function totalUpgradeLevels(p){ return UPGRADES.reduce((n,u) => n + upgLevel(p,u.id), 0); }
const MAX_UPGRADE_LEVELS = UPGRADES.reduce((n,u) => n + u.max, 0);

/** Horizontal bullet velocities fired at a given Spread Shot level. */
function spreadPattern(lvl){
  return [[0], [-45,45], [-110,0,110], [-150,-50,50,150],
          [-190,-95,0,95,190], [-230,-140,-50,50,140,230]][lvl] || [0];
}
/** Fire-interval multiplier at a given Rapid Fire level (lower = faster). */
function fireRateMult(lvl){ return [1, 0.85, 0.72, 0.62, 0.53, 0.45][lvl] || 1; }

/* ---------------------------------------------------------
   DIFFICULTIES
   Higher tiers throw faster, tougher, shootier enemies at you but
   pay out far more, so grinding a hard tier funds the upgrades that
   in turn make that tier comfortable. The top three unlock by proving
   yourself on the tier below.
   --------------------------------------------------------- */
// `aimed` is the share of shooting enemies that lead their shots at you rather
// than firing straight down; `fireRate` scales the gap between their shots
// (below 1 = they shoot more often).
const DIFFICULTIES = [
  { id:"rookie", name:"ROOKIE", tag:"Easy", color:"#2ecc71",
    blurb:"Slow enemies, sparse fire, a free extra life. Learn the ropes.",
    speed:0.70, spawn:1.40, hpBonus:0, bruteChance:0.5, bossHp:0.65, pay:0.7,
    aimed:0, fireRate:1.6, bonusLives:1, unlock:null },
  { id:"pilot", name:"PILOT", tag:"Normal", color:"#3399ff",
    blurb:"The standard mission. Balanced pay.",
    speed:1.00, spawn:1.00, hpBonus:0, bruteChance:1.0, bossHp:1.00, pay:1.0,
    aimed:0, fireRate:1.2, bonusLives:0, unlock:null },
  { id:"ace", name:"ACE", tag:"Hard", color:"#f39c12",
    blurb:"Armoured enemies, and some of them aim at you. Pays 1.7x.",
    speed:1.28, spawn:0.78, hpBonus:1, bruteChance:1.3, bossHp:1.45, pay:1.7,
    aimed:0.20, fireRate:1.0, bonusLives:0, unlock:{ diff:"pilot", level:4 } },
  { id:"veteran", name:"VETERAN", tag:"Brutal", color:"#e74c3c",
    blurb:"Heavy armour, swarms, lots of aimed return fire. Pays 2.6x.",
    speed:1.55, spawn:0.62, hpBonus:2, bruteChance:1.6, bossHp:1.90, pay:2.6,
    aimed:0.35, fireRate:0.85, bonusLives:0, unlock:{ diff:"ace", level:5 } },
  { id:"nightmare", name:"NIGHTMARE", tag:"Super Hard", color:"#9b59b6",
    blurb:"Everything at once. Only worth trying fully kitted out. Pays 4x.",
    speed:1.90, spawn:0.50, hpBonus:3, bruteChance:2.0, bossHp:2.50, pay:4.0,
    aimed:0.50, fireRate:0.7, bonusLives:0, unlock:{ diff:"veteran", level:6 } },
];
const DIFFICULTY_BY_ID = {};
DIFFICULTIES.forEach(d => DIFFICULTY_BY_ID[d.id] = d);

/** A difficulty is locked until you've reached the required level on the tier below. */
function difficultyLocked(p, d){
  if(!d.unlock) return false;
  return (p.bestLevelByDiff && p.bestLevelByDiff[d.unlock.diff] || 0) < d.unlock.level;
}
/* ---------------------------------------------------------
   PILOT RANKS
   A ladder of titles earned from the gear you've bought, so the
   Armory screen and the menu greeting always show how far along
   this particular pilot is.
   --------------------------------------------------------- */
const RANKS = [
  { at:0,  name:"ROOKIE CADET",   badge:"🌱", color:"#8fd3a7" },
  { at:4,  name:"WING CADET",     badge:"🛩️", color:"#7fc4ff" },
  { at:9,  name:"SQUADRON PILOT", badge:"⭐", color:"#3399ff" },
  { at:15, name:"FLIGHT LEADER",  badge:"🌟", color:"#f39c12" },
  { at:22, name:"STAR ACE",       badge:"🔥", color:"#ff8a3d" },
  { at:30, name:"WING COMMANDER", badge:"🚀", color:"#e74c3c" },
  { at:38, name:"SPACE LEGEND",   badge:"👑", color:"#9b59b6" },
  { at:50, name:"THIERRY LEGEND", badge:"🏆", color:"#ffd23f" },
];
function rankFor(p){
  const gear = totalUpgradeLevels(p);
  let rank = RANKS[0];
  RANKS.forEach(r => { if(gear >= r.at) rank = r; });
  return rank;
}
function nextRank(p){
  const gear = totalUpgradeLevels(p);
  return RANKS.find(r => gear < r.at) || null;
}

/** The hardest tier we'd suggest for someone with this much gear bought. */
function recommendedDifficulty(p){
  const power = totalUpgradeLevels(p);
  if(power >= 30) return "nightmare";
  if(power >= 20) return "veteran";
  if(power >= 11) return "ace";
  if(power >= 4)  return "pilot";
  return "rookie";
}

const LEVELS = [
  { speed:65,  wave:2, spawnMs:2000, kills:12, bonus:50  },
  { speed:95,  wave:3, spawnMs:1650, kills:18, bonus:75  },
  { speed:130, wave:3, spawnMs:1250, kills:25, bonus:100 },
  { speed:170, wave:4, spawnMs:1050, kills:30, bonus:150 },
  { speed:210, wave:4, spawnMs:900,  kills:40, bonus:250 },
];
function getLevel(n){
  if(n <= LEVELS.length) return LEVELS[n-1];
  const base = LEVELS[LEVELS.length-1];
  const extra = n - LEVELS.length;
  return {
    speed: base.speed + extra*15,
    wave: Math.min(base.wave + Math.floor(extra/2), 8),
    spawnMs: Math.max(base.spawnMs - extra*15, 350),
    kills: base.kills + extra*8,
    bonus: base.bonus + extra*40,
  };
}

const BOSS_EVERY = 3; // a boss appears on levels 3, 6, 9...
function isBossLevel(n){ return n % BOSS_EVERY === 0; }

const ACHIEVEMENTS = [
  { id:"first_blood",  icon:"💥", name:"First Blood",     desc:"Destroy your first enemy",        check:p=>p.totalKills>=1 },
  { id:"sharpshooter",  icon:"🎯", name:"Sharpshooter",    desc:"Reach a x5 combo",                check:p=>p.maxCombo>=5 },
  { id:"combo_master",  icon:"⚡", name:"Combo Master",    desc:"Reach a x10 combo",               check:p=>p.maxCombo>=10 },
  { id:"level5",        icon:"🚀", name:"Level 5 Legend",  desc:"Reach level 5",                   check:p=>p.maxLevel>=5 },
  { id:"boss_slayer",   icon:"👾", name:"Boss Slayer",     desc:"Defeat a boss",                   check:p=>p.bossesDefeated>=1 },
  { id:"boss_hunter",   icon:"🛡️", name:"Boss Hunter",     desc:"Defeat 5 bosses",                 check:p=>p.bossesDefeated>=5 },
  { id:"century",       icon:"💯", name:"Century Club",    desc:"Destroy 100 enemies (lifetime)",  check:p=>p.totalKills>=100 },
  { id:"high_roller",   icon:"🤑", name:"High Roller",     desc:"Earn $1000 (lifetime)",           check:p=>p.lifetimeMoney>=1000 },
  { id:"unstoppable",   icon:"🌟", name:"Unstoppable",     desc:"Reach level 10",                  check:p=>p.maxLevel>=10 },
  { id:"speed_runner",  icon:"⏱️", name:"Speed Runner",    desc:"Clear level 1 in under 25 seconds", check:p=>p.fastestLevel1!=null && p.fastestLevel1<=25 },
  { id:"untouchable",   icon:"🧿", name:"Untouchable",     desc:"Clear a level without taking a hit", check:p=>p.untouchedLevelClears>=1 },
  { id:"collector",     icon:"🎁", name:"Powered Up",      desc:"Collect 15 power-ups (lifetime)", check:p=>p.powerupsCollected>=15 },
  { id:"first_upgrade", icon:"🔧", name:"Kitted Out",      desc:"Buy your first Armory upgrade",   check:p=>totalUpgradeLevels(p)>=1 },
  { id:"maxed_one",     icon:"⭐", name:"Specialist",      desc:"Max out any single upgrade",      check:p=>UPGRADES.some(u=>upgLevel(p,u.id)>=u.max) },
  { id:"quartermaster", icon:"📦", name:"Quartermaster",   desc:"Buy 15 upgrade levels in total",  check:p=>totalUpgradeLevels(p)>=15 },
  { id:"big_spender",   icon:"💰", name:"Fully Loaded",    desc:"Max out every Armory upgrade",    check:p=>UPGRADES.every(u=>upgLevel(p,u.id)>=u.max) },
  { id:"warchest",      icon:"🏦", name:"War Chest",       desc:"Earn $25,000 (lifetime)",         check:p=>p.lifetimeMoney>=25000 },
  { id:"ace_pilot",     icon:"🥇", name:"Ace Pilot",       desc:"Reach level 5 on ACE",            check:p=>(p.bestLevelByDiff&&p.bestLevelByDiff.ace||0)>=5 },
  { id:"veteran_wings", icon:"🎖️", name:"Veteran Wings",   desc:"Reach level 5 on VETERAN",        check:p=>(p.bestLevelByDiff&&p.bestLevelByDiff.veteran||0)>=5 },
  { id:"nightmare",     icon:"👑", name:"Nightmare Fuel",  desc:"Reach level 5 on NIGHTMARE",      check:p=>(p.bestLevelByDiff&&p.bestLevelByDiff.nightmare||0)>=5 },
];

/* =========================================================
   SOUND (Web Audio, generated - no audio files to load)
   ========================================================= */
let actx = null, muted = localStorage.getItem("skyforce_muted") === "1";
function initAudio(){
  if(!actx){
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ actx = null; }
  }
  // iPads/iPhones start the audio context suspended and will only resume it
  // from inside a real user gesture, so every tap gets a chance to wake it.
  if(actx && actx.state === "suspended" && actx.resume) actx.resume();
}
// Any first touch/click anywhere counts as the gesture that unlocks sound.
["pointerdown","touchstart","keydown"].forEach(evt =>
  window.addEventListener(evt, initAudio, { passive:true }));
function tone(freq, dur, type, gainStart, glideTo){
  if(!actx || muted) return;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type || "square";
  osc.frequency.setValueAtTime(freq, actx.currentTime);
  if(glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo,1), actx.currentTime+dur);
  gain.gain.setValueAtTime(gainStart||0.08, actx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime+dur);
  osc.connect(gain); gain.connect(actx.destination);
  osc.start(); osc.stop(actx.currentTime+dur+0.02);
}
/*
 * Guns are automatic now, so this fires several times a second for a whole
 * session. A loud square-wave "pew" every 0.2s is exhausting, so the shot
 * sound is deliberately tiny: a soft triangle blip at a fraction of the old
 * volume, rate-limited so a high fire rate can't stack it into a buzzsaw, and
 * slightly detuned each time so it doesn't drone. The punch lives in the
 * explosions and hits instead - those are what you actually want to hear.
 */
let lastShootSoundAt = -1;
function playShoot(){
  const now = actx ? actx.currentTime*1000 : 0;
  if(now - lastShootSoundAt < 130) return;
  lastShootSoundAt = now;
  tone(520 + Math.random()*90, 0.035, "triangle", 0.016, 360);
}
function playExplosion(big){ tone(big?220:300,big?0.32:0.22,"sawtooth",big?0.11:0.08, big?25:40); }
function playHit(){ tone(140,0.2,"sawtooth",0.09,55); }
function playPowerup(){ if(!actx||muted) return; [523,659,784].forEach((f,i)=>setTimeout(()=>tone(f,0.08,"square",0.06),i*55)); }
function playBomb(){ if(!actx||muted) return; tone(90,0.4,"sawtooth",0.14,20); setTimeout(()=>tone(160,0.3,"square",0.08,20),40); }
function playLevelClear(){ if(!actx||muted) return; [392,523,659,784].forEach((f,i)=>setTimeout(()=>tone(f,0.1,"triangle",0.07),i*65)); }
function playBossAlert(){ if(!actx||muted) return; [220,180,220,180].forEach((f,i)=>setTimeout(()=>tone(f,0.18,"sawtooth",0.09),i*220)); }
function playBossDefeat(){ if(!actx||muted) return; [392,494,587,784,988].forEach((f,i)=>setTimeout(()=>tone(f,0.16,"triangle",0.09),i*90)); }
function playCombo(n){ tone(480+Math.min(n,15)*30, 0.06, "square", 0.05); }
function playAchievement(){ if(!actx||muted) return; [660,880,1108].forEach((f,i)=>setTimeout(()=>tone(f,0.11,"sine",0.07),i*80)); }
function playGameOver(){ if(!actx||muted) return; [392,330,220].forEach((f,i)=>setTimeout(()=>tone(f,0.3,"sawtooth",0.08),i*170)); }

/* =========================================================
   REAL GAME ART (same source files as the Java version, same crop
   rectangles as Game_Graphics/loadImage.java's crop()) - not invented
   vector shapes. Ship color tinting uses the same hue-preserving
   technique as Game_Graphics/ImageTint.java.
   ========================================================= */
const ASSET_PATHS = {
  ship: "assets/orange.png",
  enemy: "assets/red.png",
  bulletImg: "assets/bullet.png",
  playfieldBg: "assets/BackNew.jpg",
  frameBg: "assets/BackBack.jpg",
  menuBg: "assets/Menu.jpg",
};
const assets = {};
let assetsReady = false;

function loadAssets(cb){
  const keys = Object.keys(ASSET_PATHS);
  let remaining = keys.length;
  let allOk = true;
  keys.forEach(key => {
    const img = new Image();
    img.onload = () => { if(--remaining === 0){ assetsReady = allOk; cb(); } };
    img.onerror = () => { allOk = false; if(--remaining === 0){ assetsReady = allOk; cb(); } };
    img.src = ASSET_PATHS[key];
    assets[key] = img;
  });
}

function hexToRgb(hex){
  const v = parseInt(hex.replace("#",""), 16);
  return { r: (v>>16)&255, g: (v>>8)&255, b: v&255 };
}
function rgbToHsb(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d!==0){
    if(max===r) h=((g-b)/d)%6;
    else if(max===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60; if(h<0) h+=360;
  }
  const s = max===0 ? 0 : d/max;
  return { h, s, v: max };
}
function hsbToRgb(h,s,v){
  const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r,g,b;
  if(h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;} else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;} else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return { r:Math.round((r+m)*255), g:Math.round((g+m)*255), b:Math.round((b+m)*255) };
}

/**
 * True when the sprite pixels can actually be read back. Serving the game over
 * http(s) - GitHub Pages, or any local server - this is always true. Opening
 * index.html directly off the filesystem taints the canvas and blocks it, in
 * which case the game just uses the sprites untinted instead of breaking.
 */
let pixelsReadable = null;
function canReadPixels(){
  if(pixelsReadable !== null) return pixelsReadable;
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 2;
    const pctx = probe.getContext("2d");
    pctx.drawImage(assets.ship, 0, 0, 2, 2);
    pctx.getImageData(0, 0, 1, 1);
    pixelsReadable = true;
  } catch(e){
    pixelsReadable = false;
  }
  return pixelsReadable;
}

/** Recolors the ship sprite to a target hue while preserving its original shading (same technique as ImageTint.java). Cached per color. */
const tintCache = {};
function getTintedShip(hex){
  if(tintCache[hex]) return tintCache[hex];
  const img = assets.ship;
  // Reading pixels back is blocked when the page is opened straight off disk
  // (file:// taints the canvas). Fall back to the untinted sprite rather than
  // throwing every frame and leaving an invisible ship.
  if(!canReadPixels()) return img;
  const off = document.createElement("canvas");
  off.width = img.naturalWidth; off.height = img.naturalHeight;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, 0);
  const imgData = octx.getImageData(0, 0, off.width, off.height);
  const data = imgData.data;
  const targetHsb = rgbToHsb(hexToRgb(hex).r, hexToRgb(hex).g, hexToRgb(hex).b);
  for(let i=0;i<data.length;i+=4){
    if(data[i+3] === 0) continue;
    const hsb = rgbToHsb(data[i], data[i+1], data[i+2]);
    const rgb = hsbToRgb(targetHsb.h, hsb.s, hsb.v);
    data[i]=rgb.r; data[i+1]=rgb.g; data[i+2]=rgb.b;
  }
  octx.putImageData(imgData, 0, 0);
  tintCache[hex] = off;
  return off;
}

/** Recolors the enemy sprite (used for the boss's two pattern-color variants). */
const enemyTintCache = {};
function getTintedEnemy(hex){
  if(enemyTintCache[hex]) return enemyTintCache[hex];
  const img = assets.enemy;
  if(!canReadPixels()) return img; // see getTintedShip
  const off = document.createElement("canvas");
  off.width = img.naturalWidth; off.height = img.naturalHeight;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, 0);
  const imgData = octx.getImageData(0, 0, off.width, off.height);
  const data = imgData.data;
  const targetHsb = rgbToHsb(hexToRgb(hex).r, hexToRgb(hex).g, hexToRgb(hex).b);
  for(let i=0;i<data.length;i+=4){
    if(data[i+3] === 0) continue;
    const hsb = rgbToHsb(data[i], data[i+1], data[i+2]);
    const rgb = hsbToRgb(targetHsb.h, hsb.s, hsb.v);
    data[i]=rgb.r; data[i+1]=rgb.g; data[i+2]=rgb.b;
  }
  octx.putImageData(imgData, 0, 0);
  enemyTintCache[hex] = off;
  return off;
}

const INDEX_KEY = "skyforce_profiles";
const PROFILE_PREFIX = "skyforce_profile_";

function listProfileNames(){
  let names = JSON.parse(localStorage.getItem(INDEX_KEY) || "null");
  if(!names){
    names = ["Marc","Charles"];
    localStorage.setItem(INDEX_KEY, JSON.stringify(names));
  }
  return names;
}
function addProfileName(name){
  const names = listProfileNames();
  if(!names.includes(name)){
    names.push(name);
    localStorage.setItem(INDEX_KEY, JSON.stringify(names));
  }
}
function loadProfile(name){
  const base = {
    name, callsign:name, shipColor: SHIP_COLORS[0],
    money:0, upgrades:{},
    difficulty:"pilot", bestLevelByDiff:{}, bestScoreByDiff:{},
    highscore:0,
    totalKills:0, bossesDefeated:0, maxLevel:0, maxCombo:0, lifetimeMoney:0,
    fastestLevel1:null, untouchedLevelClears:0, powerupsCollected:0,
    achievements:[],
  };
  const raw = localStorage.getItem(PROFILE_PREFIX+name);
  if(raw){
    return migrateProfile(Object.assign(base, JSON.parse(raw))); // old saves just fill in any new fields as defaults
  }
  return base;
}

/**
 * Brings a save written before tiered upgrades / difficulties up to date.
 * The old flat booleans (hasSpread/hasRapid/hasShield/extraLives) become the
 * matching upgrade at the level that does what they used to do, so nobody
 * loses what they already bought.
 */
function migrateProfile(p){
  if(!p.upgrades || typeof p.upgrades !== "object") p.upgrades = {};
  if(!p.bestLevelByDiff) p.bestLevelByDiff = {};
  if(!p.bestScoreByDiff) p.bestScoreByDiff = {};
  if(!DIFFICULTY_BY_ID[p.difficulty]) p.difficulty = "pilot";
  // Granted at the level that reproduces what the old one-off purchase did,
  // so nobody's ship gets weaker: old Spread was 3-way (= level 2) and old
  // Rapid halved the fire interval (= level 4).
  if(p.hasSpread && !p.upgrades.spread) p.upgrades.spread = 2;
  if(p.hasRapid  && !p.upgrades.rapid)  p.upgrades.rapid  = 4;
  if(p.hasShield && !p.upgrades.shield) p.upgrades.shield = 1;
  if(p.extraLives > 0 && !p.upgrades.life) p.upgrades.life = Math.min(p.extraLives, UPGRADE_BY_ID.life.max);
  delete p.hasSpread; delete p.hasRapid; delete p.hasShield; delete p.extraLives;
  // Old saves predate per-difficulty bests; credit their best run to Pilot.
  if(p.maxLevel > 0 && !p.bestLevelByDiff.pilot) p.bestLevelByDiff.pilot = p.maxLevel;
  UPGRADES.forEach(u => { // clamp anything out of range (e.g. a hand-edited save)
    const lvl = p.upgrades[u.id];
    if(typeof lvl !== "number" || lvl < 0) delete p.upgrades[u.id];
    else if(lvl > u.max) p.upgrades[u.id] = u.max;
  });
  return p;
}
function saveProfile(p){
  localStorage.setItem(PROFILE_PREFIX+p.name, JSON.stringify(p));
}

let activeProfile = null;

/* =========================================================
   SCREEN MANAGEMENT
   ========================================================= */
const screens = {};
document.querySelectorAll(".screen").forEach(el => screens[el.id] = el);
function showScreen(id){
  Object.values(screens).forEach(el => el.classList.remove("active"));
  screens[id].classList.add("active");
}

/* ---- Profile picker ---- */
function renderProfileGrid(){
  const grid = document.getElementById("profileGrid");
  grid.innerHTML = "";
  listProfileNames().forEach(name => {
    const p = loadProfile(name);
    const rank = rankFor(p);
    const card = document.createElement("div");
    card.className = "profile-card";
    card.innerHTML = `
      <div class="avatar" style="background:${p.shipColor}"><span class="avatar-badge">${rank.badge}</span></div>
      <div class="pname">${escapeHtml(p.callsign || p.name)}</div>
      <div class="prank" style="color:${rank.color}">${rank.name}</div>
      <div class="pscore">Best: ${p.highscore}</div>
    `;
    card.addEventListener("click", () => selectProfile(name));
    grid.appendChild(card);
  });
}
function selectProfile(name){
  activeProfile = loadProfile(name);
  const rank = rankFor(activeProfile);
  document.getElementById("greeting").innerHTML =
    `<span class="greet-rank" style="color:${rank.color}">${rank.badge} ${rank.name}</span><br>` +
    `Ready for launch, ${escapeHtml(activeProfile.callsign)}!`;
  showScreen("screen-menu");
}
document.getElementById("addProfileBtn").addEventListener("click", () => {
  const name = prompt("Player's name?");
  if(name && name.trim()){
    addProfileName(name.trim());
    renderProfileGrid();
  }
});
document.getElementById("switchBtn").addEventListener("click", () => {
  renderProfileGrid();
  showScreen("screen-profiles");
});

/* ---- Main menu ---- */
document.getElementById("playBtn").addEventListener("click", () => {
  initAudio();
  renderDifficulties();
  showScreen("screen-difficulty");
});
document.getElementById("difficultyBackBtn").addEventListener("click", () => showScreen("screen-menu"));
document.getElementById("armoryBtn").addEventListener("click", () => {
  renderArmory();
  showScreen("screen-armory");
});
document.getElementById("leaderboardBtn").addEventListener("click", () => {
  renderLeaderboard();
  showScreen("screen-leaderboard");
});
document.getElementById("armoryBackBtn").addEventListener("click", () => showScreen("screen-menu"));
document.getElementById("leaderboardBackBtn").addEventListener("click", () => showScreen("screen-menu"));
document.getElementById("achievementsBackBtn").addEventListener("click", () => showScreen("screen-menu"));
document.getElementById("achievementsBtn").addEventListener("click", () => {
  renderAchievements();
  showScreen("screen-achievements");
});

/* ---- Armory ---- */
function renderArmory(){
  const p = activeProfile;
  document.getElementById("armoryMoney").textContent = "$" + p.money + " to spend";
  document.getElementById("callsignInput").value = p.callsign;
  renderPilotCard(p);

  const colorRow = document.getElementById("colorRow");
  colorRow.innerHTML = "";
  SHIP_COLORS.forEach(hex => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (hex === p.shipColor ? " selected" : "");
    sw.style.background = hex;
    sw.addEventListener("click", () => {
      p.shipColor = hex;
      saveProfile(p);
      renderArmory();
    });
    colorRow.appendChild(sw);
  });

  const shopItems = document.getElementById("shopItems");
  shopItems.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const group = document.createElement("div");
    group.className = "shop-group";
    group.style.setProperty("--cat", cat.color);
    group.innerHTML = `<div class="group-head"><span class="group-icon">${cat.icon}</span>${cat.name}</div>`;

    UPGRADES.filter(u => u.cat === cat.id).forEach(u => {
      const lvl = upgLevel(p, u.id);
      const cost = nextCost(p, u);
      const maxed = cost === null;
      const affordable = !maxed && p.money >= cost;
      const row = document.createElement("div");
      row.className = "shop-item" + (maxed ? " maxed" : "") + (affordable ? " affordable" : "");
      const pips = Array.from({length:u.max}, (_,i) =>
        `<span class="pip${i < lvl ? " on" : ""}"></span>`).join("");
      row.innerHTML = `
        <div class="si-badge">${u.icon}</div>
        <div class="si-main">
          <div class="si-name">${escapeHtml(u.name)} <span class="si-lvl">${maxed ? "MAXED" : "Lv " + lvl + "/" + u.max}</span></div>
          <div class="si-pips">${pips}</div>
          <div class="si-desc">${escapeHtml(u.desc)}</div>
          <div class="si-effect">${lvl > 0 ? "Now: " + escapeHtml(u.effect(lvl)) : "Not owned yet"}${
            maxed ? "" : ' <span class="si-next">→ ' + escapeHtml(u.effect(lvl+1)) + "</span>"}</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.innerHTML = maxed ? "★<br>MAX" : "$" + cost;
      btn.disabled = maxed || !affordable;
      btn.addEventListener("click", () => buyUpgrade(u.id));
      row.appendChild(btn);
      group.appendChild(row);
    });
    shopItems.appendChild(group);
  });
}

/** The "who am I" card at the top of the Armory: ship, rank badge, progress. */
function renderPilotCard(p){
  const rank = rankFor(p), next = nextRank(p);
  const gear = totalUpgradeLevels(p);
  document.getElementById("pcShip").style.background =
    `radial-gradient(circle at 35% 30%, #fff6, ${p.shipColor})`;
  document.getElementById("pcRankBadge").textContent = rank.badge;
  document.getElementById("pcName").textContent = p.callsign || p.name;
  const rankEl = document.getElementById("pcRank");
  rankEl.textContent = rank.name;
  rankEl.style.color = rank.color;
  const pctToNext = next ? Math.round((gear - rank.at) / (next.at - rank.at) * 100) : 100;
  const fill = document.getElementById("pcBarFill");
  fill.style.width = pctToNext + "%";
  fill.style.background = rank.color;
  document.getElementById("pcGear").textContent = next
    ? `Gear ${gear}/${MAX_UPGRADE_LEVELS} · ${next.at - gear} more to ${next.name}`
    : `Gear ${gear}/${MAX_UPGRADE_LEVELS} · everything unlocked!`;
}

function buyUpgrade(id){
  const p = activeProfile;
  const u = UPGRADE_BY_ID[id];
  const cost = nextCost(p, u);
  if(cost === null || p.money < cost) return;
  const rankBefore = rankFor(p).name;
  p.money -= cost;
  p.upgrades[id] = upgLevel(p, id) + 1;
  saveProfile(p);
  playPowerup();
  checkAchievements();
  renderArmory();
  const rankNow = rankFor(p);
  if(rankNow.name !== rankBefore){ // promotions are a big deal - say so
    queueAchievementToast({ icon: rankNow.badge, name: "PROMOTED: " + rankNow.name });
  }
}

/* ---- Difficulty select ---- */
let pendingDifficulty = "pilot";
function renderDifficulties(){
  const p = activeProfile;
  const rec = recommendedDifficulty(p);
  document.getElementById("difficultyPower").textContent =
    "GEAR LEVEL " + totalUpgradeLevels(p) + " / " + MAX_UPGRADE_LEVELS +
    " — suggested: " + DIFFICULTY_BY_ID[rec].name;

  const list = document.getElementById("difficultyList");
  list.innerHTML = "";
  DIFFICULTIES.forEach(d => {
    const locked = difficultyLocked(p, d);
    const best = (p.bestLevelByDiff && p.bestLevelByDiff[d.id]) || 0;
    const card = document.createElement("div");
    card.className = "diff-card" + (locked ? " locked" : "") + (d.id === rec ? " suggested" : "");
    card.style.borderColor = locked ? "" : d.color;
    card.innerHTML = `
      <div class="diff-head">
        <span class="diff-name" style="color:${locked ? "" : d.color}">${locked ? "🔒 " : ""}${d.name}</span>
        <span class="diff-tag">${d.tag}</span>
      </div>
      <div class="diff-blurb">${escapeHtml(locked
        ? "Reach level " + d.unlock.level + " on " + DIFFICULTY_BY_ID[d.unlock.diff].name + " to unlock"
        : d.blurb)}</div>
      <div class="diff-best">${best ? "Best: level " + best : (locked ? "" : "Not flown yet")}${
        d.id === rec && !locked ? " · suggested for your gear" : ""}</div>
    `;
    if(!locked){
      card.addEventListener("click", () => startAtDifficulty(d.id));
    }
    list.appendChild(card);
  });
}
function startAtDifficulty(id){
  pendingDifficulty = id;
  activeProfile.difficulty = id;
  saveProfile(activeProfile);
  initAudio();
  showScreen("screen-game");
  startRun();
}
document.getElementById("saveCallsignBtn").addEventListener("click", () => {
  const val = document.getElementById("callsignInput").value.trim();
  if(!val) return;
  activeProfile.callsign = val;
  saveProfile(activeProfile);
  alert("Callsign saved!");
});

/* ---- Leaderboard ---- */
function renderLeaderboard(){
  const list = document.getElementById("leaderboardList");
  const rows = listProfileNames().map(loadProfile).sort((a,b) => b.highscore - a.highscore);
  list.innerHTML = rows.map((p,i) => `
    <div class="lb-row">
      <span class="lb-rank">#${i+1}</span>
      <span class="lb-name">${escapeHtml(p.callsign || p.name)}</span>
      <span class="lb-score">${p.highscore}</span>
    </div>
  `).join("");
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---- Achievements ---- */
function renderAchievements(){
  const p = activeProfile;
  const list = document.getElementById("achievementsList");
  list.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = p.achievements.includes(a.id);
    return `
      <div class="ach-row${unlocked ? " unlocked" : ""}">
        <div class="ach-icon">${unlocked ? a.icon : "🔒"}</div>
        <div><div class="ach-name">${escapeHtml(a.name)}</div><div class="ach-desc">${escapeHtml(a.desc)}</div></div>
      </div>
    `;
  }).join("");
}

let toastQueue = [];
let toastShowing = false;
function queueAchievementToast(a){
  toastQueue.push(a);
  if(!toastShowing) showNextToast();
}
function showNextToast(){
  const a = toastQueue.shift();
  if(!a){ toastShowing=false; return; }
  toastShowing = true;
  playAchievement();
  const el = document.getElementById("achievementToast");
  el.classList.remove("hidden");
  document.getElementById("at-name").textContent = a.icon + " " + a.name;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.classList.add("hidden"); showNextToast(); }, 250);
  }, 2400);
}

/** Compares current profile stats against every achievement and unlocks any newly-met ones. */
function checkAchievements(){
  const p = activeProfile;
  let unlocked = [];
  ACHIEVEMENTS.forEach(a => {
    if(!p.achievements.includes(a.id) && a.check(p)){
      p.achievements.push(a.id);
      unlocked.push(a);
    }
  });
  if(unlocked.length){
    saveProfile(p);
    unlocked.forEach(queueAchievementToast);
  }
}

document.getElementById("muteBtn").addEventListener("click", () => {
  muted = !muted;
  localStorage.setItem("skyforce_muted", muted ? "1" : "0");
  document.getElementById("muteBtn").textContent = muted ? "🔇" : "♪";
});

/* =========================================================
   GAME
   ========================================================= */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const gameFrame = document.querySelector(".game-frame");

let scale = 1;
function resizeCanvas(){
  const screenEl = screens["screen-game"];
  const style = getComputedStyle(screenEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const availW = screenEl.clientWidth - padX;
  const availH = screenEl.clientHeight - padY;
  if(availW <= 0 || availH <= 0) return; // screen not visible right now; nothing to size

  const targetRatio = VW / VH;
  let w = availW, h = w / targetRatio;
  if(h > availH){ h = availH; w = h * targetRatio; }

  gameFrame.style.width = w + "px";
  gameFrame.style.height = h + "px";

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w*dpr);
  canvas.height = Math.round(h*dpr);
  scale = canvas.width / VW;
  ctx.setTransform(scale,0,0,scale,0,0);
}
window.addEventListener("resize", resizeCanvas);

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }

/* ---- Input ---- */
// The guns fire themselves - all you do is fly (and set off specials). That
// keeps one-handed iPad play possible: steer with a thumb, nothing to hold.
const keys = {};
window.addEventListener("keydown", e => {
  keys[e.key] = true;
  if(e.key===" "||e.key==="ArrowUp"||e.key==="ArrowDown") e.preventDefault();
  if(e.key==="p"||e.key==="P"||e.key==="Escape") togglePause();
  if(e.key==="b"||e.key==="B"||e.key===" ") useBomb(); // Space doubles as the special key
});
window.addEventListener("keyup", e => { keys[e.key]=false; });

// Touch steering: the ship follows your finger anywhere on the playfield,
// lifted a little above it so your thumb isn't sitting on top of the ship.
let dragActive=false, dragX=VW/2, dragY=VH-60;
const TOUCH_LIFT = 34;
function pointerToVirtual(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp((clientX-rect.left)/rect.width*VW, 0, VW),
    y: clamp((clientY-rect.top)/rect.height*VH - TOUCH_LIFT, 0, VH),
  };
}
function setDrag(e){ const p = pointerToVirtual(e.clientX, e.clientY); dragX = p.x; dragY = p.y; }
// Track which pointer is steering, so letting go of the FIRE button with the
// other thumb doesn't drop your steering finger.
let dragPointerId = null;
canvas.addEventListener("pointerdown", e => { dragActive=true; dragPointerId=e.pointerId; setDrag(e); });
window.addEventListener("pointermove", e => { if(dragActive && e.pointerId===dragPointerId) setDrag(e); });
function endDrag(e){ if(e.pointerId===dragPointerId){ dragActive=false; dragPointerId=null; } }
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

/* ---- Entity state ---- */
let player, bullets, enemyBullets, enemies, particles, floatingTexts, powerups, trail;
let shakeMag = 0, hitFlash = 0;
function screenShake(amount){ shakeMag = Math.max(shakeMag, amount); }
let level, killsInLevel, levelConfig, bannerUntil;
let sessionMoney, score, sessionKills;
let spawnTimer;
let combo, comboTimer;
let boss, bossPending;
let powerupTimer;
let runStartTime, tookDamageThisLevel;
let difficulty = DIFFICULTY_BY_ID.pilot;
let gameState = "playing"; // playing | paused | over

function startRun(){
  const p = activeProfile;
  difficulty = DIFFICULTY_BY_ID[pendingDifficulty] || DIFFICULTY_BY_ID.pilot;
  const lv = id => upgLevel(p, id);
  player = {
    x: VW/2, y: VH-60, targetX: VW/2, targetY: VH-60, r:9,
    speed: 320 * (1 + lv("thrusters")*0.15),
    lives: 3 + lv("life") + difficulty.bonusLives,
    alive:true,
    invulnTime: 1.8 + lv("armor")*0.6,
    invuln: 1.6,
    shield: lv("shield"), shieldMax: lv("shield"),
    cooldown:0,
    fireInterval: 0.30 * fireRateMult(lv("rapid")),
    spreadLvl: lv("spread"), damage: 1 + lv("damage"), pierce: lv("pierce"),
    homingLvl: lv("homing"), magnetRange: lv("magnet")*45,
    moneyMult: 1 + lv("fortune")*0.15,
    drones: lv("wingman"), bombs: lv("bomb"),
    color: p.shipColor,
    tempRapidUntil:0, tempSpreadUntil:0, tempScoreUntil:0, tempHomingUntil:0,
  };
  dragActive=false; dragX=VW/2; dragY=VH-60; // don't inherit last run's finger position
  initBackground();
  bullets=[]; enemyBullets=[]; enemies=[]; particles=[]; floatingTexts=[]; powerups=[]; trail=[];
  shakeMag=0; hitFlash=0;
  level=1; killsInLevel=0; levelConfig=getLevel(level); bannerUntil=0;
  sessionMoney=0; score=0; sessionKills=0; spawnTimer=0;
  combo=0; comboTimer=0;
  boss=null; bossPending=false;
  powerupTimer = 10 + Math.random()*6;
  runStartTime = performance.now();
  tookDamageThisLevel = false;
  gameState="playing";
  document.getElementById("pauseBtn").classList.remove("hidden");
  document.getElementById("muteBtn").classList.remove("hidden");
  document.getElementById("muteBtn").textContent = muted ? "🔇" : "♪";
  document.getElementById("overlayPause").classList.add("hidden");
  document.getElementById("overlayOver").classList.add("hidden");
  updateBombButton();
  resizeCanvas();
}

/** The special-weapon button only appears when the pilot has a special to fire. */
function updateBombButton(){
  const btn = document.getElementById("bombBtn");
  if(!btn) return;
  const show = player && player.alive && player.bombs > 0 && gameState !== "over";
  btn.classList.toggle("hidden", !show);
  const count = document.getElementById("bombCount");
  if(count) count.textContent = player ? player.bombs : 0;
}
function useBomb(){
  if(gameState !== "playing" || !player || !player.alive || player.bombs <= 0) return;
  player.bombs--;
  detonateBomb();
  updateBombButton();
}

function togglePause(){
  if(gameState==="playing"){ gameState="paused"; document.getElementById("overlayPause").classList.remove("hidden"); }
  else if(gameState==="paused"){ gameState="playing"; document.getElementById("overlayPause").classList.add("hidden"); }
}
document.getElementById("pauseBtn").addEventListener("click", togglePause);
document.getElementById("resumeBtn").addEventListener("click", togglePause);
document.getElementById("quitBtn").addEventListener("click", () => {
  document.getElementById("overlayPause").classList.add("hidden");
  document.getElementById("pauseBtn").classList.add("hidden");
  document.getElementById("muteBtn").classList.add("hidden");
  document.getElementById("bombBtn").classList.add("hidden");
  showScreen("screen-menu");
});
document.getElementById("retryBtn").addEventListener("click", () => startRun());
document.getElementById("changeDiffBtn").addEventListener("click", () => {
  document.getElementById("overlayOver").classList.add("hidden");
  renderDifficulties();
  showScreen("screen-difficulty");
});
document.getElementById("menuBtn").addEventListener("click", () => showScreen("screen-menu"));
const bombBtnEl = document.getElementById("bombBtn");
if(bombBtnEl){
  bombBtnEl.addEventListener("pointerdown", e => { e.preventDefault(); useBomb(); });
}

function endRun(){
  gameState="over";
  playGameOver();
  const p = activeProfile;
  p.money += sessionMoney;
  p.lifetimeMoney += sessionMoney;
  p.totalKills += sessionKills;
  if(level > p.maxLevel) p.maxLevel = level;
  if(combo > p.maxCombo) p.maxCombo = combo;
  if(score > p.highscore) p.highscore = score;
  if(level > (p.bestLevelByDiff[difficulty.id]||0)) p.bestLevelByDiff[difficulty.id] = level;
  if(score > (p.bestScoreByDiff[difficulty.id]||0)) p.bestScoreByDiff[difficulty.id] = score;
  saveProfile(p);
  checkAchievements();
  document.getElementById("overScore").textContent = "SCORE " + score + "  ·  " + difficulty.name + "  ·  LEVEL " + level;
  document.getElementById("overMoney").textContent = "+$" + sessionMoney + " earned (wallet: $" + p.money + ")";
  document.getElementById("pauseBtn").classList.add("hidden");
  document.getElementById("muteBtn").classList.add("hidden");
  document.getElementById("overlayOver").classList.remove("hidden");
  updateBombButton();
}

/* Callouts use the pilot's own callsign so it reads like the game knows who's
   flying it, rather than generic arcade text. */
function pilotName(){ return (activeProfile && (activeProfile.callsign || activeProfile.name) || "PILOT").toUpperCase(); }
function pick(list){ return list[Math.floor(Math.random()*list.length)]; }
function levelClearLine(){
  return pick([
    "NICE FLYING, " + pilotName() + "!",
    "SECTOR CLEAR, " + pilotName() + "!",
    "GO " + pilotName() + "!",
    pilotName() + " DOES IT AGAIN!",
    "KEEP GOING, " + pilotName() + "!",
  ]);
}
function bossDownLine(){
  return pick([
    "BOSS DOWN, " + pilotName() + "!",
    pilotName() + " WINS!",
    "SMASHED IT, " + pilotName() + "!",
  ]);
}

function addFloatingText(x,y,text,color,size){
  floatingTexts.push({x,y,text,color:color||"#ffffff",size:size||16,life:0,maxLife:0.9});
}

function spawnParticles(x,y,count,color){
  for(let i=0;i<count;i++){
    const ang=Math.random()*Math.PI*2, spd=40+Math.random()*90;
    particles.push({x,y,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,life:0,maxLife:0.3+Math.random()*0.3,color});
  }
}
function makeEnemy(){
  const brute = level>=3 && Math.random() < 0.25*difficulty.bruteChance;
  const x = 24 + Math.random()*(VW-48);
  // Tougher tiers armour everything up; deep levels add a little more on top.
  // Plasma Rounds is the answer to this — damage scales the same way HP does.
  const hp = (brute?2:1) + difficulty.hpBonus + Math.floor(level/6);
  // Most enemies shoot back, firing straight down. On the harder tiers a share
  // of them lead their shots at wherever you are instead (tinted purple).
  const shooter = Math.random() < 0.7;
  const aimed = shooter && Math.random() < difficulty.aimed;
  return {
    x, y:-30, r: brute?14:10, hp, maxhp: hp,
    speed: levelConfig.speed * difficulty.speed * (brute?0.75:1) * (0.85+Math.random()*0.3),
    sway: Math.random()*Math.PI*2, brute, shooter, aimed,
    shootTimer: (1.0 + Math.random()*2.2) * difficulty.fireRate,
  };
}
function makeBoss(){
  const hp = window.__SKYFORCE_TEST_EASY_BOSS__ ? 3 // test-only hook, unused in real play
    : Math.round((18 + level*7) * difficulty.bossHp);
  const bossIndex = level / BOSS_EVERY; // 1st, 2nd, 3rd boss encounter...
  // Pre-rolled damage spots: as its health drops, scorch marks appear and then
  // chunks are torn out of its silhouette at these positions, in this order.
  const wounds = [];
  for(let i=0;i<10;i++){
    const a = (Math.PI*2/10)*i + Math.random()*0.5;
    const rad = 14 + Math.random()*22;
    wounds.push({ x: Math.cos(a)*rad, y: Math.sin(a)*rad*0.8, r: 7+Math.random()*9 });
  }
  return {
    x: VW/2, y:-70, targetY:104, hp, maxhp:hp,
    vx: 55 + level*3, shootTimer: 1.3, entering:true,
    pattern: (bossIndex % 2 === 0) ? "aimed" : "spread",
    aimStep: 0, wounds, hitFlash: 0, smokeTimer: 0, wobble: 0,
  };
}

const POWERUP_TYPES = [
  { id:"rapid",  color:"#ffd23f", label:"RAPID FIRE" },
  { id:"spread", color:"#3399ff", label:"SPREAD SHOT" },
  { id:"shield", color:"#2ecc71", label:"SHIELD" },
  { id:"score2x",color:"#ff66b3", label:"SCORE x2" },
  { id:"bomb",   color:"#ff5d73", label:"BOMB" },
  { id:"homing", color:"#22d3ee", label:"HOMING SHOT" },
];
function spawnFloatingPowerup(){
  const type = POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
  powerups.push({ x: 30+Math.random()*(VW-60), y:-24, vy:75, r:13, angle:0, type });
}
function applyPowerup(type){
  playPowerup();
  addFloatingText(player.x, player.y-26, type.label+"!", type.color, 15);
  activeProfile.powerupsCollected = (activeProfile.powerupsCollected||0) + 1;
  saveProfile(activeProfile);
  checkAchievements();
  const now = performance.now();
  if(type.id==="rapid") player.tempRapidUntil = now + 8000;
  else if(type.id==="spread") player.tempSpreadUntil = now + 8000;
  else if(type.id==="shield") player.shield = Math.min(player.shield+1, player.shieldMax+1);
  else if(type.id==="score2x") player.tempScoreUntil = now + 8000;
  else if(type.id==="homing") player.tempHomingUntil = now + 8000;
  else if(type.id==="bomb") detonateBomb();
}

/** Wipes the screen: every enemy on it dies and pays out, all enemy fire clears. */
function detonateBomb(){
  playBomb();
  screenShake(14);
  const dying = enemies;
  enemies = [];
  enemyBullets = [];
  dying.forEach(e => registerKill(e.x, e.y, e.brute?12:5, e.brute?4:2, e.brute));
  addFloatingText(VW/2, VH/2, "BOOM!", "#ff5d73", 22);
}

function fireBullets(){
  const vy=-460;
  const now = performance.now();
  // The Spread Shot power-up is worth grabbing even when you own the upgrade:
  // it temporarily bumps you to at least the level-3 pattern.
  const spreadLvl = now < player.tempSpreadUntil ? Math.max(player.spreadLvl, 3) : player.spreadLvl;
  const homingStrength = now < player.tempHomingUntil ? 3 : player.homingLvl;
  const pierce = player.pierce;
  spreadPattern(spreadLvl).forEach(vx => {
    bullets.push({
      x: player.x, y: player.y - (vx===0 ? 14 : 10), vx, vy, r:3,
      homing: homingStrength, dmg: player.damage, pierceLeft: pierce, hitIds: null,
    });
  });
  // Wingman drones add their own straight shot from each flank.
  for(let i=0;i<player.drones;i++){
    const side = i===0 ? -1 : 1;
    bullets.push({
      x: player.x + side*26, y: player.y, vx:0, vy, r:3,
      homing: homingStrength, dmg: Math.max(1, Math.round(player.damage*0.6)),
      pierceLeft: pierce, hitIds: null, drone:true,
    });
  }
  playShoot();
}

function update(dt){
  if(!player.alive) return;

  // movement - free in both axes (arrows or WASD on a keyboard, drag on touch)
  let dx=0, dy=0;
  if(keys["ArrowLeft"]||keys["a"]||keys["A"]) dx-=1;
  if(keys["ArrowRight"]||keys["d"]||keys["D"]) dx+=1;
  if(keys["ArrowUp"]||keys["w"]||keys["W"]) dy-=1;
  if(keys["ArrowDown"]||keys["s"]||keys["S"]) dy+=1;
  if(dx!==0 || dy!==0){
    const len = Math.hypot(dx,dy) || 1; // diagonals shouldn't be faster than straight lines
    player.targetX += (dx/len)*player.speed*dt;
    player.targetY += (dy/len)*player.speed*dt;
  }
  if(dragActive){ player.targetX = dragX; player.targetY = dragY; }
  player.targetX = clamp(player.targetX, 18, VW-18);
  player.targetY = clamp(player.targetY, PLAY_TOP, VH-24);
  player.x += (player.targetX-player.x)*Math.min(1, dt*14);
  player.y += (player.targetY-player.y)*Math.min(1, dt*14);

  trail.push({x:player.x, y:player.y+10, life:0, maxLife:0.35});
  trail.forEach(t=> t.life += dt);
  trail = trail.filter(t=> t.life < t.maxLife);

  shakeMag = Math.max(0, shakeMag - dt*40);
  hitFlash = Math.max(0, hitFlash - dt*2.2);

  if(player.invuln>0) player.invuln -= dt;

  const now = performance.now();
  let interval = player.fireInterval;
  if(now < player.tempRapidUntil) interval *= 0.55;
  player.cooldown -= dt;
  if(player.cooldown<=0){ fireBullets(); player.cooldown = interval; } // auto-fire

  bullets.forEach(b=>{
    if(b.homing){
      let target = null, bestD = Infinity;
      enemies.forEach(e=>{ const d=dist2(b.x,b.y,e.x,e.y); if(d<bestD){ bestD=d; target=e; } });
      if(boss){ const d=dist2(b.x,b.y,boss.x,boss.y); if(d<bestD){ bestD=d; target=boss; } }
      if(target){ // stronger Seeker Rounds levels turn harder and faster
        const desired = clamp((target.x-b.x)*3, -90*b.homing, 90*b.homing);
        b.vx += clamp(desired-b.vx, -200*b.homing*dt, 200*b.homing*dt);
      }
    }
    b.x+=b.vx*dt; b.y+=b.vy*dt;
  });
  bullets = bullets.filter(b=> b.y>-20 && b.x>-20 && b.x<VW+20);
  enemyBullets.forEach(b=>{ b.x+=b.vx*dt; b.y+=b.vy*dt; });
  enemyBullets = enemyBullets.filter(b=> b.y<VH+20);

  const showingBanner = now < bannerUntil;

  if(bossPending && !showingBanner){
    boss = makeBoss();
    bossPending = false;
  }

  if(!showingBanner && !boss && !bossPending){
    spawnTimer -= dt*1000;
    if(spawnTimer<=0){
      for(let i=0;i<levelConfig.wave;i++) enemies.push(makeEnemy());
      spawnTimer = levelConfig.spawnMs * difficulty.spawn;
    }
    powerupTimer -= dt;
    if(powerupTimer<=0){
      spawnFloatingPowerup();
      powerupTimer = 10 + Math.random()*7;
    }
  }

  enemies.forEach(e=>{
    e.y += e.speed*dt;
    e.x += Math.sin(now/600 + e.sway)*20*dt;
    // Enemies shoot on their way down: straight ahead normally, or led toward
    // your ship if this one is an aimed shooter.
    if(e.shooter && e.y > 0 && e.y < VH - 40){
      e.shootTimer -= dt;
      if(e.shootTimer <= 0){
        let vx = 0;
        if(e.aimed){
          const dx = player.x - e.x, dy = Math.max(60, player.y - e.y);
          vx = clamp((dx/dy)*210, -110, 110);
        }
        enemyBullets.push({x:e.x, y:e.y+12, vx, vy:210, r:4});
        e.shootTimer = (2.0 + Math.random()*2.0) * difficulty.fireRate;
      }
    }
  });

  if(boss){
    boss.hitFlash = Math.max(0, boss.hitFlash - dt*6);
    const hurt = 1 - boss.hp/boss.maxhp;
    boss.wobble = hurt > 0.75 ? 3.5 : (hurt > 0.5 ? 1.5 : 0); // shudders when it's badly hurt
    // Wounded bosses trail smoke, and burning ones throw sparks.
    if(hurt > 0.3){
      boss.smokeTimer -= dt;
      if(boss.smokeTimer <= 0){
        const w = boss.wounds[Math.floor(Math.random()*boss.wounds.length)];
        particles.push({
          x: boss.x + w.x, y: boss.y + w.y,
          vx: (Math.random()-0.5)*20, vy: 30+Math.random()*30,
          life:0, maxLife: 0.8+Math.random()*0.5,
          color: hurt > 0.6 ? "#ff8a3d" : "#6b6b78",
        });
        boss.smokeTimer = hurt > 0.6 ? 0.045 : 0.12;
      }
    }
    if(boss.entering){
      boss.y += 150*dt; // arrives quickly so it always makes its entrance
      if(boss.y >= boss.targetY){ boss.y = boss.targetY; boss.entering=false; }
    } else {
      boss.x += boss.vx*dt;
      if(boss.x < 46 || boss.x > VW-46) boss.vx *= -1;
      boss.shootTimer -= dt;
      if(boss.shootTimer<=0){
        if(boss.pattern === "aimed"){
          const dx = player.x - boss.x, dy = Math.max(60, player.y - boss.y);
          const vy = 220, vx = clamp((dx/dy)*vy, -160, 160);
          enemyBullets.push({x:boss.x, y:boss.y+26, vx, vy, r:4});
          boss.aimStep++;
          boss.shootTimer = boss.aimStep % 3 === 0 ? 1.1 : 0.28;
        } else {
          [-90,0,90].forEach(vx => enemyBullets.push({x:boss.x, y:boss.y+26, vx, vy:210, r:4}));
          boss.shootTimer = 1.3;
        }
      }
    }
  }

  powerups.forEach(p=>{
    p.y += p.vy*dt;
    p.angle += dt*2.2;
    if(player.magnetRange > 0){ // Tractor Beam reels in anything close enough
      const d = Math.sqrt(dist2(p.x,p.y,player.x,player.y));
      if(d < player.magnetRange && d > 1){
        const pull = 240*dt;
        p.x += (player.x-p.x)/d * pull;
        p.y += (player.y-p.y)/d * pull;
      }
    }
  });
  powerups = powerups.filter(p=> p.y < VH+20);

  particles.forEach(p=>{ p.x+=p.vx*dt; p.y+=p.vy*dt; p.life+=dt; p.vx*=0.94; p.vy*=0.94; });
  particles = particles.filter(p=> p.life<p.maxLife);

  floatingTexts.forEach(f=>{ f.y -= 30*dt; f.life += dt; });
  floatingTexts = floatingTexts.filter(f=> f.life < f.maxLife);

  if(comboTimer>0) comboTimer -= dt;
  else if(combo>0) combo = 0;

  checkCollisions();
  checkLevelClear();

  if(player.lives<=0 && player.alive){
    player.alive=false;
    endRun();
  }
}

function damagePlayer(){
  if(window.__SKYFORCE_TEST_INVINCIBLE__) return; // test-only hook, unused in real play
  tookDamageThisLevel = true;
  if(player.shield > 0){
    player.shield--;
    player.invuln = Math.max(1.0, player.invulnTime*0.55);
    spawnParticles(player.x,player.y,14,player.color);
    screenShake(6);
    playHit();
    return;
  }
  player.lives--;
  player.invuln = player.invulnTime;
  spawnParticles(player.x,player.y,16,player.color);
  screenShake(10);
  hitFlash = 1;
  playHit();
}

function comboMultiplier(){ return 1 + Math.min(Math.floor(combo/3), 4)*0.5; } // caps at x3

function registerKill(x, y, baseScore, baseMoney, isBrute){
  combo++; comboTimer = 1.3;
  if(combo > activeProfile.maxCombo){ activeProfile.maxCombo = combo; }
  const mult = comboMultiplier() * (performance.now() < player.tempScoreUntil ? 2 : 1);
  // Harder tiers pay more (difficulty.pay); Salvage Rig levels pay more on top of that.
  const gainedScore = Math.round(baseScore*mult*difficulty.pay);
  const gainedMoney = Math.round(baseMoney*mult*difficulty.pay*player.moneyMult);
  score += gainedScore;
  sessionMoney += gainedMoney;
  sessionKills++;
  killsInLevel++;
  activeProfile.totalKills++;
  activeProfile.lifetimeMoney += gainedMoney;
  spawnParticles(x,y,isBrute?18:13,"#ffd23f");
  particles.push({x,y,vx:0,vy:0,life:0,maxLife:0.15,color:"#ffffff",flash:true});
  if(combo>0 && combo%3===0){
    addFloatingText(x,y-10,"COMBO x"+combo+"!","#ffd23f",16);
    playCombo(combo);
  }
  saveProfile(activeProfile);
  checkAchievements();
}

function checkCollisions(){
  for(const b of bullets){
    for(const e of enemies){
      if(e.dead) continue;
      if(dist2(b.x,b.y,e.x,e.y) < (b.r+e.r)*(b.r+e.r)){
        e.hp -= b.dmg;
        if(e.hp<=0){
          e.dead=true;
          registerKill(e.x, e.y, e.brute?12:5, e.brute?4:2, e.brute);
          playExplosion(e.brute);
        } else {
          spawnParticles(e.x, e.y, 3, "#ffd23f"); // armoured enemy shrugged it off
        }
        // Piercing Rounds let a bullet carry on into the next enemy behind it.
        if(b.pierceLeft > 0){ b.pierceLeft--; continue; }
        b.hit=true;
        break;
      }
    }
    if(b.hit) continue;
    if(boss && dist2(b.x,b.y,boss.x,boss.y) < (b.r+34)*(b.r+34)){
      b.hit=true;
      boss.hp -= b.dmg;
      boss.hitFlash = 0.45; // it visibly flinches on every hit
      spawnParticles(b.x, b.y, 4, boss.hp/boss.maxhp < 0.5 ? "#ffb03d" : "#ff5d73");
      if(boss.hp > 0 && Math.random() < 0.35){
        spawnParticles(b.x, b.y, 2, "#ffffff"); // sparks off the armour
      }
      if(boss.hp<=0){
        score += Math.round(150*difficulty.pay);
        sessionMoney += Math.round(60*difficulty.pay*player.moneyMult);
        activeProfile.bossesDefeated++;
        saveProfile(activeProfile);
        checkAchievements();
        playBossDefeat();
        screenShake(22);
        // It comes apart in stages rather than vanishing in one puff. Positions
        // are captured up front because `boss` is cleared on the next line.
        const bx0 = boss.x, by0 = boss.y, wounds = boss.wounds;
        spawnParticles(bx0, by0, 46, "#ffb03d");
        spawnParticles(bx0, by0, 30, "#ff5d73");
        wounds.forEach((w,i) => setTimeout(() => {
          if(gameState !== "playing") return;
          spawnParticles(bx0 + w.x, by0 + w.y, 8, i%2 ? "#ffffff" : "#ff8a3d");
          screenShake(6);
        }, i*55));
        addFloatingText(bx0, by0, bossDownLine(), "#ffd23f", 19);
        boss=null;
        advanceLevel(0);
      }
    }
  }
  bullets = bullets.filter(b=>!b.hit);
  enemies = enemies.filter(e=>!e.dead);

  // Enemies that get past you simply leave — only flying into one, or being
  // shot, costs a life.
  enemies = enemies.filter(e => e.y <= VH+30);

  if(player.invuln<=0){
    for(const e of enemies){
      if(dist2(e.x,e.y,player.x,player.y) < (e.r+player.r)*(e.r+player.r)){
        e.dead=true;
        spawnParticles(e.x,e.y,10,"#ffd23f");
        damagePlayer();
        break;
      }
    }
    enemies = enemies.filter(e=>!e.dead);

    for(const eb of enemyBullets){
      if(dist2(eb.x,eb.y,player.x,player.y) < (eb.r+player.r)*(eb.r+player.r)){
        eb.hit=true;
        damagePlayer();
        break;
      }
    }
    enemyBullets = enemyBullets.filter(eb=>!eb.hit);

    if(boss && dist2(boss.x,boss.y,player.x,player.y) < (34+player.r)*(34+player.r)){
      damagePlayer();
    }
  }

  for(const p of powerups){
    if(dist2(p.x,p.y,player.x,player.y) < (p.r+player.r)*(p.r+player.r)){
      p.taken=true;
      applyPowerup(p.type);
    }
  }
  powerups = powerups.filter(p=>!p.taken);
}

function advanceLevel(bonus){
  sessionMoney += Math.round(bonus*difficulty.pay*player.moneyMult);
  const wasLevel1 = (level === 1);
  if(!tookDamageThisLevel){
    activeProfile.untouchedLevelClears = (activeProfile.untouchedLevelClears||0) + 1;
  }
  if(wasLevel1){
    const elapsedSec = (performance.now() - runStartTime) / 1000;
    if(activeProfile.fastestLevel1 == null || elapsedSec < activeProfile.fastestLevel1){
      activeProfile.fastestLevel1 = Math.round(elapsedSec*10)/10;
    }
  }
  tookDamageThisLevel = false;
  level++;
  killsInLevel=0;
  levelConfig = getLevel(level);
  enemies = [];
  enemyBullets = [];
  if(player.shield < player.shieldMax){ // Energy Shield regains one charge per level cleared
    player.shield++;
  }
  if(level > activeProfile.maxLevel){
    activeProfile.maxLevel = level;
  }
  if(level > (activeProfile.bestLevelByDiff[difficulty.id]||0)){
    activeProfile.bestLevelByDiff[difficulty.id] = level; // unlocks the next tier as you climb
  }
  saveProfile(activeProfile);
  checkAchievements();
  addFloatingText(VW/2, VH*0.62, levelClearLine(), "#ffd23f", 17);
  if(isBossLevel(level)){
    bannerUntil = performance.now() + 2200;
    bossPending = true;
    playBossAlert();
  } else {
    bannerUntil = performance.now() + 1500;
    bossPending = false;
    playLevelClear();
  }
}

function checkLevelClear(){
  if(boss || bossPending) return; // during a boss encounter, only defeating it advances the level
  if(killsInLevel >= levelConfig.kills && performance.now() >= bannerUntil){
    advanceLevel(levelConfig.bonus);
  }
}

/* ---- Rendering ---- */
/* ---- Living background ----
   The nebula art scrolls past instead of sitting still, with three parallax
   star layers over it (far/mid/near) and the odd comet streaking through, so
   it always reads as flying somewhere rather than hovering on a wallpaper.
   Everything scrolls faster as the levels climb. */
let bgPhase = 0, stars = [], comets = [], cometTimer = 6;
// The nebula art isn't tileable, so instead of scrolling it (which leaves a
// hard seam where the copies meet) it's drawn slightly oversized and drifted
// around inside that margin, like a slow camera pan. The sense of speed comes
// from the star layers on top of it.
const BG_ZOOM = 1.14;

function initBackground(){
  stars = [];
  const layers = [
    { count: 46, speed: 14, size: 1.0, alpha: 0.45 },
    { count: 26, speed: 34, size: 1.5, alpha: 0.65 },
    { count: 14, speed: 68, size: 2.2, alpha: 0.9  },
  ];
  layers.forEach((L, li) => {
    for(let i=0;i<L.count;i++){
      stars.push({
        x: Math.random()*VW, y: Math.random()*VH,
        speed: L.speed, size: L.size, alpha: L.alpha, layer: li,
        twinkle: Math.random()*Math.PI*2,
      });
    }
  });
  comets = [];
  cometTimer = 4 + Math.random()*7;
  bgPhase = Math.random()*Math.PI*2;
}

function updateBackground(dt){
  // Deeper levels feel faster; capped so it never turns into a blur.
  const warp = Math.min(1 + (level-1)*0.09, 2.2);
  bgPhase += dt*0.075*warp;

  stars.forEach(s => {
    s.y += s.speed*warp*dt;
    s.twinkle += dt*2.5;
    if(s.y > VH){ s.y -= VH; s.x = Math.random()*VW; }
  });

  cometTimer -= dt;
  if(cometTimer <= 0){
    const fromLeft = Math.random() < 0.5;
    comets.push({
      x: fromLeft ? -20 : VW+20, y: Math.random()*VH*0.55,
      vx: (fromLeft ? 1 : -1) * (150+Math.random()*120), vy: 90+Math.random()*70,
      life: 0, maxLife: 2.4,
    });
    cometTimer = 7 + Math.random()*11;
  }
  comets.forEach(c => { c.x += c.vx*dt; c.y += c.vy*dt; c.life += dt; });
  comets = comets.filter(c => c.life < c.maxLife);
}

function drawBackground(){
  if(assetsReady){
    const marginX = VW*(BG_ZOOM-1)/2, marginY = VH*(BG_ZOOM-1)/2;
    ctx.drawImage(assets.playfieldBg,
      -marginX + Math.sin(bgPhase)*marginX,
      -marginY + Math.sin(bgPhase*0.63)*marginY,
      VW*BG_ZOOM, VH*BG_ZOOM);
  } else {
    ctx.fillStyle="#05040f"; ctx.fillRect(0,0,VW,VH);
  }

  ctx.save();
  stars.forEach(s => {
    const flicker = 0.75 + Math.sin(s.twinkle)*0.25;
    ctx.globalAlpha = s.alpha*flicker;
    ctx.fillStyle = s.layer===2 ? "#cfe8ff" : "#ffffff";
    ctx.fillRect(s.x, s.y, s.size, s.size + (s.layer===2 ? 2 : 0));
  });
  ctx.globalAlpha = 1;

  comets.forEach(c => {
    const fade = 1 - c.life/c.maxLife;
    const len = 26;
    const nx = c.vx/Math.hypot(c.vx,c.vy), ny = c.vy/Math.hypot(c.vx,c.vy);
    const grad = ctx.createLinearGradient(c.x, c.y, c.x-nx*len, c.y-ny*len);
    grad.addColorStop(0, `rgba(255,255,255,${0.85*fade})`);
    grad.addColorStop(1, "rgba(120,180,255,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x-nx*len, c.y-ny*len);
    ctx.stroke();
  });
  ctx.restore();
}
function drawPlayer(){
  if(!player.alive) return;
  if(player.invuln>0 && Math.floor(player.invuln*10)%2===0) return;
  const size = 46;
  const sprite = assetsReady ? getTintedShip(player.color) : null;
  // Wingman drones ride alongside at 60% scale.
  for(let i=0;i<player.drones;i++){
    const dx = (i===0 ? -26 : 26), dsize = size*0.6;
    if(sprite) ctx.drawImage(sprite, player.x+dx-dsize/2, player.y-dsize/2+4, dsize, dsize);
    else { ctx.fillStyle=player.color; ctx.beginPath(); ctx.arc(player.x+dx, player.y+4, dsize/2, 0, Math.PI*2); ctx.fill(); }
  }
  if(sprite){
    ctx.drawImage(sprite, player.x-size/2, player.y-size/2, size, size);
  } else {
    ctx.fillStyle = player.color;
    ctx.beginPath(); ctx.arc(player.x, player.y, size/2, 0, Math.PI*2); ctx.fill();
  }
  // One ring per remaining shield charge.
  for(let i=0;i<player.shield;i++){
    ctx.save();
    ctx.strokeStyle="rgba(120,200,255," + (0.8 - i*0.15) + ")";
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(player.x, player.y, size*0.7 + i*4, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
}
function drawEnemies(){
  enemies.forEach(e=>{
    const size = e.brute ? 46 : 34;
    if(assetsReady){
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(Math.PI); // enemy sprite faces the same way as player art; flip to face downward
      // Aimed shooters are tinted so you can tell which ones lead their shots.
      ctx.drawImage(e.aimed ? getTintedEnemy("#a855f7") : assets.enemy, -size/2, -size/2, size, size);
      ctx.restore();
    } else {
      ctx.fillStyle = e.aimed ? "#a855f7" : (e.brute ? "#ff5d73" : "#c0392b");
      ctx.beginPath(); ctx.arc(e.x, e.y, size/2, 0, Math.PI*2); ctx.fill();
    }
    // Armoured enemies (harder tiers / deep levels) show how much is left.
    if(e.maxhp > 1 && e.hp < e.maxhp){
      const w = size*0.8, pct = Math.max(0, e.hp/e.maxhp);
      ctx.fillStyle="rgba(0,0,0,0.5)";
      ctx.fillRect(e.x-w/2, e.y-size/2-6, w, 3);
      ctx.fillStyle="#ffd23f";
      ctx.fillRect(e.x-w/2, e.y-size/2-6, w*pct, 3);
    }
  });
}
/* The boss is drawn through an offscreen buffer so damage can be composited
   onto the sprite itself: scorch marks burned in with "source-atop", and at
   low health actual chunks erased out of the silhouette with "destination-out".
   That way you can see it coming apart, not just a bar going down. */
const bossBuf = document.createElement("canvas");
bossBuf.width = 128; bossBuf.height = 128;
const bossBufCtx = bossBuf.getContext("2d");

function drawBoss(){
  if(!boss) return;
  const size = 96;
  const tintHex = boss.pattern === "aimed" ? "#a855f7" : "#ff2d55";
  const pct = Math.max(0, boss.hp/boss.maxhp);
  const damage = 1 - pct;

  const bx = boss.x + (boss.wobble ? (Math.random()-0.5)*boss.wobble : 0);
  const by = boss.y + (boss.wobble ? (Math.random()-0.5)*boss.wobble : 0);

  if(assetsReady){
    const B = bossBufCtx;
    B.setTransform(1,0,0,1,0,0);
    B.clearRect(0,0,128,128);
    B.save();
    B.translate(64,64);
    B.rotate(Math.PI);
    B.drawImage(getTintedEnemy(tintHex), -size/2, -size/2, size, size);
    B.restore();

    // Burn scorch marks in as health falls - one per 10% lost.
    const scorched = Math.min(boss.wounds.length, Math.floor(damage*10));
    B.save();
    B.globalCompositeOperation = "source-atop";
    for(let i=0;i<scorched;i++){
      const w = boss.wounds[i];
      const g = B.createRadialGradient(64+w.x, 64+w.y, 1, 64+w.x, 64+w.y, w.r);
      g.addColorStop(0, "rgba(20,10,10,0.95)");
      g.addColorStop(1, "rgba(40,20,20,0)");
      B.fillStyle = g;
      B.beginPath(); B.arc(64+w.x, 64+w.y, w.r, 0, Math.PI*2); B.fill();
    }
    B.restore();

    // Below half health, start tearing pieces off it for real.
    if(damage > 0.5){
      const broken = Math.floor((damage-0.5)*2*boss.wounds.length);
      B.save();
      B.globalCompositeOperation = "destination-out";
      for(let i=0;i<broken;i++){
        const w = boss.wounds[boss.wounds.length-1-i];
        B.beginPath(); B.arc(64+w.x, 64+w.y, w.r*0.7, 0, Math.PI*2); B.fill();
      }
      B.restore();
      // Glowing molten edges around the holes
      B.save();
      B.globalCompositeOperation = "source-atop";
      B.strokeStyle = "rgba(255,150,40,0.85)";
      B.lineWidth = 2;
      for(let i=0;i<broken;i++){
        const w = boss.wounds[boss.wounds.length-1-i];
        B.beginPath(); B.arc(64+w.x, 64+w.y, w.r*0.75, 0, Math.PI*2); B.stroke();
      }
      B.restore();
    }

    // White flash on the frames right after it's been hit.
    if(boss.hitFlash > 0){
      B.save();
      B.globalCompositeOperation = "source-atop";
      B.fillStyle = `rgba(255,255,255,${Math.min(0.45, boss.hitFlash)})`;
      B.fillRect(0,0,128,128);
      B.restore();
    }

    ctx.drawImage(bossBuf, bx-64, by-64);
  } else {
    ctx.fillStyle = tintHex;
    ctx.beginPath(); ctx.arc(bx, by, size/2*(0.7+0.3*pct), 0, Math.PI*2); ctx.fill();
  }

  // Boss health lives in its own strip below the HUD, so it never tangles
  // with the score/lives readouts or hides behind the boss itself.
  const w = VW-56, barY = 74;
  ctx.save();
  ctx.fillStyle="rgba(0,0,0,0.45)";
  ctx.fillRect(28, barY, w, 10);
  // Bar shifts red as it weakens, so a glance tells you how close it is.
  ctx.fillStyle = pct > 0.5 ? tintHex : (pct > 0.25 ? "#ffa726" : "#ff3b30");
  ctx.fillRect(28, barY, w*pct, 10);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 9px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BOSS", VW/2, barY-3);
  ctx.textAlign = "left";
  if(pct <= 0.25){ // "nearly there" pulse
    ctx.strokeStyle = `rgba(255,60,60,${0.4+0.4*Math.sin(performance.now()/120)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(27, barY-1, w+2, 12);
  }
  ctx.restore();
}
function drawPowerups(){
  powerups.forEach(p=>{
    ctx.save();
    ctx.translate(p.x,p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.type.color;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0,0,11,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.rotate(-p.angle);
    ctx.fillStyle="#0a0920";
    ctx.font="bold 11px Arial, sans-serif";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    const glyph = {rapid:"R",spread:"S",shield:"+",score2x:"x2",bomb:"B",homing:"H"}[p.type.id] || "?";
    ctx.fillText(glyph,0,1);
    ctx.restore();
  });
}
function drawFloatingTexts(){
  floatingTexts.forEach(f=>{
    const t = 1 - f.life/f.maxLife;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = f.color;
    ctx.font = "bold " + f.size + "px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  });
}
function drawBullets(){
  const bw=8, bh=22;
  bullets.forEach(b=>{
    if(assetsReady) ctx.drawImage(assets.bulletImg, b.x-bw/2, b.y-bh/2, bw, bh);
    else { ctx.fillStyle="#ffd23f"; ctx.fillRect(b.x-2,b.y-6,4,10); }
  });
  ctx.save();
  ctx.fillStyle="#ff5d73"; ctx.shadowColor="#ff5d73"; ctx.shadowBlur=6;
  enemyBullets.forEach(b=> ctx.fillRect(b.x-2,b.y-5,4,9));
  ctx.restore();
}
function drawParticles(){
  particles.forEach(p=>{
    const t=1-p.life/p.maxLife;
    ctx.globalAlpha = t;
    if(p.flash){
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x,p.y, 4+(1-t)*16, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x-2,p.y-2,4,4);
    }
    ctx.globalAlpha = 1;
  });
}
function drawTrail(){
  trail.forEach(t=>{
    const a = 1 - t.life/t.maxLife;
    ctx.globalAlpha = a*0.3;
    ctx.fillStyle = player.color;
    ctx.fillRect(t.x-2, t.y, 4, 8);
    ctx.globalAlpha = 1;
  });
}
function drawHud(){
  ctx.save();
  ctx.textBaseline="top";
  ctx.fillStyle="white";
  ctx.font="bold 15px Arial, sans-serif";
  ctx.fillText("Score " + score, 12, 10);
  ctx.textAlign="right";
  ctx.fillText("Lv " + level, VW-12, 10);
  ctx.textAlign="left";

  ctx.fillStyle="#ffd23f";
  ctx.font="bold 13px Arial, sans-serif";
  ctx.fillText((activeProfile.callsign||"") + "   $" + (activeProfile.money+sessionMoney), 12, 32);

  ctx.fillStyle=difficulty.color;
  ctx.font="bold 11px Arial, sans-serif";
  ctx.textAlign="center";
  ctx.fillText(difficulty.name, VW/2, 12);
  ctx.textAlign="left";

  if(player.bombs > 0){
    ctx.fillStyle="#ff5d73";
    ctx.font="bold 12px Arial, sans-serif";
    ctx.textAlign="right";
    ctx.fillText("💣 x" + player.bombs, VW-12, 52);
    ctx.textAlign="left";
  }

  for(let i=0;i<player.lives;i++){
    ctx.save();
    ctx.translate(12+i*16, 54);
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.moveTo(0,-6); ctx.lineTo(5,6); ctx.lineTo(0,3); ctx.lineTo(-5,6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  if(combo>=3){
    ctx.fillStyle="#ff5d73";
    ctx.font="bold 13px Arial, sans-serif";
    ctx.textAlign="right";
    ctx.fillText("COMBO x"+combo, VW-12, 32);
    ctx.textAlign="left";
  }

  if(performance.now() < bannerUntil){
    ctx.fillStyle="rgba(0,0,0,0.55)";
    ctx.fillRect(50,VH/2-40,VW-100,60);
    ctx.fillStyle= bossPending ? "#ff5d73" : "white";
    ctx.textAlign="center";
    ctx.font="bold 19px Arial, sans-serif";
    ctx.fillText(bossPending ? "⚠ BOSS INCOMING ⚠" : "LEVEL " + level + " INCOMING", VW/2, VH/2-22);
    ctx.textAlign="left";
  }
  ctx.restore();
}

function render(dt){
  ctx.save();
  if(shakeMag > 0.3){
    ctx.translate((Math.random()-0.5)*shakeMag, (Math.random()-0.5)*shakeMag);
  }
  ctx.clearRect(-20,-20,VW+40,VH+40);
  drawBackground();
  drawTrail();
  drawParticles();
  drawPowerups();
  drawEnemies();
  drawBoss();
  drawBullets();
  drawPlayer();
  drawFloatingTexts();
  drawHud();
  if(hitFlash > 0.01){
    ctx.fillStyle = `rgba(255,40,60,${hitFlash*0.35})`;
    ctx.fillRect(0,0,VW,VH);
  }
  ctx.restore();
}

let lastTime = performance.now();
function loop(now){
  // Queue the next frame first: if one frame ever throws, the game keeps
  // running instead of freezing solid on whoever's playing.
  requestAnimationFrame(loop);
  let dt = (now-lastTime)/1000;
  lastTime = now;
  dt = Math.min(dt, 0.05);
  if(screens["screen-game"].classList.contains("active")){
    if(stars.length) updateBackground(dt); // keeps drifting even while paused
    if(gameState==="playing") update(dt);
    render(dt);
  }
}

renderProfileGrid();
resizeCanvas();
requestAnimationFrame(loop);
loadAssets(() => { document.body.classList.add("assets-ready"); });

})();
