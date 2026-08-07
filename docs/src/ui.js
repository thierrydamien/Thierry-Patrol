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
const { SHIP_COLORS, PAINTS, PAINT_BY_ID, TRAILS, TRAIL_BY_ID,
        BADGES, CATEGORIES, UPGRADES, UPGRADE_BY_ID, MAX_UPGRADE_LEVELS,
        DIFFICULTIES, DIFFICULTY_BY_ID, ACHIEVEMENTS } = SF.config;
const { MISSIONS, OBJECTIVES, isMissionUnlocked, rescueCount, enemyCount } = SF.missions;
const P = SF.profile;
const audio = SF.audio;

let profile = null;
let failStreak = null;   // { key: "mission:tier", n } - resets on any win
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
  if(id === "screen-profiles" || id === "screen-menu") startTitleLoop();
  // Every screen that isn't combat gets menu music - except the pilot picker,
  // which owns the title fanfare. Launch swaps in the combat track.
  if(id !== "screen-game")
    audio.setMusic(id === "screen-profiles" ? "title" : "menu");
}
function $(id){ return document.getElementById(id); }
function qa(sel){ return Array.from(document.querySelectorAll(sel)); }
/** Prices run to six figures now, so they need separators to stay readable. */
function money(n){ return "£" + Math.round(n).toLocaleString("en-GB"); }
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function click(el, fn){
  if(!el) return;
  el.addEventListener("click", (e) => { audio.play("uiClick"); fn(e); });
}

/* ---------------------------------------------------------
   TITLE ART
   The home screens used to sit on assets/Menu.jpg, which was
   the real Sky Force game's promotional artwork - complete
   with its logo. This paints our own instead: a generated
   sky, a planet, and the pilot's ship coming at you.
   --------------------------------------------------------- */
/*
 * The home screens are alive, not a poster: the wing bobs, exhausts flicker
 * and a handful of stars twinkle, driven by one rAF loop that only runs while
 * a menu-bg screen is up. The sky itself stays a cached canvas - the per-frame
 * cost is four small ships and a dozen twinkles.
 */
let titleRaf = 0, titleT = 0;
function drawTitleArt(canvasId, p, t){
  const cv = $(canvasId);
  const ctx = cv && cv.getContext("2d");
  if(!ctx) return;
  const W = cv.width, H = cv.height;
  t = t || 0;
  ctx.clearRect(0, 0, W, H);

  const sky = SF.skygen.build(7, W, H);           // The Deep: the most dramatic
  if(sky) ctx.drawImage(sky, 0, 0);
  else { ctx.fillStyle = "#070716"; ctx.fillRect(0, 0, W, H); }

  // A handful of live twinkles over the cached sky.
  for(let i=0;i<14;i++){
    const tx = ((Math.sin(i*127.1)*43758.5453) % 1 + 1) % 1;
    const ty = ((Math.sin(i*311.7)*43758.5453) % 1 + 1) % 1;
    ctx.globalAlpha = 0.25 + Math.abs(Math.sin(t*1.3 + i*2.1))*0.55;
    ctx.fillStyle = i % 3 ? "#ffffff" : "#ffe9c4";
    ctx.fillRect(tx*W, ty*H*0.72, 2, 2);
  }
  ctx.globalAlpha = 1;

  // A big planet low and left, so the ship has something to fly past.
  const g = ctx.createRadialGradient(W*0.16, H*0.86, W*0.05, W*0.30, H*0.94, W*0.62);
  g.addColorStop(0, "#4a6fd8");
  g.addColorStop(0.5, "#17224f");
  g.addColorStop(1, "#04050f");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(W*0.30, H*0.98, W*0.58, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = "rgba(160,200,255,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(W*0.30, H*0.98, W*0.58, -2.9, -1.4); ctx.stroke();

  // The hero: their ship if we know who is flying, a stock one otherwise.
  const levels = p ? SF.shipart.levelsOf(p) : {};
  const col = p ? p.shipColor : "#f5a623";
  const bob = Math.sin(t*1.1)*H*0.006;
  SF.shipart.drawShip(ctx, W*0.66, H*0.22 + bob, W*0.28, { color: col, levels, t: t + 1.1, idle:false, tune: p && p.tune });

  // A wing of three behind it, small, for depth - each on its own rhythm.
  [[0.36,0.12,0.10],[0.86,0.15,0.085],[0.52,0.05,0.07]].forEach(([x,y,sz], i) => {
    const b2 = Math.sin(t*1.3 + i*2.4)*H*0.005;
    SF.shipart.drawShip(ctx, W*x, H*y + b2, W*sz, { color: col, levels:{}, t: t + i*0.7, idle:false });
  });

  // Darken toward the bottom so the UI over it stays readable.
  const fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, "rgba(5,4,15,0.25)");
  fade.addColorStop(0.5, "rgba(5,4,15,0.55)");
  fade.addColorStop(1, "rgba(5,4,15,0.95)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);
}

function startTitleLoop(){
  if(titleRaf) return;
  const step = () => {
    titleRaf = 0;
    const onProfiles = screens["screen-profiles"].classList.contains("active");
    const onMenu = screens["screen-menu"].classList.contains("active");
    if(!onProfiles && !onMenu) return;            // stops itself off-screen
    titleT += 1/60;
    drawTitleArt(onProfiles ? "titleArt" : "menuArt", onProfiles ? null : profile, titleT);
    titleRaf = requestAnimationFrame(step);
  };
  titleRaf = requestAnimationFrame(step);
}

/* ---------------------------------------------------------
   PILOT PICKER
   --------------------------------------------------------- */
function renderProfiles(){
  drawTitleArt("titleArt", null);
  const grid = $("profileGrid");
  grid.innerHTML = "";
  P.listNames().forEach(name => {
    const p = P.load(name);
    const rank = P.rankFor(p);
    const card = document.createElement("div");
    card.className = "profile-card";
    card.innerHTML = `
      <div class="pc-art"><canvas width="132" height="132"></canvas>
        <span class="pc-patch"></span></div>
      <div class="pname">${esc(p.callsign || p.name)}</div>
      <div class="prank" style="color:${rank.color}">${rank.name}</div>
      <div class="pstats"><b>${P.totalStars(p)}</b> ★ <i></i> <b>${p.highscore}</b> best</div>
    `;
    click(card, () => selectProfile(name));
    grid.appendChild(card);
    // Their actual ship, with everything they have bought on it - a pilot
    // picker should show who you are, not a coloured circle.
    const ctx = card.querySelector("canvas").getContext("2d");
    if(ctx){
      SF.shipart.drawShip(ctx, 66, 68, 108,
        { color: p.shipColor, levels: SF.shipart.levelsOf(p), t: 0.7, idle:false,
          tune: p.tune, decal: p.decal });
      // With an installed portrait, the pilot rides their card's corner.
      SF.pilotart.paint(ctx, 24, 24, 44, p);
    }
    SF.insignia.mount(card.querySelector(".pc-patch"), P.badgeFor(p), p.shipColor, 34);
  });
}

function selectProfile(name){
  profile = P.load(name);
  SF.game.profile = profile;
  renderMenu();
  show("screen-menu");
}

function renderMenu(){
  drawTitleArt("menuArt", profile);
  const rank = P.rankFor(profile);
  const next = P.nextRank(profile);
  const gear = P.gearLevel(profile);
  const stars = P.totalStars(profile);
  const pct = next ? Math.round((gear - rank.at) / (next.at - rank.at) * 100) : 100;

  $("menuPilot").innerHTML = `
    <span class="mp-patch"></span>
    <div class="mp-main">
      <div class="mp-name">${esc(profile.callsign)}</div>
      <div class="mp-rank" style="color:${rank.color}">${rank.name}</div>
      <div class="mp-bar"><i style="width:${pct}%;background:${rank.color}"></i></div>
      <div class="mp-stats">${stars} ★ · ${money(profile.money)}${
        next ? " · " + (next.at - gear) + " more gear to " + next.name : " · fully kitted out"}</div>
    </div>`;
  if(!SF.pilotart.mount($("menuPilot").querySelector(".mp-patch"), profile, 52)){
    SF.insignia.mount($("menuPilot").querySelector(".mp-patch"), P.badgeFor(profile), profile.shipColor, 52);
  }

  // Each button says what it is *for* right now, not just where it goes.
  let nextMission = 0;
  for(let i=0;i<MISSIONS.length;i++) if(isMissionUnlocked(profile, i)) nextMission = i;
  const A = SF.shipart, levels = A.levelsOf(profile), part = A.nextPart(levels);
  setSub("playSub", MISSIONS[nextMission].name);
  // The Daily Patrol opens once the basics are learned (mission 3 cleared).
  // Its sub is the score to beat - yours, or the leading brother's.
  {
    const open = dailyUnlocked(profile);
    $("dailyBtn").classList.toggle("locked", !open);
    const rivals = P.listNames().map(P.load).filter(q => (q.endlessBest || 0) > 0)
      .sort((a,b) => b.endlessBest - a.endlessBest);
    setSub("dailySub", !open ? "opens after Mission 3"
      : rivals.length
        ? "beat " + (rivals[0].callsign || rivals[0].name) + "'s " +
          rivals[0].endlessBest.toLocaleString("en-US") + " pts"
        : "today's sky - same for everyone");
  }
  // Boss Rush opens once the first boss falls; the sub is the score to beat.
  {
    const bosses = RUSH_IDS.filter(id => profile.missions && profile.missions[id] &&
                                         profile.missions[id].cleared).length;
    $("rushBtn").classList.toggle("locked", bosses === 0);
    setSub("rushSub", bosses === 0 ? "beat the Mission 4 boss first"
      : bosses + " boss" + (bosses > 1 ? "es" : "") + " in the queue · best " +
        (profile.bossRushBest || 0) + " down");
  }
  setSub("armorySub", part ? "Next part: " + part.name : "Every part fitted");
  {
    const owed = P.unclaimedMedals(profile);
    setSub("medalsSub", owed.length
      ? "Collect £" + owed.reduce((n,a)=>n+a.pay,0).toLocaleString("en-GB") + "!"
      : profile.achievements.length + " of " + ACHIEVEMENTS.length + " earned");
  }
  const rows = P.listNames().map(P.load)
    .sort((a,b) => P.totalStars(b) - P.totalStars(a));
  setSub("champSub", rows.length > 1
    ? (rows[0].callsign || rows[0].name) + " leads with " + P.totalStars(rows[0]) + " ★"
    : "No one to race yet");
  drawMenuIcons();
}
function setSub(id, text){ const el = $(id); if(el) el.textContent = text; }

/* ---------------------------------------------------------
   MENU ICONS
   Each mode gets a glyph drawn in the game's own neon style
   (emoji looked pasted-on next to the canvas art). FLY shows
   the pilot's actual ship; the rest are hand-drawn marks in
   the mode's accent colour.
   --------------------------------------------------------- */
function star5(c, x, y, r){
  c.beginPath();
  for(let i=0;i<10;i++){
    const rr = i % 2 === 0 ? r : r*0.45;
    const a = -Math.PI/2 + (i/10)*Math.PI*2;
    c[i === 0 ? "moveTo" : "lineTo"](x + Math.cos(a)*rr, y + Math.sin(a)*rr);
  }
  c.closePath();
}
function drawMenuIcons(){
  const paint = (btnId, fn) => {
    const btn = $(btnId);
    const cv = btn && btn.querySelector(".mb-icon");
    const c = cv && cv.getContext("2d");
    if(!c) return;
    c.clearRect(0, 0, 76, 76);
    c.save();
    try { fn(c); } catch(e){}
    c.restore();
  };
  const glowSet = (c, color) => { c.shadowColor = color; c.shadowBlur = 10; };

  paint("playBtn", c => {
    SF.shipart.drawShip(c, 38, 40, 58,
      { color: profile.shipColor, levels: SF.shipart.levelsOf(profile), t: 0, tune: profile.tune });
  });

  paint("dailyBtn", c => {              // a sun coming up over the horizon
    glowSet(c, "#ffd23f");
    c.fillStyle = "#ffd23f";
    c.beginPath(); c.arc(38, 46, 15, Math.PI, 0); c.fill();
    c.strokeStyle = "#ffd23f"; c.lineWidth = 3; c.lineCap = "round";
    for(let i=0;i<5;i++){
      const a = Math.PI + (i/4)*Math.PI;
      c.beginPath();
      c.moveTo(38 + Math.cos(a)*21, 46 + Math.sin(a)*21);
      c.lineTo(38 + Math.cos(a)*27, 46 + Math.sin(a)*27);
      c.stroke();
    }
    c.strokeStyle = "rgba(255,210,63,0.65)"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(10, 48); c.lineTo(66, 48); c.stroke();
  });

  paint("rushBtn", c => {               // a horned boss hull, eyes lit
    glowSet(c, "#ff5d73");
    c.fillStyle = "#ff5d73";
    c.beginPath();
    c.moveTo(38, 16);                   // crown
    c.lineTo(58, 28); c.lineTo(66, 14); c.lineTo(64, 38);  // right horn
    c.lineTo(50, 56); c.lineTo(38, 50); c.lineTo(26, 56);  // jaw
    c.lineTo(12, 38); c.lineTo(10, 14); c.lineTo(18, 28);  // left horn
    c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = "#1a0b12";
    c.beginPath(); c.arc(29, 34, 4.4, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(47, 34, 4.4, 0, Math.PI*2); c.fill();
    c.fillStyle = "#ffe9a8";
    c.beginPath(); c.arc(29, 34, 1.8, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(47, 34, 1.8, 0, Math.PI*2); c.fill();
  });

  paint("armoryBtn", c => {             // a wrench across a bolt
    glowSet(c, "#7cc4ff");
    c.strokeStyle = "#7cc4ff"; c.fillStyle = "#7cc4ff";
    c.lineWidth = 9; c.lineCap = "round";
    c.beginPath(); c.moveTo(28, 48); c.lineTo(52, 24); c.stroke();
    c.lineWidth = 0;
    c.beginPath(); c.arc(24, 52, 11, -0.6, Math.PI*1.35); c.lineWidth = 8; c.stroke();
    c.beginPath(); c.arc(56, 20, 11, Math.PI - 0.6, Math.PI*2.35); c.stroke();
  });

  paint("achievementsBtn", c => {       // a medal on its ribbon
    glowSet(c, "#4ade80");
    c.fillStyle = "#2f9e5b";
    c.beginPath(); c.moveTo(28, 10); c.lineTo(38, 30); c.lineTo(20, 34); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(48, 10); c.lineTo(38, 30); c.lineTo(56, 34); c.closePath(); c.fill();
    c.fillStyle = "#4ade80";
    c.beginPath(); c.arc(38, 45, 15, 0, Math.PI*2); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = "#0f2b18";
    star5(c, 38, 45, 8); c.fill();
  });

  paint("leaderboardBtn", c => {        // the podium, star on first place
    glowSet(c, "#c084fc");
    c.fillStyle = "#c084fc";
    c.fillRect(12, 42, 15, 22);         // second
    c.fillRect(30, 34, 16, 30);         // first
    c.fillRect(49, 48, 15, 16);         // third
    c.shadowBlur = 0;
    c.fillStyle = "#ffd23f";
    glowSet(c, "#ffd23f");
    star5(c, 38, 22, 7); c.fill();
  });
}

/* ---------------------------------------------------------
   THE CAMPAIGN MAP
   A list of cards told you the missions existed. A route
   drawn across a starfield, with your own ship parked at the
   furthest stop you've reached, tells you you're going
   somewhere - which is the whole difference between a menu
   and a campaign.

   Layout is computed once in normalised [0,1] coordinates so
   the canvas (which draws it) and the DOM buttons (which
   catch the taps) can never disagree about where a stop is.
   --------------------------------------------------------- */
const campaign = { raf:0, t:0, ctx:null, stars:null, sky:null };

/* A deterministic little RNG so the sky is elaborate but always the same sky. */
function skyRand(i){ return ((Math.sin(i*127.1 + 311.7)*43758.5453) % 1 + 1) % 1; }

/*
 * The backdrop is static, so it is painted once into an offscreen canvas and
 * blitted every frame - nebula clouds, planets, a distant galaxy and dust.
 * Only the star twinkle is live. Redrawing a dozen radial gradients at 60fps
 * to produce an identical image would be silly.
 */
function buildSky(W, H){
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  if(!c) return cv;

  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#2b2465");
  bg.addColorStop(0.5, "#151338");
  bg.addColorStop(1, "#080718");
  c.fillStyle = bg; c.fillRect(0, 0, W, H);

  // Nebula: a few big soft clouds, deliberately low contrast so the route
  // stays the brightest thing on the map.
  [["#7c3aed", 0.30, 0.22, 0.46], ["#0ea5e9", 0.76, 0.44, 0.40],
   ["#db2777", 0.24, 0.72, 0.38], ["#14b8a6", 0.62, 0.90, 0.30]]
    .forEach(([col, x, y, r]) => {
      const g = c.createRadialGradient(x*W, y*H, 0, x*W, y*H, r*W);
      g.addColorStop(0, col + "44");
      g.addColorStop(0.5, col + "1a");
      g.addColorStop(1, col + "00");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    });

  // Wispy filaments through the clouds.
  c.globalAlpha = 0.16;
  for(let i=0;i<26;i++){
    const x = skyRand(i)*W, y = skyRand(i+40)*H;
    const len = 60 + skyRand(i+80)*180, ang = skyRand(i+120)*Math.PI;
    c.strokeStyle = i%3 === 0 ? "#a78bfa" : "#67e8f9";
    c.lineWidth = 1 + skyRand(i+160)*2;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(ang)*len*0.5 + 40, y + Math.sin(ang)*len*0.5,
                       x + Math.cos(ang)*len, y + Math.sin(ang)*len);
    c.stroke();
  }
  c.globalAlpha = 1;

  // A distant galaxy: an ellipse of dots with a bright core.
  (function galaxy(cx, cy, rr){
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, "rgba(255,240,210,0.55)");
    g.addColorStop(0.35, "rgba(200,170,255,0.14)");
    g.addColorStop(1, "rgba(120,90,200,0)");
    c.fillStyle = g;
    c.save(); c.translate(cx, cy); c.rotate(-0.5); c.scale(1, 0.42);
    c.beginPath(); c.arc(0, 0, rr, 0, Math.PI*2); c.fill();
    for(let i=0;i<160;i++){
      const a = skyRand(i+200)*Math.PI*2, d = Math.pow(skyRand(i+260), 0.6)*rr;
      c.globalAlpha = 0.5*(1 - d/rr);
      c.fillStyle = "#ffffff";
      c.fillRect(Math.cos(a + d*0.02)*d, Math.sin(a + d*0.02)*d, 1.4, 1.4);
    }
    c.globalAlpha = 1;
    c.restore();
  })(W*0.16, H*0.17, W*0.28);

  // Planets. Lit from the upper left like everything else in the game.
  // Placed in the gaps the serpentine route leaves: it runs x 0.20-0.80, so
  // the planets live out at the edges and never sit under a stop.
  [[0.85, 0.25, 0.115, "#c2703a", "#5a2a12"],
   [0.15, 0.63, 0.075, "#3f8fd8", "#12294d"],
   [0.93, 0.55, 0.042, "#8b9bb4", "#2b3244"]]
    .forEach(([x, y, r, lit, dark], idx) => {
      const cx = x*W, cy = y*H, rr = r*W;
      const g = c.createRadialGradient(cx - rr*0.4, cy - rr*0.45, rr*0.1, cx, cy, rr);
      g.addColorStop(0, lit);
      g.addColorStop(0.65, dark);
      g.addColorStop(1, "#05060f");
      c.fillStyle = g;
      c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI*2); c.fill();
      // Bands on the big one, a ring on the small one.
      if(idx === 0){
        c.save();
        c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI*2); c.clip();
        c.globalAlpha = 0.18; c.fillStyle = "#ffd9a8";
        [-0.45, -0.1, 0.3, 0.6].forEach(o =>
          c.fillRect(cx - rr, cy + o*rr, rr*2, rr*0.14));
        c.restore();
        c.globalAlpha = 1;
      }
      c.strokeStyle = "rgba(255,235,200,0.28)";
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(cx, cy, rr, -2.5, -0.9); c.stroke();
    });

  // THEIR STAR: a baleful red giant over the far end of the route. The top of
  // the map should read as enemy space long before you can fly there - the
  // journey climbs out of friendly blue and into somebody else's red.
  (function redGiant(cx, cy, rr){
    const halo = c.createRadialGradient(cx, cy, rr*0.4, cx, cy, rr*3.4);
    halo.addColorStop(0, "rgba(255,70,60,0.30)");
    halo.addColorStop(0.5, "rgba(210,30,60,0.10)");
    halo.addColorStop(1, "rgba(160,20,60,0)");
    c.fillStyle = halo;
    c.fillRect(cx - rr*3.4, cy - rr*3.4, rr*6.8, rr*6.8);
    const g = c.createRadialGradient(cx - rr*0.3, cy - rr*0.3, rr*0.1, cx, cy, rr);
    g.addColorStop(0, "#ffd9a0");
    g.addColorStop(0.35, "#ff8a4a");
    g.addColorStop(1, "#a11224");
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI*2); c.fill();
    // solar flares licking off the rim
    c.strokeStyle = "rgba(255,130,80,0.55)"; c.lineWidth = 2.5;
    for(let i=0;i<5;i++){
      const a0 = skyRand(i+500)*Math.PI*2;
      c.beginPath();
      c.arc(cx, cy, rr*(1.10 + skyRand(i+520)*0.22), a0, a0 + 0.5 + skyRand(i+540)*0.8);
      c.stroke();
    }
  })(W*0.12, H*0.035, W*0.085);
  const war = c.createLinearGradient(0, 0, 0, H*0.16);
  war.addColorStop(0, "rgba(210,30,60,0.15)");
  war.addColorStop(1, "rgba(210,30,60,0)");
  c.fillStyle = war; c.fillRect(0, 0, W, H*0.16);

  // Far dust, so the empty corners aren't empty.
  for(let i=0;i<70;i++){
    c.globalAlpha = 0.10 + skyRand(i+300)*0.16;
    c.fillStyle = i%4 === 0 ? "#ffd9a8" : "#9fb6ff";
    const sz = 1 + skyRand(i+340)*2.4;
    c.fillRect(skyRand(i+380)*W, skyRand(i+420)*H, sz, sz);
  }
  c.globalAlpha = 1;
  return cv;
}

/*
 * The map draws the monsters. A boss stop used to be a red disc with a number
 * on it, which tells you the game THINKS something scary is there. Drawing the
 * boss's actual battle hull - the same painter the fight uses - shows you.
 * Ahead of you they loom as dark silhouettes; beaten, they stay behind as
 * cracked wrecks. Only enough of a boss is faked here for the painters to run.
 */
const mapBoss = { fake:{}, shadow:{} };
function mapBossFor(id){
  if(!mapBoss.fake[id]){
    const wounds = [];
    for(let i=0;i<10;i++) wounds.push({
      x: skyRand(i*3+1)*120 - 60, y: skyRand(i*3+2)*120 - 60,
      r: 10 + skyRand(i*3+3)*12,
    });
    mapBoss.fake[id] = { defId:id, flash:0, charge:0, phaseIndex:0, phase:null, wounds };
  }
  return mapBoss.fake[id];
}
function mapHullReady(id){
  return id === "devourer"
    ? !!(SF.render && SF.render.drawDevourerHull)
    : !!(SF.bossart && SF.bossart.has(id));
}
function drawMapHull(ctx, id, S, damage, timeMs){
  const fake = mapBossFor(id);
  if(id === "devourer") SF.render.drawDevourerHull(ctx, fake, 0, 0, S, damage, timeMs);
  else SF.bossart.draw(ctx, fake, S, damage, timeMs);
}
/* A locked boss is a shape, not a ship: the hull rendered once, then flooded
   dark, so kids see that SOMETHING big is waiting without seeing what. */
function hullShadow(id, S){
  const key = id + "@" + S;
  if(mapBoss.shadow[key] !== undefined) return mapBoss.shadow[key];
  const pad = Math.ceil(S*1.05);
  const cv = document.createElement("canvas");
  cv.width = cv.height = pad*2;
  const c = cv.getContext("2d");
  if(!c) return (mapBoss.shadow[key] = null);
  c.translate(pad, pad);
  drawMapHull(c, id, S, 0, 0);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = "#161a3a";
  c.fillRect(-pad, -pad, pad*2, pad*2);
  return (mapBoss.shadow[key] = cv);
}

/*
 * WHAT LIVES HERE. Bosses got hulls, and next to them every ordinary stop was
 * the same blue disc with a number - eleven identical dots on a route that is
 * supposed to be a journey through different places. So a stop now wears its
 * own mission: the enemy you will mostly be fighting, drawn inside the disc,
 * and a colour taken from what the mission actually ASKS of you.
 *
 * All of it is derived from the mission's own wave script and objectives, so a
 * new level gets a face for free and nobody has to maintain a lookup table.
 */
const FACE_KINDS = {
  // objective/flag driven, checked in this order - most distinctive first
  noGuns:  { c0:"#b07be8", c1:"#3a1d5c" },   // Silent Running: guns down
  duel:    { c0:"#ff4fd8", c1:"#5c0a44" },   // the Rival - personal, not a war
  storm:   { c0:"#67e8f9", c1:"#164e63" },   // the wind is the level
  escort:  { c0:"#7cc4ff", c1:"#123a5c" },   // protect, don't just survive
  dark:    { c0:"#3d477a", c1:"#0b0d24" },   // the Searchlight's blackout
  coins:   { c0:"#ffc451", c1:"#6b4a09" },   // a coin run
  rescue:  { c0:"#4bd6a0", c1:"#0e4436" },   // pull everyone out
  rocks:   { c0:"#b09a86", c1:"#3a2e24" },   // debris fields, nothing shoots
  fight:   { c0:"#5b6bd8", c1:"#1d2050" },   // the plain blue default
};
const faceCache = {};
/*
 * A full-colour enemy sprite shrunk to 50px on top of a coloured disc turns
 * into a grey smudge - too much internal detail, too little contrast. Flooding
 * it to one dark colour turns it back into a SHAPE, which is all it needs to
 * be at this size: you read "the pointy one" or "the fat one" instantly.
 */
const silCache = {};
function enemySil(type){
  if(silCache[type] !== undefined) return silCache[type];
  const cv = document.createElement("canvas");
  const c = () => cv.getContext("2d");
  // Rocks have no enemy art - they are drawn by the particle layer in play -
  // but "through the debris" is a whole level's identity, so the map draws one.
  if(type === "asteroid"){
    cv.width = cv.height = 96;
    const k = c();
    if(!k) return (silCache[type] = null);
    k.translate(48, 48);
    k.fillStyle = "#080b1c";
    k.beginPath();
    for(let i = 0; i < 9; i++){
      const a = i/9*Math.PI*2;
      const r = 30 + ((i*7)%5 - 2)*3.5;
      const px2 = Math.cos(a)*r, py2 = Math.sin(a)*r;
      i ? k.lineTo(px2, py2) : k.moveTo(px2, py2);
    }
    k.closePath(); k.fill();
    return (silCache[type] = cv);
  }
  const src = SF.enemyArt.spriteFor(type, "#ffffff", false);
  if(!src) return (silCache[type] = null);
  cv.width = src.width; cv.height = src.height;
  const k = c();
  if(!k) return (silCache[type] = null);
  k.drawImage(src, 0, 0);
  k.globalCompositeOperation = "source-in";
  k.fillStyle = "#080b1c";
  k.fillRect(0, 0, cv.width, cv.height);
  return (silCache[type] = cv);
}
/*
 * How many missions each enemy turns up in. A mission's SIGNATURE enemy is its
 * rarest one, not its most numerous: grunts are the filler in almost every
 * level, so "most bodies" picked the grunt for missions 1, 2, 3, 5 and 7 alike
 * and the map went straight back to identical dots. The rare one is the one
 * the level is actually about - weavers in Weaving Through, kamikazes in
 * Kamikaze Run, thieves in Their Treasury.
 */
let spreadCache = null;
function enemySpread(){
  if(spreadCache) return spreadCache;
  spreadCache = {};
  MISSIONS.forEach(mm => {
    const seen = {};
    mm.waves.forEach(wv => { seen[wv.type] = true; });
    Object.keys(seen).forEach(tp => { spreadCache[tp] = (spreadCache[tp] || 0) + 1; });
  });
  return spreadCache;
}
function missionFace(m){
  if(faceCache[m.id]) return faceCache[m.id];

  const tally = {};
  m.waves.forEach(wv => { tally[wv.type] = (tally[wv.type] || 0) + wv.n; });
  const spread = enemySpread();
  /*
   * Bodies weighted DOWN by how many missions the type appears in. Raw counts
   * pick the grunt every time; raw rarity picks whatever cameos once, so
   * "Weaving Through" came out as a thief level. Bodies over spread lands on
   * the enemy a level is actually built around.
   *
   * A mission may still name its own face, and five do: where the brief states
   * the identity outright ("kill the hive first", "the gold glowing ones are
   * elites") the data should say so rather than hope a heuristic agrees. Rocks
   * and mines have no art of their own, so they can colour a stop but only
   * become its face by being asked for by name.
   */
  let enemy = null, best = -1, rockN = 0, totalN = 0;
  Object.keys(tally).forEach(type => {
    totalN += tally[type];
    if(!SF.enemyArt.has(type)){ rockN += tally[type]; return; }
    const score = tally[type] / (spread[type] || 1);
    if(score > best){ best = score; enemy = type; }
  });
  if(m.face) enemy = m.face;

  const obj = m.objectives || [];
  // Order matters: nearly every level has pods to collect, so the rescue test
  // is greedy and would paint half the route the same green. The narrower
  // identities - guns down, a coin run, a rock field - get asked first.
  // Coins outrank weather: the Treasury picked up the storm remix, but its
  // identity on the map is still "the coin level", not "another windy one".
  const kind = m.noGuns ? "noGuns"
             : m.rival ? "duel"
             : (obj.includes("coinRush") || m.coinRain) ? "coins"
             : m.storm ? "storm"
             : m.convoy ? "escort"
             : m.blackout ? "dark"
             : (totalN > 0 && rockN/totalN >= 0.3) ? "rocks"
             : (obj.includes("rescueAll") && rescueCount(m) >= 4) ? "rescue"
             : "fight";
  return (faceCache[m.id] = Object.assign({ enemy, kind, elite: !!m.faceElite },
                                          FACE_KINDS[kind]));
}

/** Serpentine route from the bottom of the map to the top. */
/*
 * The map is sized from the mission count rather than fixed, because the route
 * grew from 8 stops to 14. At the old 900px height those 14 sat 55px apart -
 * closer than the 76px tap targets over them, so two neighbouring missions
 * shared pixels and you could launch the wrong one. ROUTE_GAP is the spacing
 * that actually matters; the canvas is whatever height delivers it.
 */
/* The mission that closes act one, found rather than numbered: a hard-coded 7
   would quietly point at the wrong level the first time the campaign is
   reordered, and the half-time story beat would fire in the wrong place. */
const ACT_ONE_END = MISSIONS.findIndex(m => m.boss === "sentinel");

const MAP_W = 640;
const ROUTE_GAP = 108;          // vertical pixels between stops, canvas-space
const ROUTE_SPAN = 0.80;        // fraction of the height the route occupies
function mapHeight(){
  return Math.round(ROUTE_GAP * (MISSIONS.length - 1) / ROUTE_SPAN);
}

function campaignLayout(){
  const n = MISSIONS.length;
  return MISSIONS.map((m, i) => {
    const k = i/(n-1);
    return {
      mission: m, index: i,
      // Period chosen so no two neighbours land on the same side: at 1.15 the
      // last two stops sat almost on top of each other.
      x: 0.5 + Math.sin(i*0.85 + 0.6) * 0.30,
      y: 0.90 - k*ROUTE_SPAN,
    };
  });
}

/* Named stretches, so the route reads as a journey rather than fourteen dots. */
const SECTORS = [
  { at:0,  name:"HOME PATROL" },     // 1-3: learning the ropes
  { at:2,  name:"THE BELT" },        // 3-5: rocks and raiders
  { at:5,  name:"THE STORM" },       // 6: the squall
  { at:7,  name:"DEEP RUN" },        // 8-9: the gauntlet and the convoy
  { at:10, name:"ENEMY SPACE" },     // 11-13: behind their lines
  { at:13, name:"WARDEN SPACE" },    // 14-15: the jailer's ground
  { at:16, name:"THE TRENCHES" },    // 17-18: their fortress
  { at:19, name:"THEIR STAR" },      // 20-22: the dark, and the end
];

function renderMissions(){
  const stars = P.totalStars(profile);
  $("missionStars").textContent = stars + " / " + (MISSIONS.length*3) + " ★ collected";

  // Size the map to the campaign, not the other way round.
  const cv = $("campaignCanvas");
  const wantH = mapHeight();
  if(cv && (cv.width !== MAP_W || cv.height !== wantH)){
    cv.width = MAP_W; cv.height = wantH;
    campaign.sky = null;                     // painted at the old size
  }

  const nodes = campaignLayout();
  const holder = $("campaignNodes");
  holder.innerHTML = "";
  nodes.forEach(node => {
    const unlocked = isMissionUnlocked(profile, node.index);
    const earned = P.starsForMission(profile, node.mission.id);
    const btn = document.createElement("button");
    btn.className = "map-node" + (unlocked ? "" : " locked") + (earned === 3 ? " perfect" : "");
    btn.style.left = (node.x*100) + "%";
    btn.style.top  = (node.y*100) + "%";
    btn.setAttribute("aria-label",
      unlocked ? node.mission.name + ", " + earned + " of 3 stars"
               : node.mission.name + ", locked");
    if(unlocked) click(btn, () => openBriefing(node.index));
    holder.appendChild(btn);
  });

  /*
   * The stop the map opens on, and the one the bottom button flies.
   *
   * This used to be a five-line card: mission number, name, subtitle, enemy
   * count, record holder, TAP TO FLY. It was cut for restating the picture
   * directly above it - the stop is already the only bright one in a row of
   * locked ones, ringed and haloed with your ship parked on it, and the
   * record holder's initial already rides its rim in their own colour.
   *
   * What was worth keeping is the shortcut, not the paragraph: "a next level
   * button is good but it doesn't need to be a whole card". So it is one
   * line - a verb, a number, and the name - which is a control rather than a
   * description of one. The map keeps the storytelling; the button just goes
   * there.
   */
  let next = 0;
  for(let i=0;i<MISSIONS.length;i++) if(isMissionUnlocked(profile, i)) next = i;
  const nextBtn = $("campaignNext");
  if(nextBtn){
    const nm = MISSIONS[next];
    nextBtn.innerHTML = `<b>▶ FLY MISSION ${nm.id}</b>` +
                        `<span>${esc(nm.name)}</span>`;
    nextBtn.onclick = () => { audio.play("uiClick"); openBriefing(next); };
  }

  startCampaignLoop();
  scrollToNextStop(next);
}

/*
 * A twenty-three stop map is far taller than the screen - about 2200px of it -
 * and the route runs bottom to top, so mission 1 is at the very bottom and
 * mission 23 at the very top. Opening the campaign has to land on the stop
 * you are actually going to fly: the bottom for a new pilot, the top for one
 * who has finished, wherever you happen to be for everyone in between.
 *
 * It did none of that, and the reason is a one-liner: every caller does
 * `renderMissions(); show("screen-missions")` - render, THEN show - so this
 * ran while the section was still display:none. Every measurement came back
 * 0, `scrollTop` was set to 0, and the campaign always opened at the top on
 * mission 23's empty sky. The code was right; it just ran a frame too early.
 *
 * So it waits for the screen to actually be laid out, then measures the
 * node's own box rather than recomputing the layout fractions - the button is
 * the ground truth for where the stop ended up. The generation counter drops
 * a pending scroll if another render supersedes it, and the try budget means
 * a screen that is never opened stops asking after half a second.
 */
let campaignScrollGen = 0;
function scrollToNextStop(index){
  const screen = screens["screen-missions"];
  const holder = $("campaignNodes");
  if(!screen || !holder) return;
  const gen = ++campaignScrollGen;
  let tries = 0;
  const apply = () => {
    if(gen !== campaignScrollGen) return;          // a newer render took over
    const node = holder.children[index];
    const ready = screen.classList.contains("active") && screen.clientHeight > 0 &&
                  node && node.getBoundingClientRect().height > 0;
    if(!ready){
      if(++tries < 40) requestAnimationFrame(apply);
      return;
    }
    const nr = node.getBoundingClientRect(), sr = screen.getBoundingClientRect();
    // The stop's centre, in the scroll container's own content coordinates.
    const y = (nr.top + nr.height/2 - sr.top) + screen.scrollTop;
    const max = Math.max(0, screen.scrollHeight - screen.clientHeight);
    screen.scrollTop = Math.max(0, Math.min(max, y - screen.clientHeight/2));
  };
  apply();
}

function startCampaignLoop(){
  const cv = $("campaignCanvas");
  if(!cv) return;
  campaign.ctx = campaign.ctx || cv.getContext("2d");
  if(!campaign.stars){
    campaign.stars = Array.from({length:110}, (_,i) => ({
      x: (Math.sin(i*12.9898)*43758.5453 % 1 + 1) % 1,
      y: (Math.sin(i*78.233)*43758.5453 % 1 + 1) % 1,
      r: 0.4 + ((Math.sin(i*3.7)*10000 % 1 + 1) % 1) * 1.6,
      tw: i*0.7,
    }));
  }
  if(campaign.raf) return;
  const step = () => {
    campaign.raf = 0;
    if(!screens["screen-missions"].classList.contains("active")) return;
    campaign.t += 1/60;
    drawCampaign();
    campaign.raf = requestAnimationFrame(step);
  };
  campaign.raf = requestAnimationFrame(step);
}

function drawCampaign(){
  const ctx = campaign.ctx;
  if(!ctx || !profile) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const t = campaign.t;
  const nodes = campaignLayout();
  const px = n => n.x*W, py = n => n.y*H;

  campaign.sky = campaign.sky || buildSky(W, H);
  ctx.drawImage(campaign.sky, 0, 0);

  campaign.stars.forEach(s => {
    ctx.globalAlpha = 0.35 + Math.sin(t*1.6 + s.tw)*0.3;
    ctx.fillStyle = "#dbe6ff";
    ctx.fillRect(s.x*W, s.y*H, s.r, s.r);
  });
  ctx.globalAlpha = 1;

  // A shooting star every few seconds. Pure theatre, and nearly free.
  {
    const period = 5.5, k = Math.floor(t/period), f = (t - k*period)/1.1;
    if(f < 1){
      const sx = (0.1 + skyRand(k*5+1)*0.8)*W, sy = skyRand(k*5+2)*H;
      const ang = 2.2 + skyRand(k*5+3)*0.7;
      const d = f*260, LEN = 70;
      const ex = sx + Math.cos(ang)*d, ey = sy + Math.sin(ang)*d;
      const a = Math.sin(f*Math.PI);
      const g = ctx.createLinearGradient(ex - Math.cos(ang)*LEN, ey - Math.sin(ang)*LEN, ex, ey);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(255,255,255," + (0.75*a).toFixed(2) + ")");
      ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ex - Math.cos(ang)*LEN, ey - Math.sin(ang)*LEN);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }

  // How far along the route the player has actually got.
  let reached = 0;
  for(let i=0;i<nodes.length;i++) if(isMissionUnlocked(profile, i)) reached = i;

  // The route: travelled stretches are lit, the rest is a faint dashed plan.
  for(let i=0;i<nodes.length-1;i++){
    const a = nodes[i], b = nodes[i+1];
    const done = i < reached;
    ctx.save();
    ctx.setLineDash(done ? [] : [10, 12]);
    ctx.lineWidth = done ? 5 : 3;
    ctx.strokeStyle = done ? "rgba(245,166,35,0.75)" : "rgba(255,255,255,0.16)";
    if(done){ ctx.shadowColor = "rgba(245,166,35,0.7)"; ctx.shadowBlur = 12; }
    ctx.beginPath();
    ctx.moveTo(px(a), py(a));
    ctx.quadraticCurveTo((px(a)+px(b))/2 + (i%2 ? 70 : -70), (py(a)+py(b))/2, px(b), py(b));
    ctx.stroke();
    ctx.restore();
  }

  // A little supply convoy runs the lit stretch: the road you opened is in
  // use. Three gold sparks chasing each other up the route, nothing more.
  if(reached > 0){
    const quad = (a, b, i, u) => {
      const cx = (px(a)+px(b))/2 + (i%2 ? 70 : -70), cy = (py(a)+py(b))/2;
      const q = 1-u;
      return [q*q*px(a) + 2*q*u*cx + u*u*px(b), q*q*py(a) + 2*q*u*cy + u*u*py(b)];
    };
    ctx.save();
    ctx.lineCap = "round";
    for(let j=0;j<3;j++){
      const u = ((t*0.16 + j*0.37) % 1) * reached;
      const seg = Math.min(reached-1, Math.floor(u));
      const f = u - seg;
      const [hx, hy] = quad(nodes[seg], nodes[seg+1], seg, f);
      const [tx2, ty2] = quad(nodes[seg], nodes[seg+1], seg, Math.max(0, f-0.05));
      ctx.strokeStyle = "rgba(255,214,90,0.45)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tx2, ty2); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  SECTORS.forEach(sec => {
    const n = nodes[sec.at];
    if(!n) return;
    ctx.save();
    ctx.globalAlpha = isMissionUnlocked(profile, sec.at) ? 0.5 : 0.22;
    ctx.fillStyle = "#cfd8ff";
    ctx.font = "bold 15px Rajdhani, Arial, sans-serif";
    // Opposite side to the ship marker, and clear of the node itself.
    const away = n.x > 0.5 ? -1 : 1;
    ctx.textAlign = away < 0 ? "right" : "left";
    ctx.letterSpacing = "3px";
    ctx.fillText(sec.name, px(n) + away*74, py(n) - 2);
    ctx.restore();
  });

  const me = profile.callsign || profile.name;
  nodes.forEach((node, i) => {
    const unlocked = isMissionUnlocked(profile, i);
    const earned = P.starsForMission(profile, node.mission.id);
    const boss = !!node.mission.boss;
    const bossId = node.mission.boss || null;
    const hull = boss && mapHullReady(bossId);
    const finale = bossId === "devourer";
    const hullS = finale ? 150 : 92;   // the last one dwarfs the rest
    const x = px(node), y = py(node);
    // Locked stops shrink and hush: the past and present are the story, the
    // future is a sketch. Bosses are the exception - a monster ahead should
    // LOOM, so a locked hull keeps its size and loses its colour instead.
    const R = hull ? hullS*0.5 : (boss ? 40 : 32) * (unlocked ? 1 : 0.72);
    const isNext = i === reached;
    const beaten = earned > 0;

    if(boss && !beaten){               // a wreck doesn't buzz with danger
      ctx.save();
      ctx.globalAlpha = unlocked ? 1 : 0.18;
      ctx.strokeStyle = "rgba(255,45,85,0.7)";
      ctx.lineWidth = 3;
      for(let k=0;k<12;k++){
        const a = k/12*Math.PI*2 + t*0.35;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a)*(R+7), y + Math.sin(a)*(R+7));
        ctx.lineTo(x + Math.cos(a)*(R+16), y + Math.sin(a)*(R+16));
        ctx.stroke();
      }
      ctx.restore();
    }
    if(isNext){
      // The stop you're here to fly announces itself even in a still frame:
      // a slow gold reticle (four corner arcs) plus the pulse.
      const pulse = 0.5 + Math.sin(t*3)*0.5;
      ctx.strokeStyle = "rgba(255,210,63," + (0.25 + pulse*0.5) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, R + 12 + pulse*7, 0, Math.PI*2); ctx.stroke();
      ctx.save();
      ctx.strokeStyle = "rgba(255,210,63,0.9)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for(let q=0;q<4;q++){
        const a0 = t*0.6 + q*Math.PI/2;
        ctx.beginPath(); ctx.arc(x, y, R + 9, a0, a0 + 0.6); ctx.stroke();
      }
      ctx.restore();
    }

    if(hull){
      // The stop IS the monster: the fight's own hull painter, hovering.
      if(!unlocked){
        const sh = hullShadow(bossId, hullS);
        if(sh) ctx.drawImage(sh, x - sh.width/2, y - sh.height/2);
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(200,210,255,0.5)";
        ctx.font = "bold 30px Rajdhani, Arial, sans-serif";
        ctx.fillText("?", x, y + 10);
      } else {
        ctx.save();
        ctx.translate(x, y + Math.sin(t*1.1 + i)*3);   // a slow hover
        if(beaten) ctx.globalAlpha = 0.75;             // a wreck, not a threat
        drawMapHull(ctx, bossId, hullS, beaten ? 0.85 : 0, t*1000);
        ctx.restore();
      }
      if(earned === 3){
        ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, R + 6, 0, Math.PI*2); ctx.stroke();
      }
      /*
       * The mission number can't ride in the middle of a hull, so it gets a
       * badge - but the badge is a MINIATURE MISSION DISC, not a chip of its
       * own invention: same radial gradient, same stroke rules, same bold
       * numeral. Every stop on the map then counts in the same currency, which
       * a dim little pill in the corner did not.
       */
      const bR = 19, bx2 = x - R*0.82, by2 = y + R*0.62;
      const bg = ctx.createRadialGradient(bx2-bR*0.3, by2-bR*0.4, bR*0.15, bx2, by2, bR);
      if(unlocked){ bg.addColorStop(0, "#ff7a90"); bg.addColorStop(1, "#7a1226"); }
      else { bg.addColorStop(0, "#3a3f57"); bg.addColorStop(1, "#191c2c"); }
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(bx2, by2, bR, 0, Math.PI*2); ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = earned === 3 ? "#ffd23f"
                      : unlocked ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.15)";
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = unlocked ? "#fff" : "rgba(255,255,255,0.4)";
      ctx.font = "bold 21px Rajdhani, Arial, sans-serif";
      ctx.fillText(String(node.mission.id), bx2, by2 + 8);
    } else {
      const face = missionFace(node.mission);
      const g = ctx.createRadialGradient(x-R*0.3, y-R*0.4, R*0.15, x, y, R);
      if(unlocked){
        g.addColorStop(0, boss ? "#ff7a90" : face.c0);
        g.addColorStop(1, boss ? "#7a1226" : face.c1);
      }
      else { g.addColorStop(0, "#3a3f57"); g.addColorStop(1, "#191c2c"); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();

      // The mission's own enemy, riding inside the disc. Clipped to the rim so
      // eighteen stops stay eighteen tidy circles, and kept faint so it reads
      // as the stop's character rather than competing with its number.
      const sprite = face.enemy && enemySil(face.enemy);
      if(sprite){
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, R-2, 0, Math.PI*2); ctx.clip();
        // An elite level glows gold behind its silhouette - the same tell the
        // elites themselves wear in play, so the map speaks the game's language.
        if(face.elite && unlocked){
          const eg = ctx.createRadialGradient(x, y, 0, x, y, R);
          eg.addColorStop(0, "rgba(255,210,63,0.85)");
          eg.addColorStop(1, "rgba(255,170,20,0.15)");
          ctx.fillStyle = eg;
          ctx.fillRect(x-R, y-R, R*2, R*2);
        }
        ctx.globalAlpha = unlocked ? 0.62 : 0.2;
        // Wide ships lose their wingtips to the rim at full width, and the
        // wingtips are exactly what tells a weaver from a grunt.
        const box = R*1.72;
        ctx.drawImage(sprite, x - box/2, y - box/2, box, box);
        ctx.restore();
      }

      ctx.lineWidth = 3;
      ctx.strokeStyle = earned === 3 ? "#ffd23f"
                      : unlocked ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.15)";
      ctx.stroke();

      ctx.textAlign = "center";
      // A number over artwork needs its own backing or it dissolves into the
      // silhouette behind it - the shadow is what keeps the map countable.
      ctx.save();
      ctx.shadowColor = "rgba(4,6,16,0.95)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = unlocked ? "#fff" : "rgba(255,255,255,0.4)";
      ctx.font = "bold " + Math.round((boss ? 26 : 22) * (unlocked ? 1 : 0.8)) + "px Rajdhani, Arial, sans-serif";
      ctx.fillText(String(node.mission.id), x, y + (boss ? 9 : 8) * (unlocked ? 1 : 0.8));
      ctx.restore();
    }

    const starY = y - R - (hull ? 10 : boss ? 22 : 6);
    if(unlocked){                                  // stars earned, on the rim
      ctx.font = "13px Rajdhani, Arial, sans-serif";
      for(let sIdx=0; sIdx<3; sIdx++){
        ctx.fillStyle = sIdx < earned ? "#ffd23f" : "rgba(255,255,255,0.22)";
        ctx.fillText("★", x + (sIdx-1)*15, starY);
      }
    }
    /*
     * A boss stop says BOSS. Red spikes read as "danger" only if you already
     * know the convention, and an eight-year-old doesn't - a label costs
     * nothing and removes the guess entirely.
     */
    if(boss && unlocked){
      ctx.save();
      const label = beaten ? "✓ DEFEATED" : "☠ BOSS", padX = 9, h = 19;
      ctx.font = "bold 12px Rajdhani, Arial, sans-serif";
      const w = ctx.measureText(label).width + padX*2;
      // Discs wear the strap as a hat; hulls are tall enough that a hat
      // lands on the name of the stop above, so theirs hangs below instead.
      const bx = x - w/2, by = hull ? y + R + 8 : y - R - 20;
      ctx.fillStyle = beaten ? "#166a45" : "#c2123a";
      ctx.beginPath();
      ctx.moveTo(bx + h/2, by);
      ctx.lineTo(bx + w - h/2, by);
      ctx.quadraticCurveTo(bx + w, by, bx + w, by + h/2);
      ctx.quadraticCurveTo(bx + w, by + h, bx + w - h/2, by + h);
      ctx.lineTo(bx + h/2, by + h);
      ctx.quadraticCurveTo(bx, by + h, bx, by + h/2);
      ctx.quadraticCurveTo(bx, by, bx + h/2, by);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = beaten ? "rgba(150,255,205,0.8)" : "rgba(255,180,190,0.85)";
      ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, by + h/2 + 1);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
    ctx.fillStyle = unlocked ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)";
    ctx.font = "bold " + (unlocked ? 13 : 11) + "px Rajdhani, Arial, sans-serif";
    // A locked boss keeps its name to itself - the silhouette is the tease.
    ctx.fillText(boss && !unlocked ? "? ? ? ? ?" : node.mission.name.toUpperCase(),
                 x, y + R + (hull && unlocked ? 44 : 20));

    // Whose flag flies here: the record holder's initial in their own ship
    // colour, pinned to the stop's rim. A brother's chip on YOUR mission is
    // the whole replay engine of a family game, and it belongs on the map,
    // not buried in a hint card.
    if(unlocked){
      const best = P.familyBest(node.mission.id);
      if(best && best.owner !== profile.name){
        const chipX = x + R*0.78, chipY = y + R*0.78;
        ctx.fillStyle = best.color || "#e74c3c";
        ctx.strokeStyle = "rgba(10,12,24,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(chipX, chipY, 10, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px Rajdhani, Arial, sans-serif";
        ctx.fillText((best.name[0] || "?").toUpperCase(), chipX, chipY + 4);
      }
    }
  });

  // Your actual ship, parked at the furthest stop you've reached - always on
  // the outside of the route, so it never sits on top of the line.
  const here = nodes[reached];
  const side = here.x > 0.5 ? 1 : -1;
  const bob = Math.sin(t*1.4)*3;
  SF.shipart.drawShip(ctx, px(here) + side*84, py(here) + 30 + bob, 52, {
    color: profile.shipColor, levels: SF.shipart.levelsOf(profile), t, tune: profile.tune,
    decal: profile.decal,
  });
  ctx.textAlign = "left";
}

/* ---------------------------------------------------------
   THE ARMORY / HANGAR/* ---------------------------------------------------------
   THE ARMORY / HANGAR
   One screen, because buying a part and seeing it appear are
   the same moment. The ship bay is pinned at the top while
   you shop; the shelves are tabbed so only one is ever on
   screen, which keeps the scroll short on a tablet.
   --------------------------------------------------------- */
const hangar = { raf:0, t:0, compare:false, ctx:null, celebrate:0 };
let armoryTab = "guns";

/** Tabs: the four shelves, then the parts ladder, then everything about you. */
function armoryTabs(){
  return CATEGORIES.map(c => ({ id:c.id, icon:c.icon, name:c.name, color:c.color }))
    .concat([{ id:"paint", icon:"🎨", name:"STYLE SHOP", color:"#ff4fd8" },
             { id:"parts", icon:"🔧", name:"MY SHIP", color:"#8fd3a7" },
             { id:"pilot", icon:"👤", name:"PILOT",   color:"#c9a7ff" }]);
}

function renderArmory(){
  const A = SF.shipart;
  const levels = A.levelsOf(profile);
  const next = A.nextPart(levels);

  $("armoryMoney").textContent = money(profile.money);
  if(next){
    const u = UPGRADE_BY_ID[next.up];
    const atNext = P.upgradeLevel(profile, u.id) === next.at - 1;
    const cost = atNext ? P.nextCost(profile, u) : null;
    $("hangarNext").innerHTML =
      `<span class="hn-label">NEXT PART TO FIT</span><b>${esc(next.name)}</b>
       <span class="hn-how">buy ${esc(u.name)} Lv ${next.at}${cost !== null ? " — " + money(cost) : ""} · tap to shop</span>`;
    $("hangarNext").onclick = () => { audio.play("uiClick"); armoryTab = u.cat; renderArmory(); };
    $("hangarNext").classList.add("tappable");
  } else {
    $("hangarNext").innerHTML =
      `<span class="hn-label">COMPLETE</span><b>Every part fitted.</b>
       <span class="hn-how">Nothing left to bolt on</span>`;
    $("hangarNext").onclick = null;
    $("hangarNext").classList.remove("tappable");
  }
  $("hangarCompareBtn").textContent = hangar.compare ? "MY SHIP" : "COMPARE";
  $("hangarCompareLabels").classList.toggle("hidden", !hangar.compare);
  renderShipSpecs();

  const tabs = $("armoryTabs");
  tabs.innerHTML = "";
  armoryTabs().forEach(t => {
    const el = document.createElement("button");
    el.className = "armory-tab" + (t.id === armoryTab ? " on" : "");
    el.style.setProperty("--cat", t.color);
    el.innerHTML = `<span class="at-ic">${t.icon}</span><span>${esc(t.name)}</span>`;
    click(el, () => { armoryTab = t.id; renderArmory(); });
    tabs.appendChild(el);
  });

  // Browsing tabs don't pin the ship bay: on STYLE SHOP and MY SHIP the
  // cards already show the ship, and a sticky bay turned scrolling into
  // peering through a letterbox.
  $("screen-armory").classList.toggle("unpinned", armoryTab === "paint" || armoryTab === "parts");

  const panel = $("armoryPanel");
  panel.innerHTML = "";
  if(armoryTab === "parts") renderPartsTab(panel, levels, next);
  else if(armoryTab === "pilot") renderPilotTab(panel);
  else if(armoryTab === "paint") renderPaintTab(panel);
  else renderShelf(panel, armoryTab);

  startHangarLoop();
}

/** One shelf of upgrades - only ever the tab you're looking at. */
function renderShelf(panel, catId){
  const cat = CATEGORIES.find(c => c.id === catId);
  const group = document.createElement("div");
  group.className = "shop-group";
  group.style.setProperty("--cat", cat.color);
  // When everything affordable pulses, nothing does. One beacon per shelf:
  // the cheapest thing you can buy right now.
  const shelf = UPGRADES.filter(u => u.cat === cat.id);
  const buyable = shelf.map(u => ({ u, cost: P.nextCost(profile, u) }))
    .filter(x => x.cost !== null && profile.money >= x.cost);
  const beacon = buyable.length ? buyable.reduce((a,b) => b.cost < a.cost ? b : a).u.id : null;
  shelf.forEach(u => {
    const lvl = P.upgradeLevel(profile, u.id);
    const cost = P.nextCost(profile, u);
    const maxed = cost === null;
    const affordable = !maxed && profile.money >= cost;
    // The part this level bolts on, so the shop says what you'll *see*.
    const part = SF.shipart.PARTS.find(pt => pt.up === u.id && pt.at === lvl+1);
    const row = document.createElement("div");
    row.className = "shop-item" + (maxed ? " maxed" : "") + (affordable ? " affordable" : "")
      + (u.id === beacon ? " beacon" : "");
    const pips = Array.from({length:u.max}, (_,i) => `<span class="pip${i < lvl ? " on" : ""}"></span>`).join("");
    row.innerHTML = `
      <div class="si-badge">${u.icon}</div>
      <div class="si-main">
        <div class="si-name">${esc(u.name)} <span class="si-lvl">${maxed ? "MAXED" : "Lv " + lvl + "/" + u.max}</span></div>
        <div class="si-pips">${pips}</div>
        <div class="si-desc">${esc(u.desc)}</div>
        <div class="si-effect">${lvl > 0 ? "Now: " + esc(u.effect(lvl)) : "Not owned yet"}${
          maxed ? "" : ' <span class="si-next">→ ' + esc(u.effect(lvl+1)) + "</span>"}</div>
        ${part ? `<div class="si-part">🔧 fits <b>${esc(part.name)}</b> to your ship</div>` : ""}
      </div>`;
    const btn = document.createElement("button");
    btn.innerHTML = maxed ? "★<br>MAX" : money(cost);
    btn.disabled = maxed || !affordable;
    click(btn, () => buyUpgrade(u.id));
    row.appendChild(btn);
    group.appendChild(row);
  });
  panel.appendChild(group);
}

/*
 * THE PAINT SHOP. The customer's one rule: "if kids spend money it needs to
 * be an obvious difference." So every card IS the difference - the pilot's
 * actual ship, all their bought parts, painted in the colour on offer - and
 * applying anything repaints the big hangar ship the same instant, because
 * the shop and the hangar share the screen. Nothing here is a stat.
 */
function renderPaintTab(panel){
  const wrap = document.createElement("div");
  wrap.className = "shop-group paint-shop";
  wrap.style.setProperty("--cat", "#ff4fd8");
  const levels = SF.shipart.levelsOf(profile);
  const owned = profile.cosmetics;

  const head = (txt) => {
    const h = document.createElement("label");
    h.className = "panel-label";
    h.textContent = txt;
    wrap.appendChild(h);
  };
  const grid = () => {
    const g = document.createElement("div");
    g.className = "paint-grid";
    wrap.appendChild(g);
    return g;
  };

  /*
   * The one livery money can't buy: the pilot's own drawing, made at the
   * easel. It leads the shop because "you made it" beats anything on the
   * shelves below - and because the easel is free, a brand-new pilot with
   * £0 still walks out of this tab with a ship that is theirs.
   */
  head("YOUR OWN PAINT — the one livery money can't buy");
  const og = grid();
  const mineWorn = SF.paintjob.isCustom(profile.decal);
  const mine = document.createElement("div");
  mine.className = "paint-card" + (mineWorn ? " on" : "");
  const mcv = document.createElement("canvas");
  mcv.width = 120; mcv.height = 84;
  mine.appendChild(mcv);
  const mc = mcv.getContext("2d");
  if(mc) SF.shipart.drawShip(mc, 60, 46, 66,
    { color: profile.shipColor, levels, t: 0.6, tune: profile.tune,
      decal: profile.paintjob || null });
  const mnm = document.createElement("div");
  mnm.className = "paint-name"; mnm.textContent = "MY OWN PAINT";
  mine.appendChild(mnm);
  const mds = document.createElement("div");
  mds.className = "paint-desc";
  mds.textContent = profile.paintjob
    ? "Painted by hand at the easel."
    : "Grab a brush and paint your hull yourself.";
  mine.appendChild(mds);
  if(profile.paintjob){
    const wearBtn = document.createElement("button");
    wearBtn.className = "small-btn";
    wearBtn.id = "ownPaintWear";
    wearBtn.textContent = mineWorn ? "WEARING IT" : "WEAR IT";
    wearBtn.disabled = mineWorn;
    click(wearBtn, () => {
      profile.decal = profile.paintjob;
      P.save(profile);
      hangar.celebrate = performance.now();
      renderArmory(); renderMenu();
    });
    mine.appendChild(wearBtn);
  }
  const drawBtn = document.createElement("button");
  drawBtn.className = "small-btn" + (profile.paintjob ? "" : " free-btn");
  drawBtn.id = "ownPaintDraw";
  drawBtn.textContent = profile.paintjob ? "BACK TO THE EASEL" : "FREE — DRAW IT";
  click(drawBtn, openPaintEditor);
  mine.appendChild(drawBtn);
  og.appendChild(mine);

  head("PAINT JOBS — your whole ship, everywhere, instantly");
  const pg = grid();
  /*
   * One shelf, one kind of card. The free squadron colours go in the SAME
   * grid as the paid paints - same ship, same size, same button - just
   * marked FREE. A colour is a colour; keeping the free ones in a separate
   * row of little dots made them read as a different, lesser thing.
   */
  const paintCard = (name, hex, cost, id) => {
    const free = cost == null;
    const has = free || owned.paints.includes(id);
    const on = profile.shipColor === hex;
    const card = document.createElement("div");
    card.className = "paint-card" + (on ? " on" : "");
    const cv = document.createElement("canvas");
    cv.width = 120; cv.height = 84;
    card.appendChild(cv);
    const c = cv.getContext("2d");
    if(c) SF.shipart.drawShip(c, 60, 46, 66,
      { color: hex, levels, t: 0.6, tune: profile.tune, decal: profile.decal });
    const nm = document.createElement("div");
    nm.className = "paint-name";
    nm.textContent = name;
    card.appendChild(nm);
    const btn = document.createElement("button");
    btn.className = "small-btn" + (free && !on ? " free-btn" : "");
    btn.textContent = on ? "WEARING IT" : has ? (free ? "FREE — WEAR IT" : "WEAR IT") : money(cost);
    btn.disabled = on || (!has && profile.money < cost);
    click(btn, () => {
      if(!has){
        profile.money -= cost;
        owned.paints.push(id);
        audio.play("uiBuy");
      } else audio.play("uiClick");
      profile.shipColor = hex;
      P.save(profile);
      // Purchase TIMESTAMP, not a deadline - the hangar loop derives its
      // flash from (now - celebrate), and a future stamp turns the radius
      // negative. Caught by the browser probe as a canvas arc error.
      hangar.celebrate = performance.now();
      renderArmory(); renderMenu();
    });
    card.appendChild(btn);
    pg.appendChild(card);
  };
  /*
   * Named in the same register as the paid paints (LASER LIME, DEEP AQUA...)
   * rather than "SQUADRON BLUE". Calling the free ones by a family name made
   * them read as a separate, lesser set even once they shared the grid - the
   * shelf is one list of colours, some of which happen to cost nothing.
   */
  const FREE_NAMES = ["SKY BLUE","CRIMSON","JADE","VIOLET","AMBER","ROSE"];
  SHIP_COLORS.forEach((hex, i) => paintCard(FREE_NAMES[i] || "CLASSIC", hex, null, null));
  PAINTS.forEach(pt => {
    if(pt.secret && !owned.paints.includes(pt.id)) return;   // the shop hides the secret
    paintCard(pt.name, pt.hex, pt.secret ? null : pt.cost, pt.id);
  });

  head("ENGINE TRAILS — burns behind you in every fight");
  const tg = grid();
  const noneCard = document.createElement("div");
  noneCard.className = "paint-card" + (!profile.trail ? " on" : "");
  noneCard.innerHTML = `<div class="trail-strip"></div><div class="paint-name">NO TRAIL</div>`;
  const noneBtn = document.createElement("button");
  noneBtn.className = "small-btn";
  noneBtn.textContent = !profile.trail ? "CLEAN" : "GO CLEAN";
  noneBtn.disabled = !profile.trail;
  click(noneBtn, () => { profile.trail = null; P.save(profile); audio.play("uiClick"); renderArmory(); });
  noneCard.appendChild(noneBtn);
  tg.appendChild(noneCard);

  TRAILS.forEach(tr => {
    const has = owned.trails.includes(tr.id);
    const on = profile.trail === tr.id;
    const card = document.createElement("div");
    card.className = "paint-card" + (on ? " on" : "");
    const strip = document.createElement("canvas");
    strip.width = 120; strip.height = 30;
    card.appendChild(strip);
    const c = strip.getContext("2d");
    if(c){
      for(let i = 0; i < 9; i++){
        const k = i/8;
        c.fillStyle = tr.id === "rainbow" ? "hsl(" + Math.floor(k*300) + ",95%,60%)" : tr.color;
        c.globalAlpha = 0.25 + k*0.75;
        c.beginPath();
        c.arc(12 + k*96, 15 + Math.sin(k*6)*4, 2 + k*3.4, 0, Math.PI*2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    const nm = document.createElement("div");
    nm.className = "paint-name";
    nm.textContent = tr.name;
    card.appendChild(nm);
    const ds = document.createElement("div");
    ds.className = "paint-desc";
    ds.textContent = tr.desc;
    card.appendChild(ds);
    const btn = document.createElement("button");
    btn.className = "small-btn";
    btn.textContent = on ? "BURNING" : has ? "LIGHT IT" : money(tr.cost);
    btn.disabled = on || (!has && profile.money < tr.cost);
    click(btn, () => {
      if(!has){
        profile.money -= tr.cost;
        owned.trails.push(tr.id);
        audio.play("uiBuy");
      } else audio.play("uiClick");
      profile.trail = tr.id;
      P.save(profile);
      renderArmory();
    });
    card.appendChild(btn);
    tg.appendChild(card);
  });

  head("PAINT PATTERNS — over the whole hull, impossible to miss");
  const dg = grid();
  SF.config.DECALS.forEach(dc => {
    const has = owned.decals.includes(dc.id);
    const on = profile.decal === dc.id;
    const card = document.createElement("div");
    card.className = "paint-card" + (on ? " on" : "");
    const cv = document.createElement("canvas");
    cv.width = 120; cv.height = 84;
    card.appendChild(cv);
    const c = cv.getContext("2d");
    if(c) SF.shipart.drawShip(c, 60, 46, 66,
      { color: profile.shipColor, levels, t: 0.6, tune: profile.tune, decal: dc.id });
    const nm = document.createElement("div");
    nm.className = "paint-name"; nm.textContent = dc.name;
    card.appendChild(nm);
    const ds = document.createElement("div");
    ds.className = "paint-desc"; ds.textContent = dc.desc;
    card.appendChild(ds);
    const btn = document.createElement("button");
    btn.className = "small-btn";
    btn.textContent = on ? "WEARING IT" : has ? "PAINT IT" : money(dc.cost);
    btn.disabled = on || (!has && profile.money < dc.cost);
    click(btn, () => {
      if(!has){ profile.money -= dc.cost; owned.decals.push(dc.id); audio.play("uiBuy"); }
      else audio.play("uiClick");
      profile.decal = dc.id;
      P.save(profile);
      hangar.celebrate = performance.now();
      renderArmory(); renderMenu();
    });
    card.appendChild(btn);
    dg.appendChild(card);
  });
  // Bare metal: nose art can always come off again.
  const plain = document.createElement("div");
  plain.className = "paint-card" + (!profile.decal ? " on" : "");
  plain.innerHTML = `<div class="trail-strip"></div><div class="paint-name">PLAIN HULL</div>`;
  const plainBtn = document.createElement("button");
  plainBtn.className = "small-btn";
  plainBtn.textContent = !profile.decal ? "WEARING IT" : "STRIP IT OFF";
  plainBtn.disabled = !profile.decal;
  click(plainBtn, () => { profile.decal = null; P.save(profile); audio.play("uiClick"); renderArmory(); });
  plain.appendChild(plainBtn);
  dg.appendChild(plain);

  head("VICTORY FIREWORKS — the sky claps in your colours");
  const fg = grid();
  SF.config.FIREWORKS.forEach(fw => {
    const has = fw.free || owned.fireworks.includes(fw.id);
    const on = (profile.fireworks || "classic") === fw.id;
    const card = document.createElement("div");
    card.className = "paint-card" + (on ? " on" : "");
    const cv = document.createElement("canvas");
    cv.width = 120; cv.height = 54;
    card.appendChild(cv);
    const c = cv.getContext("2d");
    if(c){
      // a little frozen firework in this show's palette
      fw.colors.forEach((col, i) => {
        const a = (i/fw.colors.length)*Math.PI*2;
        for(let k = 1; k <= 3; k++){
          c.fillStyle = col;
          c.globalAlpha = 1.1 - k*0.3;
          c.beginPath();
          c.arc(60 + Math.cos(a)*k*7.5, 27 + Math.sin(a)*k*6, 2.2, 0, Math.PI*2);
          c.fill();
        }
      });
      c.globalAlpha = 1;
    }
    const nm = document.createElement("div");
    nm.className = "paint-name"; nm.textContent = fw.name;
    card.appendChild(nm);
    const btn = document.createElement("button");
    btn.className = "small-btn";
    btn.textContent = on ? "YOUR SHOW" : has ? "USE IT" : money(fw.cost);
    btn.disabled = on || (!has && profile.money < fw.cost);
    click(btn, () => {
      if(!has){ profile.money -= fw.cost; owned.fireworks.push(fw.id); audio.play("uiBuy"); }
      else audio.play("uiClick");
      profile.fireworks = fw.id;
      P.save(profile);
      renderArmory();
    });
    card.appendChild(btn);
    fg.appendChild(card);
  });

  const note = document.createElement("p");
  note.className = "paint-note";
  note.textContent = "Trails show off best on the Test Range — try yours!";
  wrap.appendChild(note);
  panel.appendChild(wrap);
}

/* ---------------------------------------------------------
   THE EASEL
   A 12x12 finger-paint grid laid over the widest band of the
   pilot's own hull, zoomed right in so every cell is a fat
   touch target on a phone. The little preview in the corner
   shows the whole ship wearing the drawing as it grows. What
   comes out is worn exactly like a bought livery (paintjob.js
   for how it travels), so the drawing flies every mission.
   --------------------------------------------------------- */
const pe = { cells: null, color: 1, undo: [], down: false, wired: false };

function openPaintEditor(){
  const PJ = SF.paintjob;
  pe.cells = PJ.decode(profile.paintjob) || new Array(PJ.COLS*PJ.ROWS).fill(0);
  pe.undo = [];
  wireEasel();
  buildEaselPalette();
  $("paintEditor").classList.remove("hidden");
  drawEasel();
}
function closeEasel(){ $("paintEditor").classList.add("hidden"); }

function buildEaselPalette(){
  const host = $("pePalette");
  host.innerHTML = "";
  const swatch = (idx, label) => {
    const b = document.createElement("button");
    b.className = "pe-swatch" + (idx === pe.color ? " sel" : "") + (idx === 0 ? " eraser" : "");
    if(idx > 0) b.style.background = SF.paintjob.PALETTE[idx - 1];
    if(label) b.textContent = label;
    b.setAttribute("aria-label", idx === 0 ? "eraser" : "paint pot " + idx);
    click(b, () => { pe.color = idx; buildEaselPalette(); });
    host.appendChild(b);
  };
  SF.paintjob.PALETTE.forEach((_, i) => swatch(i + 1));
  swatch(0, "⌫");
}

/** Canvas pixel coords of a pointer event, robust to CSS scaling. */
function easelCell(ev){
  const cv = $("peCanvas");
  const r = cv.getBoundingClientRect();
  const sx = cv.width  / (r.width  || cv.width);
  const sy = cv.height / (r.height || cv.height);
  const x = (ev.clientX - r.left) * sx, y = (ev.clientY - r.top) * sy;
  const CELL = cv.width / SF.paintjob.COLS;
  return { c: Math.floor(x / CELL), row: Math.floor(y / CELL) };
}

function easelPaint(ev){
  const PJ = SF.paintjob;
  const { c, row } = easelCell(ev);
  if(!PJ.usable(c, row)) return;        // off the hull: the brush just misses
  const i = row*PJ.COLS + c;
  if(pe.cells[i] === pe.color) return;
  pe.cells[i] = pe.color;
  drawEasel();
}

function wireEasel(){
  if(pe.wired) return;
  pe.wired = true;
  const cv = $("peCanvas");
  // One undo step per STROKE, not per cell - a dragged squiggle comes off
  // with one tap, which is the level a seven-year-old thinks in.
  cv.addEventListener("pointerdown", ev => {
    if(ev.preventDefault) ev.preventDefault();
    pe.undo.push(pe.cells.slice());
    if(pe.undo.length > 40) pe.undo.shift();
    pe.down = true;
    if(cv.setPointerCapture && ev.pointerId != null){
      try { cv.setPointerCapture(ev.pointerId); } catch(e){}
    }
    easelPaint(ev);
  });
  cv.addEventListener("pointermove", ev => { if(pe.down) easelPaint(ev); });
  window.addEventListener("pointerup",     () => { pe.down = false; });
  window.addEventListener("pointercancel", () => { pe.down = false; });

  click($("peUndo"),  () => { if(pe.undo.length){ pe.cells = pe.undo.pop(); drawEasel(); } });
  click($("peClear"), () => {
    pe.undo.push(pe.cells.slice());
    pe.cells = new Array(SF.paintjob.COLS*SF.paintjob.ROWS).fill(0);
    drawEasel();
  });
  click($("peCancel"), closeEasel);
  click($("peDone"), () => {
    const str = SF.paintjob.encode(pe.cells);
    if(!str){ queueToast({ name: "Paint something first!", label: "EASEL" }); return; }
    profile.paintjob = str;
    profile.decal = str;                 // fresh art goes straight on the ship
    P.save(profile);
    audio.play("uiBuy");
    hangar.celebrate = performance.now();
    closeEasel();
    renderArmory(); renderMenu();
    queueToast({ name: "Your paint is on the ship!", label: "HANGAR" });
  });
}

function drawEasel(){
  const PJ = SF.paintjob;
  const cv = $("peCanvas");
  const ctx = cv && cv.getContext("2d");
  if(!ctx) return;
  const W = cv.width, H = cv.height, CELL = W/PJ.COLS;
  // The canvas frames exactly the paint band, so the hull-unit scale and the
  // hull origin both fall out of REGION.
  const S = W / PJ.REGION.w;
  const ox = W/2 - (PJ.REGION.x + PJ.REGION.w/2)*S;
  const oy = H/2 - (PJ.REGION.y + PJ.REGION.h/2)*S;

  ctx.clearRect(0, 0, W, H);
  // The pilot's real ship, zoomed to the band, held still under the grid.
  SF.shipart.drawShip(ctx, ox, oy, S, { color: profile.shipColor,
    levels: SF.shipart.levelsOf(profile), t: 0.35, idle: false, tune: profile.tune });
  // Dim what isn't paintable, so the easel reads ship-shaped.
  ctx.fillStyle = "rgba(4,8,18,0.62)";
  for(let r = 0; r < PJ.ROWS; r++)
    for(let c = 0; c < PJ.COLS; c++)
      if(!PJ.usable(c, r)) ctx.fillRect(c*CELL, r*CELL, CELL, CELL);
  // The paint so far - through the same clip it is worn with, so edge cells
  // look on the easel exactly as they will on the wing.
  const str = PJ.encode(pe.cells);
  if(str){ ctx.save(); ctx.translate(ox, oy); PJ.paint(ctx, S, str); ctx.restore(); }
  // Grid lines last, so they stay visible over the paint.
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  for(let i = 0; i <= PJ.COLS; i++){
    ctx.beginPath(); ctx.moveTo(i*CELL, 0); ctx.lineTo(i*CELL, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*CELL); ctx.lineTo(W, i*CELL); ctx.stroke();
  }
  // And the whole ship in the corner, wearing the work in progress.
  const pv = $("pePreview");
  const pc = pv && pv.getContext("2d");
  if(pc){
    pc.clearRect(0, 0, pv.width, pv.height);
    SF.shipart.drawShip(pc, pv.width/2, pv.height/2 + 4, 52,
      { color: profile.shipColor, levels: SF.shipart.levelsOf(profile),
        t: 0.35, idle: false, tune: profile.tune, decal: str || null });
  }
}

/** The parts ladder: what's on the ship and what's still missing. */
/*
 * MY SHIP = the tuning bay. (The 21-chip parts inventory that used to live
 * here was, per the customer, confusing and not that useful - the hangar's
 * "next part" line and the shelves already do that job.)
 *
 * Tunes are boss trophies: beat a campaign boss, win its tune. Each one
 * changes how the ship flies AND how it looks - the hangar above redraws the
 * moment a card is tapped, which is the whole explanation a kid needs.
 */
function tuneUnlocked(t){
  return !t.unlockMission ||
    !!((profile.missions && profile.missions[t.unlockMission] || {}).cleared);
}

function renderPartsTab(panel){
  const wrap = document.createElement("div");
  wrap.className = "tune-wrap";
  wrap.innerHTML = `<label class="panel-label">FLIGHT TUNING</label>
    <p class="tune-how">Beat a boss, win its tune. Fit ONE - it changes how your
    ship flies <b>and how it looks</b>. Swap any time, free.</p>`;
  const row = document.createElement("div");
  row.className = "tune-row two-col";
  SF.config.TUNES.forEach(t => {
    const open = tuneUnlocked(t);
    const on = (profile.tune || "vanguard") === t.id;
    const card = document.createElement("button");
    card.className = "tune-card" + (on ? " on" : "") + (open ? "" : " tlocked");
    const lines =
      t.pros.map(x => `<em class="good">▲ ${esc(x)}</em>`).join("") +
      t.cons.map(x => `<em class="bad">▼ ${esc(x)}</em>`).join("");
    // The card's icon is YOUR ship wearing this tune - the most honest
    // preview possible, and no pasted-on emoji.
    card.innerHTML = `<canvas class="tc-ship" width="96" height="96"></canvas><b>${esc(t.name)}</b>
      <span>${esc(t.blurb)}</span>${lines}
      <u>${on ? "FITTED ✓" : open ? "tap to fit"
            : "🔒 beat Mission " + t.unlockMission + "'s boss"}</u>`;
    const tc = card.querySelector(".tc-ship").getContext("2d");
    if(tc) SF.shipart.drawShip(tc, 48, 50, 72,
      { color: profile.shipColor, levels: SF.shipart.levelsOf(profile),
        t: 0.8, idle: false, tune: t.id });
    click(card, () => {
      if(!open){
        queueToast({ icon:"🔒", name:"Beat Mission " + t.unlockMission + "'s boss to win " + t.name,
                     label:"LOCKED" });
        return;
      }
      if(profile.tune === t.id) return;
      profile.tune = t.id;
      P.save(profile);
      renderArmory();      // hangar + spec bars redraw: the ship visibly changes
      queueToast({ name: t.name + " tune fitted", label:"HANGAR" });
    });
    row.appendChild(card);
  });
  wrap.appendChild(row);
  panel.appendChild(wrap);
}

/** Everything about the pilot rather than the ship. */
function renderPilotTab(panel){
  panel.appendChild($("pilotTabTpl").content.cloneNode(true));
  renderPortraitPanel();
  $("callsignInput").value = profile.callsign;
  click($("saveCallsignBtn"), () => {
    const v = $("callsignInput").value.trim();
    if(!v) return;
    profile.callsign = v;
    P.save(profile);
    renderArmory();
    renderMenu();
  });
  renderPilotCard();

  const badgeRow = $("badgeRow");
  BADGES.forEach(b => {
    const el = document.createElement("div");
    el.className = "badge-pick" + (b === P.badgeFor(profile) ? " selected" : "");
    click(el, () => { profile.badge = b; P.save(profile); renderArmory(); renderMenu(); });
    badgeRow.appendChild(el);
    SF.insignia.mount(el, b, profile.shipColor, 40);
  });
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
    if(!screens["screen-armory"].classList.contains("active")) return;
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
    A.drawShip(ctx, W*0.28, H*0.52, Math.min(W*0.30, H*0.62), {
      color: profile.shipColor, levels: {}, t: hangar.t });
    A.drawShip(ctx, W*0.72, H*0.52, Math.min(W*0.30, H*0.62), {
      color: profile.shipColor, levels, t: hangar.t, tune: profile.tune,
      decal: profile.decal });
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W/2, H*0.10); ctx.lineTo(W/2, H*0.90); ctx.stroke();
  } else {
    // Sized so the widest parts - the aegis halo and the drone cradle - still
    // sit inside the bay rather than being cropped by it.
    const S = Math.min(W*0.40, H*0.66);
    A.drawShip(ctx, W/2, H*0.50, S, {
      color: profile.shipColor, levels, t: hangar.t, tune: profile.tune,
      decal: profile.decal,
      ghost: next ? next.id : null,
      mateColor: (P.squadmates(profile.name)[0] || {}).shipColor,
    });
    // With an installed portrait, the pilot is visible at the controls.
    const bob = Math.sin(hangar.t*1.6)*S*0.018;
    SF.pilotart.paint(ctx, W/2, H*0.50 + bob - S*0.055, S*0.15, profile);

    // Part-fitted celebration: a white flash and a gold ring rolling off the
    // hull for a beat after a purchase bolts something new on.
    const since = (performance.now() - hangar.celebrate)/1000;
    if(hangar.celebrate && since < 0.9){
      const k = since/0.9;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (1-k)*0.5;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(W/2, H*0.50, S*0.55*(0.6+k*0.2), 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1-k;
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 4*(1-k) + 1;
      ctx.beginPath(); ctx.arc(W/2, H*0.50, S*(0.4 + k*0.55), 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
}

/*
 * MY PILOT: shows the installed portrait when there is one, and otherwise
 * says nothing at all. (Two generations of code-drawn faces were rejected on
 * sight - the slot stays empty until real art exists.)
 */
function renderPortraitPanel(){
  const host = $("avatarEditor");
  if(!host) return;
  if(!SF.pilotart.has(profile.name)){ host.classList.add("hidden"); return; }
  host.classList.remove("hidden");
  host.innerHTML = `<label class="panel-label">MY PILOT</label>
    <div class="ae-preview"><span class="ae-face"></span></div>`;
  SF.pilotart.mount(host.querySelector(".ae-face"), profile, 96);
}

/*
 * The bay's spec sheet: what all the bolted-on parts add up to, as four
 * labelled bars against the best ship this game can build. The bay used to be
 * pure decoration; this is what makes it the place you check whether a
 * purchase actually moved anything.
 */
function renderShipSpecs(){
  const el = $("hangarSpecs");
  if(!el || !profile) return;
  const diff = SF.config.DIFFICULTY_BY_ID.pilot;
  const now = SF.game.buildLoadout(profile, diff);
  const maxed = P.blank("__max");
  SF.config.UPGRADES.forEach(u => { maxed.upgrades[u.id] = u.max; });
  const top = SF.game.buildLoadout(maxed, diff);

  const rows = [
    { label:"FIREPOWER", value: Math.round(now.dps),        max: Math.round(top.dps),        show: Math.round(now.dps) + "/s" },
    { label:"FIRE RATE", value: 1/now.fireInterval,         max: 1/top.fireInterval,         show: (1/now.fireInterval).toFixed(1) + "/s" },
    { label:"SPEED",     value: now.speedMult,              max: top.speedMult,              show: "x" + now.speedMult.toFixed(2) },
    { label:"TOUGHNESS", value: now.lives + now.shieldMax,  max: top.lives + top.shieldMax,  show: now.lives + "\u2665 " + now.shieldMax + "\u26e8" },
  ];

  /*
   * Updated IN PLACE, never rebuilt: a rebuilt bar appears at its new width
   * with no motion, which is why buying an upgrade "didn't do anything".
   * Updating the same element lets the CSS width transition sweep, and a
   * changed row gets a bump so the eye lands on exactly what improved.
   */
  if(el.children.length !== rows.length){
    el.innerHTML = rows.map(r => `<div class="hs-row">
        <span class="hs-label">${r.label}</span>
        <div class="hs-bar"><i style="width:0%"></i></div>
        <span class="hs-value"></span>
      </div>`).join("");
  }
  rows.forEach((r, i) => {
    const rowEl = el.children[i];
    const bar = rowEl.querySelector(".hs-bar i");
    const val = rowEl.querySelector(".hs-value");
    const pct = Math.max(3, Math.round(Math.min(1, r.value/r.max) * 100)) + "%";
    const changed = val.textContent !== "" && val.textContent !== r.show;
    if(bar.style.width !== pct) requestAnimationFrame(() => { bar.style.width = pct; });
    val.textContent = r.show;
    if(changed){
      rowEl.classList.remove("bump");
      void rowEl.offsetWidth;               // restart the animation
      rowEl.classList.add("bump");
    }
  });
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
let briefTier = "pilot";

function openBriefing(index){
  selectedMissionIndex = index;
  const m = MISSIONS[index];
  const stars = P.totalStars(profile);

  // First look at a no-guns mission: the GUNS DOWN card explains WHY the
  // ship can't shoot before anyone launches confused.
  if(m.noGuns) maybeStory("silent");

  $("briefNum").textContent = "MISSION " + m.id;
  $("briefBoss").classList.toggle("hidden", !m.boss);
  $("briefTitle").textContent = m.name.toUpperCase();
  $("briefSubtitle").textContent = m.subtitle;

  /*
   * "What's out there": the actual enemy art for the archetypes this mission
   * uses, biggest threats first. It answers the only question that matters
   * before launching - what am I about to meet - and it reuses the sprites the
   * fleet is already drawn from, so it can never drift out of date.
   */
  const roster = $("briefRoster");
  roster.innerHTML = "";
  const seen = [];
  m.waves.forEach(w => { if(seen.indexOf(w.type) < 0) seen.push(w.type); });
  seen.sort((a, b) => (SF.enemyData.ENEMY_TYPES[b].hp || 0) - (SF.enemyData.ENEMY_TYPES[a].hp || 0));
  seen.slice(0, 6).forEach(typeId => {
    const t = SF.enemyData.ENEMY_TYPES[typeId];
    const chip = document.createElement("div");
    chip.className = "roster-chip";
    const cv = document.createElement("canvas");
    cv.width = cv.height = 54;
    chip.appendChild(cv);
    const label = document.createElement("span");
    label.textContent = t.name;
    chip.appendChild(label);
    roster.appendChild(chip);
    const sprite = SF.enemyArt.spriteFor(typeId, t.tint || "#c0392b", false);
    const c = cv.getContext("2d");
    if(c && sprite) c.drawImage(sprite, 0, 0, 54, 54);
    else if(c){ c.fillStyle = t.tint || "#c0392b"; c.beginPath(); c.arc(27,27,18,0,Math.PI*2); c.fill(); }
  });

  // Default to the hardest tier they've unlocked - that's the one they want.
  const unlocked = DIFFICULTIES.filter(d => stars >= d.unlockStars);
  briefTier = (unlocked[unlocked.length-1] || DIFFICULTIES[1]).id;
  renderBriefTiers(index);
  drawBriefHero(index);
  show("screen-briefing");
}

function renderBriefTiers(index){
  const m = MISSIONS[index];
  const stars = P.totalStars(profile);
  const list = $("briefDifficulties");
  list.innerHTML = "";
  DIFFICULTIES.forEach(d => {
    const locked = stars < d.unlockStars;
    const earned = (profile.missions[m.id] && profile.missions[m.id].stars[d.id]) || 0;
    const on = !locked && d.id === briefTier;
    const card = document.createElement("button");
    card.className = "diff-card" + (locked ? " locked" : "") + (on ? " on" : "");
    card.style.setProperty("--tier", d.color);
    card.innerHTML = `
      <span class="diff-name">${locked ? "🔒" : d.name}</span>
      <span class="diff-tag">${locked ? stars + "/" + d.unlockStars + " ★" : d.tag}</span>
      <span class="diff-stars">${locked ? "" :
        [0,1,2].map(i => `<i class="${i < earned ? "on" : ""}">★</i>`).join("")}</span>`;
    if(!locked) click(card, () => { briefTier = d.id; renderBriefTiers(index); });
    list.appendChild(card);
  });

  /*
   * Objectives light up for the tier you have selected, not "any tier ever".
   * A star is stored as a count rather than a set, and objectives are scored
   * in order, so the first N pips is the honest reading of it.
   */
  const earnedHere = (profile.missions[m.id] && profile.missions[m.id].stars[briefTier]) || 0;
  $("briefObjectives").innerHTML = m.objectives.map((id, i) => {
    const o = OBJECTIVES[id];
    return `<div class="bo-row">
              <span class="bo-text">${esc(o.label)}</span>
              <span class="bo-star${i < earnedHere ? " on" : ""}">★</span></div>`;
  }).join("");

  const d = DIFFICULTY_BY_ID[briefTier];
  $("briefDiffDetail").innerHTML =
    `<b style="color:${d.color}">${d.name}</b> — ${esc(d.blurb)}` +
    `<span>${Math.round(d.density*100)}% as many enemies · ${d.hpMult}x health · pays ${d.pay}x</span>`;
  $("launchBtn").style.background = `linear-gradient(135deg, ${d.color}, ${d.color}bb)`;
}

/** The mission's own sky behind its own ship - the level, before you fly it. */
function drawBriefHero(index){
  const cv = $("briefHero");
  const ctx = cv && cv.getContext("2d");
  if(!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const photo = SF.skygen.photoFor(index);
  const art = photo && SF.render.isReady() ? SF.render.assets[photo] : null;
  if(art){
    const iw = art.naturalWidth || 400, ih = art.naturalHeight || 500;
    const cover = Math.max(W/iw, H/ih);
    ctx.drawImage(art, (W - iw*cover)/2, (H - ih*cover)/2, iw*cover, ih*cover);
  } else {
    const sky = SF.skygen.build(index, W, Math.round(W*1.25));
    if(sky) ctx.drawImage(sky, 0, -(Math.round(W*1.25) - H)*0.45);
  }
  // The in-game skies are deliberately near-black so bullets read on them;
  // as a still, at this size, that just looks like an unloaded image. A soft
  // wash lifts it without touching the playfield version.
  const lift = ctx.createRadialGradient(W*0.74, H*0.5, 0, W*0.74, H*0.5, W*0.6);
  lift.addColorStop(0, "rgba(150,170,255,0.16)");
  lift.addColorStop(1, "rgba(150,170,255,0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, W, H);
  SF.shipart.drawShip(ctx, W*0.75, H*0.56, 128, {
    color: profile.shipColor, levels: SF.shipart.levelsOf(profile), t: 0.7, idle:false });
}

function dailyUnlocked(p){
  const rec = p && p.missions && p.missions[3];
  return !!(rec && rec.cleared);
}

// Boss missions, in campaign order - the rush queue mirrors these.
const RUSH_IDS = [4, 6, 8, 12, 14, 16, 18];
function rushUnlocked(p){
  const rec = p && p.missions && p.missions[4];
  return !!(rec && rec.cleared);
}

function launch(index, difficultyId){
  audio.init();
  show("screen-game");
  hideResults();
  SF.game.startMission(index, difficultyId);
  // Silent running hides the specials entirely - a greyed-out bomb button
  // reads as "broken", an absent one reads as "not this mission".
  document.querySelector(".ability-bar").classList
    .toggle("hidden", !!SF.game.run.mission.noGuns);
  syncAbilityButtons(true);
}

/* ---------------------------------------------------------
   ARMORY
   --------------------------------------------------------- */
function renderPilotCard(){
  if(!$("pcRankBadge")) return;     // only mounted while the PILOT tab is open
  const rank = P.rankFor(profile), next = P.nextRank(profile);
  const gear = P.gearLevel(profile);
  /*
   * The card used to lead with a plain circle filled with the pilot's ship
   * colour, with the insignia - also in their ship colour - pinned to its
   * corner: two elements carrying one fact, directly under a bay showing the
   * real ship at full size. The patch alone is the emblem now, at the size the
   * blob used to occupy.
   */
  SF.insignia.mount($("pcRankBadge"), P.badgeFor(profile), profile.shipColor, 62);
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
  if(rankNow.name !== rankBefore) queueToast({ icon: rankNow.badge, name: "PROMOTED: " + rankNow.name, label:"RANK UP" });

  // A purchase that changes the *shape* of the ship deserves to be seen, and
  // the twentieth level is the story's chapter break.
  const partsNow = SF.shipart.ownedCount(SF.shipart.levelsOf(profile));
  if(partsNow > partsBefore){
    const part = SF.shipart.PARTS.filter(pt => (P.upgradeLevel(profile, pt.up) >= pt.at))[partsNow-1];
    queueToast({ icon:"🔧", name: "FITTED: " + (part ? part.name : "NEW PART"), label:"HANGAR" });
    // And the bay celebrates: white flash + gold ring rolling off the hull.
    hangar.celebrate = performance.now();
  }
  if(P.gearLevel(profile) >= 20) maybeStory("ace");
  else if(partsNow > 0 && partsBefore === 0) maybeStory("firstPart");
}

/* ---------------------------------------------------------
   MEDALS + CHAMPIONSHIP
   --------------------------------------------------------- */
function renderAchievements(){
  const owned = profile.achievements;
  const stats = P.achievementStats(profile);
  const unclaimed = P.unclaimedMedals(profile);
  $("achievementsCount").innerHTML =
    `<b>${owned.length}</b> of ${ACHIEVEMENTS.length} medals` +
    (unclaimed.length
      ? ` · <b class="mh-owed">£${unclaimed.reduce((n,a)=>n+a.pay,0).toLocaleString("en-GB")}</b> to collect`
      : "");

  // Name the nearest thing still to win, so the screen is a to-do list rather
  // than a scoreboard of things that already happened.
  const next = ACHIEVEMENTS.find(a => !owned.includes(a.id));
  $("medalNext").innerHTML = next
    ? `<span>NEXT UP</span>${next.icon} ${esc(next.name)} — ${esc(next.desc)} · <b>£${next.pay.toLocaleString("en-GB")}</b>`
    : `<span>COMPLETE</span>Every medal earned. Nothing left to win.`;

  drawMedalRing(owned.length / ACHIEVEMENTS.length);

  // Every medal names its bounty. Earned-but-unclaimed ones carry a COLLECT
  // button - pressing it is the ceremony, and the reason to keep coming back.
  $("achievementsList").innerHTML = ACHIEVEMENTS.map(a => {
    const has = owned.includes(a.id);
    const claimed = !!profile.medalsClaimed[a.id];
    return `<div class="medal${has ? " won" : ""}${has && !claimed ? " owed" : ""}">
      <div class="medal-disc"><span>${has ? a.icon : "🔒"}</span></div>
      <div class="medal-name">${esc(a.name)}</div>
      <div class="medal-desc">${esc(a.desc)}</div>
      ${has
        ? (claimed
            ? `<div class="medal-pay done">£${a.pay.toLocaleString("en-GB")} collected</div>`
            : `<button class="medal-claim" data-medal="${a.id}">COLLECT £${a.pay.toLocaleString("en-GB")}</button>`)
        : `<div class="medal-pay">worth £${a.pay.toLocaleString("en-GB")}</div>`}
    </div>`;
  }).join("");

  qa("#achievementsList .medal-claim").forEach(btn => {
    click(btn, () => {
      const paid = P.claimMedal(profile, btn.dataset.medal);
      if(paid > 0){
        audio.play("buy");
        queueToast({ name: "+£" + paid.toLocaleString("en-GB") + " collected", label:"MEDAL PAID" });
        renderAchievements();
        renderMenu();
      }
    });
  });
}

/** A progress ring - the one number that says how far through you are. */
function drawMedalRing(frac){
  const cv = $("medalRing");
  const ctx = cv && cv.getContext("2d");
  if(!ctx) return;
  const W = cv.width, H = cv.height, cx = W/2, cy = H/2, r = W*0.38;
  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = W*0.11;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  if(frac > 0){
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#ffd23f");
    g.addColorStop(1, "#ff8a3d");
    ctx.strokeStyle = g;
    ctx.shadowColor = "rgba(255,210,63,0.7)"; ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + Math.PI*2*frac);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = "#fff";
  ctx.font = "bold " + Math.round(W*0.26) + "px Rajdhani, Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(Math.round(frac*100) + "%", cx, cy + 1);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

function renderLeaderboard(){
  const rows = P.listNames().map(P.load)
    .sort((a,b) => (P.totalStars(b) - P.totalStars(a)) || (b.highscore - a.highscore));

  /*
   * A podium, because with two or three pilots in a house a ranked list is
   * just two lines of text. Second place stands left, first in the middle and
   * taller, third right - the arrangement everyone already knows how to read.
   */
  // With three pilots the classic 2-1-3 arrangement reads instantly; with
  // two, that collapses to "winner on the right", which reads like a table
  // sorted wrong. Two pilots = winner first, and taller.
  const order = rows.length === 2 ? [0, 1] : [1, 0, 2].filter(i => i < rows.length);
  const podium = $("podium");
  podium.innerHTML = "";
  order.forEach(i => {
    const p = rows[i];
    const step = document.createElement("div");
    step.className = "podium-step place-" + (i+1);
    step.innerHTML = `
      <canvas width="96" height="96"></canvas>
      <div class="ps-badge"></div>
      <div class="ps-name">${esc(p.callsign || p.name)}</div>
      <div class="ps-rank" style="color:${P.rankFor(p).color}">${P.rankFor(p).name}</div>
      <div class="ps-block"><span class="ps-place">${i+1}</span>
        <span class="ps-stars">${P.totalStars(p)} ★</span></div>`;
    podium.appendChild(step);
    const c = step.querySelector("canvas").getContext("2d");
    if(c){
      if(SF.pilotart.has(p.name)){
        SF.shipart.drawShip(c, 48, 56, 74,
          { color: p.shipColor, levels: SF.shipart.levelsOf(p), t: 0.7, idle:false });
        SF.pilotart.paint(c, 48, 18, 34, p);
      } else {
        SF.shipart.drawShip(c, 48, 50, 84,
          { color: p.shipColor, levels: SF.shipart.levelsOf(p), t: 0.7, idle:false });
      }
    }
    SF.insignia.mount(step.querySelector(".ps-badge"), P.badgeFor(p), p.shipColor, 26);
  });

  // Everyone below the podium, if this household ever gets that big.
  $("leaderboardList").innerHTML = rows.slice(3).map((p,i) => {
    const rank = P.rankFor(p);
    return `<div class="lb-row">
      <span class="lb-rank">#${i+4}</span>
      <span class="lb-name">${esc(p.callsign || p.name)}<br>
        <span class="lb-sub" style="color:${rank.color}">${rank.name}</span></span>
      <span class="lb-score">${P.totalStars(p)} ★<br><span class="lb-sub">${p.highscore}</span></span>
    </div>`;
  }).join("");

  /*
   * Who holds each mission. This is the part that actually gets played for -
   * a single total tells you who is ahead, but a per-mission board tells you
   * exactly which one to go and take back.
   */
  // Only missions somebody has actually flown get a row - nine bright
  // "unflown" rows spent the attention colour announcing an absence. The
  // tail collapses into one quiet line.
  const flown = MISSIONS.filter(m => P.familyBest(m.id));
  const unflown = MISSIONS.length - flown.length;
  // The Daily Patrol crown sits on top of the record board - it's the one
  // record that resets its battleground every morning.
  const daily = P.listNames().map(P.load).filter(q => (q.endlessBest || 0) > 0)
    .sort((a,b) => b.endlessBest - a.endlessBest);
  const dailyRow = daily.length ? `<div class="rb-row rb-daily${daily[0].name === profile.name ? " mine" : ""}">
      <span class="rb-num">★</span>
      <span class="rb-name">Daily Patrol</span>
      <span class="rb-holder">${esc(daily[0].callsign || daily[0].name)}</span>
      <span class="rb-score">${daily[0].endlessBest.toLocaleString()}</span>
    </div>` : "";
  $("recordBoard").innerHTML = dailyRow + flown.map(m => {
    const best = P.familyBest(m.id);
    const mine = best.owner === profile.name;
    return `<div class="rb-row${mine ? " mine" : ""}">
      <span class="rb-num">${m.id}</span>
      <span class="rb-name">${esc(m.name)}</span>
      <span class="rb-holder">${esc(best.name)}</span>
      <span class="rb-score">${best.score.toLocaleString()}</span>
    </div>`;
  }).join("") + (unflown > 0
    ? `<div class="rb-row rb-rest">${unflown} more stop${unflown === 1 ? "" : "s"} nobody has flown yet</div>`
    : "");
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

/*
 * Turning the phone sideways mid-mission covers the game with TURN YOUR PHONE
 * (see .rotate-nag) - so the run has to stop, or a child watches their lives
 * drain away behind a screen telling them to rotate. CSS owns WHEN the nag
 * shows; this only asks whether it is currently up, which keeps the rule in
 * one place. It pauses and never un-pauses: coming back to a paused game and
 * choosing to resume is the safe direction.
 */
function pauseIfSideways(){
  const nag = $("rotateNag");
  if(!nag) return;
  /*
   * getComputedStyle, NOT offsetParent. The nag is position:fixed, and
   * offsetParent is null for a fixed element whether it is displayed or not -
   * so the obvious check reported "hidden" every single time and this never
   * fired once. It looked right, it ran clean, and it did nothing; the
   * browser probe caught it by rotating a live mission and finding the game
   * still merrily playing behind the overlay.
   */
  if(getComputedStyle(nag).display === "none") return;
  if(SF.game.state === "playing") togglePause();
}
window.addEventListener("resize", pauseIfSideways);
window.addEventListener("orientationchange", pauseIfSideways);

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
  const { completed, stars, run, objectives, unlocked, prevFamilyBest, prevSelfBest,
          endless, endlessNewBest, durationSec, rush, rushBeaten, rushTotal } = result;
  $("resultTitle").textContent = rush ? (completed ? "RUSH COMPLETE!" : "RUSH OVER")
    : endless ? "PATROL OVER"
    : completed ? "MISSION COMPLETE" : "SHIP DOWN";
  $("resultTitle").style.color = rush ? (completed ? "#4ade80" : "#ffd23f")
    : endless ? "#ffd23f"
    : completed ? "#4ade80" : "#ff9d5c";

  // Losing should read as "you nearly had it", not as a telling-off - and you
  // always keep the money you collected, so a failed run is never wasted.
  const sub = $("resultSubtitle");
  if(rush){
    sub.textContent = completed
      ? "ALL " + rushTotal + " bosses down, " + (profile.callsign || profile.name) + "!"
      : rushBeaten + " of " + rushTotal + " bosses down — go again?";
  } else if(endless){
    // A Daily Patrol run never fails - it just has a length and a score.
    const m = Math.floor((durationSec || 0)/60), s = ("0" + (durationSec || 0)%60).slice(-2);
    sub.textContent = endlessNewBest
      ? "NEW RECORD! " + run.score.toLocaleString("en-US") + " pts in " + m + ":" + s
      : run.score.toLocaleString("en-US") + " pts in " + m + ":" + s +
        " — your best is " + (profile.endlessBest || 0).toLocaleString("en-US");
  } else if(completed){
    failStreak = null;
    sub.textContent = stars === 3
      ? "Perfect flying, " + (profile.callsign || profile.name) + "!"
      : "Nice work, " + (profile.callsign || profile.name) + "!";
  } else {
    // Two losses in a row on the same flight earns a real tip instead of the
    // same "go again". Seven-year-olds don't think of turning the difficulty
    // down or shopping - the game has to say it out loud.
    const failKey = run.mission.id + ":" + run.difficulty.id;
    failStreak = failStreak && failStreak.key === failKey
      ? { key: failKey, n: failStreak.n + 1 } : { key: failKey, n: 1 };
    sub.textContent = failStreak.n >= 2
      ? (run.difficulty.id === "rookie"
          ? "This one's tough! Grab an upgrade in the ARMORY — even one level helps."
          : "This one's tough! Drop to ROOKIE, or buy an upgrade in the ARMORY first.")
      : "You got " + Math.round(run.progress*100) + "% of the way and kept every coin. Go again?";
  }

  // Advice a seven-year-old can act on is a BUTTON, not a sentence: after two
  // losses on a harder tier, the easier way down is one tap. The arcade modes
  // (daily, rush) run at a fixed tier, so they never offer it.
  $("rookieBtn").classList.toggle("hidden",
    !(!endless && !rush && !completed && failStreak && failStreak.n >= 2 && run.difficulty.id !== "rookie"));

  // Combat's over: a win keeps the calm menu theme the victory lap started;
  // a loss gets the ten-second defeat sting, which hands back to the menu.
  // A Daily Patrol ending is never a defeat, so it never gets the sting.
  audio.setMusic(completed || endless ? "menu" : "defeat");

  // Three stars rains confetti. Pride deserves paper.
  const oldConf = $("overlayResults").querySelector(".confetti");
  if(oldConf) oldConf.remove();
  if((completed && stars === 3) || (endless && endlessNewBest) || (rush && completed)){
    const conf = document.createElement("div");
    conf.className = "confetti";
    const colors = ["#ffd23f","#ff5d73","#4ade80","#3fc9ff","#c084fc","#ffffff"];
    for(let i=0;i<54;i++){
      const bit = document.createElement("i");
      bit.style.left = (Math.random()*100) + "%";
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = (Math.random()*1.6) + "s";
      bit.style.animationDuration = (2.2 + Math.random()*1.6) + "s";
      bit.style.transform = "rotate(" + Math.round(Math.random()*360) + "deg)";
      conf.appendChild(bit);
    }
    $("overlayResults").appendChild(conf);
    setTimeout(() => conf.remove(), 6000);
  }

  // Stars pop in one at a time - the small ceremony that makes replaying
  // worth it. The Daily Patrol has no stars: the score is the whole story.
  const starBox = $("resultStars");
  starBox.innerHTML = (endless || rush) ? "" : [0,1,2].map(i => `<span class="rs" data-i="${i}">★</span>`).join("");
  Array.from(starBox.children).forEach((el, i) => {
    if(i < stars){
      setTimeout(() => { el.classList.add("on"); audio.play("star", i); }, 380 + i*420);
    }
  });

  // Unmet objectives say how close you got - "87%" turns a shrug into
  // "SO close, going again".
  $("resultObjectives").innerHTML = objectives.map(o =>
    `<div class="ro-row ${o.met ? "met" : ""}"><span>${o.met ? "★" : "☆"}</span> ${esc(o.label)}` +
    (!o.met && o.progress ? ` <i class="ro-progress">${esc(o.progress)}</i>` : "") + `</div>`
  ).join("");

  const s = run.stats;
  $("resultLines").innerHTML = `
    <div class="rl"><span>Score</span><b>${run.score}</b></div>
    <div class="rl"><span>Money collected</span><b class="money">+£${run.money}</b></div>
    ${run.completionBonus ? `<div class="rl"><span>Mission bonus (${stars} ★)</span><b class="money">included</b></div>` : ""}
    <div class="rl"><span>Enemies destroyed</span><b>${(endless || rush) ? s.kills
      : s.kills + "/" + Math.max(s.spawned, run.director.totalPlanned)}</b></div>
    <div class="rl"><span>Pilots rescued</span><b>${(endless || rush) ? s.rescues
      : s.rescues + "/" + s.rescuesTotal}</b></div>
    <div class="rl"><span>Best combo</span><b>x${run.maxCombo}</b></div>
    ${crewLine()}
    <div class="rl"><span>Wallet</span><b class="money">${money(profile.money)}</b></div>
    ${(unlocked || []).map(a =>
      `<div class="rl record"><span>Medal earned</span><b>${a.icon} ${esc(a.name)} — collect £${(a.pay||0).toLocaleString("en-GB")} in MEDALS</b></div>`).join("")}
    ${endless ? dailyRecordLine() : rush ? rushRecordLine() : recordLine(run, prevFamilyBest)}`;

  renderResultComms(run, completed || (endless && endlessNewBest), stars, prevFamilyBest,
                    endless ? result.prevEndlessBest : prevSelfBest);

  const hasNext = completed && run.missionIndex + 1 < MISSIONS.length;
  $("nextBtn").classList.toggle("hidden", !hasNext);
  $("overlayResults").classList.remove("hidden");
  renderMenu();
  (unlocked || []).forEach(queueToast);
  // First time a campaign boss falls, its tune becomes yours - and the toast
  // says where to go fit it.
  if(result.firstClear && run.mission.boss){
    const wonTune = SF.config.TUNES.find(t => t.unlockMission === run.mission.id);
    if(wonTune) queueToast({ name: wonTune.name + " tune won! Fit it in MY SHIP",
      label:"TUNE UNLOCKED" });
  }
  if(result.vaultWon)
    queueToast({ icon:"🌟", name:"SOLAR GOLD — the star's own paint. Yours alone.",
      label:"SECRET FOUND" });
  if(completed && P.campaignComplete(profile)) maybeStory("campaign");
  // Clearing the Sentinel used to be the end of the game; now it's half time.
  else if(completed && run.missionIndex === ACT_ONE_END) maybeStory("actTwo");
}

/** Who has run the gauntlet deepest - shown after every Boss Rush. */
function rushRecordLine(){
  const rows = P.listNames().map(P.load).filter(q => (q.bossRushBest || 0) > 0)
    .sort((a,b) => b.bossRushBest - a.bossRushBest);
  if(!rows.length) return "";
  const top = rows[0];
  const mine = top.name === profile.name;
  return `<div class="rl record"><span>Rush record</span><b>${mine ? "YOURS" :
    esc(top.callsign || top.name)} — ${top.bossRushBest} boss${top.bossRushBest > 1 ? "es" : ""}</b></div>`;
}

/** Who holds the Daily Patrol crown right now - shown after every daily run. */
function dailyRecordLine(){
  const rows = P.listNames().map(P.load).filter(q => (q.endlessBest || 0) > 0)
    .sort((a,b) => b.endlessBest - a.endlessBest);
  if(!rows.length) return "";
  const top = rows[0];
  const mine = top.name === profile.name;
  return `<div class="rl record"><span>Daily crown</span><b>${mine ? "YOURS" :
    esc(top.callsign || top.name)} — ${top.endlessBest.toLocaleString("en-US")} pts</b></div>`;
}

/**
 * One spoken line on the results screen, with the speaker's real ship next to
 * it. The comms panel can't be seen once the overlay is up, and taking your
 * brother's record is exactly the moment that deserves a voice.
 */
function renderResultComms(run, completed, stars, prevFamilyBest, prevSelfBest){
  const box = $("resultComms");
  const mate = P.squadmates(profile.name)[0] || null;
  const me = profile.callsign || profile.name;

  /*
   * Celebrations must be earned: the old logic called any completed run a
   * "new record", including a score of zero on a mission nobody had flown -
   * and a seven-year-old knows when praise is fake. A record needs a previous
   * score to have actually beaten.
   */
  let event = null;
  const tookFamilyRecord = prevFamilyBest && prevFamilyBest.owner !== profile.name &&
                           run.score > prevFamilyBest.score && mate;
  const beatOwnBest = prevSelfBest > 0 && run.score > prevSelfBest;
  if(tookFamilyRecord) event = "recordTaken";
  else if(completed && stars === 3) event = "flawless";
  else if(completed && beatOwnBest) event = "personalBest";
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
  if(!SF.pilotart.paint(ctx, 36, 36, 64, who || profile)){
    SF.shipart.drawShip(ctx, 36, 38, 62, {
      color: who ? who.shipColor : profile.shipColor,
      levels: SF.shipart.levelsOf(who || profile), t: 0.6, idle: false });
  }
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
function recordLine(run, prevBest){
  const me = profile.callsign || profile.name;
  // "New best!" only when there was a real previous score to beat.
  if(prevBest && run.score > prevBest.score){
    return `<div class="rl record"><span>Family record</span><b>🏆 ${esc(me)} — new best!</b></div>`;
  }
  const best = prevBest || P.familyBest(run.mission.id);
  if(!best || best.score <= 0){
    return `<div class="rl"><span>Family record</span><b>none yet — set one!</b></div>`;
  }
  if(best.owner === profile.name){
    return `<div class="rl"><span>Family record</span><b>🏅 yours, ${best.score.toLocaleString()}</b></div>`;
  }
  return `<div class="rl"><span>${esc(best.name)} still holds this</span><b>${best.score.toLocaleString()}</b></div>`;
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
  // The toast serves more than medals now - a `label` names the occasion
  // (default keeps the medal ceremony), and non-medal toasts drop the trophy.
  $("at-label").textContent = a.label || "MEDAL UNLOCKED";
  // Only a real medal gets the trophy; other toasts carry no pasted-on icon.
  $("at-icon").textContent = a.label ? "" : "🏆";
  $("at-icon").classList.toggle("hidden", !!a.label);
  $("at-name").textContent = (a.icon ? a.icon + " " : "") + a.name;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.classList.add("hidden"); nextToast(); }, 250);
  }, 2300);
}

/* ---------------------------------------------------------
   WIRING
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   SQUAD SYNC
   The button only exists when an endpoint is configured, so
   an unconfigured build shows no dead controls.
   --------------------------------------------------------- */
function renderCloud(){
  const cloud = SF.cloud;
  $("cloudCode").textContent = cloud.code() || "----\u00a0----";
  $("cloudBlurb").textContent = cloud.isDefaultCode()
    ? "Every device in the house shares this squad automatically. Nothing to type in, nothing to write down."
    : "This device is on its own squad. Any device given this code shares its progress.";
  const list = cloud.backups();
  const btn = $("cloudRestoreBtn");
  btn.classList.toggle("hidden", !list.length);
  if(list.length) btn.textContent = "Restore backup (" + ago(list[0].at) + ")";
  paintCloudStatus(cloud.status);
}

/** "3 hours ago", for a backup list nobody wants to read timestamps in. */
function ago(at){
  const mins = Math.max(0, Math.round((Date.now() - at)/60000));
  if(mins < 60) return mins <= 1 ? "just now" : mins + " min ago";
  const hrs = Math.round(mins/60);
  if(hrs < 48) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
  return Math.round(hrs/24) + " days ago";
}
function paintCloudStatus(st){
  const el = $("cloudStatus");
  if(!el) return;
  const text = {
    off: "Not syncing yet - tap SYNC NOW to start",
    syncing: "Syncing\u2026",
    ok: "Up to date",
    error: "Couldn't reach the squad: " + (st.error || "unknown"),
  }[st.state] || "";
  el.textContent = text;
  el.className = "cloud-status" + (st.state === "ok" ? " ok" : st.state === "error" ? " error" : "");
}

if(SF.cloud && SF.cloud.configured()){
  $("setCloud").classList.remove("hidden");
  SF.cloud.onStatus(paintCloudStatus);
  // Squad Sync lives inside Settings now; opening it swaps overlays.
  click($("setCloud"), () => {
    $("settingsOverlay").classList.add("hidden");
    renderCloud();
    $("cloudOverlay").classList.remove("hidden");
  });
  click($("cloudCloseBtn"), () => { $("cloudOverlay").classList.add("hidden"); renderProfiles(); });
  click($("cloudSyncBtn"), () => {
    SF.cloud.ensureCode();
    renderCloud();
    SF.cloud.sync().then(() => { renderCloud(); renderProfiles(); });
  });
  click($("cloudCopyBtn"), () => {
    const c = SF.cloud.ensureCode();
    renderCloud();
    if(navigator.clipboard) navigator.clipboard.writeText(c).catch(() => {});
  });
  click($("cloudJoinBtn"), () => {
    const entered = prompt("Squad code from the other device?");
    if(!entered) return;
    SF.cloud.join(entered)
      .then(() => { renderCloud(); renderProfiles(); })
      .catch(err => { paintCloudStatus({ state:"error", error: String(err.message || err) }); });
  });
  click($("cloudRestoreBtn"), () => {
    const list = SF.cloud.backups();
    if(!list.length) return;
    const names = Object.keys(list[0].pilots).join(", ");
    if(!window.confirm("Put every pilot back to how they were " + ago(list[0].at) +
                       "?\n\n" + names + "\n\nWhat you have now is kept as a backup too.")) return;
    const n = SF.cloud.restoreBackup(0);
    renderCloud(); renderProfiles();
    paintCloudStatus({ state:"ok", error:null });
    if(n) queueToast({ name: n + " pilot" + (n === 1 ? "" : "s") + " restored", label:"SQUAD SYNC" });
  });
  SF.cloud.boot();
}

/* ---------------------------------------------------------
   SETTINGS
   One overlay for everything device-level: the sound switches
   (master / music / effects), screen shake, the Squad Sync
   entry point, and the only deliberately scary button in the
   game - resetting a pilot.
   --------------------------------------------------------- */
function renderSettings(){
  const pill = (id, on) => {
    const el = $(id).querySelector(".set-pill");
    el.textContent = on ? "ON" : "OFF";
    el.classList.toggle("off", !on);
  };
  pill("setSound", !audio.isMuted());
  pill("setMusicRow", audio.musicEnabled());
  pill("setSfx", audio.sfxEnabled());
  pill("setShake", SF.fx.shakeEnabled());
  /*
   * The row stays visible on a device that cannot rumble, greyed out with a
   * note under it. Hiding it was the first instinct and it was wrong: every
   * device this family owns is an iPhone or an iPad, so the feature simply
   * wasn't there and the report that came back was "the phone never shakes
   * even though the feature is enabled" - someone hunting for a switch that
   * had quietly removed itself. An explanation beats an absence.
   */
  const canRumble = SF.haptics.supported();
  const rumbleBtn = $("setRumble");
  rumbleBtn.disabled = !canRumble;
  pill("setRumble", canRumble && SF.haptics.isEnabled());
  rumbleBtn.querySelector(".set-pill").textContent =
    !canRumble ? "N/A" : (SF.haptics.isEnabled() ? "ON" : "OFF");
  $("rumbleNote").classList.toggle("hidden", canRumble);
  const resetBtn = $("setReset");
  resetBtn.classList.toggle("hidden", !profile);
  if(profile) resetBtn.querySelector("span").textContent = "Reset " + profile.name;
}
function openSettings(){
  renderSettings();
  $("settingsOverlay").classList.remove("hidden");
}
click($("settingsBtnPicker"), openSettings);
click($("settingsBtnMenu"), openSettings);
/*
 * THE BUILD STAMP. A shipped change was invisible on the device for two
 * rounds because the browser was serving cached JavaScript, and there was
 * no way to tell from the iPad what version was actually running. Now
 * there is - and tapping it wipes every cache and hard-reloads, which is
 * the fix a parent can apply without a laptop.
 */
const BUILD = "2026-08-07.3";
(function buildStamp(){
  const el = $("setBuild");
  if(!el) return;
  el.textContent = "build " + BUILD + " · tap to refresh";
  click(el, async () => {
    el.textContent = "refreshing…";
    try {
      if(window.caches) (await caches.keys()).forEach(k => caches.delete(k));
      if(navigator.serviceWorker){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch(e){ /* a refresh must never be blocked by cleanup failing */ }
    location.reload(true);
  });
})();

click($("settingsCloseBtn"), () => {
  $("settingsOverlay").classList.add("hidden");
  // The in-game mute button shows the same master switch - keep it honest.
  $("muteBtn").textContent = audio.isMuted() ? "🔇" : "♪";
});
click($("setSound"), () => { audio.setMuted(!audio.isMuted()); renderSettings(); });
click($("setMusicRow"), () => { audio.setMusicEnabled(!audio.musicEnabled()); renderSettings(); });
click($("setSfx"), () => { audio.setSfxEnabled(!audio.sfxEnabled()); renderSettings(); });
click($("setShake"), () => { SF.fx.setShakeEnabled(!SF.fx.shakeEnabled()); renderSettings(); });
click($("setRumble"), () => {
  if(!SF.haptics.supported()) return;
  SF.haptics.setEnabled(!SF.haptics.isEnabled());
  // Turning it on should be felt at once: the tap that switched it on happened
  // while it was still off, so nothing has buzzed yet.
  if(SF.haptics.isEnabled()) SF.haptics.play("uiBuy");
  renderSettings();
});
click($("setReset"), () => {
  if(!profile) return;
  const who = profile.name;
  if(!window.confirm("Start " + who + " over from ZERO?\n\nStars, money, upgrades and medals all go" +
                     " - on every synced device too. This cannot be undone.")) return;
  if(!window.confirm("Really erase " + who + "'s whole career?")) return;
  // A fresh blank saved now carries the newest savedAt, so the wipe wins the
  // per-pilot merge on every other device instead of being "repaired" by it.
  const fresh = P.blank(who);
  P.save(fresh);
  profile = fresh;
  SF.game.profile = fresh;
  $("settingsOverlay").classList.add("hidden");
  queueToast({ name: who + " starts over as a rookie", label:"PILOT RESET" });
  renderMenu();
  show("screen-menu");
});

click($("addProfileBtn"), () => {
  const name = prompt("Pilot's name?");
  if(name && name.trim()){ P.addName(name.trim()); renderProfiles(); }
});
click($("switchBtn"), () => { renderProfiles(); show("screen-profiles"); });
click($("playBtn"), () => { renderMissions(); show("screen-missions"); });

/*
 * THE STAR VAULT's front door. Five quick taps on the red giant at the top
 * of the campaign map - the sun painted into the sky, not a button, not a
 * node, no glow, no hint anywhere in the game. Deliberately undiscoverable
 * by accident: the customer hands the ritual out personally. Replayable on
 * request - "I want to be able to re-do the secret level, as many times as
 * I want" - so the door never locks. Only the SOLAR GOLD paint is a
 * one-time prize; the star rain, KING PAPA and his French goodbye happen
 * in full every single time.
 */
(function starVaultDoor(){
  const pad = $("campaignNodes");
  if(!pad) return;
  let taps = [];
  pad.addEventListener("pointerdown", ev => {
    if(!profile) return;
    const cv = $("campaignCanvas");
    if(!cv) return;
    const r = pad.getBoundingClientRect();
    const sx = r.width ? cv.width / r.width : 1;
    const sy = r.height ? cv.height / r.height : 1;
    const x = (ev.clientX - (r.left || 0)) * sx;
    const y = (ev.clientY - (r.top || 0)) * sy;
    // The sun lives at (0.12, 0.035) of the sky (see buildSky's redGiant).
    if(Math.hypot(x - cv.width*0.12, y - cv.height*0.035) > 72){
      taps.length = 0;                 // any stray tap resets the ritual
      return;
    }
    const now = performance.now();
    taps = taps.filter(t => now - t < 4000);
    taps.push(now);
    if(taps.length >= 5){
      taps.length = 0;
      audio.play("achievement");
      show("screen-game");
      SF.game.startMission("vault", "pilot");
    }
  });
})();
// The Daily Patrol launches straight in - no briefing, no tier choice. Same
// sky, same rules, PILOT difficulty for everyone: a fair fight over a score.
click($("dailyBtn"), () => {
  if(!dailyUnlocked(profile)){
    queueToast({ icon:"🔒", name:"Clear Mission 3 to open the Daily Patrol", label:"LOCKED" });
    return;
  }
  launch("daily", "pilot");
});
click($("rushBtn"), () => {
  if(!rushUnlocked(profile)){
    queueToast({ icon:"🔒", name:"Beat the Mission 4 boss to open the Rush", label:"LOCKED" });
    return;
  }
  launch("rush", "pilot");
});
click($("armoryBtn"), () => { renderArmory(); show("screen-armory"); });
click($("hangarCompareBtn"), () => { hangar.compare = !hangar.compare; renderArmory(); });
// The firing range: feel the ship you just built, ten seconds after buying it.
click($("testFlightBtn"), () => launch("test", "pilot"));
SF.game.onTestFlightEnd = (r) => {
  renderArmory();
  show("screen-armory");
  queueToast({ name:"Test complete — " + r.kills + " targets down", label:"TEST RANGE" });
};
click($("storyBtn"), () => $("storyOverlay").classList.add("hidden"));
click($("achievementsBtn"), () => { renderAchievements(); show("screen-achievements"); });
click($("leaderboardBtn"), () => { renderLeaderboard(); show("screen-leaderboard"); });
click($("missionsBackBtn"), () => show("screen-menu"));
click($("briefBackBtn"), () => { renderMissions(); show("screen-missions"); });
click($("launchBtn"), () => launch(selectedMissionIndex, briefTier));
click($("armoryBackBtn"), () => { renderMenu(); show("screen-menu"); });
click($("achievementsBackBtn"), () => show("screen-menu"));
click($("leaderboardBackBtn"), () => show("screen-menu"));
click($("pauseBtn"), togglePause);
click($("resumeBtn"), togglePause);

// Switching apps, locking the iPad, or changing tabs pauses the mission by
// itself - nobody should come back to a dead ship they never saw die.
document.addEventListener("visibilitychange", () => {
  if(document.hidden && SF.game.state === "playing") togglePause();
});
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
click($("rookieBtn"), () => launch(SF.game.run.missionIndex, "rookie"));
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

/*
 * The results screen waits for the tape. A death ends the mission on the
 * frame it happens - scores, saves and medals all run as they always did -
 * but the card only comes up once the rewind has shown them what hit them.
 * A win, or a death with too little tape to replay, goes straight through.
 */
SF.game.onMissionEnd = (result) => {
  if(SF.rewind && SF.rewind.active()) SF.rewind.onEnd(() => showResults(result));
  else showResults(result);
};

/* ---------------------------------------------------------
   BOOT
   --------------------------------------------------------- */
SF.game.attach($("game"), document.querySelector(".game-frame"), $("screen-game"));
$("muteBtn").textContent = audio.isMuted() ? "🔇" : "♪";
renderProfiles();
startTitleLoop();
SF.game.resize();
SF.game.start();
// The display font arrives async; one-shot canvases (title art, briefing
// hero) may have painted with the fallback before it landed. Repaint once.
if(document.fonts && document.fonts.ready){
  document.fonts.ready.then(() => {
    drawTitleArt("titleArt", null);
    if(profile) drawTitleArt("menuArt", profile);
  });
}

/*
 * Every ship drawn to a one-shot canvas before the sprite finished loading
 * keeps the flat vector fallback FOREVER, because nothing repaints it. That
 * is why the pilot picker showed coloured arrows: renderProfiles() runs at
 * boot, loadAssets lands a moment later, and only the title art was redrawn.
 * Repaint whatever is actually on screen instead of naming two canvases.
 */
function repaintArt(){
  if(screens["screen-profiles"].classList.contains("active")) renderProfiles();
  if(screens["screen-menu"].classList.contains("active")) renderMenu();
  if(screens["screen-armory"].classList.contains("active")) renderArmory();
  if(screens["screen-leaderboard"].classList.contains("active")) renderLeaderboard();
  if(screens["screen-briefing"].classList.contains("active") && selectedMissionIndex != null){
    openBriefing(selectedMissionIndex);
  }
  drawTitleArt("titleArt", null, titleT);
  if(profile) drawTitleArt("menuArt", profile, titleT);
}

SF.render.loadAssets(() => {
  document.body.classList.add("assets-ready");
  repaintArt();
});

// Offline support: after the first online visit, the whole game (music
// included) comes out of the cache - see sw.js for the update-safety rules.
if("serviceWorker" in navigator){
  try { navigator.serviceWorker.register("sw.js"); } catch(e){}
}

SF.ui = { show, togglePause, syncAbilityButtons, renderMissions, renderArmory, renderProfiles,
          queueToast, maybeStory, missionFace, openPaintEditor, renderSettings,
          showStory: id => showStory(SF.storyData.STORY[id]),
          getProfile: () => profile };
})();
