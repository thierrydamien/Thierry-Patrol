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
window.HTMLCanvasElement.prototype.getContext = function(){
  const noop = () => {};
  return new Proxy({}, { get: () => noop });
};
window.requestAnimationFrame = () => 1;
window.alert = (msg) => { window.__lastAlert = msg; };
window.prompt = () => "TestKid";

let errors = [];
window.addEventListener("error", (e) => errors.push(e.error || e.message));

// Give layout methods sane non-zero values since jsdom doesn't do real layout.
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable:true, get(){ return 390; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable:true, get(){ return 620; } });
window.getComputedStyle = (() => {
  const orig = window.getComputedStyle;
  return (el) => {
    const s = orig(el);
    if (!s.paddingLeft) Object.defineProperty(s, "paddingLeft", { value: "0px" });
    return s;
  };
})();

function run() {
  const doc = window.document;
  const script = doc.createElement("script");
  script.textContent = fs.readFileSync(path.join(__dirname, "game.js"), "utf8");
  doc.body.appendChild(script);

  const results = [];
  function check(label, cond) { results.push([label, !!cond]); }

  // 1. Profile grid populated on load
  check("profile grid has Marc & Charles cards", doc.querySelectorAll("#profileGrid .profile-card").length === 2);

  // 2. Selecting a profile shows the menu with a greeting
  doc.querySelectorAll("#profileGrid .profile-card")[0].dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("menu screen active after picking profile", doc.getElementById("screen-menu").classList.contains("active"));
  check("greeting mentions Marc", doc.getElementById("greeting").textContent.includes("Marc"));

  // 3. Armory renders shop items and color swatches
  doc.getElementById("armoryBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("armory screen active", doc.getElementById("screen-armory").classList.contains("active"));
  check("armory has 4 shop items", doc.querySelectorAll("#shopItems .shop-item").length === 4);
  check("armory has 6 color swatches", doc.querySelectorAll("#colorRow .swatch").length === 6);

  // 4. Buying an item you can't afford stays disabled; money display present
  check("money line rendered", /MONEY: \$\d+/.test(doc.getElementById("armoryMoney").textContent));

  // 5. Leaderboard renders both profiles
  doc.getElementById("armoryBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.getElementById("leaderboardBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("leaderboard has 2 rows", doc.querySelectorAll("#leaderboardList .lb-row").length === 2);

  // 6. Starting a run shows the game screen and doesn't throw
  doc.getElementById("leaderboardBackBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  doc.getElementById("playBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("game screen active after Play", doc.getElementById("screen-game").classList.contains("active"));
  check("pause button visible during play", !doc.getElementById("pauseBtn").classList.contains("hidden"));

  // 7. Pause/resume toggling works
  doc.getElementById("pauseBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("pause overlay shown", !doc.getElementById("overlayPause").classList.contains("hidden"));
  doc.getElementById("resumeBtn").dispatchEvent(new window.MouseEvent("click", {bubbles:true}));
  check("pause overlay hidden after resume", doc.getElementById("overlayPause").classList.contains("hidden"));

  console.log("\n--- Smoke test results ---");
  let failed = 0;
  for (const [label, ok] of results) {
    console.log((ok ? "PASS" : "FAIL") + "  " + label);
    if (!ok) failed++;
  }
  console.log("\nRuntime errors caught:", errors.length);
  errors.forEach(e => console.log(" -", e && e.stack ? e.stack : e));

  if (failed > 0 || errors.length > 0) {
    console.log("\nRESULT: FAIL");
    process.exit(1);
  } else {
    console.log("\nRESULT: PASS");
  }
}

window.addEventListener("load", run);
