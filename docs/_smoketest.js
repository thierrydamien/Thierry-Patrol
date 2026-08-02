/*
 * jsdom smoke test.
 *
 * Loads the real sources in the same order index.html does, drives real
 * missions with a bot, and asserts on gameplay outcomes rather than just menu
 * wiring. jsdom has no canvas rendering (that needs native deps), so the 2D
 * context is stubbed - this catches logic/DOM/state bugs, and the visual side
 * is checked separately with Chromium screenshots.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const dom = new JSDOM(html, { url:"http://localhost/", runScripts:"dangerously", resources:"usable", pretendToBeVisual:true });
const { window } = dom;

// --- canvas stub -----------------------------------------------------------
// A plain object, not a Proxy: this is called thousands of times per frame and
// a trap-per-property-access made the simulated missions crawl.
window.HTMLCanvasElement.prototype.getContext = function(){
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const ctx = {
    canvas: { width:1, height:1 },
    getImageData: (x,y,w,h) => ({ width:w, height:h, data:new Uint8ClampedArray(w*h*4) }),
    putImageData: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  ["save","restore","translate","rotate","scale","setTransform","resetTransform","clearRect","fillRect",
   "strokeRect","beginPath","closePath","moveTo","lineTo","arc","ellipse","fill","stroke","drawImage",
   "fillText","strokeText","clip","quadraticCurveTo","bezierCurveTo","rect","setLineDash","createPattern",
  ].forEach(m => ctx[m] = noop);
  return ctx;
};

// --- clock / frame driver --------------------------------------------------
// Every rAF callback is queued and drained, not just the last one registered:
// the UI schedules one-shot rAFs of its own (toast animations), and tracking a
// single "last callback" silently dropped the game loop when one landed.
let frames = 0, fakeNow = 0;
let pendingFrames = [];
const errors = [];
window.performance.now = () => fakeNow;
window.requestAnimationFrame = (cb) => { pendingFrames.push(cb); return pendingFrames.length; };

/**
 * A crude pilot: sweeps across the screen and drifts up and down. Events are
 * only dispatched when the intended direction changes - synthesising four
 * jsdom KeyboardEvents every frame was the single slowest thing in this test.
 */
let botX = 0, botY = 0;
function botInput(){
  const key = (type, k) => window.dispatchEvent(new window.KeyboardEvent(type, { key: k }));
  const t = fakeNow/1000;
  const wantX = Math.sin(t*0.9) > 0 ? -1 : 1;
  const wantY = Math.cos(t*0.35) > 0 ? -1 : 1;
  if(wantX !== botX){
    botX = wantX;
    if(wantX < 0){ key("keydown","ArrowLeft"); key("keyup","ArrowRight"); }
    else { key("keydown","ArrowRight"); key("keyup","ArrowLeft"); }
  }
  if(wantY !== botY){
    botY = wantY;
    if(wantY < 0){ key("keydown","w"); key("keyup","s"); }
    else { key("keydown","s"); key("keyup","w"); }
  }
}

async function runFrames(n){
  for(let i = 0; i < n; i++){
    frames++;
    fakeNow += 16.7;
    botInput();
    const batch = pendingFrames;
    pendingFrames = [];
    for(let k = 0; k < batch.length; k++){
      try { batch[k](fakeNow); } catch(e){ errors.push(e); }
    }
    if(i % 30 === 0) await sleep(0); // let timers/promises (toasts, staged FX) run
  }
  await sleep(40);
}

window.alert = () => {};
window.prompt = () => "TestKid";
class StubImage {
  set src(v){ this._src = v; setTimeout(() => { if(this.onload) this.onload(); }, 0); }
  get src(){ return this._src; }
}
window.Image = StubImage;
window.addEventListener("error", e => errors.push(e.error || e.message));
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable:true, get(){ return 390; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable:true, get(){ return 620; } });
const gcs = window.getComputedStyle;
window.getComputedStyle = el => {
  const s = gcs(el);
  if(!s.paddingLeft) Object.defineProperty(s, "paddingLeft", { value:"0px" });
  return s;
};

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

const SRC = [
  "src/core.js","src/audio.js","src/data/config.js","src/data/enemies.js","src/data/missions.js",
  "src/profile.js","src/fx.js","src/input.js","src/entities.js","src/bosses.js","src/systems.js",
  "src/render.js","src/game.js","src/ui.js",
];

const results = [];
function check(label, cond){ results.push([label, !!cond]); }
function clickEl(el){ el.dispatchEvent(new window.MouseEvent("click", { bubbles:true })); }
function q(sel){ return window.document.querySelector(sel); }
function qa(sel){ return Array.from(window.document.querySelectorAll(sel)); }
function id(x){ return window.document.getElementById(x); }

async function run(){
  const doc = window.document;
  SRC.forEach(file => {
    const s = doc.createElement("script");
    s.textContent = fs.readFileSync(path.join(__dirname, file), "utf8");
    doc.body.appendChild(s);
  });
  const SF = window.SF;

  /* ---------- data sanity ---------- */
  check("all 14 upgrades defined", SF.config.UPGRADES.length === 14);
  check("upgrade catalogue totals 53 levels", SF.config.MAX_UPGRADE_LEVELS === 53);
  check("8 campaign missions defined", SF.missions.MISSIONS.length === 8);
  check("every mission has waves and objectives",
    SF.missions.MISSIONS.every(m => m.waves.length > 0 && m.objectives.length === 3));
  check("every wave references a real enemy type",
    SF.missions.MISSIONS.every(m => m.waves.every(w => !!SF.enemyData.ENEMY_TYPES[w.type])));
  check("every enemy type has a real behaviour",
    Object.values(SF.enemyData.ENEMY_TYPES).every(t => typeof SF.enemyData.BEHAVIOURS[t.behaviour] === "function"));
  check("bosses declare phases in descending health order",
    Object.values(SF.missions.BOSSES).every(b =>
      b.phases.every((p,i) => i === 0 || p.at < b.phases[i-1].at)));
  check("playfield is tuned-range wide and 800 tall",
    SF.entityConst.VH === 800 && SF.entityConst.VW >= 440 && SF.entityConst.VW <= 640);
  check("nothing spawns outside the playfield",
    SF.missions.MISSIONS.every(m => m.waves.every(wv => {
      const slots = SF.enemyData.FORMATIONS[wv.form](wv.n, SF.entityConst.VW);
      return slots.every(sl => sl.x >= 0 && sl.x <= SF.entityConst.VW);
    })));
  check("every wave references a real formation",
    SF.missions.MISSIONS.every(m => m.waves.every(wv => typeof SF.enemyData.FORMATIONS[wv.form] === "function")));
  check("every boss weak point disables a real attack",
    Object.values(SF.missions.BOSSES).every(b =>
      b.weakPoints.every(wp => !wp.disables || !!SF.bosses.ATTACKS[wp.disables])));

  /* ---------- pilot picker + menu ---------- */
  check("pilot grid lists Marc & Charles", qa("#profileGrid .profile-card").length === 2);
  clickEl(qa("#profileGrid .profile-card")[0]);
  check("menu active after picking a pilot", id("screen-menu").classList.contains("active"));
  check("menu shows the pilot's rank", /CADET|PILOT|LEADER|ACE|COMMANDER|LEGEND/.test(id("menuPilot").textContent));

  /* ---------- armory ---------- */
  clickEl(id("armoryBtn"));
  check("armory lists every upgrade", qa("#shopItems .shop-item").length === 14);
  check("armory groups upgrades into 4 shelves", qa("#shopItems .shop-group").length === 4);
  check("pilot card shows gear progress", /Gear 0\/53/.test(id("pcGear").textContent));

  const rich = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc") || "{}");
  rich.name = "Marc"; rich.money = 200000; rich.upgrades = {};
  window.localStorage.setItem("skyforce_profile_Marc", JSON.stringify(rich));
  clickEl(id("armoryBackBtn"));
  clickEl(id("switchBtn"));
  clickEl(qa("#profileGrid .profile-card")[0]);
  clickEl(id("armoryBtn"));

  const buyBtn = i => qa("#shopItems .shop-item")[i].querySelector("button");
  const priceBefore = buyBtn(0).textContent;
  clickEl(buyBtn(0));
  check("buying a level raises the next price", buyBtn(0).textContent !== priceBefore);
  check("gear level tracks purchases", /Gear 1\/53/.test(id("pcGear").textContent));
  for(let n=0;n<8;n++) clickEl(buyBtn(0));
  check("upgrade level caps at its max", JSON.parse(window.localStorage.getItem("skyforce_profile_Marc")).upgrades.spread === 5);
  check("maxed upgrade reads MAX", buyBtn(0).textContent.includes("MAX"));

  // Buy everything: exercises drones, piercing, seekers, bombs, overdrive in play.
  const rows = qa("#shopItems .shop-item").length;
  for(let r=0;r<rows;r++){
    for(let n=0;n<7 && !buyBtn(r).textContent.includes("MAX"); n++) clickEl(buyBtn(r));
  }
  check("every upgrade can be maxed", /Gear 53\/53/.test(id("pcGear").textContent));
  const spent = 200000 - JSON.parse(window.localStorage.getItem("skyforce_profile_Marc")).money;
  check("maxing the armory costs about $70k", spent === SF.config.TOTAL_UPGRADE_COST);
  clickEl(id("armoryBackBtn"));

  /* ---------- mission select ---------- */
  clickEl(id("playBtn"));
  check("mission list shows all 8 missions", qa("#missionList .mission-card").length === 8);
  check("only mission 1 is unlocked at the start", qa("#missionList .mission-card.locked").length === 7);
  clickEl(qa("#missionList .mission-card")[1]);
  check("locked missions can't be opened", !id("screen-briefing").classList.contains("active"));

  clickEl(qa("#missionList .mission-card")[0]);
  check("briefing opens for mission 1", id("screen-briefing").classList.contains("active"));
  check("briefing lists 3 objectives", qa("#briefObjectives .bo-row").length === 3);
  check("hard tiers are locked until stars are earned", qa("#briefDifficulties .diff-card.locked").length === 3);

  /* ---------- play mission 1 to completion ---------- */
  SF.game.godMode = true;      // test-only: survive long enough to finish
  clickEl(qa("#briefDifficulties .diff-card")[1]);   // PILOT
  check("game screen active after launch", id("screen-game").classList.contains("active"));
  check("bomb button visible for a pilot who owns bombs", !id("bombBtn").classList.contains("hidden"));
  check("overdrive button visible too", !id("overdriveBtn").classList.contains("hidden"));

  await runFrames(240);   // past the 2.2s briefing banner
  check("mission spawns enemies", SF.game.world.enemies.countAlive() > 0);
  check("player auto-fires without any input", SF.game.world.bullets.countAlive() > 0);

  await runFrames(2400);
  console.log("Mission 1 sim ->", SF.game.run.phase, "spawned:", SF.game.run.stats.spawned,
    "kills:", SF.game.run.stats.kills, "enemies left:", SF.game.world.enemies.countAlive(),
    "state:", SF.game.state);
  check("no runtime errors during mission 1", errors.length === 0);
  const res1 = !id("overlayResults").classList.contains("hidden");
  check("mission 1 reached the results screen", res1);
  check("results show 3 star slots", qa("#resultStars .rs").length === 3);
  const marc = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc"));
  check("mission 1 recorded as cleared", !!(marc.missions && marc.missions[1] && marc.missions[1].cleared));
  check("earned at least one star", SF.profile.totalStars(marc) >= 1);
  check("money was banked", marc.money > 0);
  check("kills were counted", marc.totalKills > 0);
  console.log(`Mission 1 -> stars:${SF.profile.totalStars(marc)} kills:${marc.totalKills} money:${marc.money}`);

  /* ---------- mission 2 unlocked by finishing 1 ---------- */
  clickEl(id("resultsMenuBtn"));
  check("mission 2 unlocked after clearing mission 1",
    !qa("#missionList .mission-card")[1].classList.contains("locked"));

  /* ---------- boss mission ---------- */
  const p2 = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc"));
  [1,2,3,4].forEach(mid => { p2.missions[mid] = { cleared:true, stars:{ pilot:3 }, best:{} }; });
  window.localStorage.setItem("skyforce_profile_Marc", JSON.stringify(p2));
  clickEl(id("missionsBackBtn"));
  clickEl(id("switchBtn"));
  clickEl(qa("#profileGrid .profile-card")[0]);
  clickEl(id("playBtn"));
  clickEl(qa("#missionList .mission-card")[3]);      // mission 4 - first boss
  clickEl(qa("#briefDifficulties .diff-card")[1]);
  await runFrames(2800);
  await sleep(1600);   // the boss death animation holds the results back ~1.2s
  await runFrames(30);
  check("boss mission spawned its boss", !!(SF.game.run && SF.game.run.bossSpawned));
  check("boss fight resolved or is still running cleanly",
    !!(SF.game.world.boss || SF.game.run.stats.completed || SF.game.state === "ending" || SF.game.run.ended));
  check("no runtime errors during the boss mission", errors.length === 0);
  if(SF.game.world.boss){
    const b = SF.game.world.boss;
    check("boss took damage from the bot", b.hp < b.maxHp);
    console.log(`Boss -> ${b.name} hp:${Math.round(b.hp)}/${b.maxHp} phase:${b.phaseIndex+1} weakPointsLeft:${b.weakPoints.filter(w=>!w.destroyed).length}`);
  } else {
    console.log("Boss -> defeated within the frame budget");
  }

  /* ---------- abilities ---------- */
  const before = SF.game.world.player ? SF.game.world.player.bombs : 0;
  if(SF.game.world.player && SF.game.state === "playing"){
    SF.game.useBomb();
    check("smart bomb consumes a charge", SF.game.world.player.bombs === before - 1);
    SF.game.useOverdrive();
    check("overdrive activates", SF.game.world.player.overdriveUntil > fakeNow);
  }

  /* ---------- pooling / performance ---------- */
  const pools = [SF.game.world.bullets, SF.game.world.enemies, SF.game.world.enemyBullets, SF.game.world.pickups];
  check("entity pools stay bounded", pools.every(p => p.items.length <= p.cap));
  check("particle pool stays bounded", SF.fx._pools.particles.items.length <= 900);
  console.log(`Pools -> bullets:${SF.game.world.bullets.items.length} enemies:${SF.game.world.enemies.items.length} ` +
              `enemyBullets:${SF.game.world.enemyBullets.items.length} particles:${SF.fx._pools.particles.items.length}`);

  /* ---------- old-save migration ---------- */
  window.localStorage.setItem("skyforce_profile_Legacy", JSON.stringify({
    name:"Legacy", callsign:"Legacy", money: 500,
    hasSpread:true, hasRapid:true, hasShield:true, extraLives:2,
    bestLevelByDiff:{ pilot: 7 }, totalKills: 40, achievements:["first_blood"],
  }));
  SF.profile.addName("Legacy");
  const legacy = SF.profile.load("Legacy");
  check("legacy one-off purchases become upgrade levels",
    legacy.upgrades.spread === 2 && legacy.upgrades.rapid === 4 && legacy.upgrades.shield === 1 && legacy.upgrades.life === 2);
  check("legacy endless progress credits campaign missions",
    Object.keys(legacy.missions).length === 3);
  check("legacy money and kills survive", legacy.money === 500 && legacy.totalKills === 40);

  /* ---------- report ---------- */
  console.log("\n--- Smoke test results ---");
  let failed = 0;
  results.forEach(([label, ok]) => {
    console.log((ok ? "PASS" : "FAIL") + "  " + label);
    if(!ok) failed++;
  });
  console.log("\nRuntime errors caught:", errors.length);
  errors.slice(0,5).forEach(e => console.log(" -", e && e.stack ? e.stack : e));
  if(failed > 0 || errors.length > 0){
    console.log("\nRESULT: FAIL");
    process.exit(1);
  }
  console.log("\nRESULT: PASS");
}

window.addEventListener("load", () => { run(); });
