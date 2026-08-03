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
/** Prices run to six figures now, so they need separators to stay readable. */
function money(n){ return "$" + Math.round(n).toLocaleString("en-US"); }
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
      <div class="mp-stats">${stars} ★ collected · ${money(profile.money)}</div>
    </div>`;
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

/** Serpentine route from the bottom of the map to the top. */
function campaignLayout(){
  const n = MISSIONS.length;
  return MISSIONS.map((m, i) => {
    const k = i/(n-1);
    return {
      mission: m, index: i,
      // Period chosen so no two neighbours land on the same side: at 1.15 the
      // last two stops sat almost on top of each other.
      x: 0.5 + Math.sin(i*0.85 + 0.6) * 0.30,
      y: 0.90 - k*0.80,
    };
  });
}

/* Named stretches, so the route reads as a journey rather than eight dots. */
const SECTORS = [
  { at:0, name:"HOME PATROL" },
  { at:2, name:"THE BELT" },
  { at:4, name:"DEEP RUN" },
  { at:6, name:"ENEMY SPACE" },
];

function renderMissions(){
  const stars = P.totalStars(profile);
  $("missionStars").textContent = stars + " / " + (MISSIONS.length*3) + " ★ collected";

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

  // The hint line carries what the cards used to: what's next, and who holds it.
  let next = 0;
  for(let i=0;i<MISSIONS.length;i++) if(isMissionUnlocked(profile, i)) next = i;
  const m = MISSIONS[next];
  const best = P.familyBest(m.id);
  const me = profile.callsign || profile.name;
  $("campaignHint").innerHTML =
    `<b>${esc(m.name)}</b>` +
    `<span class="ch-sub">${esc(m.subtitle)}</span>` +
    `<span>${enemyCount(m)} enemies${rescueCount(m) ? " · " + rescueCount(m) + " to rescue" : ""}` +
    `${m.boss ? " · BOSS" : ""}</span>` +
    `<span class="ch-record">${best
      ? (best.name === me ? "🏅 You hold this one · " + best.score
                          : "🏅 " + esc(best.name) + " holds this · " + best.score)
      : "Nobody has flown this yet - claim it"}</span>`;

  startCampaignLoop();
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

  SECTORS.forEach(sec => {
    const n = nodes[sec.at];
    if(!n) return;
    ctx.save();
    ctx.globalAlpha = isMissionUnlocked(profile, sec.at) ? 0.5 : 0.22;
    ctx.fillStyle = "#cfd8ff";
    ctx.font = "bold 15px Arial, sans-serif";
    // Opposite side to the ship marker, and clear of the node itself.
    const away = n.x > 0.5 ? -1 : 1;
    ctx.textAlign = away < 0 ? "right" : "left";
    ctx.letterSpacing = "3px";
    ctx.fillText(sec.name, px(n) + away*74, py(n) - 2);
    ctx.restore();
  });

  nodes.forEach((node, i) => {
    const unlocked = isMissionUnlocked(profile, i);
    const earned = P.starsForMission(profile, node.mission.id);
    const boss = !!node.mission.boss;
    const x = px(node), y = py(node);
    const R = boss ? 40 : 32;
    const isNext = i === reached;

    if(boss){
      ctx.save();
      ctx.globalAlpha = unlocked ? 1 : 0.35;
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
    if(isNext){                                   // the one you're here to fly
      const pulse = 0.5 + Math.sin(t*3)*0.5;
      ctx.strokeStyle = "rgba(255,210,63," + (0.25 + pulse*0.5) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, R + 12 + pulse*7, 0, Math.PI*2); ctx.stroke();
    }

    const g = ctx.createRadialGradient(x-R*0.3, y-R*0.4, R*0.15, x, y, R);
    if(unlocked){ g.addColorStop(0, boss ? "#ff7a90" : "#5b6bd8"); g.addColorStop(1, boss ? "#7a1226" : "#1d2050"); }
    else { g.addColorStop(0, "#3a3f57"); g.addColorStop(1, "#191c2c"); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = earned === 3 ? "#ffd23f"
                    : unlocked ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.15)";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = unlocked ? "#fff" : "rgba(255,255,255,0.35)";
    ctx.font = "bold " + (boss ? 26 : 22) + "px Arial, sans-serif";
    ctx.fillText(unlocked ? String(node.mission.id) : "🔒", x, y + (boss ? 9 : 8));

    const starY = y - R - (boss ? 22 : 6);
    if(unlocked){                                  // stars earned, on the rim
      ctx.font = "13px Arial, sans-serif";
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
    if(boss){
      ctx.save();
      ctx.globalAlpha = unlocked ? 1 : 0.45;
      const label = "☠ BOSS", padX = 9, h = 19;
      ctx.font = "bold 12px Arial, sans-serif";
      const w = ctx.measureText(label).width + padX*2;
      const bx = x - w/2, by = y - R - 20;
      ctx.fillStyle = "#c2123a";
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
      ctx.strokeStyle = "rgba(255,180,190,0.85)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, by + h/2 + 1);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
    ctx.fillStyle = unlocked ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.fillText(node.mission.name.toUpperCase(), x, y + R + 20);
  });

  // Your actual ship, parked at the furthest stop you've reached - always on
  // the outside of the route, so it never sits on top of the line.
  const here = nodes[reached];
  const side = here.x > 0.5 ? 1 : -1;
  SF.shipart.drawShip(ctx, px(here) + side*62, py(here) - 4, 52, {
    color: profile.shipColor, levels: SF.shipart.levelsOf(profile), t,
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
const hangar = { raf:0, t:0, compare:false, ctx:null };
let armoryTab = "guns";

/** Tabs: the four shelves, then the parts ladder, then everything about you. */
function armoryTabs(){
  return CATEGORIES.map(c => ({ id:c.id, icon:c.icon, name:c.name, color:c.color }))
    .concat([{ id:"parts", icon:"🔧", name:"MY SHIP", color:"#8fd3a7" },
             { id:"pilot", icon:"👤", name:"PILOT",   color:"#c9a7ff" }]);
}

function renderArmory(){
  const A = SF.shipart;
  const levels = A.levelsOf(profile);
  const next = A.nextPart(levels);

  $("armoryMoney").textContent = money(profile.money);
  $("hangarNext").innerHTML = next
    ? `<span class="hn-label">NEXT PART</span><b>${esc(next.name)}</b>
       <span class="hn-how">${esc(UPGRADE_BY_ID[next.up].name)} lv${next.at}</span>`
    : `<span class="hn-label">COMPLETE</span><b>Every part fitted.</b>
       <span class="hn-how">Nothing left to bolt on</span>`;
  $("hangarCompareBtn").textContent = hangar.compare ? "MY SHIP" : "COMPARE";
  $("hangarCompareLabels").classList.toggle("hidden", !hangar.compare);

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

  const panel = $("armoryPanel");
  panel.innerHTML = "";
  if(armoryTab === "parts") renderPartsTab(panel, levels, next);
  else if(armoryTab === "pilot") renderPilotTab(panel);
  else renderShelf(panel, armoryTab);

  startHangarLoop();
}

/** One shelf of upgrades - only ever the tab you're looking at. */
function renderShelf(panel, catId){
  const cat = CATEGORIES.find(c => c.id === catId);
  const group = document.createElement("div");
  group.className = "shop-group";
  group.style.setProperty("--cat", cat.color);
  UPGRADES.filter(u => u.cat === cat.id).forEach(u => {
    const lvl = P.upgradeLevel(profile, u.id);
    const cost = P.nextCost(profile, u);
    const maxed = cost === null;
    const affordable = !maxed && profile.money >= cost;
    // The part this level bolts on, so the shop says what you'll *see*.
    const part = SF.shipart.PARTS.find(pt => pt.up === u.id && pt.at === lvl+1);
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

/** The parts ladder: what's on the ship and what's still missing. */
function renderPartsTab(panel, levels, next){
  const A = SF.shipart;
  const head = document.createElement("div");
  head.className = "parts-head";
  head.textContent = A.ownedCount(levels) + " of " + A.PARTS.length + " parts fitted";
  panel.appendChild(head);
  const grid = document.createElement("div");
  grid.className = "hangar-parts";
  A.partList(levels).forEach(({ part, owned:has }) => {
    const chip = document.createElement("div");
    chip.className = "part-chip" + (has ? " owned" : "") + (next && part.id === next.id ? " next" : "");
    chip.innerHTML = `<b>${esc(part.name)}</b><span>${has ? esc(part.blurb)
      : esc(UPGRADE_BY_ID[part.up].name) + " lv" + part.at}</span>`;
    grid.appendChild(chip);
  });
  panel.appendChild(grid);
}

/** Everything about the pilot rather than the ship. */
function renderPilotTab(panel){
  panel.appendChild($("pilotTabTpl").content.cloneNode(true));
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

  const colorRow = $("colorRow");
  SHIP_COLORS.forEach(hex => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (hex === profile.shipColor ? " selected" : "");
    sw.style.background = hex;
    click(sw, () => { profile.shipColor = hex; P.save(profile); renderArmory(); renderMenu(); });
    colorRow.appendChild(sw);
  });

  const badgeRow = $("badgeRow");
  BADGES.forEach(b => {
    const el = document.createElement("div");
    el.className = "badge-pick" + (b === P.badgeFor(profile) ? " selected" : "");
    el.textContent = b;
    click(el, () => { profile.badge = b; P.save(profile); renderArmory(); renderMenu(); });
    badgeRow.appendChild(el);
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
      color: profile.shipColor, levels, t: hangar.t });
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W/2, H*0.10); ctx.lineTo(W/2, H*0.90); ctx.stroke();
  } else {
    // Sized so the widest parts - the aegis halo and the drone cradle - still
    // sit inside the bay rather than being cropped by it.
    A.drawShip(ctx, W/2, H*0.50, Math.min(W*0.40, H*0.66), {
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
let briefTier = "pilot";

function openBriefing(index){
  selectedMissionIndex = index;
  const m = MISSIONS[index];
  const stars = P.totalStars(profile);

  $("briefNum").textContent = "MISSION " + m.id;
  $("briefBoss").classList.toggle("hidden", !m.boss);
  $("briefTitle").textContent = m.name.toUpperCase();
  $("briefSubtitle").textContent = m.subtitle;
  $("briefText").textContent = m.brief;

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
      <span class="diff-tag">${locked ? d.unlockStars + " ★" : d.tag}</span>
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
    return `<div class="bo-row"><span class="bo-icon">${o.icon}</span>
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
function renderPilotCard(){
  if(!$("pcShip")) return;          // only mounted while the PILOT tab is open
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
  const stats = P.achievementStats(profile);
  $("achievementsCount").innerHTML =
    `<b>${owned.length}</b> of ${ACHIEVEMENTS.length} medals`;

  // Name the nearest thing still to win, so the screen is a to-do list rather
  // than a scoreboard of things that already happened.
  const next = ACHIEVEMENTS.find(a => !owned.includes(a.id));
  $("medalNext").innerHTML = next
    ? `<span>NEXT UP</span>${next.icon} ${esc(next.name)} — ${esc(next.desc)}`
    : `<span>COMPLETE</span>Every medal earned. Nothing left to win.`;

  drawMedalRing(owned.length / ACHIEVEMENTS.length);

  $("achievementsList").innerHTML = ACHIEVEMENTS.map(a => {
    const has = owned.includes(a.id);
    return `<div class="medal${has ? " won" : ""}">
      <div class="medal-disc"><span>${has ? a.icon : "🔒"}</span></div>
      <div class="medal-name">${esc(a.name)}</div>
      <div class="medal-desc">${esc(a.desc)}</div>
    </div>`;
  }).join("");
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
  ctx.font = "bold " + Math.round(W*0.26) + "px Arial, sans-serif";
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
  const order = [1, 0, 2].filter(i => i < rows.length);
  const podium = $("podium");
  podium.innerHTML = "";
  order.forEach(i => {
    const p = rows[i];
    const step = document.createElement("div");
    step.className = "podium-step place-" + (i+1);
    step.innerHTML = `
      <canvas width="96" height="96"></canvas>
      <div class="ps-badge">${P.badgeFor(p)}</div>
      <div class="ps-name">${esc(p.callsign || p.name)}</div>
      <div class="ps-rank" style="color:${P.rankFor(p).color}">${P.rankFor(p).name}</div>
      <div class="ps-block"><span class="ps-place">${i+1}</span>
        <span class="ps-stars">${P.totalStars(p)} ★</span></div>`;
    podium.appendChild(step);
    const c = step.querySelector("canvas").getContext("2d");
    if(c) SF.shipart.drawShip(c, 48, 50, 84,
      { color: p.shipColor, levels: SF.shipart.levelsOf(p), t: 0.7, idle:false });
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
  $("recordBoard").innerHTML = MISSIONS.map(m => {
    const best = P.familyBest(m.id);
    const mine = best && best.name === (profile.callsign || profile.name);
    return `<div class="rb-row${mine ? " mine" : ""}">
      <span class="rb-num">${m.id}</span>
      <span class="rb-name">${esc(m.name)}</span>
      <span class="rb-holder">${best ? esc(best.name) : "—"}</span>
      <span class="rb-score">${best ? best.score : "unflown"}</span>
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
    <div class="rl"><span>Wallet</span><b class="money">${money(profile.money)}</b></div>
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
click($("hangarCompareBtn"), () => { hangar.compare = !hangar.compare; renderArmory(); });
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
          queueToast, maybeStory,
          showStory: id => showStory(SF.storyData.STORY[id]),
          getProfile: () => profile };
})();
