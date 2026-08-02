(function(){
"use strict";

/* =========================================================
   CONFIG
   ========================================================= */
const VW = 390, VH = 620;

const SHIP_COLORS = ["#3399ff", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#ff66b3"];

/* ---------------------------------------------------------
   UPGRADES
   Every item has several levels and each level costs more than
   the one before it, so fully maxing the Armory is a long-haul
   goal (~$65k of kills) rather than something you finish in an
   afternoon. `effect` describes what owning `lvl` levels does.
   --------------------------------------------------------- */
const UPGRADES = [
  { id:"spread", name:"Spread Shot", icon:"🔱", max:5, costs:[150,400,900,1800,3200],
    desc:"More bullets in every shot",
    effect: lvl => spreadPattern(lvl).length + "-way fire" },
  { id:"rapid", name:"Rapid Fire", icon:"⚡", max:5, costs:[120,320,750,1500,2800],
    desc:"Shorter gap between shots",
    effect: lvl => "+" + Math.round((1/fireRateMult(lvl) - 1)*100) + "% fire rate" },
  { id:"damage", name:"Plasma Rounds", icon:"💥", max:5, costs:[200,500,1100,2200,4000],
    desc:"Each bullet hits harder",
    effect: lvl => (1+lvl) + " damage per hit" },
  { id:"pierce", name:"Piercing Rounds", icon:"🗡️", max:3, costs:[600,1600,3400],
    desc:"Bullets punch through enemies instead of stopping",
    effect: lvl => "hits " + (1+lvl) + " enemies per bullet" },
  { id:"homing", name:"Seeker Rounds", icon:"🎯", max:3, costs:[500,1400,3000],
    desc:"Bullets curve toward the nearest target",
    effect: lvl => "tracking " + lvl + "/3" },
  { id:"shield", name:"Energy Shield", icon:"🛡️", max:4, costs:[100,350,900,2000],
    desc:"Absorbs hits; one charge comes back each level cleared",
    effect: lvl => lvl + (lvl===1 ? " charge" : " charges") },
  { id:"life", name:"Extra Life", icon:"❤️", max:5, costs:[80,240,600,1400,2600],
    desc:"Start every run with more lives",
    effect: lvl => (3+lvl) + " starting lives" },
  { id:"thrusters", name:"Ion Thrusters", icon:"🚀", max:4, costs:[130,340,800,1700],
    desc:"Steer faster — the main way to survive fast enemies",
    effect: lvl => "+" + (lvl*15) + "% ship speed" },
  { id:"armor", name:"Hull Plating", icon:"🧱", max:3, costs:[250,700,1600],
    desc:"Longer blinking-invincible window after you take a hit",
    effect: lvl => "+" + (lvl*0.6).toFixed(1) + "s recovery" },
  { id:"magnet", name:"Tractor Beam", icon:"🧲", max:3, costs:[220,600,1400],
    desc:"Drags nearby power-ups toward your ship",
    effect: lvl => (lvl*45) + "px pull range" },
  { id:"fortune", name:"Salvage Rig", icon:"💰", max:5, costs:[300,700,1500,3000,5500],
    desc:"Every kill pays out more — buy this early, it pays for itself",
    effect: lvl => "+" + (lvl*15) + "% money" },
  { id:"wingman", name:"Wingman Drone", icon:"🛩️", max:2, costs:[1200,3000],
    desc:"Escort drones that fire alongside you",
    effect: lvl => lvl + (lvl===1 ? " drone" : " drones") },
  { id:"bomb", name:"Smart Bombs", icon:"💣", max:3, costs:[400,1000,2200],
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
const DIFFICULTIES = [
  { id:"rookie", name:"ROOKIE", tag:"Easy", color:"#2ecc71",
    blurb:"Slow enemies, a free extra life. Learn the ropes.",
    speed:0.70, spawn:1.40, hpBonus:0, bruteChance:0.5, bossHp:0.65, pay:0.7, shooter:0, bonusLives:1, unlock:null },
  { id:"pilot", name:"PILOT", tag:"Normal", color:"#3399ff",
    blurb:"The standard mission. Balanced pay.",
    speed:1.00, spawn:1.00, hpBonus:0, bruteChance:1.0, bossHp:1.00, pay:1.0, shooter:0, bonusLives:0, unlock:null },
  { id:"ace", name:"ACE", tag:"Hard", color:"#f39c12",
    blurb:"Armoured enemies, and some of them shoot back. Pays 1.7x.",
    speed:1.28, spawn:0.78, hpBonus:1, bruteChance:1.3, bossHp:1.45, pay:1.7, shooter:0.12,
    bonusLives:0, unlock:{ diff:"pilot", level:4 } },
  { id:"veteran", name:"VETERAN", tag:"Brutal", color:"#e74c3c",
    blurb:"Heavy armour, swarms, lots of return fire. Pays 2.6x.",
    speed:1.55, spawn:0.62, hpBonus:2, bruteChance:1.6, bossHp:1.90, pay:2.6, shooter:0.22,
    bonusLives:0, unlock:{ diff:"ace", level:5 } },
  { id:"nightmare", name:"NIGHTMARE", tag:"Super Hard", color:"#9b59b6",
    blurb:"Everything at once. Only worth trying fully kitted out. Pays 4x.",
    speed:1.90, spawn:0.50, hpBonus:3, bruteChance:2.0, bossHp:2.50, pay:4.0, shooter:0.32,
    bonusLives:0, unlock:{ diff:"veteran", level:6 } },
];
const DIFFICULTY_BY_ID = {};
DIFFICULTIES.forEach(d => DIFFICULTY_BY_ID[d.id] = d);

/** A difficulty is locked until you've reached the required level on the tier below. */
function difficultyLocked(p, d){
  if(!d.unlock) return false;
  return (p.bestLevelByDiff && p.bestLevelByDiff[d.unlock.diff] || 0) < d.unlock.level;
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
}
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
function playShoot(){ tone(760,0.06,"square",0.045,420); }
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

/** Recolors the ship sprite to a target hue while preserving its original shading (same technique as ImageTint.java). Cached per color. */
const tintCache = {};
function getTintedShip(hex){
  if(tintCache[hex]) return tintCache[hex];
  const img = assets.ship;
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
 * The old flat booleans (hasSpread/hasRapid/hasShield/extraLives) become
 * level 1 of the matching upgrade, so nobody loses what they already bought.
 */
function migrateProfile(p){
  if(!p.upgrades || typeof p.upgrades !== "object") p.upgrades = {};
  if(!p.bestLevelByDiff) p.bestLevelByDiff = {};
  if(!p.bestScoreByDiff) p.bestScoreByDiff = {};
  if(!DIFFICULTY_BY_ID[p.difficulty]) p.difficulty = "pilot";
  if(p.hasSpread && !p.upgrades.spread) p.upgrades.spread = 1;
  if(p.hasRapid  && !p.upgrades.rapid)  p.upgrades.rapid  = 1;
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
    const card = document.createElement("div");
    card.className = "profile-card";
    card.innerHTML = `
      <div class="avatar" style="background:${p.shipColor}"></div>
      <div class="pname">${escapeHtml(p.callsign || p.name)}</div>
      <div class="pscore">Best: ${p.highscore}</div>
    `;
    card.addEventListener("click", () => selectProfile(name));
    grid.appendChild(card);
  });
}
function selectProfile(name){
  activeProfile = loadProfile(name);
  document.getElementById("greeting").textContent = "Ready for launch, " + activeProfile.callsign + "!";
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
  document.getElementById("armoryMoney").textContent = "MONEY: $" + p.money;
  document.getElementById("callsignInput").value = p.callsign;

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

  document.getElementById("armoryPower").textContent =
    "GEAR LEVEL " + totalUpgradeLevels(p) + " / " + MAX_UPGRADE_LEVELS;

  const shopItems = document.getElementById("shopItems");
  shopItems.innerHTML = "";
  UPGRADES.forEach(u => {
    const lvl = upgLevel(p, u.id);
    const cost = nextCost(p, u);
    const maxed = cost === null;
    const row = document.createElement("div");
    row.className = "shop-item" + (maxed ? " maxed" : "");
    const pips = Array.from({length:u.max}, (_,i) =>
      `<span class="pip${i < lvl ? " on" : ""}"></span>`).join("");
    row.innerHTML = `
      <div class="si-main">
        <div class="si-name">${u.icon} ${escapeHtml(u.name)} <span class="si-lvl">Lv ${lvl}/${u.max}</span></div>
        <div class="si-pips">${pips}</div>
        <div class="si-desc">${escapeHtml(u.desc)}</div>
        <div class="si-effect">${lvl > 0 ? "Now: " + escapeHtml(u.effect(lvl)) : "Not owned"}${
          maxed ? "" : " → " + escapeHtml(u.effect(lvl+1))}</div>
      </div>
    `;
    const btn = document.createElement("button");
    btn.textContent = maxed ? "MAX" : "$" + cost;
    btn.disabled = maxed || p.money < cost;
    btn.addEventListener("click", () => buyUpgrade(u.id));
    row.appendChild(btn);
    shopItems.appendChild(row);
  });
}
function buyUpgrade(id){
  const p = activeProfile;
  const u = UPGRADE_BY_ID[id];
  const cost = nextCost(p, u);
  if(cost === null || p.money < cost) return;
  p.money -= cost;
  p.upgrades[id] = upgLevel(p, id) + 1;
  saveProfile(p);
  playPowerup();
  checkAchievements();
  renderArmory();
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
const keys = {};
let firing = false;
window.addEventListener("keydown", e => {
  keys[e.key] = true;
  if(e.key===" ") firing = true;
  if(e.key===" "||e.key==="ArrowUp"||e.key==="ArrowDown") e.preventDefault();
  if(e.key==="p"||e.key==="P"||e.key==="Escape") togglePause();
  if(e.key==="b"||e.key==="B") useBomb();
});
window.addEventListener("keyup", e => {
  keys[e.key]=false;
  if(e.key===" ") firing = false;
});

let dragActive=false, dragX=VW/2;
function pointerToVirtualX(clientX){
  const rect = canvas.getBoundingClientRect();
  return clamp((clientX-rect.left)/rect.width*VW, 0, VW);
}
canvas.addEventListener("pointerdown", e => { dragActive=true; dragX=pointerToVirtualX(e.clientX); });
window.addEventListener("pointermove", e => { if(dragActive) dragX = pointerToVirtualX(e.clientX); });
window.addEventListener("pointerup", () => { dragActive=false; });

const fireBtn = document.getElementById("fireBtn");
if(fireBtn){
  const startFiring = e => { firing = true; e.preventDefault(); };
  const stopFiring = () => { firing = false; };
  fireBtn.addEventListener("pointerdown", startFiring);
  fireBtn.addEventListener("pointerup", stopFiring);
  fireBtn.addEventListener("pointerleave", stopFiring);
  fireBtn.addEventListener("pointercancel", stopFiring);
}

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
    x: VW/2, y: VH-60, targetX: VW/2, r:9,
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
  document.getElementById("fireBtn").classList.remove("hidden");
  document.getElementById("muteBtn").classList.remove("hidden");
  document.getElementById("muteBtn").textContent = muted ? "🔇" : "♪";
  document.getElementById("overlayPause").classList.add("hidden");
  document.getElementById("overlayOver").classList.add("hidden");
  updateBombButton();
  resizeCanvas();
}

/** The 💣 button only exists for players who bought Smart Bombs, and shows what's left. */
function updateBombButton(){
  const btn = document.getElementById("bombBtn");
  if(!btn) return;
  const show = player && player.alive && player.bombs > 0 && gameState !== "over";
  btn.classList.toggle("hidden", !show);
  btn.textContent = "💣" + (player ? player.bombs : 0);
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
  document.getElementById("fireBtn").classList.add("hidden");
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
  document.getElementById("fireBtn").classList.add("hidden");
  updateBombButton();
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
  const shooter = !brute && level>=2 && Math.random() < difficulty.shooter;
  return {
    x, y:-30, r: brute?14:10, hp, maxhp: hp,
    speed: levelConfig.speed * difficulty.speed * (brute?0.75:1) * (0.85+Math.random()*0.3),
    sway: Math.random()*Math.PI*2, brute, shooter,
    shootTimer: 1.2 + Math.random()*1.6,
  };
}
function makeBoss(){
  const hp = window.__SKYFORCE_TEST_EASY_BOSS__ ? 3 // test-only hook, unused in real play
    : Math.round((18 + level*7) * difficulty.bossHp);
  const bossIndex = level / BOSS_EVERY; // 1st, 2nd, 3rd boss encounter...
  return {
    x: VW/2, y:-70, targetY:74, hp, maxhp:hp,
    vx: 55 + level*3, shootTimer: 1.3, entering:true,
    pattern: (bossIndex % 2 === 0) ? "aimed" : "spread",
    aimStep: 0,
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

  // movement
  let dx=0;
  if(keys["ArrowLeft"]||keys["a"]||keys["A"]) dx-=1;
  if(keys["ArrowRight"]||keys["d"]||keys["D"]) dx+=1;
  if(dx!==0) player.targetX += dx*player.speed*dt;
  if(dragActive) player.targetX = dragX;
  player.targetX = clamp(player.targetX, 18, VW-18);
  player.x += (player.targetX-player.x)*Math.min(1, dt*14);

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
  if(firing && player.cooldown<=0){ fireBullets(); player.cooldown = interval; }

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
    // On the harder tiers some enemies shoot back on their way down.
    if(e.shooter && e.y > 0 && e.y < VH*0.72){
      e.shootTimer -= dt;
      if(e.shootTimer <= 0){
        const dx = player.x - e.x, dy = Math.max(60, player.y - e.y);
        const vy = 200, vx = clamp((dx/dy)*vy, -110, 110);
        enemyBullets.push({x:e.x, y:e.y+12, vx, vy, r:4});
        e.shootTimer = 1.7 + Math.random()*1.2;
      }
    }
  });

  if(boss){
    if(boss.entering){
      boss.y += 70*dt;
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
      spawnParticles(boss.x+((Math.random()-0.5)*40), boss.y+((Math.random()-0.5)*20), 4, "#ff5d73");
      if(boss.hp<=0){
        score += Math.round(150*difficulty.pay);
        sessionMoney += Math.round(60*difficulty.pay*player.moneyMult);
        activeProfile.bossesDefeated++;
        saveProfile(activeProfile);
        checkAchievements();
        playBossDefeat();
        screenShake(18);
        spawnParticles(boss.x,boss.y,40,"#ff5d73");
        addFloatingText(boss.x, boss.y, "BOSS DOWN!", "#ff5d73", 20);
        boss=null;
        advanceLevel(0);
      }
    }
  }
  bullets = bullets.filter(b=>!b.hit);
  enemies = enemies.filter(e=>!e.dead);

  if(player.invuln<=0){
    for(const e of enemies){
      if(e.y > VH+20 || dist2(e.x,e.y,player.x,player.y) < (e.r+player.r)*(e.r+player.r)){
        e.dead=true;
        if(e.y<=VH+20) spawnParticles(e.x,e.y,10,"#ffd23f");
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
  } else {
    enemies = enemies.filter(e=> e.y <= VH+20);
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
function drawBackground(){
  if(assetsReady) ctx.drawImage(assets.playfieldBg, 0, 0, VW, VH);
  else { ctx.fillStyle="#05040f"; ctx.fillRect(0,0,VW,VH); }
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
      // Shooters are tinted so you can tell at a glance which ones fire back.
      ctx.drawImage(e.shooter ? getTintedEnemy("#a855f7") : assets.enemy, -size/2, -size/2, size, size);
      ctx.restore();
    } else {
      ctx.fillStyle = e.shooter ? "#a855f7" : (e.brute ? "#ff5d73" : "#c0392b");
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
function drawBoss(){
  if(!boss) return;
  const size = 96;
  const tintHex = boss.pattern === "aimed" ? "#a855f7" : "#ff2d55";
  if(assetsReady){
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.rotate(Math.PI);
    ctx.drawImage(getTintedEnemy(tintHex), -size/2, -size/2, size, size);
    ctx.restore();
  } else {
    ctx.fillStyle = tintHex;
    ctx.beginPath(); ctx.arc(boss.x, boss.y, size/2, 0, Math.PI*2); ctx.fill();
  }

  const w=140, pct=Math.max(0,boss.hp/boss.maxhp);
  ctx.fillStyle="rgba(0,0,0,0.5)";
  ctx.fillRect(VW/2-w/2, boss.y-64, w, 8);
  ctx.fillStyle=tintHex;
  ctx.fillRect(VW/2-w/2, boss.y-64, w*pct, 8);
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
  let dt = (now-lastTime)/1000;
  lastTime = now;
  dt = Math.min(dt, 0.05);
  if(screens["screen-game"].classList.contains("active")){
    if(gameState==="playing") update(dt);
    render(dt);
  }
  requestAnimationFrame(loop);
}

renderProfileGrid();
resizeCanvas();
requestAnimationFrame(loop);
loadAssets(() => { document.body.classList.add("assets-ready"); });

})();
