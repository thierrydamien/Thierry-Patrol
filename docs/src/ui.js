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
const { SHIP_COLORS, BADGES, CATEGORIES, UPGRADES, UPGRADE_BY_ID, MAX_UPGRADE_LEVELS,
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
      <div class="avatar" style="background:${p.shipColor}"><span class="avatar-badge">${P.badgeFor(p)}</span></div>
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
    <div class="mp-badge" style="background:${profile.shipColor}">${P.badgeFor(profile)}</div>
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
        ${unlocked ? familyBestLine(m.id) : ""}
      </div>
      <div class="mc-stars">${unlocked ? starHtml : ""}</div>
    `;
    if(unlocked) click(card, () => openBriefing(i));
    list.appendChild(card);
  });
}

/**
 * "Charlie holds this one" - the household record, shown on the mission card.
 * With two pilots sharing one game, the person to beat is at the kitchen
 * table, and that's a far better hook than an abstract high score.
 */
function familyBestLine(missionId){
  const best = P.familyBest(missionId);
  if(!best) return `<div class="mc-record none">Nobody has flown this yet - claim it</div>`;
  const mine = (best.name === (profile.callsign || profile.name));
  return `<div class="mc-record${mine ? " mine" : ""}">${
    mine ? "🏅 You hold this one · " + best.score
         : "🏅 " + esc(best.name) + " holds this · " + best.score}</div>`;
}

/* ---------------------------------------------------------
   HANGAR
   The Armory sells numbers; the hangar is where those numbers
   turn into a machine you can look at. One animation loop
   drives the whole screen - a slow bob, a flickering exhaust,
   and the next unearned part ghosted on so there's always
   something visibly missing.
   --------------------------------------------------------- */
const hangar = { raf:0, t:0, compare:false, ctx:null };

function renderHangar(){
  const A = SF.shipart;
  const levels = A.levelsOf(profile);
  const next = A.nextPart(levels);
  const owned = A.ownedCount(levels);

  $("hangarPilot").innerHTML =
    `<b style="color:${profile.shipColor}">${esc(profile.callsign || profile.name)}'S SHIP</b> · ` +
    `${owned}/${A.PARTS.length} parts fitted`;

  $("hangarNext").innerHTML = next
    ? `<span class="hn-label">NEXT PART</span>
       <b>${esc(next.name)}</b>
       <span class="hn-blurb">${esc(next.blurb)}</span>
       <span class="hn-how">Buy ${esc(UPGRADE_BY_ID[next.up].name)} level ${next.at}</span>`
    : `<span class="hn-label">COMPLETE</span><b>Every part fitted.</b>
       <span class="hn-blurb">There is nothing left to bolt on. Go and use it.</span>`;

  const parts = $("hangarParts");
  parts.innerHTML = "";
  A.partList(levels).forEach(({ part, owned:has }) => {
    const chip = document.createElement("div");
    chip.className = "part-chip" + (has ? " owned" : "") + (next && part.id === next.id ? " next" : "");
    chip.innerHTML = `<b>${esc(part.name)}</b><span>${has ? esc(part.blurb)
      : esc(UPGRADE_BY_ID[part.up].name) + " lv" + part.at}</span>`;
    parts.appendChild(chip);
  });

  $("hangarCompareBtn").textContent = hangar.compare ? "BACK TO MY SHIP" : "COMPARE TO STOCK";
  $("hangarCompareLabels").classList.toggle("hidden", !hangar.compare);
  startHangarLoop();
}

function startHangarLoop(){
  const cv = $("hangarCanvas");
  if(!cv) return;
  hangar.ctx = hangar.ctx || cv.getContext("2d");
  if(hangar.raf) return;                      // already spinning
  // Unlike the game loop, this one queues the *next* frame last and simply
  // stops when you leave the screen - an idle animation must not keep a
  // callback alive behind every other screen in the app.
  const step = () => {
    hangar.raf = 0;
    if(!screens["screen-hangar"].classList.contains("active")) return;
    hangar.t += 1/60;
    drawHangar();
    hangar.raf = requestAnimationFrame(step);
  };
  hangar.raf = requestAnimationFrame(step);
}

function drawHangar(){
  const ctx = hangar.ctx;
  if(!ctx || !profile) return;
  const A = SF.shipart;
  const cv = ctx.canvas;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  // A floor light so the ship reads as parked in a bay rather than floating.
  const g = ctx.createRadialGradient(W/2, H*0.62, 8, W/2, H*0.62, W*0.55);
  g.addColorStop(0, "rgba(120,160,255,0.20)");
  g.addColorStop(1, "rgba(120,160,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const levels = A.levelsOf(profile);
  const next = A.nextPart(levels);

  if(hangar.compare){
    // Side by side, same scale: the whole point is that the difference is obvious.
    A.drawShip(ctx, W*0.28, H*0.55, Math.min(W*0.34, H*0.62), {
      color: profile.shipColor, levels: {}, t: hangar.t });
    A.drawShip(ctx, W*0.72, H*0.55, Math.min(W*0.34, H*0.62), {
      color: profile.shipColor, levels, t: hangar.t });
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W/2, H*0.12); ctx.lineTo(W/2, H*0.88); ctx.stroke();
  } else {
    // Sized so the widest parts - the aegis halo and the drone cradle - still
    // sit inside the bay rather than being cropped by it.
    A.drawShip(ctx, W/2, H*0.52, Math.min(W*0.46, H*0.66), {
      color: profile.shipColor, levels, t: hangar.t,
      ghost: next ? next.id : null,
      mateColor: (P.squadmates(profile.name)[0] || {}).shipColor,
    });
  }
}

/* ---------------------------------------------------------
   STORY BEATS
   --------------------------------------------------------- */
function storySeen(id){ return !!(profile.stories && profile.stories[id]); }
function markStorySeen(id){
  profile.stories = profile.stories || {};
  profile.stories[id] = true;
  P.save(profile);
}

/** Shows a beat if it hasn't been seen. Returns true if it opened. */
function maybeStory(id){
  const def = SF.storyData.STORY[id];
  if(!def || !profile || storySeen(id)) return false;
  markStorySeen(id);
  showStory(def);
  return true;
}

function showStory(def){
  const A = SF.shipart;
  const levels = A.levelsOf(profile);
  const mate = P.squadmates(profile.name)[0] || null;
  const you = profile.callsign || profile.name;

  $("storyTitle").textContent = def.title;
  $("storyBtn").textContent = def.button || "CONTINUE";
  const box = $("storyPanels");
  box.innerHTML = "";

  def.panels.forEach((panel, i) => {
    const el = document.createElement("div");
    el.className = "story-panel";
    el.style.animationDelay = (i*0.12) + "s";
    const cv = document.createElement("canvas");
    cv.width = 260; cv.height = 150; cv.className = "story-art";
    const cap = document.createElement("p");
    cap.textContent = SF.commsData.fill(panel.text, { you, mate: mate ? (mate.callsign || mate.name) : "" });
    el.appendChild(cv); el.appendChild(cap);
    box.appendChild(el);
    drawStoryArt(cv.getContext("2d"), panel.art, levels, mate);
  });

  $("storyOverlay").classList.remove("hidden");
}

function drawStoryArt(ctx, art, levels, mate){
  const A = SF.shipart;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#131a3a"); g.addColorStop(1, "#070a1c");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for(let i=0;i<26;i++){
    ctx.fillStyle = "rgba(255,255,255," + (0.15 + (i%5)*0.11) + ")";
    ctx.fillRect((i*61)%W, (i*37)%H, 1.4, 1.4);
  }
  const t = 0.6;   // a still frame, not an animation - these are comic panels
  if(art === "stock"){
    A.drawShip(ctx, W/2, H*0.56, 96, { color:"#8a94a8", levels:{}, t, idle:false });
  } else if(art === "crew"){
    A.drawShip(ctx, W*0.36, H*0.56, 84, { color: profile.shipColor, levels, t, idle:false });
    A.drawShip(ctx, W*0.68, H*0.62, 58,
      { color: mate ? mate.shipColor : "#7fc4ff", levels: mate ? A.levelsOf(mate) : {}, t, idle:false });
  } else if(art === "sky"){
    ctx.fillStyle = "rgba(90,140,255,0.18)";
    ctx.beginPath(); ctx.arc(W*0.5, H*1.45, W*0.8, 0, Math.PI*2); ctx.fill();
    A.drawShip(ctx, W/2, H*0.42, 52, { color: profile.shipColor, levels, t, idle:false });
  } else {
    A.drawShip(ctx, W/2, H*0.56, 100, { color: profile.shipColor, levels, t, idle:false });
  }
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

  const badgeRow = $("badgeRow");
  badgeRow.innerHTML = "";
  BADGES.forEach(b => {
    const el = document.createElement("div");
    el.className = "badge-pick" + (b === P.badgeFor(profile) ? " selected" : "");
    el.textContent = b;
    click(el, () => { profile.badge = b; P.save(profile); renderArmory(); renderMenu(); });
    badgeRow.appendChild(el);
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
  $("pcRankBadge").textContent = P.badgeFor(profile);
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
  // A flight log of what this pilot has actually done - their record, not the game's.
  $("pcLog").textContent =
    `${profile.missionsCompleted} missions flown · ${profile.rescues} pilots rescued · ` +
    `${profile.totalKills} enemies down · best combo x${profile.maxCombo}`;
}

function buyUpgrade(id){
  const u = UPGRADE_BY_ID[id];
  const cost = P.nextCost(profile, u);
  if(cost === null || profile.money < cost) return;
  const rankBefore = P.rankFor(profile).name;
  const partsBefore = SF.shipart.ownedCount(SF.shipart.levelsOf(profile));
  profile.money -= cost;
  profile.upgrades[id] = P.upgradeLevel(profile, id) + 1;
  P.save(profile);
  audio.play("uiBuy");
  P.checkAchievements(profile).forEach(queueToast);
  renderArmory();
  const rankNow = P.rankFor(profile);
  if(rankNow.name !== rankBefore) queueToast({ icon: rankNow.badge, name: "PROMOTED: " + rankNow.name });

  // A purchase that changes the *shape* of the ship deserves to be seen, and
  // the twentieth level is the story's chapter break.
  const partsNow = SF.shipart.ownedCount(SF.shipart.levelsOf(profile));
  if(partsNow > partsBefore){
    const part = SF.shipart.PARTS.filter(pt => (P.upgradeLevel(profile, pt.up) >= pt.at))[partsNow-1];
    queueToast({ icon:"🔧", name: "FITTED: " + (part ? part.name : "NEW PART") });
  }
  if(P.gearLevel(profile) >= 20) maybeStory("ace");
  else if(partsNow > 0 && partsBefore === 0) maybeStory("firstPart");
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
  $("resultTitle").textContent = completed ? "MISSION COMPLETE" : "SHIP DOWN";
  $("resultTitle").style.color = completed ? "#4ade80" : "#ff9d5c";

  // Losing should read as "you nearly had it", not as a telling-off - and you
  // always keep the money you collected, so a failed run is never wasted.
  const sub = $("resultSubtitle");
  if(completed){
    sub.textContent = stars === 3
      ? "Perfect flying, " + (profile.callsign || profile.name) + "!"
      : "Nice work, " + (profile.callsign || profile.name) + "!";
  } else {
    sub.textContent = "You got " + Math.round(run.progress*100) + "% of the way and kept every coin. Go again?";
  }

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
    ${crewLine()}
    <div class="rl"><span>Wallet</span><b class="money">$${profile.money}</b></div>
    ${recordLine(run)}`;

  renderResultComms(run, completed, stars);

  const hasNext = completed && run.missionIndex + 1 < MISSIONS.length;
  $("nextBtn").classList.toggle("hidden", !hasNext);
  $("overlayResults").classList.remove("hidden");
  renderMenu();
  (unlocked || []).forEach(queueToast);
  if(completed && P.campaignComplete(profile)) maybeStory("campaign");
}

/**
 * One spoken line on the results screen, with the speaker's real ship next to
 * it. The comms panel can't be seen once the overlay is up, and taking your
 * brother's record is exactly the moment that deserves a voice.
 */
function renderResultComms(run, completed, stars){
  const box = $("resultComms");
  const mate = P.squadmates(profile.name)[0] || null;
  const best = P.familyBest(run.mission.id);
  const me = profile.callsign || profile.name;

  let event = null;
  if(best && best.name === me && mate && run.score > 0 && run.score >= best.score) event = "recordTaken";
  else if(completed && stars === 3) event = "flawless";
  else if(completed) event = "personalBest";
  if(!event){ box.classList.add("hidden"); return; }

  const def = SF.commsData.COMMS[event];
  const useMate = def.speaker === "mate" && !!mate;
  const who = useMate ? mate : null;
  const line = def.lines[Math.floor(Math.random()*def.lines.length)];
  $("resultCommsWho").textContent = who ? (who.callsign || who.name).toUpperCase() : "CONTROL";
  $("resultCommsWho").style.color = who ? who.shipColor : "#7fc4ff";
  $("resultCommsText").textContent = SF.commsData.fill(line, { you: me, mate: mate ? (mate.callsign||mate.name) : "" });

  const ctx = $("resultCommsArt").getContext("2d");
  ctx.clearRect(0, 0, 72, 72);
  SF.shipart.drawShip(ctx, 36, 38, 62, {
    color: who ? who.shipColor : profile.shipColor,
    levels: SF.shipart.levelsOf(who || profile), t: 0.6, idle: false });
  box.classList.remove("hidden");
}

/** Names the squadmates who flew as your wingmen this run. */
function crewLine(){
  const p = SF.game.world.player;
  if(!p || !p.drones || !p.crew.length) return "";
  const names = p.crew.slice(0, p.drones).map(c => esc(c.callsign)).join(" & ");
  return names ? `<div class="rl"><span>Flew with you</span><b>${names}</b></div>` : "";
}

/** Did this run take the household record for the mission, or how close was it? */
function recordLine(run){
  const best = P.familyBest(run.mission.id);
  const me = profile.callsign || profile.name;
  if(!best || best.score <= run.score){
    return `<div class="rl record"><span>Family record</span><b>🏆 ${esc(me)} — new best!</b></div>`;
  }
  if(best.name === me){
    return `<div class="rl"><span>Family record</span><b>🏅 yours, ${best.score}</b></div>`;
  }
  return `<div class="rl"><span>${esc(best.name)} to beat</span><b>${best.score - run.score} more</b></div>`;
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
click($("hangarBtn"), () => { renderHangar(); show("screen-hangar"); });
click($("hangarBackBtn"), () => { renderMenu(); show("screen-menu"); });
click($("hangarShopBtn"), () => { renderArmory(); show("screen-armory"); });
click($("hangarCompareBtn"), () => { hangar.compare = !hangar.compare; renderHangar(); });
click($("storyBtn"), () => $("storyOverlay").classList.add("hidden"));
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

SF.ui = { show, togglePause, syncAbilityButtons, renderMissions, renderArmory, renderProfiles,
          renderHangar, queueToast, maybeStory,
          showStory: id => showStory(SF.storyData.STORY[id]),
          getProfile: () => profile };
})();
