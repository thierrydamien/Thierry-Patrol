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
let frameCount = 0;
let fakeNow = 0;
window.performance.now = () => fakeNow;
window.requestAnimationFrame = (cb) => {
  if (frameCount >= FRAME_BUDGET) return 1;
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
  check("armory has 4 shop items", doc.querySelectorAll("#shopItems .shop-item").length === 4);
  check("armory has 6 color swatches", doc.querySelectorAll("#colorRow .swatch").length === 6);
  doc.getElementById("armoryBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));

  doc.getElementById("achievementsBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("achievements screen active", doc.getElementById("screen-achievements").classList.contains("active"));
  check("achievements list has all 13 defined", doc.querySelectorAll("#achievementsList .ach-row").length === 13);
  doc.getElementById("achievementsBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));

  doc.getElementById("leaderboardBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("leaderboard has 2 rows", doc.querySelectorAll("#leaderboardList .lb-row").length === 2);
  doc.getElementById("leaderboardBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));

  // --- Extended gameplay simulation (~60 simulated seconds) ---
  window.__SKYFORCE_TEST_INVINCIBLE__ = true; // survive long enough to reach boss/powerup systems
  window.__SKYFORCE_TEST_EASY_BOSS__ = true;  // verify the boss-defeat code path reliably within the frame budget
  doc.getElementById("playBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("game screen active after Play", doc.getElementById("screen-game").classList.contains("active"));
  check("mute button visible during play", !doc.getElementById("muteBtn").classList.contains("hidden"));

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
  check("reached at least level 3 (a boss level)", marc.maxLevel >= 3);
  check("defeated at least one boss", marc.bossesDefeated >= 1);
  check("boss_slayer achievement unlocked", marc.achievements.includes("boss_slayer"));
  check("built at least one real combo streak", marc.maxCombo >= 3);
  console.log(`Simulation stats -> kills:${marc.totalKills} maxCombo:${marc.maxCombo} maxLevel:${marc.maxLevel} bosses:${marc.bossesDefeated} money:${marc.lifetimeMoney} achievements:${marc.achievements.length}`);

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
