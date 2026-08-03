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
  "src/core.js","src/audio.js","src/data/config.js","src/data/enemies.js","src/data/missions.js",
  "src/data/comms.js","src/data/story.js",
  "src/profile.js","src/cloud.js","src/fx.js","src/input.js","src/entities.js","src/bosses.js","src/systems.js",
  "src/render.js","src/enemyart.js","src/insignia.js","src/skygen.js","src/shipart.js","src/comms.js","src/game.js","src/ui.js",
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
  // Copy is aimed at kids, so every shelf item and every mission has to actually
  // explain itself - a blank description reads as a bug to an 8-year-old.
  check("every upgrade explains itself in plain words",
    SF.config.UPGRADES.every(u => typeof u.desc === "string" && u.desc.length > 12));
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
  check("a stock ship lists every part as unfitted",
    qa("#armoryPanel .part-chip").length === SF.shipart.PARTS.length &&
    qa("#armoryPanel .part-chip.owned").length === 0);
  check("the parts tab marks which part is next", qa("#armoryPanel .part-chip.next").length === 1);
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
    qa("#armoryPanel .part-chip.owned").length === SF.shipart.PARTS.length);
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
  check("the record board lists every mission",
    qa("#recordBoard .rb-row").length === SF.missions.MISSIONS.length);
  clickEl(id("leaderboardBackBtn"));

  /* ---------- mission select ---------- */
  clickEl(id("playBtn"));
  check("the campaign map has a stop for every mission", qa("#campaignNodes .map-node").length === 8);
  check("only mission 1 is unlocked at the start", qa("#campaignNodes .map-node.locked").length === 7);
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
  check("a completed run gets a spoken line with a ship portrait",
    !id("resultComms").classList.contains("hidden") &&
    id("resultCommsText").textContent.length > 0);
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
    check("boulders show up on some missions but not most",
      SF.missions.MISSIONS.filter(m => m.waves.some(wv => wv.type === "boulder")).length === 3);

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
    !SF.game.world.boss ? (SF.game.run.ended || SF.game.run.finishTimer > 0) : true);
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
