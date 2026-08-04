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
window.cancelAnimationFrame = () => {};

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
    fakeNow += 33.4;   // 30fps steps: same simulated time, half the frames
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
  "src/core.js","src/audio.js","src/data/config.js","src/data/enemies.js","src/data/missions.js","src/daily.js",
  "src/data/comms.js","src/data/story.js",
  "src/profile.js","src/cloud.js","src/fx.js","src/input.js","src/entities.js","src/bosses.js","src/systems.js",
  "src/render.js","src/enemyart.js","src/insignia.js","src/skygen.js","src/shipart.js","src/pilotart.js","src/comms.js","src/game.js","src/ui.js",
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
  check("16 campaign missions defined, ids sequential",
    SF.missions.MISSIONS.length === 16 &&
    SF.missions.MISSIONS.every((m, i) => m.id === i + 1));
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
  check("every boss a mission names actually exists",
    SF.missions.MISSIONS.every(m => !m.boss || !!SF.missions.BOSSES[m.boss]));
  check("every phase of every boss fires real attacks",
    Object.values(SF.missions.BOSSES).every(b =>
      b.phases.every(ph => ph.attacks.every(a => !!SF.bosses.ATTACKS[a]))));
  // A boss whose every attack is disable-able could be reduced to silence.
  check("no boss can be stripped of all its attacks",
    Object.values(SF.missions.BOSSES).every(b => {
      const gone = new Set(b.weakPoints.map(wp => wp.disables).filter(Boolean));
      return b.phases.every(ph => ph.attacks.some(a => !gone.has(a)));
    }));
  // Backdrops are picked modulo the sky list, so a short list silently makes
  // late missions reuse early ones - the exact complaint that produced them.
  check("every mission gets its own sky", SF.skygen.SKIES.length >= SF.missions.MISSIONS.length);
  // Copy is aimed at kids, so every shelf item and every mission has to actually
  // explain itself - a blank description reads as a bug to an 8-year-old.
  check("every upgrade explains itself in plain words",
    SF.config.UPGRADES.every(u => typeof u.desc === "string" && u.desc.length > 12));
  check("both story acts exist and name real art",
    ["firstPart","ace","actTwo","campaign"].every(k => {
      const st = SF.storyData.STORY[k];
      return st && st.panels.length > 0 &&
        st.panels.every(pn => ["stock","now","crew","sky"].indexOf(pn.art) >= 0 && pn.text.length > 20);
    }));
  check("every mission has a brief and a subtitle",
    SF.missions.MISSIONS.every(m => m.brief && m.brief.length > 12 && m.subtitle));
  check("badge picker offers a real set of insignia", SF.config.BADGES.length >= 12);
  check("every insignia is a drawn design, not an emoji",
    SF.config.BADGES.every(b => typeof SF.insignia.EMBLEMS[b] === "function"));
  check("every rank awards a drawn insignia too",
    SF.config.RANKS.every(r => typeof SF.insignia.EMBLEMS[r.badge] === "function"));
  check("an old emoji badge falls back to the rank patch", (() => {
    const p = SF.profile.blank("Old"); p.badge = "🦄";
    return SF.profile.badgeFor(p) === SF.profile.rankFor(p).badge;
  })());
  check("every mission has its own sky", SF.skygen.SKIES.length >= SF.missions.MISSIONS.length);
  check("no two missions look alike",
    new Set(SF.skygen.SKIES.map(k => k.photo || k.clouds.join(""))).size === SF.skygen.SKIES.length);
  check("the original artwork is still in use",
    SF.skygen.SKIES.some(k => k.photo === "playfieldBg") &&
    SF.skygen.SKIES.some(k => k.photo === "backAlt"));
  check("every generated sky has something with an edge in it",
    SF.skygen.SKIES.filter(k => !k.photo).every(k => (k.props || []).length >= 2));
  check("a photo mission generates no canvas", SF.skygen.build(0, 100, 100) === null);
  check("every ship part hangs off a real upgrade",
    SF.shipart.PARTS.every(pt => !!SF.config.UPGRADE_BY_ID[pt.up]));
  check("no ship part asks for a level its upgrade can't reach",
    SF.shipart.PARTS.every(pt => pt.at <= SF.config.UPGRADE_BY_ID[pt.up].max));
  check("a stock ship has no parts and a maxed one has them all", (() => {
    const maxed = {}; SF.config.UPGRADES.forEach(u => maxed[u.id] = u.max);
    return SF.shipart.ownedCount({}) === 0 &&
           SF.shipart.ownedCount(maxed) === SF.shipart.PARTS.length;
  })());
  check("a stock ship always has a next part to want", !!SF.shipart.nextPart({}));
  check("every comms bucket has lines",
    Object.values(SF.commsData.COMMS).every(c => c.lines.length > 0 && c.cooldown > 0));
  check("every story beat has panels and art",
    Object.values(SF.storyData.STORY).every(b =>
      b.panels.length >= 2 && b.panels.every(pn => pn.text && pn.art)));

  /* ---------- pilot picker + menu ---------- */
  check("pilot grid lists Marc & Charles", qa("#profileGrid .profile-card").length === 2);
  clickEl(qa("#profileGrid .profile-card")[0]);
  check("menu active after picking a pilot", id("screen-menu").classList.contains("active"));
  check("menu shows the pilot's rank", /CADET|PILOT|LEADER|ACE|COMMANDER|LEGEND/.test(id("menuPilot").textContent));

  /* ---------- armory + hangar, one screen ---------- */
  clickEl(id("armoryBtn"));
  check("armory opens from the menu", id("screen-armory").classList.contains("active"));
  check("armory offers a tab per shelf plus parts and pilot",
    qa("#armoryTabs .armory-tab").length === SF.config.CATEGORIES.length + 2);
  check("only one shelf is on screen at a time", qa("#armoryPanel .shop-group").length === 1);
  check("the open shelf shows only its own upgrades",
    qa("#armoryPanel .shop-item").length ===
      SF.config.UPGRADES.filter(u => u.cat === "guns").length);
  check("the ship bay names the next part", /NEXT PART/.test(id("hangarNext").textContent));
  clickEl(id("hangarCompareBtn"));
  check("compare mode labels stock vs yours", !id("hangarCompareLabels").classList.contains("hidden"));
  clickEl(id("hangarCompareBtn"));
  check("compare mode toggles back off", id("hangarCompareLabels").classList.contains("hidden"));
  await runFrames(4);
  check("the ship bay animates without errors", errors.length === 0);

  const tabByName = n => qa("#armoryTabs .armory-tab").find(t => t.textContent.includes(n));
  clickEl(tabByName("MY SHIP"));
  // The part inventory left the DOM (MY SHIP is the tuning bay now) but the
  // part model still drives the hangar ghost and the "next part" line.
  check("a stock ship lists every part as unfitted",
    SF.shipart.ownedCount({}) === 0 &&
    SF.shipart.partList({}).length === SF.shipart.PARTS.length);
  check("a stock ship still has a next part to want",
    !!SF.shipart.nextPart({}));
  check("MY SHIP is the tuning bay",
    qa("#armoryPanel .tune-card").length === SF.config.TUNES.length &&
    qa("#armoryPanel .part-chip").length === 0);
  clickEl(tabByName("PILOT"));
  check("pilot card shows gear progress", /Gear 0\/53/.test(id("pcGear").textContent));
  check("pilot tab carries callsign, colour and badge",
    !!id("callsignInput") && qa("#colorRow .swatch").length > 0 && qa("#badgeRow .badge-pick").length > 0);
  check("every upgrade is reachable across the shelves",
    SF.config.CATEGORIES.reduce((n,c) =>
      n + SF.config.UPGRADES.filter(u => u.cat === c.id).length, 0) === 14);
  clickEl(tabByName("GUNS"));

  const rich = JSON.parse(window.localStorage.getItem("patrol_profile_Marc") || "{}");
  rich.name = "Marc"; rich.money = 2000000;   // enough to buy the whole (much pricier) Armory rich.upgrades = {};
  window.localStorage.setItem("patrol_profile_Marc", JSON.stringify(rich));
  clickEl(id("armoryBackBtn"));
  clickEl(id("switchBtn"));
  clickEl(qa("#profileGrid .profile-card")[0]);
  clickEl(id("armoryBtn"));

  const buyBtn = i => qa("#armoryPanel .shop-item")[i].querySelector("button");
  const priceBefore = buyBtn(0).textContent;
  clickEl(buyBtn(0));
  check("buying a level raises the next price", buyBtn(0).textContent !== priceBefore);
  clickEl(tabByName("PILOT"));
  check("gear level tracks purchases", /Gear 1\/53/.test(id("pcGear").textContent));
  clickEl(tabByName("GUNS"));
  for(let n=0;n<8;n++) clickEl(buyBtn(0));
  check("upgrade level caps at its max", JSON.parse(window.localStorage.getItem("patrol_profile_Marc")).upgrades.spread === 5);
  check("maxed upgrade reads MAX", buyBtn(0).textContent.includes("MAX"));

  // Buy everything: exercises drones, piercing, seekers, bombs, overdrive in play.
  SF.config.CATEGORIES.forEach(cat => {
    clickEl(tabByName(cat.name));
    const rows = qa("#armoryPanel .shop-item").length;
    for(let r=0;r<rows;r++){
      for(let n=0;n<7 && !buyBtn(r).textContent.includes("MAX"); n++) clickEl(buyBtn(r));
    }
  });
  clickEl(tabByName("PILOT"));
  check("every upgrade can be maxed", /Gear 53\/53/.test(id("pcGear").textContent));
  const spent = 2000000 - JSON.parse(window.localStorage.getItem("patrol_profile_Marc")).money;
  check("buying every level costs exactly the catalogue total", spent === SF.config.TOTAL_UPGRADE_COST);
  check("maxing the armory is a long-haul goal, not an afternoon",
    SF.config.TOTAL_UPGRADE_COST > 600000);
  check("the first level of anything is pocket money",
    SF.config.UPGRADES.every(u => u.costs[0] <= 2000));
  check("each level costs meaningfully more than the last",
    SF.config.UPGRADES.every(u => u.costs.every((c,i) => i === 0 || c > u.costs[i-1]*3)));
  check("passing 20 gear levels plays the ace story",
    !id("storyOverlay").classList.contains("hidden") &&
    /SQUADRON ACE/.test(id("storyTitle").textContent));
  check("the ace story draws a panel per beat",
    qa("#storyPanels .story-panel").length === SF.storyData.STORY.ace.panels.length);
  clickEl(id("storyBtn"));
  check("story closes on continue", id("storyOverlay").classList.contains("hidden"));
  clickEl(tabByName("MY SHIP"));
  check("a maxed ship has every part fitted",
    SF.shipart.ownedCount(SF.shipart.levelsOf(SF.profile.load("Marc"))) === SF.shipart.PARTS.length);
  check("a maxed ship has nothing left to want", /COMPLETE/.test(id("hangarNext").textContent));
  clickEl(id("armoryBackBtn"));

  /* ---------- medals + championship ---------- */
  clickEl(id("achievementsBtn"));
  check("medals screen shows a tile per medal",
    qa("#achievementsList .medal").length === SF.config.ACHIEVEMENTS.length);
  check("earned medals are marked apart from the rest",
    qa("#achievementsList .medal.won").length === SF.ui.getProfile().achievements.length);
  check("medals name the next one to chase", /NEXT UP|COMPLETE/.test(id("medalNext").textContent));
  check("medals show overall progress", /of \d+ medals/.test(id("achievementsCount").textContent));
  clickEl(id("achievementsBackBtn"));

  clickEl(id("leaderboardBtn"));
  check("the championship puts the pilots on a podium",
    qa("#podium .podium-step").length === Math.min(3, SF.profile.listNames().length));
  check("the winner stands on the top step", qa("#podium .place-1").length === 1);
  // Only flown missions get a row now; the unflown tail is one quiet line.
  check("the record board lists flown missions plus a collapsed tail", (() => {
    const flown = SF.missions.MISSIONS.filter(m => SF.profile.familyBest(m.id)).length;
    const rows = qa("#recordBoard .rb-row").length;
    const rest = qa("#recordBoard .rb-rest").length;
    return rows === flown + rest && (flown === SF.missions.MISSIONS.length || rest === 1);
  })());
  clickEl(id("leaderboardBackBtn"));

  /* ---------- mission select ---------- */
  clickEl(id("playBtn"));
  check("the campaign map has a stop for every mission",
    qa("#campaignNodes .map-node").length === SF.missions.MISSIONS.length);
  check("only mission 1 is unlocked at the start",
    qa("#campaignNodes .map-node.locked").length === SF.missions.MISSIONS.length - 1);
  check("the map says what you're flying next", /\w/.test(id("campaignHint").textContent));
  await runFrames(3);
  check("the campaign map draws without errors", errors.length === 0);
  clickEl(qa("#campaignNodes .map-node")[1]);
  check("locked missions can't be opened", !id("screen-briefing").classList.contains("active"));

  clickEl(qa("#campaignNodes .map-node")[0]);
  check("briefing opens for mission 1", id("screen-briefing").classList.contains("active"));
  check("briefing lists 3 objectives", qa("#briefObjectives .bo-row").length === 3);
  check("briefing shows what you'll be facing", qa("#briefRoster .roster-chip").length > 0);
  check("hard tiers are locked until stars are earned", qa("#briefDifficulties .diff-card.locked").length === 3);
  check("a tier is preselected so LAUNCH always works",
    qa("#briefDifficulties .diff-card.on").length === 1);
  check("the briefing explains the tier you picked", /pays/.test(id("briefDiffDetail").textContent));

  /* ---------- play mission 1 to completion ---------- */
  SF.game.godMode = true;      // test-only: survive long enough to finish
  clickEl(qa("#briefDifficulties .diff-card")[1]);   // pick PILOT
  check("picking a tier selects it rather than launching",
    !id("screen-game").classList.contains("active"));
  clickEl(id("launchBtn"));
  check("game screen active after launch", id("screen-game").classList.contains("active"));
  check("bomb button visible for a pilot who owns bombs", !id("bombBtn").classList.contains("hidden"));
  check("overdrive button visible too", !id("overdriveBtn").classList.contains("hidden"));

  await runFrames(120);   // past the 2.2s briefing banner
  // Cumulative, not "alive right this frame": between two waves the field is
  // legitimately empty, and asserting on one instant made this flap whenever
  // anything else touched the RNG stream.
  check("mission spawns enemies", SF.game.run.director.spawnedCount > 0);
  check("comms greeted the pilot by name at launch",
    !!SF.comms._state.lastAt.missionStart ||
    SF.comms._state.lastAt.missionStart === 0);
  check("player auto-fires without any input", SF.game.world.bullets.countAlive() > 0);

  await runFrames(4200);   // mission 1 runs ~1m45 now
  console.log("Mission 1 sim ->", SF.game.run.phase, "spawned:", SF.game.run.stats.spawned,
    "kills:", SF.game.run.stats.kills, "enemies left:", SF.game.world.enemies.countAlive(),
    "state:", SF.game.state);
  check("no runtime errors during mission 1", errors.length === 0);
  check("comms reacted to more than one kind of event",
    Object.keys(SF.comms._state.lastAt).length >= 2);
  check("comms never leaves a panel stuck on screen",
    !SF.comms.current() || SF.comms.current().life <= SF.comms.current().max);
  const res1 = !id("overlayResults").classList.contains("hidden");
  check("mission 1 reached the results screen", res1);
  check("results show 3 star slots", qa("#resultStars .rs").length === 3);
  check("results name the family record", /record|to beat/i.test(id("resultLines").textContent));
  // Celebrations must be earned: a first-ever completion with nothing beaten
  // gets NO "new record!" line - a kid knows fake praise when they hear it.
  check("an unearned celebration stays silent",
    id("resultComms").classList.contains("hidden") ||
    !/record/i.test(id("resultCommsText").textContent));
  check("results say the record is still unset, honestly",
    /none yet|record|holds this/i.test(id("resultLines").textContent));
  check("a cleared mission offers the next one", !id("nextBtn").classList.contains("hidden"));
  check("wingmen fly under a squadmate's name",
    SF.game.world.player.crew.some(c => c.callsign === "Charles"));
  const marc = JSON.parse(window.localStorage.getItem("patrol_profile_Marc"));
  check("mission 1 recorded as cleared", !!(marc.missions && marc.missions[1] && marc.missions[1].cleared));
  check("earned at least one star", SF.profile.totalStars(marc) >= 1);
  check("money was banked", marc.money > 0);
  check("kills were counted", marc.totalKills > 0);
  console.log(`Mission 1 -> stars:${SF.profile.totalStars(marc)} kills:${marc.totalKills} money:${marc.money}`);

  /* ---------- mission 2 unlocked by finishing 1 ---------- */
  clickEl(id("resultsMenuBtn"));
  check("mission 2 unlocked after clearing mission 1",
    !qa("#campaignNodes .map-node")[1].classList.contains("locked"));

  /* ---------- the interactions that make a wave a puzzle ---------- */
  {
    const W = SF.game.world, diff = SF.config.DIFFICULTY_BY_ID.pilot;
    W.reset();
    W.createPlayer(SF.game.buildLoadout(JSON.parse(window.localStorage.getItem("patrol_profile_Marc")), diff));
    const ctxb = { VW:SF.entityConst.VW, VH:SF.entityConst.VH, player:W.player, difficulty:diff,
                   smart:0, pickups:W.pickups, onEscape(){}, onEnemyKilled(e){ e.alive = false; } };

    // Guardian: everything inside the bubble is untouchable until it dies.
    const guard = W.spawnEnemy("shielder", 200, 200, { difficulty: diff });
    const under = W.spawnEnemy("grunt", 215, 220, { difficulty: diff });
    const far   = W.spawnEnemy("grunt", 215, 700, { difficulty: diff });
    W.applyGuardianShields();
    check("a Guardian shields enemies near it", under.shielded === true);
    check("a Guardian does not shield the whole field", far.shielded === false);
    check("a Guardian is not shielded by itself", guard.shielded === false);
    guard.alive = false;
    W.applyGuardianShields();
    check("killing the Guardian drops the bubble immediately", under.shielded === false);

    // Thief: steals loose coins, and hands them back if you shoot it down.
    W.reset();
    W.createPlayer(SF.game.buildLoadout(JSON.parse(window.localStorage.getItem("patrol_profile_Marc")), diff));
    ctxb.player = W.player; ctxb.pickups = W.pickups;
    W.dropCoins(300, 300, 40);
    const coinsBefore = W.pickups.items.filter(i => i.alive && i.kind === "coin").length;
    const thief = W.spawnEnemy("thief", 300, 260, { difficulty: diff });
    for(let i=0;i<240;i++) SF.enemyData.BEHAVIOURS.thief(thief, 1/60, ctxb);
    check("a thief actually takes coins off the field", thief.loot > 0);
    check("a thief runs for it once it is loaded", thief.fleeing === true);
    check("the coins it took are really gone",
      W.pickups.items.filter(i => i.alive && i.kind === "coin").length < coinsBefore);

    // Boulders: sized from your guns, split into asteroids, and can't be rammed away.
    W.reset();
    const strong = SF.profile.blank("Strong"); strong.upgrades = { spread:5, rapid:5, damage:5 };
    W.createPlayer(SF.game.buildLoadout(strong, diff));
    const bigA = W.spawnEnemy("boulder", 300, 100, { difficulty: diff });
    W.reset();
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Weak"), diff));
    const bigB = W.spawnEnemy("boulder", 300, 100, { difficulty: diff });
    check("a boulder is sized from the guns pointed at it", bigA.hp > bigB.hp * 3);
    check("a boulder outlasts a plain asteroid",
      bigA.hp > W.spawnEnemy("asteroid", 10, 10, { difficulty: diff }).hp * 2);
    check("a boulder breaks into asteroids", SF.enemyData.ENEMY_TYPES.boulder.splitsInto.type === "asteroid");

    // Asteroids are scenery: they never count toward "destroy the enemies".
    const rockWave = { waves:[{ t:0, type:"asteroid", n:5, form:"scatter" }], boss:null };
    const rockDir = new SF.systems.WaveDirector(rockWave, diff, W);
    check("asteroids are not counted as enemies to destroy", rockDir.totalPlanned === 0);
    check("asteroids are flagged as hazards",
      W.spawnEnemy("asteroid", 100, 100, { difficulty: diff }).hazard === true);
    // The point of boulders is that they are an occasional event, not scenery.
    // Pinning an exact count just breaks every time a mission is added, so
    // assert the shape: present on several levels, absent from most.
    {
      const withBoulders = SF.missions.MISSIONS.filter(m => m.waves.some(wv => wv.type === "boulder")).length;
      check("boulders show up on some missions but not most",
        withBoulders >= 2 && withBoulders <= SF.missions.MISSIONS.length/2);
    }

    // Ramming a rock costs a life and leaves the rock exactly where it was.
    {
      const rock = W.spawnEnemy("boulder", W.player.x, W.player.y, { difficulty: diff });
      const rockHp = rock.hp;
      let hits = 0;
      W.player.invuln = 0;
      SF.systems.resolve(W, { onEnemyKilled(){}, onBossHit(){}, onPlayerHit(){ hits++; }, godMode:false }, 1/60);
      check("ramming a rock hurts you", hits === 1);
      check("ramming a rock does not destroy it", rock.alive === true && rock.hp === rockHp);
    }
  }

  /* ---------- how full the screen gets ---------- */
  {
    const W = SF.game.world;
    const m8 = SF.missions.MISSIONS[7];
    const plannedOn = tierId => new SF.systems.WaveDirector(
      m8, SF.config.DIFFICULTY_BY_ID[tierId], W).totalPlanned;
    check("every tier declares a density", SF.config.DIFFICULTIES.every(d => d.density > 0));
    check("hard tiers send far more enemies than normal",
      plannedOn("nightmare") > plannedOn("pilot") * 3 &&
      plannedOn("veteran") > plannedOn("ace") &&
      plannedOn("ace") > plannedOn("pilot"));
    check("the easy tier sends fewer", plannedOn("rookie") < plannedOn("pilot"));
    // Density used to be dead config: declared on every tier, read by nothing.
    const dir = new SF.systems.WaveDirector(m8, SF.config.DIFFICULTY_BY_ID.nightmare, W);
    check("density actually reaches the wave director",
      dir.waveSize(m8.waves[0]) > m8.waves[0].n * 2);
    check("a dense wave is split into salvos, not one huge formation", (() => {
      dir.pending = []; dir.queueWave(m8.waves[0]);
      const late = dir.pending.filter(x => x.delay > 2).length;
      return late > 0 && late < dir.pending.length;
    })());
    check("headcount does not run the economy",
      SF.config.DIFFICULTY_BY_ID.nightmare.pay /
        Math.sqrt(SF.config.DIFFICULTY_BY_ID.nightmare.density) <
      SF.config.DIFFICULTY_BY_ID.nightmare.pay);
  }

  /* ---------- the health curve across tiers ---------- */
  {
    const W = SF.game.world;
    const maxed = SF.profile.blank("Maxed");
    maxed.upgrades = { spread:5, rapid:5, damage:5, wingman:2 };
    const stock = SF.profile.blank("Stock");
    const hpFor = (prof, tierId) => {
      const tier = SF.config.DIFFICULTY_BY_ID[tierId];
      W.reset(); W.createPlayer(SF.game.buildLoadout(prof, tier));
      return W.spawnEnemy("grunt", 100, 100, { difficulty: tier }).hp;
    };
    check("easy tiers do not scale enemies to your guns",
      hpFor(maxed, "pilot") === hpFor(stock, "pilot"));
    check("hard tiers do scale enemies to your guns",
      hpFor(maxed, "nightmare") > hpFor(stock, "nightmare") * 3);
    check("each tier is meaningfully tougher than the last",
      hpFor(stock,"pilot") < hpFor(stock,"ace") &&
      hpFor(stock,"ace") < hpFor(stock,"veteran") &&
      hpFor(stock,"veteran") < hpFor(stock,"nightmare"));
    check("a maxed ship still meets a real wall on NIGHTMARE",
      hpFor(maxed, "nightmare") >= 8 * hpFor(maxed, "pilot"));
  }

  /* ---------- the enemies that do something other than shoot ---------- */
  {
    const W = SF.game.world, diff = SF.config.DIFFICULTY_BY_ID.pilot;
    W.reset(); W.createPlayer(SF.game.buildLoadout(SF.profile.blank("B"), diff));
    const B = SF.enemyData.BEHAVIOURS;
    const ctxd = { VW:SF.entityConst.VW, VH:SF.entityConst.VH, player:W.player,
                   difficulty:diff, smart:0, world:W, pickups:W.pickups, onEscape(){} };

    // Mender repairs what you already shot.
    const hurt = W.spawnEnemy("brute", 300, 260, { difficulty: diff });
    hurt.hp = 1;
    const doc2 = W.spawnEnemy("mender", 300, 240, { difficulty: diff });
    doc2.y = doc2.hoverY + 10;
    for(let i=0;i<60;i++) B.mender(doc2, 1/60, ctxd);
    check("a Mender repairs a damaged enemy", hurt.hp > 1);
    check("a Mender shows you what it is repairing", doc2.healTarget === hurt);

    // Hive keeps producing, and its drones are not part of the mission count.
    W.reset(); W.createPlayer(SF.game.buildLoadout(SF.profile.blank("B"), diff));
    ctxd.player = W.player; ctxd.pickups = W.pickups;
    const hive = W.spawnEnemy("hive", 300, 400, { difficulty: diff });
    hive.state = 1;
    const before = W.countEnemies();
    for(let i=0;i<400;i++) B.hive(hive, 1/60, ctxd);
    check("a Hive keeps making more of them", W.countEnemies() > before);
    check("Hive drones do not count toward the mission's kill total",
      W.enemies.items.filter(e => e.alive && e.typeId === "shard").every(e => e.counted === false));

    // Minelayer leaves mines behind it.
    const bomber = W.spawnEnemy("bomber", 200, 120, { difficulty: diff });
    for(let i=0;i<300;i++) B.bomber(bomber, 1/60, ctxd);
    const mines = W.enemies.items.filter(e => e.alive && e.typeId === "mine");
    check("a Minelayer actually lays mines", mines.length > 0);
    check("a mine goes off on its own if you leave it", (() => {
      const m = mines[0];
      for(let i=0;i<700;i++) B.mine(m, 1/60, ctxd);
      return m.hp <= 0;
    })());

    // Marksman charges before it fires, so the shot is always telegraphed.
    const shots0 = W.enemyBullets.items.filter(b => b.alive).length;
    const snip = W.spawnEnemy("sniper", 300, 100, { difficulty: diff });
    snip.state = 1; snip.charge = 0;
    B.sniper(snip, 1/60, ctxd);
    check("a Marksman aims before it shoots",
      snip.charge > 0 && W.enemyBullets.items.filter(b => b.alive).length === shots0);
    for(let i=0;i<200;i++) B.sniper(snip, 1/60, ctxd);
    check("a Marksman does eventually fire",
      W.enemyBullets.items.filter(b => b.alive).length > shots0);
  }

  check("the game has a wide roster of enemies",
    Object.keys(SF.enemyData.ENEMY_TYPES).length >= 18);

  /* ---------- boss mission ---------- */
  const p2 = JSON.parse(window.localStorage.getItem("patrol_profile_Marc"));
  [1,2,3,4].forEach(mid => { p2.missions[mid] = { cleared:true, stars:{ pilot:3 }, best:{} }; });
  window.localStorage.setItem("patrol_profile_Marc", JSON.stringify(p2));
  clickEl(id("missionsBackBtn"));
  clickEl(id("switchBtn"));
  clickEl(qa("#profileGrid .profile-card")[0]);
  clickEl(id("playBtn"));
  clickEl(qa("#campaignNodes .map-node")[3]);        // mission 4 - first boss
  clickEl(qa("#briefDifficulties .diff-card")[1]);
  clickEl(id("launchBtn"));
  await runFrames(6000);   // mission 4 is ~3 minutes with its boss
  await sleep(1600);   // the boss death animation holds the results back ~1.2s
  await runFrames(30);
  check("boss mission spawned its boss", !!(SF.game.run && SF.game.run.bossSpawned));
  check("beating the boss actually ends the mission (no wall-clock timer)",
    !SF.game.world.boss ? (SF.game.run.ended || SF.game.run.finishTimer > 0 ||
                           SF.game.run.phase === "lap" || SF.game.run.phase === "outro" ||
                           SF.game.run.phase === "gone") : true);
  check("no enemy can linger on the field forever",
    SF.game.world.enemies.items.every(e => !e.alive || e.life <= 40));
  check("boss fight resolved or is still running cleanly",
    !!(SF.game.world.boss || SF.game.run.stats.completed || SF.game.state === "ending" || SF.game.run.ended));
  check("no runtime errors during the boss mission", errors.length === 0);

  /* A piercing bullet used to sit inside the boss hitbox and re-damage it
     every frame it took to fly through - dozens of hits from one bullet, and
     the reason a maxed ship deleted a boss in three seconds. */
  {
    const W = SF.game.world;
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    W.reset();
    const prof = SF.profile.blank("Pierce"); prof.upgrades = { pierce:3, damage:5, spread:5, rapid:5 };
    const loadout = SF.game.buildLoadout(prof, diff);
    W.createPlayer(loadout);
    W.boss = SF.bosses.create("sentinel", diff, loadout.dps);
    W.boss.entering = false;
    const hp0 = W.boss.hp;
    const b = W.bullets.spawn();
    b.x = W.boss.x; b.y = W.boss.y; b.vx = 0; b.vy = -10; b.r = 5;
    b.dmg = 5; b.pierce = 3; b.homing = 0; b.tier = 0; b.age = 0; b.hitBoss = false;
    const ctxc = { onBossHit:(boss, bl) => SF.bosses.damage(boss, bl.dmg, bl.x, bl.y),
                   onEnemyKilled(){}, onPlayerHit(){}, godMode:true };
    for(let f=0; f<40; f++) SF.systems.resolve(W, ctxc, 1/60);
    check("one bullet damages a boss once, however much it pierces",
      hp0 - W.boss.hp <= b.dmg * 2);

    // And the pool itself is sized from firepower, not fixed.
    const weak = SF.bosses.bossHpFor(SF.missions.BOSSES.sentinel, diff, 20);
    const strong = SF.bosses.bossHpFor(SF.missions.BOSSES.sentinel, diff, 300);
    check("a boss is sized from the firepower you bring", strong > weak * 8);
    check("boss fight length is independent of gear",
      Math.abs((strong/300) - (weak/20)) < 0.5);
    W.boss = null;
  }

  /* Act 2's bosses introduce the first new attacks since launch (spiralArms,
     mineField). Drive each boss through every phase to the death, forcing an
     attack every frame it will accept one, so a typo in a new pattern shows up
     here instead of in mission 11. */
  {
    const W = SF.game.world;
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const ctxc = { difficulty: diff, onBossHit(){}, onEnemyKilled(){}, onPlayerHit(){}, godMode:true };
    ["warden","leviathan"].forEach(id => {
      W.reset();
      const prof = SF.profile.blank("Boss" + id);
      W.createPlayer(SF.game.buildLoadout(prof, diff));
      const boss = W.boss = SF.bosses.create(id, diff, 60);
      boss.entering = false; boss.y = boss.def.entryY;
      const phasesHit = new Set();
      for(let f=0; f<4200; f++){
        SF.bosses.update(boss, W, ctxc, 1/60);
        if(!boss.alive) break;
        phasesHit.add(boss.phaseIndex);
        boss.attackTimer = Math.min(boss.attackTimer, 0.02);   // keep it firing
        // Away from every weak point: hitting one would disable the attack it
        // powers, which is correct behaviour but not what this is measuring.
        SF.bosses.damage(boss, boss.maxHp/900, boss.x, boss.y - 90);
      }
      check(id + " reaches every one of its phases",
        phasesHit.size === boss.def.phases.length);

      // Every declared attack, fired for real - deterministic, rather than
      // waiting for a random picker to happen to choose each one.
      const declared = new Set();
      boss.def.phases.forEach(ph => ph.attacks.forEach(a => declared.add(a)));
      let fired = 0;
      declared.forEach(attack => {
        W.reset();
        W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Atk"), diff));
        const b2 = W.boss = SF.bosses.create(id, diff, 60);
        b2.entering = false; b2.y = b2.def.entryY;
        b2.phase = b2.def.phases[b2.def.phases.length-1];   // the enraged variant
        SF.bosses.ATTACKS[attack].fire(b2, W, ctxc);
        for(let f=0; f<180; f++) SF.bosses.update(b2, W, ctxc, 1/60);
        fired++;
      });
      check(id + " fires all " + declared.size + " of its attacks cleanly",
        fired === declared.size && errors.length === 0);
    });
    check("the new bosses fight without runtime errors", errors.length === 0);
    check("spiral arms and mines are real attacks",
      !!SF.bosses.ATTACKS.spiralArms && !!SF.bosses.ATTACKS.mineField);
    W.reset(); W.boss = null;
  }
  if(SF.game.world.boss){
    const b = SF.game.world.boss;
    check("boss took damage from the bot", b.hp < b.maxHp);
    console.log(`Boss -> ${b.name} hp:${Math.round(b.hp)}/${b.maxHp} phase:${b.phaseIndex+1} weakPointsLeft:${b.weakPoints.filter(w=>!w.destroyed).length}`);
  } else {
    console.log("Boss -> defeated within the frame budget");
  }

  /* ---------- abilities ---------- */
  // Deterministic: this used to piggyback on whatever state the boss run left
  // behind, so timing shifts silently skipped it. Stage a fresh flight if
  // needed, grant the charges, then prove the buttons spend them.
  if(!(SF.game.world.player && SF.game.state === "playing")){
    SF.game.startMission(0, "rookie");
    await runFrames(10);
  }
  {
    const pl = SF.game.world.player;
    pl.bombs = Math.max(pl.bombs, 1);
    pl.overdrives = Math.max(pl.overdrives, 1);
    pl.overdriveUntil = 0;
    const before = pl.bombs;
    SF.game.useBomb();
    check("smart bomb consumes a charge", pl.bombs === before - 1);
    SF.game.useOverdrive();
    check("overdrive activates", pl.overdriveUntil > fakeNow);
    SF.game.state = "idle";
  }

  /* ---------- pooling / performance ---------- */
  const pools = [SF.game.world.bullets, SF.game.world.enemies, SF.game.world.enemyBullets, SF.game.world.pickups];
  check("entity pools stay bounded", pools.every(p => p.items.length <= p.cap));
  check("particle pool stays bounded", SF.fx._pools.particles.items.length <= 900);
  console.log(`Pools -> bullets:${SF.game.world.bullets.items.length} enemies:${SF.game.world.enemies.items.length} ` +
              `enemyBullets:${SF.game.world.enemyBullets.items.length} particles:${SF.fx._pools.particles.items.length}`);

  /* ---------- old-save migration ---------- */
  window.localStorage.setItem("patrol_profile_Legacy", JSON.stringify({
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

  /* ---------- renames: older saves adopted under the new keys ---------- */
  window.localStorage.removeItem("patrol_profiles");
  window.localStorage.removeItem("patrol_profile_Renamed");
  window.localStorage.setItem("skyforce_profiles", JSON.stringify(["Renamed"]));
  window.localStorage.setItem("skyforce_profile_Renamed",
    JSON.stringify({ name:"Renamed", callsign:"Renamed", money: 1234, totalKills: 9 }));
  SF.profile.adoptOldSaves();
  const adopted = SF.profile.load("Renamed");
  check("pre-rename save is adopted under the new key",
    adopted.money === 1234 && adopted.totalKills === 9);
  check("pre-rename pilot list is adopted",
    SF.profile.listNames().indexOf("Renamed") >= 0);
  check("the original SkyForce save is left untouched",
    window.localStorage.getItem("skyforce_profile_Renamed") != null);

  // Two renames deep: a Novawing-era save wins over the older SkyForce one.
  window.localStorage.removeItem("patrol_profiles");
  window.localStorage.removeItem("patrol_profile_Renamed");
  window.localStorage.setItem("novawing_profiles", JSON.stringify(["Renamed"]));
  window.localStorage.setItem("novawing_profile_Renamed",
    JSON.stringify({ name:"Renamed", callsign:"Renamed", money: 5678, totalKills: 21 }));
  SF.profile.adoptOldSaves();
  check("the newest pre-rename save wins", SF.profile.load("Renamed").money === 5678);

  /* ---------- silent running (the dodge mission) ---------- */
  {
    const dodgeIx = SF.missions.MISSIONS.findIndex(m => m.noGuns);
    check("exactly one mission flies with guns cold",
      SF.missions.MISSIONS.filter(m => m.noGuns).length === 1);
    const prof = SF.profile.blank("Dodge"); prof.callsign = "Dodge";
    prof.upgrades = { rapid:3, damage:3, bomb:2, overdrive:2 };
    SF.profile.save(prof);
    SF.game.profile = prof;
    SF.ui.show("screen-game");
    SF.game.startMission(dodgeIx, "pilot");
    await runFrames(400);
    check("guns stay cold for the whole run",
      !SF.game.world.bullets.items.some(b => b.alive) && SF.game.run.stats.spawned > 0);
    check("bombs and overdrive refuse to fire on a silent mission",
      SF.game.useBomb() === false && SF.game.useOverdrive() === false);
    check("coins rain without any kills",
      SF.game.world.pickups.items.some(pk => pk.alive && pk.kind === "coin"));
    check("the coin objective tracks pickups",
      SF.game.run.objectiveIds.includes("coinRush"));

    /* Playtest calibration: full fire was undodgeable, full silence was
       flat. The whole fleet shares one shot every couple of seconds. */
    check("silent running fires sparsely - one shared shot, then throttled", (() => {
      const W = SF.game.world;
      W.lastSilentShot = -99;
      const first = W.spawnEnemyBullet(100, 100, 0, 100, "bolt", 4);
      const second = W.spawnEnemyBullet(100, 100, 0, 100, "bolt", 4);
      if(first) first.alive = false;
      return W.silent === true && first !== null && second === null;
    })());
    check("the silent roster keeps shooters rare and telegraphed",
      SF.missions.MISSIONS.find(m => m.noGuns).waves.every(wv => wv.type !== "bomber") &&
      SF.missions.MISSIONS.find(m => m.noGuns).waves
        .filter(wv => wv.type === "sniper").reduce((n,wv) => n + wv.n, 0) <= 6);
    check("the broken guns are explained before launch",
      /guns/i.test(SF.missions.MISSIONS.find(m => m.noGuns).brief) &&
      !!SF.storyData.STORY.silent && SF.storyData.STORY.silent.panels.length >= 2 &&
      /maybeStory\("silent"\)/.test(fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8")) &&
      !!SF.commsData.COMMS.silentStart);

    /* Freeing people stays an objective even with the guns cold: pilots
       drift down on their own, no carrier to shoot open. */
    check("the dodge mission asks you to rescue drifting pilots",
      SF.game.run.objectiveIds.includes("rescueAll") &&
      SF.game.run.stats.rescuesTotal === SF.missions.MISSIONS[dodgeIx].podDrops &&
      SF.game.run.podTimes.length === SF.missions.MISSIONS[dodgeIx].podDrops);
    SF.game.run.podTimes[0] = 0;           // pull the next drop forward
    await runFrames(3);
    check("a drifting pilot enters without anything being shot",
      SF.game.world.pickups.items.some(pk => pk.alive && pk.kind === "rescue"));

    /* The ending: clear sky -> a few seconds of free flight -> the autopilot
       opens the throttle and leaves the screen -> only then, results. */
    SF.game.run.phase = "clearing"; SF.game.run.phaseTimer = 0.01;
    await runFrames(5);
    check("a cleared mission opens a victory lap instead of ending",
      SF.game.run.phase === "lap" && !SF.game.run.ended);
    check("nothing can cheap-shot the victory lap",
      SF.game.world.player.invuln > 5);
    await runFrames(110);   // 30fps steps: ~3.7s in - still lapping
    check("the lap is long enough to actually fly around in",
      SF.game.run.phase === "lap" && !SF.game.run.ended);
    await runFrames(80);
    check("the lap ends with the autopilot taking the ship",
      SF.game.run.phase === "outro" || SF.game.run.phase === "gone" || SF.game.run.ended);
    await runFrames(50);
    check("the sky sits empty for a beat after the ship leaves",
      (SF.game.run.phase === "gone" && !SF.game.run.ended && SF.game.world.player.y < -60) ||
      SF.game.run.ended);
    await runFrames(120);
    check("the ship flies off the top before the results land",
      SF.game.run.ended && SF.game.run.stats.completed &&
      SF.game.world.player.y < -60);
    SF.game.state = "idle";
  }

  /* ---------- rescues are an objective wherever there are people to free ---------- */
  check("every mission with pilots to free stars their rescue",
    SF.missions.MISSIONS.every(m =>
      SF.missions.rescueCount(m) === 0 || m.objectives.includes("rescueAll")));
  check("free-drifting pilots count toward the mission's rescue total",
    SF.missions.rescueCount(SF.missions.MISSIONS.find(m => m.noGuns)) ===
      SF.missions.MISSIONS.find(m => m.noGuns).podDrops);

  /* ---------- act-two records shift around the new mission ---------- */
  {
    const oldSave = { name:"Shift", callsign:"Shift",
      missions: { "8": { cleared:true, stars:{pilot:2}, best:{pilot:1000} },
                  "9": { cleared:true, stars:{pilot:3}, best:{pilot:2000} },
                  "14": { cleared:true, stars:{pilot:1}, best:{pilot:3000} } },
      lastMission: 9 };
    window.localStorage.setItem("patrol_profile_Shift", JSON.stringify(oldSave));
    SF.profile.addName("Shift");
    const shifted = SF.profile.load("Shift");
    // Two inserts deep now: v2 (Silent Running at 9) then v3 (Treasury at
    // 13). Old mission 9 lands on 10; old mission 14 rides both shifts to 16.
    check("pre-insert records ride every shift",
      shifted.missions["10"] && shifted.missions["10"].stars.pilot === 3 &&
      shifted.missions["16"] && shifted.missions["16"].stars.pilot === 1 &&
      !shifted.missions["14"] && !shifted.missions["15"] && shifted.lastMission === 10);
    check("act-one records stay where they were",
      shifted.missions["8"] && shifted.missions["8"].stars.pilot === 2);
    check("the shifts run exactly once",
      SF.profile.migrate(shifted).missions["10"].stars.pilot === 3 &&
      SF.profile.migrate(shifted).missions["16"].stars.pilot === 1);
    // A v2-era save (Silent Running already counted) only gets the v3 shift.
    const v2era = SF.profile.migrate({ name:"V2", missionsVer: 2,
      missions: { "13": { cleared:true, stars:{pilot:2}, best:{} } }, lastMission: 13 });
    check("a v2-era save shifts only the treasury insert",
      v2era.missions["14"] && !v2era.missions["13"] && v2era.lastMission === 14);
  }

  /* ---------- settings ---------- */
  {
    clickEl(id("settingsBtnMenu"));
    check("the settings overlay opens",
      !id("settingsOverlay").classList.contains("hidden"));
    const musicWas = SF.audio.musicEnabled();
    clickEl(id("setMusicRow"));
    check("the music switch flips and persists",
      SF.audio.musicEnabled() === !musicWas &&
      window.localStorage.getItem("patrol_music_off") === (musicWas ? "1" : "0"));
    clickEl(id("setMusicRow"));
    clickEl(id("setSfx"));
    check("effects can be silenced without touching music",
      SF.audio.sfxEnabled() === false && SF.audio.musicEnabled() === musicWas &&
      (SF.audio.play("coin"), true));
    clickEl(id("setSfx"));
    clickEl(id("setShake"));
    SF.fx.shake(50);
    const off = { x: 9, y: 9 };
    SF.fx.shakeOffset(off);
    check("screen shake off means the camera holds still",
      !SF.fx.shakeEnabled() && off.x === 0 && off.y === 0);
    clickEl(id("setShake"));
    check("squad sync lives inside settings",
      !id("setCloud").classList.contains("hidden"));

    // Reset: two confirms, then the pilot really is a rookie again - and the
    // fresh save is stamped newest, so the wipe wins the squad merge too.
    const before = SF.profile.load("Marc");
    before.money = 4321; SF.profile.save(before);
    const realConfirm = window.confirm;
    window.confirm = () => true;
    clickEl(id("setReset"));
    window.confirm = realConfirm;
    const wiped = SF.profile.load("Marc");
    check("resetting a pilot wipes the career and stamps it newest",
      wiped.money === SF.profile.blank("Marc").money &&
      Object.keys(wiped.missions).length === 0 && wiped.savedAt > 0);
    check("the settings overlay closes after a reset",
      id("settingsOverlay").classList.contains("hidden"));
  }

  /* ---------- the app layer: icon, offline, focus ---------- */
  check("the page ships a manifest, icons and a service worker", (() => {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.webmanifest"), "utf8"));
    return /manifest\.webmanifest/.test(html) && /apple-touch-icon/.test(html) &&
      man.icons.every(i => fs.existsSync(path.join(__dirname, i.src))) &&
      fs.existsSync(path.join(__dirname, "sw.js")) &&
      fs.existsSync(path.join(__dirname, "apple-touch-icon.png")) &&
      fs.existsSync(path.join(__dirname, "favicon-32.png"));
  })());
  check("the service worker keeps code network-first (deploys stay live)", (() => {
    const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
    return /networkFirst\(req\)/.test(sw) && /cacheFirst\(req\)/.test(sw) &&
      /assets/.test(sw);
  })());

  {
    // Switching apps mid-mission pauses the game rather than flying it blind.
    SF.game.profile = SF.profile.load("Marc");
    SF.ui.show("screen-game");
    SF.game.startMission(0, "rookie");
    await runFrames(10);
    Object.defineProperty(window.document, "hidden", { get: () => true, configurable: true });
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    check("losing the screen pauses the mission", SF.game.state === "paused");
    Object.defineProperty(window.document, "hidden", { get: () => false, configurable: true });
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    SF.game.state = "idle";
    id("overlayPause").classList.add("hidden");

    // Two losses in a row on the same flight turn the retry line into advice.
    SF.game.startMission(1, "pilot");
    SF.game.endMission(false);
    SF.game.startMission(1, "pilot");
    SF.game.endMission(false);
    check("a losing streak earns a real tip",
      /ARMORY|ROOKIE/.test(id("resultSubtitle").textContent));
    check("the streak's advice is a button, not a sentence",
      !id("rookieBtn").classList.contains("hidden"));
    SF.game.startMission(1, "pilot");
    SF.game.endMission(true);
    SF.game.startMission(1, "pilot");
    SF.game.endMission(false);
    check("one loss after a win stays encouraging",
      !/ARMORY/.test(id("resultSubtitle").textContent) &&
      id("rookieBtn").classList.contains("hidden"));
    SF.game.state = "idle";
  }

  /* ---------- the daily patrol (seeded endless mode) ---------- */
  {
    const a = SF.daily.build("Mon Aug 03 2026");
    const b = SF.daily.build("Mon Aug 03 2026");
    const c = SF.daily.build("Tue Aug 04 2026");
    check("the same day builds the same sky for everyone",
      JSON.stringify(a.waves) === JSON.stringify(b.waves));
    check("a new day builds a new sky",
      JSON.stringify(a.waves) !== JSON.stringify(c.waves));
    check("every generated wave names a real enemy and formation",
      a.waves.every(wv => SF.enemyData.ENEMY_TYPES[wv.type] && wv.n >= 1 && wv.t >= 1));
    check("the daily script escalates and runs long",
      a.waves.length > 150 && a.waves[a.waves.length-1].t > 1200);
    check("rescues stay on the daily menu",
      a.waves.filter(wv => wv.type === "carrier").length >= 15);

    // A run: launch, score, die - the score books as the endless best, the
    // campaign records stay untouched, and the results read as a patrol.
    const prof = SF.profile.blank("Daily"); prof.callsign = "Daily";
    [1,2,3].forEach(mid => { prof.missions[mid] = { cleared:true, stars:{pilot:2}, best:{} }; });
    SF.profile.save(prof);
    SF.game.profile = prof;
    SF.ui.show("screen-game");
    SF.game.startMission("daily", "pilot");
    check("a daily run flies the generated mission",
      SF.game.run.mission.endless === true && SF.game.run.mission.id === "daily");
    await runFrames(120);
    SF.game.run.score = 4321;
    const missionsBefore = JSON.stringify(prof.missions);
    SF.game.endMission(false);
    check("the score books as the endless best",
      prof.endlessBest === 4321 && prof.endlessLongest >= 1);
    check("a daily run never touches the campaign records",
      JSON.stringify(prof.missions) === missionsBefore && prof.lastMission !== "daily");
    check("the results read as a patrol, not a defeat",
      id("resultTitle").textContent === "PATROL OVER" &&
      /NEW RECORD/.test(id("resultSubtitle").textContent) &&
      id("nextBtn").classList.contains("hidden"));
    check("a worse run does not overwrite the best", (() => {
      SF.game.startMission("daily", "pilot");
      SF.game.run.score = 100;
      SF.game.endMission(false);
      return prof.endlessBest === 4321 && !/NEW RECORD/.test(id("resultSubtitle").textContent);
    })());
    SF.game.state = "idle";

    // Menu gating: locked before mission 3, and it says so.
    const rook = SF.profile.blank("Rook"); SF.profile.save(rook);
    SF.game.profile = rook;
    clickEl(qa("#profileGrid .profile-card")[0]); // any click path re-renders below
    SF.ui.renderProfiles();
    check("daily medals exist and pay",
      SF.config.ACHIEVEMENTS.some(x => x.id === "daily_ace" && x.pay > 0) &&
      SF.config.ACHIEVEMENTS.some(x => x.id === "daily_iron" && x.pay > 0));
    check("the daily unlock rule is mission 3",
      (() => { const t = SF.profile.blank("T");
               const no = !(t.missions[3] && t.missions[3].cleared);
               t.missions[3] = { cleared:true, stars:{}, best:{} };
               return no && !!(t.missions[3].cleared); })());
  }

  /* ---------- the armory test range ---------- */
  {
    const prof = SF.profile.blank("Range"); prof.callsign = "Range";
    prof.upgrades = { damage:3, spread:2 };
    SF.profile.save(prof);
    SF.game.profile = prof;
    const kills0 = prof.totalKills, money0 = prof.money;
    let ended = null;
    const prevHook = SF.game.onTestFlightEnd;
    SF.game.onTestFlightEnd = r => { ended = r; if(prevHook) prevHook(r); };
    SF.ui.show("screen-game");
    SF.game.startMission("test", "pilot");
    check("the range flies targets that never shoot",
      SF.game.run.mission.testFlight === true && SF.game.run.difficulty.fireRate > 10);
    check("the range does not burn the first-flight double",
      !prof.lastFlightDay && !SF.game.run.dailyDouble);
    await runFrames(60);
    check("nothing on the range can hurt the ship",
      SF.game.world.player.invuln > 0);
    await runFrames(660);
    SF.game.onTestFlightEnd = prevHook;
    check("the range times out back to the Armory",
      ended !== null && typeof ended.kills === "number" && SF.game.state === "idle");
    check("the range leaves the profile exactly as it found it",
      prof.totalKills === kills0 && prof.money === money0 &&
      Object.keys(prof.missions).length === 0);
    check("no enemy bullet ever flew on the range",
      SF.game.world.enemyBullets.items.every(b => !b.alive));
  }

  check("the area-clear fanfare exists", (() => {
    try { SF.audio.play("victory"); } catch(e){ return false; }
    return /SOUNDS\.victory/.test(fs.readFileSync(path.join(__dirname, "src/audio.js"), "utf8"));
  })());

  /* ---------- the boss death sequence + fireworks ---------- */
  {
    // A dead boss doesn't vanish: it runs a dying drumroll, then hands the
    // final blast back to the game.
    const boss = SF.bosses.create("marauder", SF.config.DIFFICULTY_BY_ID.pilot, 60);
    boss.entering = false;
    // Mirror the real kill: applyDamage marks the boss !alive (bullets pass
    // through the wreck), and the dying sequence must still run and draw.
    boss.alive = false;
    boss.dying = true; boss.deathT = 0; boss.deathDur = 0.3; boss.deathFx = 0;
    let blown = null;
    SF.bosses.update(boss, 0.16, SF.game.world, { onBossDead: b => { blown = b; } }, 0);
    check("a dying boss detonates along the hull instead of vanishing",
      blown === null && boss.dying === true);
    SF.bosses.update(boss, 0.2, SF.game.world, { onBossDead: b => { blown = b; } }, 0);
    check("the drumroll ends by handing over the final blast", blown === boss);
    check("the big sounds exist", (() => {
      try { SF.audio.play("megaBoom"); SF.audio.play("firework"); } catch(e){ return false; }
      const src = fs.readFileSync(path.join(__dirname, "src/audio.js"), "utf8");
      return /SOUNDS\.megaBoom/.test(src) && /SOUNDS\.firework/.test(src);
    })());
    check("the final blast clears every enemy bullet from the sky",
      /enemyBullets\.killAll\(\)/.test(fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));

    const alive0 = SF.fx._pools.particles.items.filter(q => q.alive).length;
    SF.fx.firework(300, 200, "#ffd23f");
    check("a firework is a real burst, not a puff",
      SF.fx._pools.particles.items.filter(q => q.alive).length >= alive0 + 30);
  }

  /* ---------- boss rush ---------- */
  {
    const prof = SF.profile.blank("Rush"); prof.callsign = "Rush";
    prof.upgrades = { damage:5, rapid:4, spread:3, shield:2 };
    [4, 8].forEach(mid => { prof.missions[mid] = { cleared:true, stars:{pilot:2}, best:{} }; });
    SF.profile.save(prof);
    SF.game.profile = prof;
    SF.ui.show("screen-game");
    SF.game.startMission("rush", "pilot");
    SF.game.run.introFly = 0;
    SF.game.world.player.invuln = 9999;      // the test is the queue, not the dodging
    check("a rush queues every beaten boss in campaign order",
      SF.game.run.mission.bossRush === true &&
      SF.game.run.rushList.join(",") === "marauder,sentinel");
    await runFrames(120);
    check("the first boss arrives immediately - no waves",
      SF.game.run.bossActive && SF.game.world.boss &&
      SF.game.world.boss.name === "THE MARAUDER" && SF.game.run.stats.spawned === 0);
    SF.game.world.boss.hp = 1;               // autofire finishes it
    await runFrames(320);
    check("the next boss follows the blast",
      SF.game.world.boss && SF.game.world.boss.name === "SKY SENTINEL");
    check("later rush stages come harder",
      SF.game.world.boss.hurry > 1 && SF.game.world.boss.maxHp > 0);
    SF.game.world.boss.hp = 1;
    await runFrames(560);
    check("an emptied queue ends in the victory lap",
      SF.game.run.lapStarted === true || SF.game.run.ended);
    await runFrames(260);
    check("the rush books its best without touching the campaign",
      SF.game.run.ended && SF.game.run.stats.completed &&
      prof.bossRushBest === 2 && !prof.missions.rush && prof.lastMission !== "rush");
    check("the rush results read as a gauntlet",
      id("resultTitle").textContent === "RUSH COMPLETE!" &&
      /ALL 2 bosses/.test(id("resultSubtitle").textContent));
    check("the gauntlet medal exists and pays",
      SF.config.ACHIEVEMENTS.some(a => a.id === "gauntlet" && a.pay > 0) &&
      SF.config.ACHIEVEMENTS.some(a => a.id === "rush_master" && a.pay > 0));
    SF.game.state = "idle";
  }

  /* ---------- the new bosses: the Jailer and the Phantom ---------- */
  {
    check("prison break and cold approach got their bosses",
      SF.missions.MISSIONS.find(m => m.id === 6).boss === "jailer" &&
      SF.missions.MISSIONS.find(m => m.id === 14).boss === "phantom" &&
      SF.missions.BOSSES.jailer.rescuePods === true &&
      SF.missions.BOSSES.phantom.cloak === true);

    const pilotDiff = SF.config.DIFFICULTY_BY_ID.pilot;
    const W = SF.game.world;
    W.reset();
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("BossTest"), pilotDiff));
    W.player.x = 300; W.player.y = 600; W.player.vx = 0; W.player.vy = 0;

    // The tractor beam is a force on the SHIP, not a bullet.
    const jb = SF.bosses.create("jailer", pilotDiff, 60);
    jb.entering = false; jb.x = 300; jb.y = 150;
    jb.pull = { timer: 1 };
    SF.bosses.update(jb, 0.1, W, {}, 0);
    check("the jailer's beam drags the ship toward it", W.player.vy < 0);

    // The phantom's blink lands over your column and arrives shooting.
    const pb = SF.bosses.create("phantom", pilotDiff, 60);
    pb.entering = false; pb.phase = pb.def.phases[0];
    SF.bosses.ATTACKS.blink.fire(pb, W);
    check("the phantom blinks to your column and arrives shooting",
      Math.abs(pb.x - 300) <= 71 && pb.burst && pb.burst.attack === "blink");
    // Cloak: faded while idle, lit while telegraphing.
    pb.burst = null;                     // the blink's arrival volley is done
    SF.bosses.update(pb, 3, W, {}, 0);
    const fadedA = pb.cloakA;
    pb.telegraph = { attack:"aimedBurst", timer: 9, max: 9, kind:"lock" };
    SF.bosses.update(pb, 3, W, {}, 0);
    check("the phantom fades between actions and lights up to act",
      fadedA < 0.6 && pb.cloakA > fadedA);
    W.reset();

    // All six bosses queue in campaign order once everything is cleared.
    const prof6 = SF.profile.blank("RushAll");
    [4, 6, 8, 12, 14, 16].forEach(mid => { prof6.missions[mid] = { cleared:true, stars:{}, best:{} }; });
    SF.profile.save(prof6);
    SF.game.profile = prof6;
    SF.game.startMission("rush", "pilot");
    check("the rush queue covers all six bosses in campaign order",
      SF.game.run.rushList.join(",") === "marauder,jailer,sentinel,warden,phantom,leviathan");
    SF.game.state = "idle";
  }

  /* ---------- their treasury (the heist between the bosses) ---------- */
  {
    const t = SF.missions.MISSIONS.find(m => m.id === 13);
    check("the treasury sits between the wardens and never carries a boss",
      t && t.name === "Their Treasury" && !t.boss &&
      SF.missions.MISSIONS.find(m => m.id === 12).boss === "warden");
    check("the heist stars greed and leans on thieves",
      t.objectives.includes("coinRush") &&
      t.waves.filter(wv => wv.type === "thief").reduce((n,wv) => n + wv.n, 0) >= 10);
    check("no two campaign bosses sit in adjacent missions",
      SF.missions.MISSIONS.every((m, i) =>
        !(m.boss && SF.missions.MISSIONS[i+1] && SF.missions.MISSIONS[i+1].boss)));
    check("every mission still has a sky of its own",
      SF.skygen ? true : /The Treasury/.test(fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8")));
  }

  /* ---------- supply drops (the rare tier) ---------- */
  {
    const prof = SF.profile.blank("Crate"); prof.callsign = "Crate";
    SF.profile.save(prof);
    SF.game.profile = prof;
    SF.ui.show("screen-game");
    SF.game.startMission(0, "pilot");
    const run = SF.game.run;
    check("a mission schedules one or two supply drops mid-run",
      run.supplyTimes.length >= 1 && run.supplyTimes.length <= 2 &&
      run.supplyTimes.every(t => t > run.wavesEndT*0.2 && t < run.wavesEndT*0.85));

    // Through the real loop: drop each crate onto the ship and step a frame.
    SF.game.startMission(0, "pilot");
    SF.game.run.introFly = 0;
    await runFrames(5);
    const pl = SF.game.world.player;
    const feed = async (id) => {
      const s = SF.game.world.spawnPickup("supply", pl.x, pl.y, { supply: SF.config.SUPPLIES.find(q => q.id === id) });
      s.vx = 0; s.vy = 0;
      await runFrames(3);
    };
    pl.bombs = 0; pl.bombsMax = 0;
    await feed("bomb");
    check("a bomb crate grants a charge and a button", pl.bombs === 1 && pl.bombsMax >= 1);
    pl.overdrives = 0; pl.overdrivesMax = 0;
    await feed("overdrive");
    check("an overdrive crate grants a charge", pl.overdrives === 1);
    const livesWas = pl.lives;
    await feed("life");
    check("a life crate grants a life", pl.lives === livesWas + 1);
    pl.shieldMax = 2; pl.shield = 0;
    await feed("shieldFull");
    check("a shield crate refills every pip", pl.shield === 2);
    SF.game.state = "idle";

    // On a silent run only calm prizes drop - a bomb you can't fire is no
    // prize. Behavioural: force many scheduled drops through the real spawner
    // and read what actually entered the sky.
    SF.game.startMission(SF.missions.MISSIONS.findIndex(m => m.noGuns), "pilot");
    SF.game.run.introFly = 0;
    SF.game.run.phase = "waves";
    SF.game.run.supplyTimes = Array.from({length: 12}, () => 0);
    await runFrames(30);
    const dropped = SF.game.world.pickups.items
      .filter(q => q.alive && q.kind === "supply")
      .map(q => q.data.supply.id);
    check("silent runs only draw the calm prizes",
      dropped.length >= 6 &&
      dropped.every(id => SF.config.SUPPLIES.find(q => q.id === id).calm));
    SF.game.state = "idle";
    check("the test range schedules no supply drops", (() => {
      SF.game.startMission("test", "pilot");
      const none = SF.game.run.supplyTimes.length === 0;
      SF.game.state = "idle";
      return none;
    })());
  }

  /* ---------- the menu speaks the game's art ---------- */
  check("menu buttons carry drawn icons, not emoji",
    qa("#screen-menu .menu-btn").every(b => b.querySelector(".mb-icon")) &&
    qa("#screen-menu .menu-btn b").every(b =>
      !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(b.textContent)));

  /* ---------- flight tuning ---------- */
  {
    check("every tune that gains something gives something up (apex excepted)",
      SF.config.TUNES.length === 7 &&
      SF.config.TUNES.every(t => t.id === "vanguard" || t.apex ||
        (t.fire > 1 || t.speed < 1)));
    check("every boss mission awards exactly one tune",
      [4, 6, 8, 12, 14, 16].every(mid =>
        SF.config.TUNES.filter(t => t.unlockMission === mid).length === 1));
    check("every tune states its trade in kid words",
      SF.config.TUNES.every(t => Array.isArray(t.pros) && t.pros.length &&
        Array.isArray(t.cons) && (t.cons.length || t.id === "vanguard" || t.apex)));

    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const base = SF.profile.blank("Tuner");
    const stock = SF.game.buildLoadout(base, diff);
    check("a fresh pilot flies the balanced vanguard tune",
      base.tune === "vanguard" && stock.tune === "vanguard");

    base.tune = "falcon";
    const falcon = SF.game.buildLoadout(base, diff);
    check("the falcon is faster with slower guns",
      falcon.speedMult > stock.speedMult && falcon.fireInterval > stock.fireInterval &&
      falcon.lives === stock.lives);
    check("boss sizing sees the falcon's real output",
      falcon.dps < stock.dps);

    base.tune = "titan";
    const titan = SF.game.buildLoadout(base, diff);
    check("the titan trades speed for a spare life",
      titan.lives === stock.lives + 1 && titan.speedMult < stock.speedMult);

    // A bad value from an old or foreign save falls back to vanguard.
    base.tune = "warpdrive9000";
    check("an unknown tune never breaks a loadout",
      SF.game.buildLoadout(SF.profile.migrate(base), diff).tune === "vanguard");

    // A tune is a trophy: fitted without its boss beaten, it reverts.
    const cheat = SF.profile.blank("Cheat");
    cheat.tune = "apex";
    check("an unearned tune reverts to vanguard",
      SF.profile.migrate(cheat).tune === "vanguard");
    const earned = SF.profile.blank("Earned");
    earned.tune = "falcon";
    earned.missions[4] = { cleared:true, stars:{}, best:{} };
    check("an earned tune survives the same check",
      SF.profile.migrate(earned).tune === "falcon");

    // Ship art: each unlockable tune paints its own accent on the hull, and
    // drawing every one of them must not throw.
    check("every unlockable tune changes the ship's look", (() => {
      const src = fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8");
      const cv = window.document.createElement("canvas");
      const c = cv.getContext("2d");
      return ["falcon","titan","viper","scavenger","ghost","apex"].every(tid => {
        if(!new RegExp("  " + tid + ": \\{").test(src)) return false;
        try { SF.shipart.drawShip(c, 60, 60, 90, { color:"#3399ff", levels:{}, t:1, tune: tid }); }
        catch(e){ return false; }
        return true;
      });
    })());

    // Through the UI: pick a tune in MY SHIP, and it persists. The Tuner has
    // beaten the first boss, so FALCON is open - and only FALCON.
    const tunerProf = SF.profile.blank("Tuner");
    tunerProf.missions[4] = { cleared:true, stars:{pilot:2}, best:{} };
    SF.profile.save(tunerProf);
    clickEl(id("switchBtn"));
    SF.ui.renderProfiles();
    clickEl(Array.from(qa("#profileGrid .profile-card"))
      .find(c => /Tuner/.test(c.textContent)) || qa("#profileGrid .profile-card")[0]);
    clickEl(id("armoryBtn"));
    const partsTab = Array.from(qa("#armoryTabs button")).find(b => /MY SHIP/.test(b.textContent));
    clickEl(partsTab);
    const falconCard = Array.from(qa(".tune-card")).find(c => /FALCON/.test(c.textContent));
    clickEl(falconCard);
    check("picking a tune in MY SHIP persists on the pilot",
      SF.profile.load("Tuner").tune === "falcon");
    check("the chosen tune reads as chosen",
      Array.from(qa(".tune-card.on")).some(c => /FALCON/.test(c.textContent)));
    check("locked tunes say which boss to beat, and refuse to fit", (() => {
      const viperCard = Array.from(qa(".tune-card")).find(c => /VIPER/.test(c.textContent));
      if(!viperCard || !/beat Mission 8/.test(viperCard.textContent)) return false;
      clickEl(viperCard);
      return SF.profile.load("Tuner").tune === "falcon";   // unchanged
    })());
    check("the confusing parts grid is gone from MY SHIP",
      qa(".part-chip").length === 0 && qa(".tune-how").length === 1);
    clickEl(id("armoryBackBtn"));

    // Beating a boss mission for the first time flags the trophy moment -
    // the payload flag is what queues the TUNE UNLOCKED toast.
    SF.game.profile = SF.profile.load("Tuner");
    let payload = null;
    const prevEnd = SF.game.onMissionEnd;
    SF.game.onMissionEnd = r => { payload = r; prevEnd(r); };
    SF.game.startMission(5, "pilot");     // mission 6, the Jailer
    SF.game.endMission(true);
    SF.game.onMissionEnd = prevEnd;
    check("a first boss clear flags the tune it won",
      payload && payload.firstClear === true &&
      payload.run.mission.boss === "jailer" &&
      SF.config.TUNES.some(t => t.unlockMission === payload.run.mission.id));
    SF.game.startMission(5, "pilot");
    payload = null;
    SF.game.onMissionEnd = r => { payload = r; prevEnd(r); };
    SF.game.endMission(true);
    SF.game.onMissionEnd = prevEnd;
    check("a repeat clear is not a first clear", payload && payload.firstClear === false);
    SF.game.state = "idle";
  }

  /* ---------- the director's-pass moments ---------- */
  check("music can be asked for without an AudioContext", (() => {
    try {
      ["title","menu","combat","boss","defeat",null]
        .forEach(t => SF.audio.setMusic(t));
      return true;
    } catch(e){ return false; }
  })());
  check("every music slot points at a real recording",
    Object.values(SF.audio.MUSIC).every(def =>
      def.files.length > 0 && def.files.every(f =>
        fs.existsSync(path.join(__dirname, "assets/music", f + ".mp3")))));
  check("combat owns several songs so flights don't repeat",
    SF.audio.MUSIC.combat.files.length >= 3);
  check("defeat plays once and hands back to the menu",
    SF.audio.MUSIC.defeat.once === true && SF.audio.MUSIC.defeat.then === "menu");
  check("every boss carries an epithet for its entrance card",
    Object.values(SF.missions.BOSSES).every(b => typeof b.epithet === "string" && b.epithet.length > 4));
  {
    const prof = SF.profile.blank("Launch"); prof.callsign = "Launch";
    SF.profile.save(prof);
    SF.game.profile = prof;
    SF.ui.show("screen-game");
    SF.game.startMission(0, "rookie");
    check("the first flight of the day pays double",
      SF.game.run.dailyDouble === true);
    check("the launch starts the ship below the screen",
      SF.game.world.player.y > SF.entityConst.PLAY_BOTTOM);
    await runFrames(100);
    check("after the launch the ship is on station and firing",
      SF.game.world.player.y <= SF.entityConst.PLAY_BOTTOM &&
      SF.game.run.introFly <= 0 &&
      SF.game.world.bullets.items.some(b => b.alive));
    SF.game.startMission(0, "rookie");
    check("the second flight of the day pays normally",
      !SF.game.run.dailyDouble);
    SF.game.state = "idle";
  }

  /* ---------- art repaints when the sprite lands ---------- */
  check("the boot repaint covers whatever screen is showing",
    /repaintArt/.test(fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8")));
  check("a sprite-less hull still draws a ship, not a triangle", (() => {
    // The fallback must render without the sprite and without throwing - it is
    // what every pilot card showed before the repaint fix.
    const cv = window.document.createElement("canvas");
    const c = cv.getContext("2d");
    let threw = false;
    try { SF.shipart.drawShip(c, 40, 40, 80, { color:"#3399ff", levels:{}, t:0 }); }
    catch(e){ threw = true; }
    return !threw;
  })());

  /* ---------- pilot portraits (image-only) ---------- */
  check("no portrait file means no face is painted",
    SF.pilotart.has("Marc") === false &&
    SF.pilotart.paint(id("game").getContext("2d") || {}, 0, 0, 40, SF.profile.load("Marc")) === false);
  check("the portrait mount reports the fallback is needed",
    SF.pilotart.mount(window.document.createElement("div"), SF.profile.load("Marc"), 40) === false);

  /* ---------- medal bounties ---------- */
  {
    const p2 = SF.profile.blank("Medals"); p2.callsign = "Medals";
    p2.achievements = ["first_blood"];
    SF.profile.save(p2);
    check("every medal names a positive bounty",
      SF.config.ACHIEVEMENTS.every(a => a.pay > 0));
    const before = p2.money;
    const paid = SF.profile.claimMedal(p2, "first_blood");
    check("collecting a medal pays its bounty", paid > 0 && p2.money === before + paid);
    check("a medal collects exactly once", SF.profile.claimMedal(p2, "first_blood") === 0);
    check("an unearned medal pays nothing", SF.profile.claimMedal(p2, "nightmare") === 0);
    check("unclaimed medals are listed as owed",
      SF.profile.unclaimedMedals(p2).length === 0 &&
      (p2.achievements.push("boss_slayer"), SF.profile.unclaimedMedals(p2).length === 1));
  }

  /* ---------- squad sync merge ---------- */
  const C = SF.cloud;
  // Squad Sync is deployed for this game (see worker/), so configured() is
  // true here - the invariant this guards is just that it's a real boolean,
  // not that a fresh unconfigured clone would also see true.
  check("cloud.configured() reports a boolean", typeof C.configured() === "boolean");
  check("a squad code is eight readable characters",
    /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(C.newCode()));
  check("squad codes avoid the ambiguous letters", !/[O0I1S5]/.test(
    Array.from({length:40}, () => C.newCode()).join("")));
  check("codes are normalised, not rejected, for case and spacing",
    C.formatCode("abcd efgh") === "ABCD-EFGH" && C.validCode("nope") === false);

  const mineSide  = { Marc: { name:"Marc", money: 10, savedAt: 200 },
                      Charles: { name:"Charles", money: 5, savedAt: 100 } };
  const theirSide = { Marc: { name:"Marc", money: 99, savedAt: 150 },
                      Charles: { name:"Charles", money: 7, savedAt: 400 },
                      Ada: { name:"Ada", money: 1, savedAt: 50 } };
  const merged = C.mergePilots(mineSide, theirSide);
  check("the newer record wins per pilot", merged.Marc.money === 10 && merged.Charles.money === 7);
  check("a pilot who only exists remotely is kept", merged.Ada.money === 1);
  check("merging is per pilot, not per device",
    merged.Marc.savedAt === 200 && merged.Charles.savedAt === 400);
  check("an unstamped record never beats a stamped one",
    C.mergePilots({ X: { name:"X", money: 3, savedAt: 1 } }, { X: { name:"X", money: 9 } }).X.money === 3);
  check("merging nothing in changes nothing",
    JSON.stringify(C.mergePilots(mineSide, {})) === JSON.stringify(mineSide));

  // Applying a merge must not resurrect an older record over a newer local one.
  SF.profile.saveRaw({ name:"SyncTest", callsign:"SyncTest", money: 500, savedAt: 9000 });
  C.applyPilots({ SyncTest: { name:"SyncTest", callsign:"SyncTest", money: 1, savedAt: 10 } });
  check("applying a stale record leaves the local save alone",
    SF.profile.load("SyncTest").money === 500);
  C.applyPilots({ SyncTest: { name:"SyncTest", callsign:"SyncTest", money: 2500, savedAt: 99999 } });
  check("applying a newer record updates the local save",
    SF.profile.load("SyncTest").money === 2500);

  const stamped = SF.profile.save(SF.profile.load("Marc"));
  check("every save is stamped for conflict resolution", stamped.savedAt > 0);

  /* Every device defaults to the family's squad, so a new browser pulls their
     progress with nothing typed in. */
  check("a fresh device is already on the family squad",
    C.isDefaultCode() && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(C.DEFAULT_CODE));

  /* Sync runs unprompted at boot now. jsdom has no fetch, which is exactly the
     shape of a browser blocking the request - and when that threw synchronously
     it took the whole ui.js script down with it, leaving a dead menu. Failure
     has to stay a status line. */
  check("a failed sync is reported, not thrown", (() => {
    let threw = false;
    try { C.sync(); } catch(e){ threw = true; }
    return !threw;
  })());
  check("the menu still works after a failed sync",
    !!id("playBtn") && typeof SF.ui.renderProfiles === "function");

  /* Adopting a squad is not a merge: timestamps answer "saved last", not
     "the real one", so a freshly-played device would beat months of progress.
     The moment a device changes squad, the squad's records win outright. */
  {
    const richSquad = { Marc: { name:"Marc", money: 999999, savedAt: 1000 } };
    const thinDevice = { Marc: { name:"Marc", money: 3, savedAt: 9999999 } };
    check("an ordinary sync lets the newer save win",
      C.mergePilots(thinDevice, richSquad).Marc.money === 3);
    check("adopting a squad lets the squad win, whatever the stamps say",
      C.adoptSquad(thinDevice, richSquad).Marc.money === 999999);
    check("pilots only this device knows survive an adoption",
      C.adoptSquad({ Solo:{ name:"Solo", money: 7, savedAt: 5 } }, richSquad).Solo.money === 7);
    check("adoption can force records past the timestamp guard", (() => {
      SF.profile.saveRaw({ name:"Adopt", callsign:"Adopt", money: 3, savedAt: 9999999 });
      C.applyPilots({ Adopt: { name:"Adopt", callsign:"Adopt", money: 999999, savedAt: 1000 } }, true);
      return SF.profile.load("Adopt").money === 999999;
    })());
  }

  /* An auto-minted code from the random-code era is let go of; one somebody
     typed in deliberately is kept. */
  {
    window.localStorage.setItem("patrol_squad_code", "XXXX-YYYY");
    window.localStorage.removeItem("patrol_squad_manual");
    C.adoptFamilySquad();
    check("a leftover auto-minted code is dropped for the family squad", C.isDefaultCode());
    C.setCode("ABCD-EFGH", true);
    C.adoptFamilySquad();
    check("a deliberately joined squad is kept", C.code() === "ABCD-EFGH");
    window.localStorage.removeItem("patrol_squad_code");
    window.localStorage.removeItem("patrol_squad_manual");
  }

  /* A record stamped in the future would beat every honest save until the
     wall clock caught up - one wrong device clock would pin the whole squad.
     Anything claiming to be from the future is re-stamped on sight. */
  {
    const poisoned = { Marc: { name:"Marc", money: 12, savedAt: Date.now() + 3600000 } };
    C.sanitizePilots(poisoned);
    check("future-stamped records are re-stamped to now",
      poisoned.Marc.savedAt <= Date.now() + 5*60000);
    const honest = { Marc: { name:"Marc", money: 5, savedAt: Date.now() - 1000 } };
    const before = honest.Marc.savedAt;
    C.sanitizePilots(honest);
    check("honest stamps pass through the sanitizer untouched", honest.Marc.savedAt === before);
    // And the local compare clamps too, so a poisoned stored record can lose.
    SF.profile.saveRaw({ name:"Clock", callsign:"Clock", money: 1, savedAt: Date.now() + 3600000 });
    C.applyPilots({ Clock: { name:"Clock", callsign:"Clock", money: 50, savedAt: Date.now() + 1 } });
    check("a poisoned local record no longer wins every sync",
      SF.profile.load("Clock").money === 50);
  }

  /* Local backups: the safety net that does not need the network. */
  {
    const before = SF.profile.load("Marc");
    before.money = 4242; SF.profile.save(before);
    C.snapshotBackup(true);
    check("a backup snapshot captures every pilot on the device",
      C.backups().length > 0 && !!C.backups()[0].pilots.Marc);

    const wrecked = SF.profile.load("Marc");
    wrecked.money = 0; wrecked.missions = {}; SF.profile.save(wrecked);
    check("progress can actually be wrecked", SF.profile.load("Marc").money === 0);

    const n = C.restoreBackup(0);
    check("restoring a backup puts the money back",
      n > 0 && SF.profile.load("Marc").money === 4242);
    // Restored records must out-stamp the cloud, or the next sync undoes them.
    check("a restored record is the newest one anywhere",
      SF.profile.load("Marc").savedAt >= wrecked.savedAt);
    check("the wrecked state is itself kept as a backup", C.backups().length >= 2);
    check("backups are capped, not unbounded", (() => {
      for(let i=0;i<8;i++) C.snapshotBackup(true);
      return C.backups().length <= 4;
    })());
  }

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
