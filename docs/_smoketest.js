const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
});
const { window } = dom;

// jsdom doesn't implement canvas 2D rendering (needs native deps) - stub it
// so the DOM/logic under test can run without touching real rendering.
// getImageData needs to return a real-shaped object (not undefined from a
// generic no-op), since the sprite-tinting code path calls .data on it.
window.HTMLCanvasElement.prototype.getContext = function(){
  const noop = () => {};
  const ctxStub = new Proxy({}, { get: (target, prop) => {
    if(prop === "getImageData") return (x,y,w,h) => ({ width:w, height:h, data: new Uint8ClampedArray(w*h*4) });
    if(prop === "canvas") return { width:1, height:1 };
    return noop;
  }});
  return ctxStub;
};

// Drive a bounded number of real animation frames with an advancing fake
// clock via setImmediate (so control returns to this script between frames,
// letting us interact with the page mid-simulation). Also nudges the ship
// left/right periodically so bullets actually intersect enemies, exercising
// collisions/combo/boss/powerup code paths rather than just idling.
const FRAME_BUDGET = 3600; // ~60s of simulated gameplay at 60fps
let frameLimit = FRAME_BUDGET; // raised for the second (hard-difficulty) session
let frameCount = 0;
let fakeNow = 0;
let lastFrameCb = null;
window.performance.now = () => fakeNow;
window.requestAnimationFrame = (cb) => {
  lastFrameCb = cb;
  if (frameCount >= frameLimit) return 1;
  frameCount++;
  fakeNow += 16.7;
  if (frameCount === 1) window.dispatchEvent(new window.KeyboardEvent("keydown", { key: " " })); // hold fire for the whole run
  if (Math.floor(fakeNow / 500) % 2 === 0) {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    window.dispatchEvent(new window.KeyboardEvent("keyup", { key: "ArrowRight" }));
  } else {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    window.dispatchEvent(new window.KeyboardEvent("keyup", { key: "ArrowLeft" }));
  }
  setImmediate(() => {
    try { cb(fakeNow); } catch (e) { errors.push(e); }
  });
  return 1;
};

window.alert = (msg) => { window.__lastAlert = msg; };
window.prompt = () => "TestKid";

// The smoke test only needs onload to fire quickly, not real pixels - jsdom
// has no real server to fetch assets/*.png from, and was hanging trying.
class StubImage {
  set src(v){ this._src = v; setTimeout(() => { if(this.onload) this.onload(); }, 0); }
  get src(){ return this._src; }
}
window.Image = StubImage;

let errors = [];
window.addEventListener("error", (e) => errors.push(e.error || e.message));

Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable:true, get(){ return 390; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable:true, get(){ return 620; } });
const origGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = (el) => {
  const s = origGetComputedStyle(el);
  if (!s.paddingLeft) Object.defineProperty(s, "paddingLeft", { value: "0px" });
  return s;
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Grants the game more frames after the budget ran out, and restarts the rAF chain. */
async function runMoreFrames(extra) {
  frameLimit = frameCount + extra;
  if (lastFrameCb) setImmediate(() => { try { lastFrameCb(fakeNow); } catch (e) { errors.push(e); } });
  while (frameCount < frameLimit) await sleep(20);
  await sleep(50);
}

async function run() {
  const doc = window.document;
  const script = doc.createElement("script");
  script.textContent = fs.readFileSync(path.join(__dirname, "game.js"), "utf8");
  doc.body.appendChild(script);

  const results = [];
  function check(label, cond) { results.push([label, !!cond]); }

  // --- Navigation smoke checks ---
  check("profile grid has Marc & Charles cards", doc.querySelectorAll("#profileGrid .profile-card").length === 2);

  doc.querySelectorAll("#profileGrid .profile-card")[0].dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("menu screen active after picking profile", doc.getElementById("screen-menu").classList.contains("active"));
  check("greeting mentions Marc", doc.getElementById("greeting").textContent.includes("Marc"));

  doc.getElementById("armoryBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("armory lists all 13 tiered upgrades", doc.querySelectorAll("#shopItems .shop-item").length === 13);
  check("upgrade rows show level pips", doc.querySelectorAll("#shopItems .si-pips .pip").length === 50);
  check("armory has 6 color swatches", doc.querySelectorAll("#colorRow .swatch").length === 6);
  check("gear level line rendered", /GEAR LEVEL 0 \/ 50/.test(doc.getElementById("armoryPower").textContent));

  // --- Tiered buying: levels stack, cost climbs, and it stops at max ---
  const rich = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc") || "{}");
  rich.name = "Marc"; rich.money = 100000; rich.upgrades = {};
  window.localStorage.setItem("skyforce_profile_Marc", JSON.stringify(rich));
  doc.getElementById("armoryBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.getElementById("switchBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.querySelectorAll("#profileGrid .profile-card")[0].dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.getElementById("armoryBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));

  const buyBtnFor = (idx) => doc.querySelectorAll("#shopItems .shop-item")[idx].querySelector("button");
  const priceBefore = buyBtnFor(0).textContent;
  buyBtnFor(0).dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("buying a level raises the next level's price", buyBtnFor(0).textContent !== priceBefore);
  check("gear level went up after a purchase", /GEAR LEVEL 1 \/ 50/.test(doc.getElementById("armoryPower").textContent));
  for (let i = 0; i < 6; i++) buyBtnFor(0).dispatchEvent(new window.MouseEvent("click", {bubbles:true})); // over-buy past the cap
  const spreadLvl = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc")).upgrades.spread;
  check("upgrade level caps at its max (5)", spreadLvl === 5);
  check("maxed upgrade button reads MAX", buyBtnFor(0).textContent === "MAX");

  // Max everything out, so the play simulation below exercises the gear that
  // only exists at higher levels (drones, piercing, seekers, bombs, magnet).
  const rowCount = doc.querySelectorAll("#shopItems .shop-item").length;
  for (let r = 0; r < rowCount; r++) {
    for (let n = 0; n < 6 && buyBtnFor(r).textContent !== "MAX"; n++) {
      buyBtnFor(r).dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
    }
  }
  check("every upgrade can be maxed out", /GEAR LEVEL 50 \/ 50/.test(doc.getElementById("armoryPower").textContent));
  const maxedProfile = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc"));
  check("maxing the armory costs about $65k", maxedProfile.money === 100000 - 65250);
  doc.getElementById("armoryBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));

  doc.getElementById("achievementsBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("achievements screen active", doc.getElementById("screen-achievements").classList.contains("active"));
  check("achievements list has all 20 defined", doc.querySelectorAll("#achievementsList .ach-row").length === 20);
  doc.getElementById("achievementsBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));

  doc.getElementById("leaderboardBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("leaderboard has 2 rows", doc.querySelectorAll("#leaderboardList .lb-row").length === 2);
  doc.getElementById("leaderboardBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));

  // --- Difficulty select ---
  doc.getElementById("playBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("difficulty screen active after Play", doc.getElementById("screen-difficulty").classList.contains("active"));
  const diffCards = doc.querySelectorAll("#difficultyList .diff-card");
  check("five difficulties offered", diffCards.length === 5);
  check("hard tiers start locked", doc.querySelectorAll("#difficultyList .diff-card.locked").length === 3);
  diffCards[2].dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("clicking a locked tier does not start a run", !doc.getElementById("screen-game").classList.contains("active"));

  // --- Extended gameplay simulation (~60 simulated seconds) ---
  window.__SKYFORCE_TEST_INVINCIBLE__ = true; // survive long enough to reach boss/powerup systems
  window.__SKYFORCE_TEST_EASY_BOSS__ = true;  // verify the boss-defeat code path reliably within the frame budget
  diffCards[1].dispatchEvent(new window.MouseEvent("click", {bubbles:true})); // PILOT (unlocked)
  check("game screen active after picking a difficulty", doc.getElementById("screen-game").classList.contains("active"));
  check("mute button visible during play", !doc.getElementById("muteBtn").classList.contains("hidden"));
  check("bomb button shown for a player who owns Smart Bombs", !doc.getElementById("bombBtn").classList.contains("hidden"));

  // let the frame budget play out
  while (frameCount < FRAME_BUDGET) {
    await sleep(20);
  }
  await sleep(50);

  check(`ran full simulated session (${frameCount} frames, no thrown errors)`, errors.length === 0);

  const overShown = !doc.getElementById("overlayOver").classList.contains("hidden");
  const stillPlaying = doc.getElementById("screen-game").classList.contains("active");
  check("ended in a sane state (game over shown or still playing)", overShown || stillPlaying);

  // Pause/resume still works after a long session
  if (stillPlaying && !overShown) {
    doc.getElementById("pauseBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
    check("pause overlay shown", !doc.getElementById("overlayPause").classList.contains("hidden"));
    doc.getElementById("resumeBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  }

  const marc = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc") || "{}");
  check("profile stats are numbers, not NaN", [marc.totalKills, marc.lifetimeMoney, marc.maxCombo, marc.maxLevel].every(v => typeof v === "number" && !Number.isNaN(v)));
  check("achievements array present", Array.isArray(marc.achievements));
  check("per-difficulty best level recorded for PILOT", (marc.bestLevelByDiff||{}).pilot >= 3);
  check("fully-loaded achievement unlocked after maxing everything", marc.achievements.includes("big_spender"));
  check("reached at least level 3 (a boss level)", marc.maxLevel >= 3);
  check("defeated at least one boss", marc.bossesDefeated >= 1);
  check("boss_slayer achievement unlocked", marc.achievements.includes("boss_slayer"));
  check("built at least one real combo streak", marc.maxCombo >= 3);
  console.log(`Simulation stats -> kills:${marc.totalKills} maxCombo:${marc.maxCombo} maxLevel:${marc.maxLevel} bosses:${marc.bossesDefeated} money:${marc.lifetimeMoney} achievements:${marc.achievements.length}`);

  // --- Second session on the hardest tier, to exercise the difficulty-only
  // code paths: armoured enemies, enemies that shoot back, and the payout
  // multipliers. Unlocked by hand here rather than by grinding three tiers. ---
  const moneyBeforeHard = marc.lifetimeMoney;
  marc.bestLevelByDiff = { pilot: 9, ace: 9, veteran: 9 };
  window.localStorage.setItem("skyforce_profile_Marc", JSON.stringify(marc));
  doc.getElementById("menuBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.getElementById("switchBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.querySelectorAll("#profileGrid .profile-card")[0].dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.getElementById("playBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("no tiers locked once the unlock requirements are met",
    doc.querySelectorAll("#difficultyList .diff-card.locked").length === 0);
  doc.querySelectorAll("#difficultyList .diff-card")[4].dispatchEvent(new window.MouseEvent("click", {bubbles:true})); // NIGHTMARE
  check("nightmare run started", doc.getElementById("screen-game").classList.contains("active"));
  await runMoreFrames(1800);
  const marc2 = JSON.parse(window.localStorage.getItem("skyforce_profile_Marc") || "{}");
  check("nightmare session ran without errors", errors.length === 0);
  check("per-difficulty best level recorded for NIGHTMARE", (marc2.bestLevelByDiff||{}).nightmare >= 1);
  check("hard tier still paid out", marc2.lifetimeMoney > moneyBeforeHard);
  console.log(`Nightmare stats -> level:${marc2.bestLevelByDiff.nightmare} extra money:${marc2.lifetimeMoney - moneyBeforeHard}`);

  console.log("\n--- Smoke test results ---");
  let failed = 0;
  for (const [label, ok] of results) {
    console.log((ok ? "PASS" : "FAIL") + "  " + label);
    if (!ok) failed++;
  }
  console.log("\nRuntime errors caught:", errors.length);
  errors.slice(0,10).forEach(e => console.log(" -", e && e.stack ? e.stack : e));

  if (failed > 0 || errors.length > 0) {
    console.log("\nRESULT: FAIL");
    process.exit(1);
  } else {
    console.log("\nRESULT: PASS");
  }
}

window.addEventListener("load", () => { run(); });
