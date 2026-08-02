/*
 * The DOM layer: every screen, every button, and the bootstrap that starts the
 * game. Gameplay code never touches the DOM; this file never touches the
 * canvas. The only bridge is SF.game (start a mission, ask for state) and
 * SF.game.onMissionEnd (results come back here).
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp } = SF.core;
const { SHIP_COLORS, CATEGORIES, UPGRADES, UPGRADE_BY_ID, MAX_UPGRADE_LEVELS,
        DIFFICULTIES, DIFFICULTY_BY_ID, ACHIEVEMENTS } = SF.config;
const { MISSIONS, OBJECTIVES, isMissionUnlocked, rescueCount, enemyCount } = SF.missions;
const P = SF.profile;
const audio = SF.audio;

let profile = null;
let selectedMissionIndex = 0;

/* ---------------------------------------------------------
   SCREENS
   --------------------------------------------------------- */
const screens = {};
document.querySelectorAll(".screen").forEach(el => screens[el.id] = el);
function show(id){
  Object.keys(screens).forEach(k => screens[k].classList.remove("active"));
  screens[id].classList.add("active");
  if(id === "screen-game") SF.game.resize();
}
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function click(el, fn){
  if(!el) return;
  el.addEventListener("click", (e) => { audio.play("uiClick"); fn(e); });
}

/* ---------------------------------------------------------
   PILOT PICKER
   --------------------------------------------------------- */
function renderProfiles(){
  const grid = $("profileGrid");
  grid.innerHTML = "";
  P.listNames().forEach(name => {
    const p = P.load(name);
    const rank = P.rankFor(p);
    const card = document.createElement("div");
    card.className = "profile-card";
    card.innerHTML = `
      <div class="avatar" style="background:${p.shipColor}"><span class="avatar-badge">${rank.badge}</span></div>
      <div class="pname">${esc(p.callsign || p.name)}</div>
      <div class="prank" style="color:${rank.color}">${rank.name}</div>
      <div class="pscore">${P.totalStars(p)} ★ · ${p.highscore}</div>
    `;
    click(card, () => selectProfile(name));
    grid.appendChild(card);
  });
}

function selectProfile(name){
  profile = P.load(name);
  SF.game.profile = profile;
  renderMenu();
  show("screen-menu");
}

function renderMenu(){
  const rank = P.rankFor(profile);
  const stars = P.totalStars(profile);
  $("menuPilot").innerHTML = `
    <div class="mp-badge" style="background:${profile.shipColor}">${rank.badge}</div>
    <div>
      <div class="mp-name">${esc(profile.callsign)}</div>
      <div class="mp-rank" style="color:${rank.color}">${rank.name}</div>
      <div class="mp-stats">${stars} ★ collected · $${profile.money}</div>
    </div>`;
}

/* ---------------------------------------------------------
   MISSION SELECT
   --------------------------------------------------------- */
function renderMissions(){
  const stars = P.totalStars(profile);
  $("missionStars").textContent = stars + " / " + (MISSIONS.length*3) + " ★ collected";
  const list = $("missionList");
  list.innerHTML = "";
  MISSIONS.forEach((m, i) => {
    const unlocked = isMissionUnlocked(profile, i);
    const earned = P.starsForMission(profile, m.id);
    const rec = profile.missions[m.id];
    const card = document.createElement("div");
    card.className = "mission-card" + (unlocked ? "" : " locked") + (earned === 3 ? " perfect" : "");
    const starHtml = [0,1,2].map(s => `<span class="ms${s < earned ? " on" : ""}">★</span>`).join("");
    card.innerHTML = `
      <div class="mc-num">${unlocked ? m.id : "🔒"}</div>
      <div class="mc-main">
        <div class="mc-name">${esc(m.name)}</div>
        <div class="mc-sub">${unlocked ? esc(m.subtitle) : "Finish mission " + (m.id-1) + " to unlock"}</div>
        ${unlocked ? `<div class="mc-meta">${enemyCount(m)} enemies · ${rescueCount(m) ? rescueCount(m)+" to rescue" : "no rescues"}${m.boss ? " · BOSS" : ""}</div>` : ""}
      </div>
      <div class="mc-stars">${unlocked ? starHtml : ""}</div>
    `;
    if(unlocked) click(card, () => openBriefing(i));
    list.appendChild(card);
  });
}

/* ---------------------------------------------------------
   BRIEFING + DIFFICULTY
   --------------------------------------------------------- */
function openBriefing(index){
  selectedMissionIndex = index;
  const m = MISSIONS[index];
  $("briefTitle").textContent = m.name.toUpperCase();
  $("briefSubtitle").textContent = m.subtitle;
  $("briefText").textContent = m.brief;
  $("briefObjectives").innerHTML = m.objectives.map(id => {
    const o = OBJECTIVES[id];
    return `<div class="bo-row"><span class="bo-icon">${o.icon}</span>${esc(o.label)}</div>`;
  }).join("");

  const stars = P.totalStars(profile);
  const list = $("briefDifficulties");
  list.innerHTML = "";
  DIFFICULTIES.forEach(d => {
    const locked = stars < d.unlockStars;
    const earned = (profile.missions[m.id] && profile.missions[m.id].stars[d.id]) || 0;
    const card = document.createElement("div");
    card.className = "diff-card" + (locked ? " locked" : "");
    if(!locked) card.style.borderColor = d.color;
    card.innerHTML = `
      <div class="diff-head">
        <span class="diff-name" style="color:${locked ? "" : d.color}">${locked ? "🔒 " : ""}${d.name}</span>
        <span class="diff-tag">${d.tag}</span>
      </div>
      <div class="diff-blurb">${esc(locked ? "Collect " + d.unlockStars + " ★ to unlock this tier" : d.blurb)}</div>
      <div class="diff-best">${locked ? "" : (earned ? "Best: " + earned + " ★" : "Not flown yet") + " · pays " + d.pay + "x"}</div>
    `;
    if(!locked) click(card, () => launch(index, d.id));
    list.appendChild(card);
  });
  show("screen-briefing");
}

function launch(index, difficultyId){
  audio.init();
  show("screen-game");
  hideResults();
  SF.game.startMission(index, difficultyId);
  syncAbilityButtons(true);
}

/* ---------------------------------------------------------
   ARMORY
   --------------------------------------------------------- */
function renderArmory(){
  $("armoryMoney").textContent = "$" + profile.money + " to spend";
  $("callsignInput").value = profile.callsign;
  renderPilotCard();

  const colorRow = $("colorRow");
  colorRow.innerHTML = "";
  SHIP_COLORS.forEach(hex => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (hex === profile.shipColor ? " selected" : "");
    sw.style.background = hex;
    click(sw, () => { profile.shipColor = hex; P.save(profile); renderArmory(); });
    colorRow.appendChild(sw);
  });

  const shop = $("shopItems");
  shop.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const group = document.createElement("div");
    group.className = "shop-group";
    group.style.setProperty("--cat", cat.color);
    group.innerHTML = `<div class="group-head"><span class="group-icon">${cat.icon}</span>${cat.name}</div>`;
    UPGRADES.filter(u => u.cat === cat.id).forEach(u => {
      const lvl = P.upgradeLevel(profile, u.id);
      const cost = P.nextCost(profile, u);
      const maxed = cost === null;
      const affordable = !maxed && profile.money >= cost;
      const row = document.createElement("div");
      row.className = "shop-item" + (maxed ? " maxed" : "") + (affordable ? " affordable" : "");
      const pips = Array.from({length:u.max}, (_,i) => `<span class="pip${i < lvl ? " on" : ""}"></span>`).join("");
      row.innerHTML = `
        <div class="si-badge">${u.icon}</div>
        <div class="si-main">
          <div class="si-name">${esc(u.name)} <span class="si-lvl">${maxed ? "MAXED" : "Lv " + lvl + "/" + u.max}</span></div>
          <div class="si-pips">${pips}</div>
          <div class="si-desc">${esc(u.desc)}</div>
          <div class="si-effect">${lvl > 0 ? "Now: " + esc(u.effect(lvl)) : "Not owned yet"}${
            maxed ? "" : ' <span class="si-next">→ ' + esc(u.effect(lvl+1)) + "</span>"}</div>
        </div>`;
      const btn = document.createElement("button");
      btn.innerHTML = maxed ? "★<br>MAX" : "$" + cost;
      btn.disabled = maxed || !affordable;
      click(btn, () => buyUpgrade(u.id));
      row.appendChild(btn);
      group.appendChild(row);
    });
    shop.appendChild(group);
  });
}

function renderPilotCard(){
  const rank = P.rankFor(profile), next = P.nextRank(profile);
  const gear = P.gearLevel(profile);
  $("pcShip").style.background = `radial-gradient(circle at 35% 30%, #fff6, ${profile.shipColor})`;
  $("pcRankBadge").textContent = rank.badge;
  $("pcName").textContent = profile.callsign || profile.name;
  const rankEl = $("pcRank");
  rankEl.textContent = rank.name;
  rankEl.style.color = rank.color;
  const pct = next ? clamp((gear - rank.at) / (next.at - rank.at) * 100, 0, 100) : 100;
  const fill = $("pcBarFill");
  fill.style.width = pct + "%";
  fill.style.background = rank.color;
  $("pcGear").textContent = next
    ? `Gear ${gear}/${MAX_UPGRADE_LEVELS} · ${next.at - gear} more to ${next.name}`
    : `Gear ${gear}/${MAX_UPGRADE_LEVELS} · everything unlocked!`;
}

function buyUpgrade(id){
  const u = UPGRADE_BY_ID[id];
  const cost = P.nextCost(profile, u);
  if(cost === null || profile.money < cost) return;
  const rankBefore = P.rankFor(profile).name;
  profile.money -= cost;
  profile.upgrades[id] = P.upgradeLevel(profile, id) + 1;
  P.save(profile);
  audio.play("uiBuy");
  P.checkAchievements(profile).forEach(queueToast);
  renderArmory();
  const rankNow = P.rankFor(profile);
  if(rankNow.name !== rankBefore) queueToast({ icon: rankNow.badge, name: "PROMOTED: " + rankNow.name });
}

/* ---------------------------------------------------------
   MEDALS + CHAMPIONSHIP
   --------------------------------------------------------- */
function renderAchievements(){
  const owned = profile.achievements;
  $("achievementsCount").textContent = owned.length + " / " + ACHIEVEMENTS.length + " medals earned";
  $("achievementsList").innerHTML = ACHIEVEMENTS.map(a => {
    const has = owned.includes(a.id);
    return `<div class="ach-row${has ? " unlocked" : ""}">
      <div class="ach-icon">${has ? a.icon : "🔒"}</div>
      <div><div class="ach-name">${esc(a.name)}</div><div class="ach-desc">${esc(a.desc)}</div></div>
    </div>`;
  }).join("");
}

function renderLeaderboard(){
  const rows = P.listNames().map(P.load)
    .sort((a,b) => (P.totalStars(b) - P.totalStars(a)) || (b.highscore - a.highscore));
  $("leaderboardList").innerHTML = rows.map((p,i) => {
    const rank = P.rankFor(p);
    return `<div class="lb-row">
      <span class="lb-rank">#${i+1}</span>
      <span class="lb-name">${esc(p.callsign || p.name)}<br><span class="lb-sub" style="color:${rank.color}">${rank.name}</span></span>
      <span class="lb-score">${P.totalStars(p)} ★<br><span class="lb-sub">${p.highscore}</span></span>
    </div>`;
  }).join("");
}

/* ---------------------------------------------------------
   IN-GAME UI
   --------------------------------------------------------- */
function togglePause(){
  const g = SF.game;
  if(g.state === "playing"){
    g.state = "paused";
    $("overlayPause").classList.remove("hidden");
  } else if(g.state === "paused"){
    g.state = "playing";
    $("overlayPause").classList.add("hidden");
  }
}

/** Keeps the two ability buttons in sync with what the ship has left. */
function syncAbilityButtons(force){
  const p = SF.game.world.player;
  const playing = SF.game.state === "playing" || SF.game.state === "paused";
  const bombBtn = $("bombBtn"), odBtn = $("overdriveBtn");
  if(!p || !playing){
    bombBtn.classList.add("hidden");
    odBtn.classList.add("hidden");
    return;
  }
  bombBtn.classList.toggle("hidden", p.bombsMax <= 0);
  bombBtn.classList.toggle("empty", p.bombs <= 0);
  $("bombCount").textContent = p.bombs;
  odBtn.classList.toggle("hidden", p.overdrivesMax <= 0);
  const odReady = p.overdrives > 0 && performance.now() >= p.overdriveUntil;
  odBtn.classList.toggle("empty", !odReady);
  $("overdriveCount").textContent = p.overdrives;
}

function hideResults(){ $("overlayResults").classList.add("hidden"); }

function showResults(result){
  const { completed, stars, run, objectives, unlocked } = result;
  $("resultTitle").textContent = completed ? "MISSION COMPLETE" : "MISSION FAILED";
  $("resultTitle").style.color = completed ? "#4ade80" : "#ff5d73";

  // Stars pop in one at a time - the small ceremony that makes replaying worth it.
  const starBox = $("resultStars");
  starBox.innerHTML = [0,1,2].map(i => `<span class="rs" data-i="${i}">★</span>`).join("");
  Array.from(starBox.children).forEach((el, i) => {
    if(i < stars){
      setTimeout(() => { el.classList.add("on"); audio.play("star", i); }, 380 + i*420);
    }
  });

  $("resultObjectives").innerHTML = objectives.map(o =>
    `<div class="ro-row ${o.met ? "met" : ""}"><span>${o.met ? "★" : "☆"}</span> ${esc(o.label)}</div>`
  ).join("");

  const s = run.stats;
  $("resultLines").innerHTML = `
    <div class="rl"><span>Score</span><b>${run.score}</b></div>
    <div class="rl"><span>Money collected</span><b class="money">+$${run.money}</b></div>
    ${run.completionBonus ? `<div class="rl"><span>Mission bonus (${stars} ★)</span><b class="money">included</b></div>` : ""}
    <div class="rl"><span>Enemies destroyed</span><b>${s.kills}/${Math.max(s.spawned, run.director.totalPlanned)}</b></div>
    <div class="rl"><span>Pilots rescued</span><b>${s.rescues}/${s.rescuesTotal}</b></div>
    <div class="rl"><span>Best combo</span><b>x${run.maxCombo}</b></div>
    <div class="rl"><span>Wallet</span><b class="money">$${profile.money}</b></div>`;

  const hasNext = completed && run.missionIndex + 1 < MISSIONS.length;
  $("nextBtn").classList.toggle("hidden", !hasNext);
  $("overlayResults").classList.remove("hidden");
  renderMenu();
  (unlocked || []).forEach(queueToast);
}

/* ---------------------------------------------------------
   TOASTS
   --------------------------------------------------------- */
let toastQueue = [], toastShowing = false;
function queueToast(a){
  toastQueue.push(a);
  if(!toastShowing) nextToast();
}
function nextToast(){
  const a = toastQueue.shift();
  if(!a){ toastShowing = false; return; }
  toastShowing = true;
  audio.play("achievement");
  const el = $("achievementToast");
  el.classList.remove("hidden");
  $("at-name").textContent = a.icon + " " + a.name;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.classList.add("hidden"); nextToast(); }, 250);
  }, 2300);
}

/* ---------------------------------------------------------
   WIRING
   --------------------------------------------------------- */
click($("addProfileBtn"), () => {
  const name = prompt("Pilot's name?");
  if(name && name.trim()){ P.addName(name.trim()); renderProfiles(); }
});
click($("switchBtn"), () => { renderProfiles(); show("screen-profiles"); });
click($("playBtn"), () => { renderMissions(); show("screen-missions"); });
click($("armoryBtn"), () => { renderArmory(); show("screen-armory"); });
click($("achievementsBtn"), () => { renderAchievements(); show("screen-achievements"); });
click($("leaderboardBtn"), () => { renderLeaderboard(); show("screen-leaderboard"); });
click($("missionsBackBtn"), () => show("screen-menu"));
click($("briefBackBtn"), () => { renderMissions(); show("screen-missions"); });
click($("armoryBackBtn"), () => { renderMenu(); show("screen-menu"); });
click($("achievementsBackBtn"), () => show("screen-menu"));
click($("leaderboardBackBtn"), () => show("screen-menu"));
click($("saveCallsignBtn"), () => {
  const v = $("callsignInput").value.trim();
  if(!v) return;
  profile.callsign = v;
  P.save(profile);
  renderPilotCard();
  renderMenu();
});

click($("pauseBtn"), togglePause);
click($("resumeBtn"), togglePause);
click($("restartBtn"), () => {
  $("overlayPause").classList.add("hidden");
  launch(SF.game.run.missionIndex, SF.game.run.difficulty.id);
});
click($("quitBtn"), () => {
  $("overlayPause").classList.add("hidden");
  SF.game.state = "idle";
  renderMissions();
  show("screen-missions");
});
click($("retryBtn"), () => launch(SF.game.run.missionIndex, SF.game.run.difficulty.id));
click($("nextBtn"), () => launch(SF.game.run.missionIndex + 1, SF.game.run.difficulty.id));
click($("resultsMenuBtn"), () => {
  SF.game.state = "idle";
  hideResults();
  renderMissions();
  show("screen-missions");
});
click($("muteBtn"), () => {
  audio.setMuted(!audio.isMuted());
  $("muteBtn").textContent = audio.isMuted() ? "🔇" : "♪";
});

// Ability buttons: pointerdown so they feel instant on touch.
["bombBtn","overdriveBtn"].forEach(id => {
  const el = $(id);
  el.addEventListener("pointerdown", e => {
    e.preventDefault();
    if(id === "bombBtn") SF.game.useBomb(); else SF.game.useOverdrive();
    syncAbilityButtons();
  });
});

SF.game.onMissionEnd = showResults;

/* ---------------------------------------------------------
   BOOT
   --------------------------------------------------------- */
SF.game.attach($("game"), document.querySelector(".game-frame"), $("screen-game"));
$("muteBtn").textContent = audio.isMuted() ? "🔇" : "♪";
renderProfiles();
SF.game.resize();
SF.game.start();
SF.render.loadAssets(() => document.body.classList.add("assets-ready"));

SF.ui = { show, togglePause, syncAbilityButtons, renderMissions, renderArmory, renderProfiles, queueToast,
          getProfile: () => profile };
})();
