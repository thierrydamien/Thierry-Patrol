(function(){
"use strict";

/* =========================================================
   CONFIG
   ========================================================= */
const VW = 390, VH = 620;

const SHIP_COLORS = ["#3399ff", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#ff66b3"];

const SHOP_ITEMS = [
  { id:"spread", name:"Spread Shot", desc:"Fire 3 bullets at once", cost:150 },
  { id:"rapid",  name:"Rapid Fire",  desc:"Fire twice as fast",    cost:120 },
  { id:"shield", name:"Energy Shield", desc:"Absorb one hit per run", cost:100 },
  { id:"life",   name:"Extra Life",  desc:"+1 starting life (max 3)", cost:80 },
];

const LEVELS = [
  { speed:70,  wave:2, spawnMs:1800, kills:15, bonus:50  },
  { speed:100, wave:3, spawnMs:1500, kills:20, bonus:75  },
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
  { id:"big_spender",   icon:"💰", name:"Fully Loaded",    desc:"Own every Armory upgrade",        check:p=>p.hasSpread&&p.hasRapid&&p.hasShield&&p.extraLives>=3 },
  { id:"century",       icon:"💯", name:"Century Club",    desc:"Destroy 100 enemies (lifetime)",  check:p=>p.totalKills>=100 },
  { id:"high_roller",   icon:"🤑", name:"High Roller",     desc:"Earn $1000 (lifetime)",           check:p=>p.lifetimeMoney>=1000 },
  { id:"unstoppable",   icon:"🌟", name:"Unstoppable",     desc:"Reach level 10",                  check:p=>p.maxLevel>=10 },
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
   PROFILES (localStorage)
   ========================================================= */
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
    money:0, hasSpread:false, hasRapid:false, hasShield:false, extraLives:0,
    highscore:0,
    totalKills:0, bossesDefeated:0, maxLevel:0, maxCombo:0, lifetimeMoney:0,
    achievements:[],
  };
  const raw = localStorage.getItem(PROFILE_PREFIX+name);
  if(raw){
    return Object.assign(base, JSON.parse(raw)); // old saves just fill in any new fields as defaults
  }
  return base;
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
  showScreen("screen-game");
  startRun();
});
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

  const shopItems = document.getElementById("shopItems");
  shopItems.innerHTML = "";
  SHOP_ITEMS.forEach(item => {
    const owned = item.id==="life" ? p.extraLives >= 3 : p["has"+capitalize(item.id)];
    const row = document.createElement("div");
    row.className = "shop-item";
    const label = item.id==="life"
      ? (owned ? `Extra Life — MAXED (${p.extraLives}/3)` : `Extra Life — $${item.cost} (${p.extraLives}/3)`)
      : (owned ? `${item.name} — OWNED` : `${item.name} — $${item.cost}`);
    row.innerHTML = `
      <div><div class="si-name">${label}</div><div class="si-desc">${item.desc}</div></div>
    `;
    const btn = document.createElement("button");
    btn.textContent = owned ? "OWNED" : "BUY";
    btn.disabled = owned || p.money < item.cost;
    btn.addEventListener("click", () => buyItem(item.id));
    row.appendChild(btn);
    shopItems.appendChild(row);
  });
}
function capitalize(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function buyItem(id){
  const p = activeProfile;
  const item = SHOP_ITEMS.find(i => i.id === id);
  if(p.money < item.cost) return;
  p.money -= item.cost;
  if(id === "life") p.extraLives = Math.min(p.extraLives+1, 3);
  else p["has"+capitalize(id)] = true;
  saveProfile(p);
  renderArmory();
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
window.addEventListener("keydown", e => {
  keys[e.key] = true;
  if(e.key===" "||e.key==="ArrowUp"||e.key==="ArrowDown") e.preventDefault();
  if(e.key==="p"||e.key==="P"||e.key==="Escape") togglePause();
});
window.addEventListener("keyup", e => { keys[e.key]=false; });

let dragActive=false, dragX=VW/2;
function pointerToVirtualX(clientX){
  const rect = canvas.getBoundingClientRect();
  return clamp((clientX-rect.left)/rect.width*VW, 0, VW);
}
canvas.addEventListener("pointerdown", e => { dragActive=true; dragX=pointerToVirtualX(e.clientX); });
window.addEventListener("pointermove", e => { if(dragActive) dragX = pointerToVirtualX(e.clientX); });
window.addEventListener("pointerup", () => { dragActive=false; });

/* ---- Entity state ---- */
let player, bullets, enemyBullets, enemies, particles, floatingTexts, powerups;
let level, killsInLevel, levelConfig, bannerUntil;
let sessionMoney, score, sessionKills;
let spawnTimer;
let combo, comboTimer;
let boss, bossPending;
let powerupTimer;
let gameState = "playing"; // playing | paused | over

function startRun(){
  const p = activeProfile;
  player = {
    x: VW/2, y: VH-60, targetX: VW/2, r:11,
    speed: 320, lives: 3+p.extraLives, alive:true,
    invuln: 1.0, shield: p.hasShield, cooldown:0,
    fireInterval: p.hasRapid ? 0.16 : 0.30,
    hasSpread: p.hasSpread, color: p.shipColor,
    tempRapidUntil:0, tempSpreadUntil:0, tempScoreUntil:0,
  };
  bullets=[]; enemyBullets=[]; enemies=[]; particles=[]; floatingTexts=[]; powerups=[];
  level=1; killsInLevel=0; levelConfig=getLevel(level); bannerUntil=0;
  sessionMoney=0; score=0; sessionKills=0; spawnTimer=0;
  combo=0; comboTimer=0;
  boss=null; bossPending=false;
  powerupTimer = 10 + Math.random()*6;
  gameState="playing";
  document.getElementById("pauseBtn").classList.remove("hidden");
  document.getElementById("muteBtn").classList.remove("hidden");
  document.getElementById("muteBtn").textContent = muted ? "🔇" : "♪";
  document.getElementById("overlayPause").classList.add("hidden");
  document.getElementById("overlayOver").classList.add("hidden");
  resizeCanvas();
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
  showScreen("screen-menu");
});
document.getElementById("retryBtn").addEventListener("click", () => startRun());
document.getElementById("menuBtn").addEventListener("click", () => showScreen("screen-menu"));

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
  saveProfile(p);
  checkAchievements();
  document.getElementById("overScore").textContent = "SCORE " + score;
  document.getElementById("overMoney").textContent = "+$" + sessionMoney + " earned (wallet: $" + p.money + ")";
  document.getElementById("pauseBtn").classList.add("hidden");
  document.getElementById("muteBtn").classList.add("hidden");
  document.getElementById("overlayOver").classList.remove("hidden");
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
  const brute = level>=3 && Math.random()<0.25;
  const x = 24 + Math.random()*(VW-48);
  return {
    x, y:-30, r: brute?15:11, hp: brute?2:1, maxhp: brute?2:1,
    speed: levelConfig.speed * (brute?0.75:1) * (0.85+Math.random()*0.3),
    sway: Math.random()*Math.PI*2, brute,
  };
}
function makeBoss(){
  const hp = window.__SKYFORCE_TEST_EASY_BOSS__ ? 3 : (18 + level*7); // test-only hook, unused in real play
  return {
    x: VW/2, y:-70, targetY:74, hp, maxhp:hp,
    vx: 55 + level*3, shootTimer: 1.3, entering:true,
  };
}

const POWERUP_TYPES = [
  { id:"rapid",  color:"#ffd23f", label:"RAPID FIRE" },
  { id:"spread", color:"#3399ff", label:"SPREAD SHOT" },
  { id:"shield", color:"#2ecc71", label:"SHIELD" },
  { id:"score2x",color:"#ff66b3", label:"SCORE x2" },
  { id:"bomb",   color:"#ff5d73", label:"BOMB" },
];
function spawnFloatingPowerup(){
  const type = POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
  powerups.push({ x: 30+Math.random()*(VW-60), y:-24, vy:75, r:13, angle:0, type });
}
function applyPowerup(type){
  playPowerup();
  addFloatingText(player.x, player.y-26, type.label+"!", type.color, 15);
  const now = performance.now();
  if(type.id==="rapid") player.tempRapidUntil = now + 8000;
  else if(type.id==="spread") player.tempSpreadUntil = now + 8000;
  else if(type.id==="shield") player.shield = true;
  else if(type.id==="score2x") player.tempScoreUntil = now + 8000;
  else if(type.id==="bomb"){
    playBomb();
    enemies.forEach(e=>{
      score += e.brute?12:5;
      sessionMoney += e.brute?4:2;
      sessionKills++; killsInLevel++;
      spawnParticles(e.x,e.y,10,"#ffd23f");
    });
    enemies = [];
    enemyBullets = [];
    addFloatingText(VW/2, VH/2, "BOOM!", "#ff5d73", 22);
  }
}

function fireBullets(){
  const vy=-460;
  const now = performance.now();
  const spreadActive = player.hasSpread || now < player.tempSpreadUntil;
  if(spreadActive){
    bullets.push({x:player.x,y:player.y-10,vx:-110,vy,r:3});
    bullets.push({x:player.x,y:player.y-14,vx:0,vy,r:3});
    bullets.push({x:player.x,y:player.y-10,vx:110,vy,r:3});
  } else {
    bullets.push({x:player.x,y:player.y-14,vx:0,vy,r:3});
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

  if(player.invuln>0) player.invuln -= dt;

  const now = performance.now();
  let interval = player.fireInterval;
  if(now < player.tempRapidUntil) interval *= 0.55;
  player.cooldown -= dt;
  if(player.cooldown<=0){ fireBullets(); player.cooldown = interval; }

  bullets.forEach(b=>{ b.x+=b.vx*dt; b.y+=b.vy*dt; });
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
      spawnTimer = levelConfig.spawnMs;
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
        [-90,0,90].forEach(vx => enemyBullets.push({x:boss.x, y:boss.y+26, vx, vy:210, r:4}));
        boss.shootTimer = 1.3;
      }
    }
  }

  powerups.forEach(p=>{ p.y += p.vy*dt; p.angle += dt*2.2; });
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
  if(player.shield){
    player.shield=false;
    player.invuln=1.0;
    spawnParticles(player.x,player.y,14,player.color);
    playHit();
    return;
  }
  player.lives--;
  player.invuln=1.5;
  spawnParticles(player.x,player.y,16,player.color);
  playHit();
}

function comboMultiplier(){ return 1 + Math.min(Math.floor(combo/3), 4)*0.5; } // caps at x3

function registerKill(x, y, baseScore, baseMoney, isBrute){
  combo++; comboTimer = 1.3;
  if(combo > activeProfile.maxCombo){ activeProfile.maxCombo = combo; }
  const mult = comboMultiplier() * (performance.now() < player.tempScoreUntil ? 2 : 1);
  const gainedScore = Math.round(baseScore*mult);
  const gainedMoney = Math.round(baseMoney*mult);
  score += gainedScore;
  sessionMoney += gainedMoney;
  sessionKills++;
  killsInLevel++;
  activeProfile.totalKills++;
  activeProfile.lifetimeMoney += gainedMoney;
  spawnParticles(x,y,isBrute?16:12,"#ffd23f");
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
        b.hit=true; e.hp--;
        if(e.hp<=0){
          e.dead=true;
          registerKill(e.x, e.y, e.brute?12:5, e.brute?4:2, e.brute);
          playExplosion(e.brute);
        }
        break;
      }
    }
    if(b.hit) continue;
    if(boss && dist2(b.x,b.y,boss.x,boss.y) < (b.r+34)*(b.r+34)){
      b.hit=true;
      boss.hp--;
      spawnParticles(boss.x+((Math.random()-0.5)*40), boss.y+((Math.random()-0.5)*20), 4, "#ff5d73");
      if(boss.hp<=0){
        score += 150; sessionMoney += 60;
        activeProfile.bossesDefeated++;
        saveProfile(activeProfile);
        checkAchievements();
        playBossDefeat();
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
  sessionMoney += bonus;
  level++;
  killsInLevel=0;
  levelConfig = getLevel(level);
  enemies = [];
  enemyBullets = [];
  if(level > activeProfile.maxLevel){
    activeProfile.maxLevel = level;
    saveProfile(activeProfile);
    checkAchievements();
  }
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
const stars = [];
for(let i=0;i<60;i++) stars.push({x:Math.random()*VW,y:Math.random()*VH,speed:30+Math.random()*70,size:Math.random()<0.2?2:1});

function drawStars(dt){
  ctx.save();
  stars.forEach(s=>{
    s.y += s.speed*dt;
    if(s.y>VH){ s.y=-2; s.x=Math.random()*VW; }
    ctx.fillStyle = `rgba(255,255,255,${s.size===2?0.5:0.22})`;
    ctx.fillRect(s.x,s.y,s.size,s.size);
  });
  ctx.restore();
}
function drawPlayer(){
  if(!player.alive) return;
  if(player.invuln>0 && Math.floor(player.invuln*10)%2===0) return;
  ctx.save();
  ctx.translate(player.x,player.y);
  ctx.fillStyle = player.color;
  ctx.shadowColor = player.color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(0,-16); ctx.lineTo(11,12); ctx.lineTo(4,7); ctx.lineTo(0,11); ctx.lineTo(-4,7); ctx.lineTo(-11,12);
  ctx.closePath(); ctx.fill();
  if(player.shield){
    ctx.strokeStyle="rgba(120,200,255,0.8)";
    ctx.lineWidth=2; ctx.shadowBlur=8;
    ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}
function drawEnemies(){
  enemies.forEach(e=>{
    ctx.save();
    ctx.translate(e.x,e.y);
    ctx.fillStyle = e.brute ? "#ff5d73" : "#8b5cf6";
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur=10;
    ctx.beginPath();
    ctx.moveTo(0,e.r); ctx.lineTo(e.r,-e.r*0.6); ctx.lineTo(0,-e.r*0.1); ctx.lineTo(-e.r,-e.r*0.6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  });
}
function drawBoss(){
  if(!boss) return;
  ctx.save();
  ctx.translate(boss.x,boss.y);
  ctx.fillStyle = "#ff2d55";
  ctx.shadowColor = "#ff2d55"; ctx.shadowBlur = 18;
  ctx.beginPath();
  const pts=8;
  for(let i=0;i<pts;i++){
    const a=(Math.PI*2/pts)*i;
    const rad = i%2===0 ? 34 : 22;
    const px=Math.cos(a)*rad, py=Math.sin(a)*rad*0.75;
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle="#ffd23f"; ctx.shadowBlur=6;
  ctx.beginPath(); ctx.arc(0,0,8,0,Math.PI*2); ctx.fill();
  ctx.restore();

  // health bar
  ctx.save();
  ctx.shadowBlur=0;
  const w=140, pct=Math.max(0,boss.hp/boss.maxhp);
  ctx.fillStyle="rgba(0,0,0,0.5)";
  ctx.fillRect(VW/2-w/2, boss.y-52, w, 8);
  ctx.fillStyle="#ff2d55";
  ctx.fillRect(VW/2-w/2, boss.y-52, w*pct, 8);
  ctx.restore();
}
function drawPowerups(){
  powerups.forEach(p=>{
    ctx.save();
    ctx.translate(p.x,p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.type.color;
    ctx.shadowColor = p.type.color; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="#0a0920";
    ctx.font="bold 12px Arial, sans-serif";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    const glyph = {rapid:"⚡",spread:"✦",shield:"🛡",score2x:"x2",bomb:"💣"}[p.type.id] || "?";
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
  ctx.save();
  ctx.fillStyle="#ffd23f"; ctx.shadowColor="#ffd23f"; ctx.shadowBlur=8;
  bullets.forEach(b=> ctx.fillRect(b.x-2,b.y-6,4,10));
  ctx.fillStyle="#ff5d73"; ctx.shadowColor="#ff5d73";
  enemyBullets.forEach(b=> ctx.fillRect(b.x-2,b.y-5,4,9));
  ctx.restore();
}
function drawParticles(){
  particles.forEach(p=>{
    const t=1-p.life/p.maxLife;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = t;
    ctx.fillRect(p.x-2,p.y-2,4,4);
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
  ctx.clearRect(0,0,VW,VH);
  drawStars(dt);
  drawParticles();
  drawPowerups();
  drawEnemies();
  drawBoss();
  drawBullets();
  drawPlayer();
  drawFloatingTexts();
  drawHud();
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

})();
