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
  const raw = localStorage.getItem(PROFILE_PREFIX+name);
  if(raw) return JSON.parse(raw);
  return {
    name, callsign:name, shipColor: SHIP_COLORS[0],
    money:0, hasSpread:false, hasRapid:false, hasShield:false, extraLives:0,
    highscore:0,
  };
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
let player, bullets, enemyBullets, enemies, particles;
let level, killsInLevel, levelConfig, bannerUntil;
let sessionMoney, score;
let spawnTimer;
let gameState = "playing"; // playing | paused | over

function startRun(){
  const p = activeProfile;
  player = {
    x: VW/2, y: VH-60, targetX: VW/2, r:11,
    speed: 320, lives: 3+p.extraLives, alive:true,
    invuln: 1.0, shield: p.hasShield, cooldown:0,
    fireInterval: p.hasRapid ? 0.16 : 0.30,
    hasSpread: p.hasSpread, color: p.shipColor,
  };
  bullets=[]; enemyBullets=[]; enemies=[]; particles=[];
  level=1; killsInLevel=0; levelConfig=getLevel(level); bannerUntil=0;
  sessionMoney=0; score=0; spawnTimer=0;
  gameState="playing";
  document.getElementById("pauseBtn").classList.remove("hidden");
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
  showScreen("screen-menu");
});
document.getElementById("retryBtn").addEventListener("click", () => startRun());
document.getElementById("menuBtn").addEventListener("click", () => showScreen("screen-menu"));

function endRun(){
  gameState="over";
  const p = activeProfile;
  p.money += sessionMoney;
  if(score > p.highscore) p.highscore = score;
  saveProfile(p);
  document.getElementById("overScore").textContent = "SCORE " + score;
  document.getElementById("overMoney").textContent = "+$" + sessionMoney + " earned (wallet: $" + p.money + ")";
  document.getElementById("pauseBtn").classList.add("hidden");
  document.getElementById("overlayOver").classList.remove("hidden");
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
function fireBullets(){
  const vy=-460;
  if(player.hasSpread){
    bullets.push({x:player.x,y:player.y-10,vx:-110,vy,r:3});
    bullets.push({x:player.x,y:player.y-14,vx:0,vy,r:3});
    bullets.push({x:player.x,y:player.y-10,vx:110,vy,r:3});
  } else {
    bullets.push({x:player.x,y:player.y-14,vx:0,vy,r:3});
  }
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

  player.cooldown -= dt;
  if(player.cooldown<=0){ fireBullets(); player.cooldown = player.fireInterval; }

  bullets.forEach(b=>{ b.x+=b.vx*dt; b.y+=b.vy*dt; });
  bullets = bullets.filter(b=> b.y>-20 && b.x>-20 && b.x<VW+20);
  enemyBullets.forEach(b=>{ b.x+=b.vx*dt; b.y+=b.vy*dt; });
  enemyBullets = enemyBullets.filter(b=> b.y<VH+20);

  const showingBanner = performance.now() < bannerUntil;
  if(!showingBanner){
    spawnTimer -= dt*1000;
    if(spawnTimer<=0){
      for(let i=0;i<levelConfig.wave;i++) enemies.push(makeEnemy());
      spawnTimer = levelConfig.spawnMs;
    }
  }

  enemies.forEach(e=>{
    e.y += e.speed*dt;
    e.x += Math.sin(performance.now()/600 + e.sway)*20*dt;
  });

  particles.forEach(p=>{ p.x+=p.vx*dt; p.y+=p.vy*dt; p.life+=dt; p.vx*=0.94; p.vy*=0.94; });
  particles = particles.filter(p=> p.life<p.maxLife);

  checkCollisions();
  checkLevelClear();

  if(player.lives<=0 && player.alive){
    player.alive=false;
    endRun();
  }
}

function damagePlayer(){
  if(player.shield){
    player.shield=false;
    player.invuln=1.0;
    spawnParticles(player.x,player.y,14,player.color);
    return;
  }
  player.lives--;
  player.invuln=1.5;
  spawnParticles(player.x,player.y,16,player.color);
}

function checkCollisions(){
  for(const b of bullets){
    for(const e of enemies){
      if(e.dead) continue;
      if(dist2(b.x,b.y,e.x,e.y) < (b.r+e.r)*(b.r+e.r)){
        b.hit=true; e.hp--;
        if(e.hp<=0){
          e.dead=true;
          score += e.brute?12:5;
          sessionMoney += e.brute?4:2;
          killsInLevel++;
          spawnParticles(e.x,e.y,12,"#ffd23f");
        }
        break;
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
  } else {
    enemies = enemies.filter(e=> e.y <= VH+20);
  }
}

function checkLevelClear(){
  if(killsInLevel >= levelConfig.kills && performance.now() >= bannerUntil){
    sessionMoney += levelConfig.bonus;
    level++;
    killsInLevel=0;
    levelConfig = getLevel(level);
    enemies = [];
    bannerUntil = performance.now() + 1600;
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

  if(performance.now() < bannerUntil){
    ctx.fillStyle="rgba(0,0,0,0.55)";
    ctx.fillRect(60,VH/2-40,VW-120,60);
    ctx.fillStyle="white";
    ctx.textAlign="center";
    ctx.font="bold 20px Arial, sans-serif";
    ctx.fillText("LEVEL " + level + " INCOMING", VW/2, VH/2-22);
    ctx.textAlign="left";
  }
  ctx.restore();
}

function render(dt){
  ctx.clearRect(0,0,VW,VH);
  drawStars(dt);
  drawParticles();
  drawEnemies();
  drawBullets();
  drawPlayer();
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
