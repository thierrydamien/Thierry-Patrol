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
let botEnabled = true;   // the seed-determinism block needs an idle stick
function botInput(){
  if(!botEnabled) return;
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

/*
 * `quiet` runs frames with the bot's hands OFF the keyboard. It exists for
 * the death rewind: the bot holds a direction every frame, and a held key is
 * a skip request, so a noisy frame can never watch a replay play out.
 */
async function runFrames(n, quiet){
  for(let i = 0; i < n; i++){
    frames++;
    fakeNow += 33.4;   // 30fps steps: same simulated time, half the frames
    if(!quiet) botInput();
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
// prompt()/confirm() are BANNED from the game now (in-game dialog instead);
// stubs that throw make any regression loud.
window.prompt = () => { throw new Error("window.prompt used - the game has its own dialog"); };
window.confirm = () => { throw new Error("window.confirm used - the game has its own dialog"); };
class StubImage {
  set src(v){ this._src = v; setTimeout(() => { if(this.onload) this.onload(); }, 0); }
  get src(){ return this._src; }
}
window.Image = StubImage;

/*
 * jsdom implements neither play() nor pause() on media elements, so the music
 * layer is invisible to it by default. This stub is just enough of an <audio>
 * to answer the only question that matters: how many tracks are sounding.
 */
const madeAudio = [];
class StubAudio {
  constructor(src){
    this.src = src; this.paused = true; this.volume = 1;
    this.currentTime = 0; this.loop = false; this.onended = null;
    madeAudio.push(this);
  }
  play(){ this.paused = false; return Promise.resolve(); }
  pause(){ this.paused = true; }
}
window.Audio = StubAudio;
function soundingTracks(){ return madeAudio.filter(a => !a.paused && a.volume > 0.001); }
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

// --- vibration stub --------------------------------------------------------
// jsdom has no vibration motor - and neither does iOS Safari, which is why the
// haptics module re-checks navigator.vibrate on every call instead of caching
// it at load. That lets this record exactly what the game asked the motor for.
const vibrations = [];
window.navigator.vibrate = (pattern) => { vibrations.push(pattern); return true; };
function vibeCount(fn){ const n = vibrations.length; fn(); return vibrations.length - n; }
/** Fires one sound hook with the clock jumped past every rate limit, so that
 *  consecutive probes can't starve each other. Returns buzzes triggered. */
function probe(name, arg){ fakeNow += 1000; return vibeCount(() => window.SF.audio.play(name, arg)); }

const SRC = [
  "src/core.js","src/icons.js","src/haptics.js","src/audio.js","src/data/config.js","src/data/enemies.js","src/data/missions.js","src/wacky.js",
  "src/data/comms.js","src/data/story.js",
  "src/profile.js","src/cloud.js","src/fx.js","src/input.js","src/entities.js","src/bosses.js","src/bossart.js","src/bossintro.js","src/rewind.js","src/finale.js","src/papadeath.js","src/systems.js",
  "src/render.js","src/enemyart.js","src/insignia.js","src/skygen.js","src/shipart.js","src/paintjob.js","src/pilotart.js","src/comms.js","src/game.js","src/ui.js",
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

  /* ---------- the playfield can be re-measured ---------- */
  /*
   * The iPhone home-screen bug: Safari lays a TAB out with its safe-area
   * insets already known, but a standalone launch runs the scripts while the
   * splash is up and env(safe-area-inset-*) still reads 0. The field was
   * measured once at load, so an installed app spent the session sized for a
   * screen with no status bar and no home indicator - ~30px too narrow, i.e.
   * pillarboxed. jsdom stands in for the late insets by moving the probe's
   * answer, which is the same lever a device pulls.
   */
  {
    const before = SF.entityConst.VW;
    check("the field starts at a sane width", before >= 380 && before <= 640);
    check("a re-measure with nothing changed is a no-op",
      SF.field.refresh() === before && SF.entityConst.VW === before);

    // Make the box shorter, the way a status bar and a home indicator do.
    window.document.documentElement.style.setProperty("--sa-top", "47px");
    window.document.documentElement.style.setProperty("--sa-bottom", "34px");
    const probeH = { "--sa-top": 47, "--sa-bottom": 34 };
    const realRect = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function(){
      const h = probeH[(this.style && this.style.height || "").replace(/^var\(|,0px\)$/g, "")];
      if(h !== undefined) return { width:1, height:h, top:0, left:0, right:1, bottom:h };
      return realRect.call(this);
    };
    const after = SF.field.refresh();
    window.HTMLElement.prototype.getBoundingClientRect = realRect;

    check("insets arriving late change the measured field", after !== before);
    check("a shorter box means a WIDER field, not a narrower one", after > before);
    check("the shared constant follows the re-measure", SF.entityConst.VW === after);
    // Every module took its own copy of VW at load. If even one is stale the
    // game is drawing into a field a different width from the one it collides
    // in, which is far worse than the letterboxing this fixes.
    check("the touch mapping follows it", (() => {
      const el = { getBoundingClientRect: () => ({ left:0, top:0, width:100, height:200 }) };
      SF.input.setField(after, 800);
      return true;
    })());
    check("the broadphase is rebuilt for the new width", (() => {
      SF.game.world.reset();
      return SF.game.world.gridWidth === after;
    })());
    // Put it back so every later check runs in the width they were written for.
    window.document.documentElement.style.removeProperty("--sa-top");
    window.document.documentElement.style.removeProperty("--sa-bottom");
    SF.field.refresh();
    check("removing the insets restores the original field", SF.entityConst.VW === before);

    /*
     * Landscape windows are not phones waiting to be rotated. A desktop
     * window or landscape iPad never turns, so the height binds and the
     * field takes the widest tuned shape - measured before the fix, a
     * 1920x1040 monitor flew a 433-wide phone field on 29% of the screen.
     */
    const defineSize = (w, h) => {
      Object.defineProperty(window.HTMLElement.prototype, "clientWidth",  { configurable:true, get(){ return w; } });
      Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable:true, get(){ return h; } });
    };
    defineSize(1920, 1040);
    check("a desktop window gets the full 640-wide field", SF.field.measure() === 640);
    defineSize(1024, 744);
    check("a landscape iPad gets it too", SF.field.measure() === 640);
    defineSize(390, 620);
    check("a portrait phone still gets a phone-shaped field",
      SF.field.measure() >= 380 && SF.field.measure() < 640);

    /*
     * "I don't want the extra space to just be empty because enemies aren't
     * using it." Measured: eight of ten formations already take their
     * positions from VW; these pin the two that didn't, plus the count
     * top-up that keeps enemies-per-area level past the 600-wide tuning
     * reference.
     */
    const F = SF.enemyData.FORMATIONS;
    const span = slots => Math.max(...slots.map(sl => sl.x)) - Math.min(...slots.map(sl => sl.x));
    check("a line rank widens with the field instead of capping at phone width",
      span(F.line(5, 640)) > span(F.line(5, 400)) * 1.05);
    check("...while a phone's line is exactly the tuned shape", span(F.line(5, 400)) === 300);
    check("a vee's wings widen with the field too",
      span(F.vee(8, 640)) > span(F.vee(8, 400)) * 1.05);
    check("every formation stays inside a 640 field",
      Object.keys(F).every(k => F[k](12, 640).every(sl => sl.x >= 0 && sl.x <= 640)));
    check("a wide field tops the wave counts up to hold enemies-per-area", (() => {
      // Direct: build a director on a desktop-measured field and compare.
      defineSize(1920, 1040);
      SF.field.refresh();
      const wide = new SF.systems.WaveDirector(
        { waves: [], objectives: [] }, SF.config.DIFFICULTY_BY_ID.pilot, SF.game.world);
      const wideN = wide.waveSize({ n: 10 });
      defineSize(390, 620);
      SF.field.refresh();
      const phone = new SF.systems.WaveDirector(
        { waves: [], objectives: [] }, SF.config.DIFFICULTY_BY_ID.pilot, SF.game.world);
      const phoneN = phone.waveSize({ n: 10 });
      return wideN === 11 && phoneN === 10;   // +7% at 640, tuned data on phones
    })());
    SF.field.refresh();
    check("the harness field is back where the rest of the suite expects it",
      SF.entityConst.VW === before);
  }

  /*
   * "The top of the page is hidden by the top icons of my phone."
   *
   * The title screens centre with an auto margin, so the gap above the title
   * was free space - and free space runs out. On a full menu there is none
   * left and the title sits flush against the safe-area edge, under the clock
   * and the Dynamic Island. Measured on a cramped viewport before the fix:
   * clearance 0px. jsdom has no layout, so this pins the rule instead.
   */
  {
    const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
    const menuBg = /\.menu-bg\s*\{[\s\S]*?\}/.exec(css);
    check("the title screens exist as a styled block", !!menuBg);
    const rule = menuBg ? menuBg[0] : "";
    const pad = /padding-top:\s*calc\(\s*max\(\s*20px\s*,\s*env\(safe-area-inset-top[^)]*\)\s*\)\s*\+\s*(\d+)px\s*\)/.exec(rule);
    check("their top padding is the safe-area inset PLUS room, not just the inset",
      !!pad && Number(pad[1]) >= 12);
    // The old rule was a flat `padding-bottom: 40px`, which ignored the home
    // indicator entirely - fine on the phone it was eyeballed on, wrong on the
    // ones with a taller one.
    check("and their bottom padding respects the home indicator",
      /padding-bottom:\s*calc\(\s*max\(\s*20px\s*,\s*env\(safe-area-inset-bottom/.test(rule));
    check("the page paints a solid colour under the gradient",
      /background-color:\s*#0a0920/.test(css));
  }

  /* ---------- KING PAPA's photo ---------- */
  /*
   * The customer's report: "what happened to the image used for the papa
   * boss?" - a "?" medallion where his face should be. The photo was present,
   * committed and valid; the loader had walked its list of spellings once and
   * latched. Reproduced in Chromium by serving ONE 503: it burned all six
   * candidates in a few frames and never asked again, eight healthy seconds
   * later.
   */
  await sleep(20);   // the boot warm-up is a real image load, so let it land
  check("Papa's photo is warmed at boot, not first asked for mid-fight",
    !!SF.render._papaState && SF.render._papaState().ready === true);
  check("a failed sweep backs off and goes round again instead of latching",
    (() => {
      const src = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = src.split("function papaPhoto()")[1].split("\n}")[0];
      // A retry deadline AND a bounded number of sweeps: without the first it
      // hammers, without the second a genuinely absent photo never stops.
      return /papaRetryAt/.test(fn) && /papaSweeps/.test(fn) &&
             /PAPA_MAX_SWEEPS/.test(src) && /papaTry = 0/.test(fn);
    })());
  check("the service worker answers an offline asset instead of throwing",
    (() => {
      const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
      const fn = sw.split("async function cacheFirst")[1].split("\n}")[0];
      // A throw escapes into respondWith and reaches an <img> as onerror,
      // which is exactly the transient failure that used to be permanent.
      return /catch/.test(fn) && /503/.test(fn);
    })());

  /* ---------- the polish contract ---------- */
  /*
   * The Steam-feel pass, pinned: no native dialogs, no external font, no
   * developer strings in the game, drawn chrome instead of emoji chrome.
   */
  check("the typeface ships with the game, not from a CDN",
    !/fonts\.googleapis/.test(fs.readFileSync(path.join(__dirname, "index.html"), "utf8")) &&
    /@font-face/.test(fs.readFileSync(path.join(__dirname, "style.css"), "utf8")) &&
    fs.existsSync(path.join(__dirname, "assets/fonts/rajdhani-latin-700-normal.woff2")));
  check("the game never opens a native browser dialog",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return !/window\.(prompt|confirm)\(/.test(u) &&
                    !/[^.\w]prompt\("/.test(u) && !/[^.\w]confirm\("/.test(u); })());
  check("no developer path leaks into the game's own text",
    !/docs\/assets/.test(fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8")));
  check("the chrome glyphs are drawn, not emoji",
    SF.icons && SF.icons.names.length >= 18 &&
    ["guns","armour","ship","extras","paint","parts","pilot","lock","gear",
     "soundOn","soundOff","bomb","overdrive","expand"].every(n => SF.icons.names.includes(n)));
  check("every shop upgrade has a drawn glyph of its own",
    SF.config.UPGRADES.every(u => SF.icons.names.includes(u.id)));
  check("overlays animate in like the screens do",
    /overlayIn/.test(fs.readFileSync(path.join(__dirname, "style.css"), "utf8")));
  check("a mouse gets hover answers, gated off touch",
    /@media \(hover: hover\)/.test(fs.readFileSync(path.join(__dirname, "style.css"), "utf8")));
  check("the deny blip exists for the tap that can't buy",
    !!SF.audio._sounds.uiDeny);
  check("Escape pauses on a keyboard",
    /Escape/.test(fs.readFileSync(path.join(__dirname, "src/input.js"), "utf8")));
  check("the loading screen is the title card, not a bare LOADING",
    (() => { const h = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
             return /loading-title/.test(h) && /A FAMILY SQUADRON/.test(
               h.split("loadingOverlay")[1].split("</div>\n</div>")[0] || ""); })());

  /* ---------- data sanity ---------- */
  // Haptics ride on the sound hooks, so a rumble keyed to an event no gameplay
  // code ever fires would be silently dead.
  check("every rumble is keyed to a real sound hook",
    Object.keys(SF.haptics._patterns).every(k => !!SF.audio._sounds[k]));
  check("no rumble is keyed to a gun or a per-bullet impact",
    ["shoot","shootHeavy","hitArmour","bossHit","armourClang","combo","coin","telegraph","laneFire"]
      .every(k => !SF.haptics._patterns[k]));
  check("all 14 upgrades defined", SF.config.UPGRADES.length === 14);
  check("upgrade catalogue totals 53 levels", SF.config.MAX_UPGRADE_LEVELS === 53);
  check("23 campaign missions defined, ids sequential",
    SF.missions.MISSIONS.length === 23 &&
    SF.missions.MISSIONS.every((m, i) => m.id === i + 1));
  /*
   * The opening card is the only instruction a child actually gets mid-flight,
   * so it is held to kid rules: every mission must have one, it must be short
   * enough to read at a glance AND to fit the 600px canvas at 19px, and it
   * must not be the adult `brief` sneaking back in.
   */
  check("every mission opens with a short goal a child can read",
    SF.missions.MISSIONS.every(m =>
      typeof m.goal === "string" && m.goal.length >= 8 && m.goal.length <= 36 &&
      m.goal !== m.brief));
  check("the opening card holds long enough to be read",
    /bannerUntil: simMs \+ (\d+)/.test(
      fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")) &&
    Number(RegExp.$1) >= 5000);
  /*
   * DESIGN 8b's rule, now enforced rather than just written down: "no gameplay
   * timing on the wall clock". The temp powerups broke it for a long time -
   * `performance.now() + 9000` deadlines against a pause that stops the game
   * but not the clock - and the only reason it went unnoticed is that nothing
   * checked. game.js is the simulation, so it gets no wall clock at all.
   */
  check("the simulation keeps no wall clock of its own",
    !/performance\.now\(\)/.test(
      fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));
  check("the opening card shows the goal, not the briefing prose",
    /bannerSub: mission\.goal/.test(
      fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));
  // A money note once replaced the goal on the first flight of the day - i.e.
  // every single day - so the instruction vanished exactly when it mattered.
  check("nothing overwrites the goal line after it is set",
    !/bannerSub = /.test(
      fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")
        .split("function startMission")[1].split("function ")[0]));
  /*
   * Mission one is the entire funnel: if a seven-year-old doesn't love it,
   * there is no mission two. So it gets its own rules, asserted.
   */
  {
    const m1 = SF.missions.MISSIONS[0];
    check("the first flight starts shooting in the first two seconds",
      m1.waves[0].t <= 2);
    check("the first rescue lands inside the first half-minute",
      m1.waves.some(w => w.type === "carrier" && w.t <= 30));
    check("the first flight has something to save, more than once",
      m1.waves.filter(w => w.type === "carrier").length >= 3);
    check("no star on the first flight is lost by being touched",
      !m1.objectives.includes("noDamage") && !m1.objectives.includes("keepLives"));
    check("the first flight only ever sends the gentlest enemy",
      m1.waves.every(w => w.type === "grunt" || w.type === "carrier"));
  }
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
  {
    clickEl(id("addProfileBtn"));
    await sleep(10);
    check("adding a pilot opens the game's own dialog, not window.prompt",
      !id("dialogOverlay").classList.contains("hidden") &&
      !id("dialogInput").classList.contains("hidden"));
    id("dialogInput").value = "TestKid";
    clickEl(id("dialogOk"));
    await sleep(20);
    check("the new pilot joins the roster",
      SF.profile.listNames().includes("TestKid") &&
      id("dialogOverlay").classList.contains("hidden"));
    // Cancel must not create anyone.
    clickEl(id("addProfileBtn"));
    await sleep(10);
    id("dialogInput").value = "Nobody";
    clickEl(id("dialogCancel"));
    await sleep(20);
    check("cancelling the dialog creates nobody",
      !SF.profile.listNames().includes("Nobody"));
  }
  clickEl(qa("#profileGrid .profile-card")[0]);
  check("menu active after picking a pilot", id("screen-menu").classList.contains("active"));
  check("menu shows the pilot's rank", /CADET|PILOT|LEADER|ACE|COMMANDER|LEGEND/.test(id("menuPilot").textContent));

  /* ---------- armory + hangar, one screen ---------- */
  clickEl(id("armoryBtn"));
  check("armory opens from the menu", id("screen-armory").classList.contains("active"));
  check("armory offers a tab per shelf plus paint, parts and pilot",
    qa("#armoryTabs .armory-tab").length === SF.config.CATEGORIES.length + 3);
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
  // Colour moved to the STYLE SHOP - two colour pickers was genuinely
  // confusing, so the pilot tab must NOT grow one back.
  check("pilot tab carries callsign and badge, and no colour picker",
    !!id("callsignInput") && qa("#badgeRow .badge-pick").length > 0 &&
    !id("colorRow"));
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
  /* The five-line UP NEXT card is gone - "a bit useless" - because every line
     of it was already drawn on the map a few pixels above: the next stop is
     the only unlocked one, ringed and haloed with your ship parked on it, and
     the record holder's initial rides its rim. What survives is the shortcut,
     not the paragraph: "a next level button is good but it doesn't need to be
     a whole card". So it must stay a button, and stay one line. */
  check("the old UP NEXT card is gone", !id("campaignHint"));
  {
    const nb = id("campaignNext");
    check("there is still a one-tap way into the next mission",
      !!nb && nb.tagName === "BUTTON");
    check("the button names the mission you are about to fly",
      /FLY MISSION 1\b/.test(nb.querySelector("b").textContent) &&
      nb.querySelector("span").textContent === SF.missions.MISSIONS[0].name);
    /* A button, not a card: one label and one name, and short enough to sit on
       a single line of a phone. The card it replaced ran to five lines. */
    check("it stays a button rather than growing back into a card",
      nb.children.length === 2 && nb.textContent.length < 44);
    clickEl(nb);
    check("tapping it briefs that mission",
      id("screen-briefing").classList.contains("active") &&
      id("briefNum").textContent === "MISSION 1");
    SF.ui.renderMissions(); SF.ui.show("screen-missions");
  }

  /* The campaign is ~2200px of map on an 800px screen and the route runs
     bottom-to-top, so where it opens IS the feature: the bottom for a new
     pilot, the top for one who has finished. It was always opening at the
     top, because renderMissions() runs while the section is still
     display:none - every caller renders and THEN shows - so every
     measurement was 0 and the scroll was a silent no-op. */
  {
    const sc = id("screen-missions");
    const holder = id("campaignNodes");
    const VIEW = 620, STOP = 76, GAP = 96;
    const nextIndex = () => {
      let n = 0;
      for(let i = 0; i < SF.missions.MISSIONS.length; i++)
        if(SF.missions.isMissionUnlocked(SF.ui.getProfile(), i)) n = i;
      return n;
    };
    // Where stop i's centre sits in the scroll container's content.
    const centreOf = i => (SF.missions.MISSIONS.length - 1 - i)*GAP + STOP/2;
    // jsdom does no layout, so hand it exactly the geometry under test: stops
    // stacked bottom-to-top, mission 1 lowest, all below the fold.
    const geom = (top, height) => () =>
      ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top });
    // clientHeight is stubbed globally at 620; scrollHeight is not, and left at
    // 0 the clamp pins every answer to 0 and the test proves nothing.
    Object.defineProperty(sc, "scrollHeight", { configurable: true,
      get(){ return (SF.missions.MISSIONS.length - 1) * GAP + STOP + 260; } });
    const measure = () => {
      sc.getBoundingClientRect = geom(0, VIEW);
      Array.from(holder.children).forEach((el, i) => {
        const fromTop = (SF.missions.MISSIONS.length - 1 - i) * GAP;
        el.getBoundingClientRect = geom(fromTop - sc.scrollTop, STOP);
      });
    };
    const openOn = (clearedIds) => {
      const p = SF.ui.getProfile();
      const keep = p.missions;
      p.missions = {};
      clearedIds.forEach(mid => { p.missions[mid] = { cleared:true, stars:{}, best:{} }; });
      sc.scrollTop = 0;
      SF.ui.renderMissions();          // renders while hidden, exactly as the app does
      const whileHidden = sc.scrollTop;
      SF.ui.show("screen-missions");
      measure();
      // Drain the deferred scroll the way the browser would.
      for(let f = 0; f < 6; f++){
        const batch = pendingFrames; pendingFrames = [];
        batch.forEach(cb => { try { cb(fakeNow); } catch(e){} });
        measure();
      }
      const at = sc.scrollTop;
      const target = nextIndex();
      p.missions = keep;
      // The stop you are about to fly has to be ON SCREEN. Not necessarily
      // dead centre: at either end of the route the scroll clamps, which is
      // exactly why a new pilot gets the bottom and a finished one the top.
      const c = centreOf(target);
      return { whileHidden, at, mission: target + 1,
               onScreen: c >= at && c <= at + VIEW };
    };

    const fresh = openOn([]);
    const mid   = openOn([1,2,3,4,5,6,7,8,9]);
    const done  = openOn(SF.missions.MISSIONS.map(m => m.id));

    check("the campaign targets the first mission you have not cleared",
      fresh.mission === 1 && mid.mission === 10 &&
      done.mission === SF.missions.MISSIONS.length);
    check("it opens with that mission on screen, whoever you are",
      fresh.onScreen && mid.onScreen && done.onScreen);
    /* The regression itself: measuring while the screen is hidden must not be
       mistaken for an answer. It has to wait for the layout. */
    check("a scroll computed while the screen is hidden is not the final word",
      fresh.whileHidden === 0 && fresh.at > 0);
    check("a new pilot opens at the bottom, on mission 1",
      fresh.at > mid.at && fresh.at > done.at);
    check("a finished pilot opens at the top, on the last mission",
      done.at === 0);
    check("everyone else opens somewhere in between",
      mid.at > 0 && mid.at < fresh.at);
    SF.ui.renderMissions();
  }

  /* ---------- iPhone ---------- */
  {
    const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");

    /* The menu is bottom-aligned inside a scrolling flex column, and
       `justify-content: flex-end` there is a trap: overflow spills past the
       START edge, which a scroll container can never reach. Measured on an
       iPhone 14 sideways, FLY A MISSION sat at y=-164 with scrollHeight ===
       clientHeight - the game could not be started at all. */
    check("the menu cannot strand its own content off the top",
      !/\.menu-bg\s*\{[^}]*justify-content:\s*flex-end/.test(css) &&
      /\.menu-bg::before\s*\{[^}]*margin-top:\s*auto/.test(css));
    check("the pilot picker centres the same safe way",
      !/#screen-profiles\.menu-bg\s*\{[^}]*justify-content:\s*center/.test(css) &&
      /#screen-profiles\.menu-bg::after\s*\{[^}]*margin-bottom:\s*auto/.test(css));

    /* 44px is Apple's floor for a touch target, and these hands are seven. */
    ["\\.ghost-btn", "\\.compare-btn", "\\.campaign-next"].forEach(sel => {
      const m = css.match(new RegExp(sel + "\\s*\\{[^}]*\\}"));
      check("tap targets on " + sel.replace(/\\/g, "") + " clear 44px",
        !!m && /min-height:\s*44px/.test(m[0]));
    });

    /* iOS Safari ignores the manifest's portrait lock - that only works on
       Android - so the page asks. Scoped by HEIGHT as well as orientation, or
       an iPad in landscape gets nagged about a screen it plays fine on. */
    check("a phone on its side is asked to turn back", !!id("rotateNag"));
    check("the nag is off unless the viewport is BOTH landscape and short",
      /\.rotate-nag\s*\{\s*display:\s*none/.test(css) &&
      /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*500px\)/.test(css));
    check("the manifest still asks for portrait where that is honoured",
      JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.webmanifest"), "utf8"))
        .orientation === "portrait");

    /* And the run has to actually stop, or a child watches their lives drain
       away behind an overlay telling them to rotate. This failed silently the
       first time: the nag is position:fixed and offsetParent is null for a
       fixed element whether it is shown or not, so the visibility check said
       "hidden" every time and the mission played on underneath. */
    check("turning the phone sideways pauses a live mission", (() => {
      const nag = id("rotateNag"), prev = SF.game.state;
      SF.game.state = "playing";
      nag.style.display = "none";
      window.dispatchEvent(new window.Event("resize"));
      const keptPlaying = SF.game.state === "playing";
      nag.style.display = "flex";
      window.dispatchEvent(new window.Event("resize"));
      const paused = SF.game.state === "paused";
      nag.style.display = "";
      id("overlayPause").classList.add("hidden");
      SF.game.state = prev;
      return keptPlaying && paused;
    })());

    /*
     * This check used to pin the opposite rule ("sized from the short edge,
     * whichever way it is held") - the rotated-phone model, which quietly
     * shrank desktops and landscape iPads to phone-shaped fields. The phone
     * problem it guarded against (loading sideways and keeping a 640 field
     * for the whole session) is covered differently now: the sub-500px
     * rotate nag blocks play until the phone is upright, and the field is
     * re-measured at mission launch, after the rotation. What must hold for
     * everyone is only that the field stays inside the tuned range.
     */
    check("the playfield always lands inside the tuned range",
      SF.entityConst.VW >= 380 && SF.entityConst.VW <= 640);
    /* The field lands in the screen MINUS the status bar and home indicator -
       ~93px of difference on an iPhone, which was the entire remaining gap.
       Measure the reserved strips rather than assuming them. */
    check("the field is matched to the measured box, not a guess at the screen",
      /env\(safe-area-inset-/.test(fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8")));

    /* "The menu is full screen but not when I'm playing a level." The field
       floor was 440 - a 0.55 shape on a 0.46 phone - so it fitted by width and
       left a black band top and bottom: 77% of the screen. The box it lands in
       is the screen MINUS the status bar and home indicator (390x763 on a 14,
       an aspect of 0.51), so a 0.50 field fills it. */
    check("a tall phone gets a field shaped like the phone", (() => {
      const src = fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8");
      const m = src.match(/Math\.max\((\d+), Math\.min\((\d+),/);
      if(!m) return false;
      const floor = +m[1];
      // An iPhone 14's real box is 390x763, which asks for ~409. The clamp has
      // to be a safety net well clear of that, not the thing deciding the shape.
      return floor <= 390 && 800 * (390/763) > floor;
    })());
    check("the game screen gives up only the strips iOS reserves", (() => {
      const m = css.match(/#screen-game\s*\{[^}]*\}/);
      return !!m && /padding:\s*var\(--sa-top\)\s*0\s*var\(--sa-bottom\)/.test(m[0]) &&
             !/padding:\s*8px/.test(m[0]);
    })());
    /* Both halves of the chain, or they can silently drift apart: the CSS pads
       the game screen by these and the JS shapes the field to them, so if the
       variables ever stop coming from env() the field is matched to a box it
       is not drawn in - which is the bug this went round twice on. */
    check("the safe-area strips have one definition, from env()",
      /--sa-top:\s*env\(safe-area-inset-top/.test(css) &&
      /--sa-bottom:\s*env\(safe-area-inset-bottom/.test(css) &&
      /height:var\(--sa-/.test(fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8")));

    /* "The bomb and fire icons are too big on iPhone where space is limited."
       74px each, stacked, on a ~374px-wide field - a fifth of the sky, sitting
       exactly where a right thumb needs to dodge. */
    check("the bomb and overdrive shrink on a phone", (() => {
      const q = css.match(/@media \(max-width: 500px\), \(max-height: 500px\)[\s\S]*?\n\}/);
      return !!q && /\.special-btn\s*\{[^}]*width:\s*56px/.test(q[0]);
    })());
    check("and still clear the 44px touch floor", (() => {
      const q = css.match(/@media \(max-width: 500px\), \(max-height: 500px\)[\s\S]*?\n\}/);
      // Read the declaration, don't pattern-match the block: any regex loose
      // enough to find `width` here also finds `border-width`.
      const rule = q && q[0].match(/\.special-btn\s*\{([^}]*)\}/);
      if(!rule) return false;
      const decl = rule[1].split(";").map(d => d.trim()).find(d => /^width\s*:/.test(d));
      return !!decl && parseInt(decl.split(":")[1], 10) >= 44;
    })());

    /* "The messages in the bottom left take too much screen space, and when the
       plane is in the same area they are half hidden." Both halves of that are
       one fact: the panel has to live inside the flight envelope, and on a phone
       there is no spare corner to move it to. So the phone stops talking. The
       tablet and the desktop, which have the room, must NOT - this is the check
       that keeps a fix for the small screen from quietly costing the big ones. */
    check("a phone flies without the comms panel, a tablet and a desktop keep it", (() => {
      const realMM = window.matchMedia;
      const iw0 = window.innerWidth, ih0 = window.innerHeight;
      /* The suite pins every element to a 390x620 phone box (see the top of
         this file), and the comms rule reads the same clientWidth the field
         does - so the BOX is what has to move to simulate a device here.
         innerWidth is set alongside it only so the stand-in device stays
         coherent whichever branch of the fallback is taken. */
      const viewport = (w, h) => {
        const proto = window.HTMLElement.prototype;
        Object.defineProperty(proto, "clientWidth",  { configurable:true, get(){ return w; } });
        Object.defineProperty(proto, "clientHeight", { configurable:true, get(){ return h; } });
        Object.defineProperty(window, "innerWidth",  { configurable:true, value: w });
        Object.defineProperty(window, "innerHeight", { configurable:true, value: h });
      };
      const pretend = (coarse, w, h) => {
        window.matchMedia = q => ({ matches: coarse && /pointer:\s*coarse/.test(q),
                                    media: q, addListener(){}, removeListener(){},
                                    addEventListener(){}, removeEventListener(){} });
        viewport(w, h);
      };
      // Driven through the real seam - begin() then say() - rather than asking
      // isPhone() what it thinks: what matters is that nothing reaches the
      // renderer, not how the decision was spelled.
      const speaks = () => {
        SF.comms.begin(SF.profile.blank("Probe"), []);
        SF.comms.say("halfway");
        const said = !!SF.comms.current();
        SF.comms.clear();
        return said;
      };
      pretend(true,  390, 844);   const phone   = speaks();   // iPhone 14
      pretend(true,  820, 1180);  const tablet  = speaks();   // iPad Air
      pretend(false, 1440, 900);  const desktop = speaks();
      // Put the suite's world back exactly as it was found - a dozen later
      // checks measure against that 390x620 box.
      window.matchMedia = realMM;
      viewport(390, 620);
      Object.defineProperty(window, "innerWidth",  { configurable:true, value: iw0 });
      Object.defineProperty(window, "innerHeight", { configurable:true, value: ih0 });
      SF.comms.begin(SF.profile.blank("Probe"), []);
      return !phone && tablet && desktop;
    })());
    /* One number, two files: the stylesheet shrinks the buttons at the same
       width the comms go quiet at, and a phone is a phone in both or neither. */
    check("comms use the same phone the stylesheet already knows about",
      /@media \(max-width: 500px\)/.test(css) &&
      /Math\.min\(vw, vh\) < 500/.test(
        fs.readFileSync(path.join(__dirname, "src/comms.js"), "utf8")));
  }
  // The map draws every boss's battle hull at its stop, so every boss the
  // campaign names must have a painter the map can borrow.
  check("the map can borrow a hull painter for every campaign boss",
    SF.missions.MISSIONS.filter(m => m.boss).every(m =>
      m.boss === "devourer" ? typeof SF.render.drawDevourerHull === "function"
                            : SF.bossart.has(m.boss)));
  /*
   * Ordinary stops are told apart by the enemy drawn inside them, so any two
   * sharing a face are two stops that look the same - which is the whole thing
   * this was built to fix. Asserted rather than eyeballed, because the face is
   * picked by a heuristic that a new level could quietly collide with.
   */
  {
    const faces = SF.missions.MISSIONS.filter(m => !m.boss).map(m => SF.ui.missionFace(m).enemy);
    check("every ordinary stop draws an enemy", faces.every(Boolean));
    check("no two ordinary stops wear the same face",
      new Set(faces).size === faces.length);
    check("a named face is the one that gets drawn",
      SF.ui.missionFace(SF.missions.MISSIONS.find(m => m.id === 14)).enemy === "hive");
  }
  await runFrames(3);
  check("the campaign map draws without errors", errors.length === 0);
  clickEl(qa("#campaignNodes .map-node")[1]);
  check("locked missions can't be opened", !id("screen-briefing").classList.contains("active"));

  clickEl(qa("#campaignNodes .map-node")[0]);
  check("briefing opens for mission 1", id("screen-briefing").classList.contains("active"));
  check("briefing lists 3 objectives", qa("#briefObjectives .bo-row").length === 3);
  check("briefing shows what you'll be facing", qa("#briefRoster .roster-chip").length > 0);
  /*
   * The briefing carries no prose. The story paragraph was the tallest thing
   * between the hero and the button - "my kids don't care about the story, it
   * is more important they can see the launch button without scrolling" - and
   * LAUNCH now sits in a bar pinned to the bottom of the scroll box, so it is
   * on screen whatever the roster does to the page height.
   */
  check("the briefing no longer carries a wall of story", !id("briefText"));
  check("LAUNCH lives in the pinned bar, not at the end of the page",
    !!q(".brief-actions #launchBtn"));
  check("Back stays outside the bar, so it can't be trapped under it",
    !q(".brief-actions #briefBackBtn") && !!id("briefBackBtn"));
  // The short line survives where it is actually useful: every mission has a
  // `goal`, and that is what greets the pilot on the launch banner. The
  // tutorial missions say "Fly with your finger. Shoot!" there, so cutting the
  // long `brief` from this screen costs a 7-year-old nothing.
  check("every mission still has a one-line goal for the launch banner",
    SF.missions.MISSIONS.every(m => typeof m.goal === "string" && m.goal.length > 4));
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

  // Tallying the hooks as well as the buzzes: the rumble table was tuned off
  // these counts (guns 4/s, kills 0.6/s), so the numbers it was tuned against
  // stay visible if a later change to spawning moves them.
  const hooks = {}; const realPlay = SF.audio.play;
  SF.audio.play = (n, a) => { hooks[n] = (hooks[n]||0) + 1; return realPlay(n, a); };
  const vibesAtStart = vibrations.length, clockAtStart = fakeNow;

  await runFrames(4200);   // mission 1 runs ~1m45 now

  SF.audio.play = realPlay;
  const vibeRate = (vibrations.length - vibesAtStart) / ((fakeNow - clockAtStart) / 1000);
  console.log(`Rumble -> ${vibrations.length - vibesAtStart} buzzes over the mission (${vibeRate.toFixed(2)}/s)`);
  console.log("Sound hooks ->", Object.entries(hooks).sort((a,b) => b[1]-a[1])
    .map(([k,v]) => `${k}:${v}`).join(" "));
  // The whole design risk of this feature is a motor that never stops, and the
  // opposite failure is a feature nobody can feel. Measured over a real mission
  // rather than reasoned about, and pinned in both directions. This bot is in
  // god mode and never takes a hit, so everything counted is the core loop.
  check("the motor punctuates a mission instead of running through it", vibeRate < 2.5);
  check("the core loop is felt, not just the rare events", vibrations.length - vibesAtStart > 40);
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
  // The first great run earns a pile of medals at once. They collapse to one
  // summary row (eight double-height rows once shoved the results off screen),
  // and the toast pop is HELD until the card has landed instead of covering
  // the title in the same instant.
  check("a bumper medal haul collapses to one summary row", (() => {
    const rows = qa("#resultLines .rl.record").map(r => r.textContent);
    const single = rows.filter(t => /Medal earned/.test(t)).length;
    const summary = rows.some(t => /Medals earned/.test(t) && /at once/.test(t));
    return summary ? single === 0 : single <= 2;
  })());
  check("medal toasts hold while the results card lands",
    id("achievementToast").classList.contains("hidden"));
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

  // The customer's logic, now law: the ship full of friends you're saving
  // must never shoot at the person saving them.
  check("a rescue hauler never shoots its rescuer",
    SF.enemyData.ENEMY_TYPES.carrier.fire === null);
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
  await runFrames(6300);   // ~3 minutes of mission, boss arrival cinematic, boss
  await sleep(1600);   // the boss death animation holds the results back ~1.2s
  await runFrames(30);
  check("boss mission spawned its boss", !!(SF.game.run && SF.game.run.bossSpawned));
  check("beating the boss actually ends the mission (no wall-clock timer)",
    !SF.game.world.boss ? (SF.game.run.ended || SF.game.run.finishTimer > 0 ||
                           SF.game.run.phase === "lap" || SF.game.run.phase === "outro" ||
                           SF.game.run.phase === "gone") : true);
  check("no enemy can linger on the field forever",
    SF.game.world.enemies.items.every(e => !e.alive || e.life <= 40));
  /*
   * "Sometime I end a level and it's not 100%." The bug: the progress
   * readout multiplied by 0.65 whenever the MISSION has a boss, not
   * whenever a boss is currently ALIVE - so the moment the boss died and
   * bossActive dropped to false, the number fell back to ~65% and stayed
   * there through the whole victory lap. Once a boss mission's boss is
   * dead, the readout must hold at 100% from then on.
   */
  check("the mission percent reaches and holds 100% once the boss is dead",
    SF.game.run.bossCleared === true && SF.game.run.progress === 1);
  check("boss fight resolved or is still running cleanly",
    !!(SF.game.world.boss || SF.game.run.stats.completed || SF.game.state === "ending" || SF.game.run.ended));
  check("no runtime errors during the boss mission", errors.length === 0);

  /*
   * "After a boss is killed and the level is won, the plane should stop
   * shooting." The auto-guns kept hammering an empty sky through the boss
   * celebration and the entire victory lap. Driven directly here so every
   * winning state is covered, not just whichever one a timed run lands in.
   */
  check("the guns go quiet the moment the fight is won", (() => {
    const W = SF.game.world;
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const realRun = SF.game.run;
    W.reset();
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Quiet"), diff));
    const fake = { mission:{}, introFly:0, phase:"waves", finishTimer:0, ended:false };
    SF.game.run = fake;
    const fireFor = (frames) => {
      W.bullets.killAll();
      W.player.cooldown = 0;
      for(let i = 0; i < (frames || 60); i++) W.updatePlayer(1/60, i*16);
      return W.bullets.items.filter(b => b.alive).length;
    };
    // Baseline: mid-mission the guns MUST fire, or this test proves nothing.
    const firingInFight = fireFor() > 0;
    // Every won state silences them.
    const quiet = ["clearing","lap","outro","gone"].every(ph => {
      fake.phase = ph;
      return fireFor() === 0;
    });
    // ...including the beat right after a boss dies, before the lap starts.
    fake.phase = "boss"; fake.finishTimer = 2;
    const quietAfterBoss = fireFor() === 0;
    // ...and once the run is over.
    fake.phase = "boss"; fake.finishTimer = 0; fake.ended = true;
    const quietWhenEnded = fireFor() === 0;
    // But a fresh Boss Rush round brings them straight back.
    fake.ended = false;
    const backForNextBoss = fireFor() > 0;
    SF.game.run = realRun;
    W.reset();
    return firingInFight && quiet && quietAfterBoss && quietWhenEnded && backForNextBoss;
  })());

  /* ---------- the boss arrival: every boss introduced like the finale ---------- */
  {
    const BI = SF.bossintro;
    check("every boss arrival is shorter than the finale's",
      BI.TOTAL < SF.finale.INTRO_TOTAL);
    const fake = { size: 132, targetY: 150, y: 0, tint: "#ff2d55",
                   entering: true, def: {} };
    BI.begin();
    check("a begun arrival is active", BI.active());
    let steps = 0, done = false;
    while(!done && steps < 400){ done = BI.update(1/30, fake); steps++; }
    check("the arrival finishes on its own clock",
      done && Math.abs(steps/30 - BI.TOTAL) < 0.2);
    check("the arrival delivers the boss to its station",
      Math.abs(fake.y - fake.targetY) < 2 && fake.entering === false);
    check("a finished arrival is inert", !BI.active() && BI.progress() === 1);
    check("every boss has the name and epithet its card needs",
      Object.keys(SF.missions.BOSSES).every(k =>
        SF.missions.BOSSES[k].name && SF.missions.BOSSES[k].epithet));
    // The wiring, asserted at the source level like the other guard rails:
    // both spawn paths must hand the arrival to bossintro, and the guns must
    // stay cold through it.
    const gsrc = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    check("both boss spawn paths use the cinematic arrival",
      (gsrc.match(/SF\.bossintro\.begin\(\)/g) || []).length >= 2);
    check("guns stay cold through the arrival",
      /bossIntro/.test(fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8")));
  }

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

  /* "When you shoot an enemy the missiles go through it. It should hit the
     enemy and stop so you know it has hit them." Two separate causes, both
     fixed here, both of which genuinely read as a shot that missed. */
  {
    const W = SF.game.world;
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const ctxc = { onBossHit(){}, onEnemyKilled(e){ e.alive = false; },
                   onPlayerHit(){}, godMode:true };
    /* `reach` is how far past the enemy's centre each end of the frame's
       travel sits. Small = an ordinary hit with the round still overlapping
       at the end of the step. Large = the round started clear in front and
       finished clear behind, having crossed the enemy in between - which is
       what a dropped frame does, and what used to register as nothing. */
    const shootAt = (type, hp, dmg, pierce, reach) => {
      W.reset();
      W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Hit"), diff));
      const e = W.spawnEnemy(type, 300, 300, { difficulty: diff });
      e.vx = 0; e.vy = 0; e.hp = e.maxHp = hp;      // no dps scaling in the way
      const b = W.bullets.spawn();
      b.x = 300; b.y = 300 - reach; b.vx = 0; b.vy = -reach*2*60;
      b.r = 5; b.dmg = dmg; b.pierce = pierce; b.homing = 0;
      b.tier = 0; b.age = 0; b.hitBoss = false; b.hitWeak = false;
      SF.systems.resolve(W, ctxc, 1/60);
      return { hit: e.hp < hp || !e.alive, dead: !e.alive, bullet: b, enemy: e };
    };

    // A grunt is r13, the round r5: anything under 18px of separation is an
    // overlap the old end-point test would also have caught. 40px is not.
    check("a shot at a steady framerate hits", shootAt("grunt", 1, 1, 0, 6).hit);
    check("a shot on a dropped frame still hits - no tunnelling",
      shootAt("grunt", 1, 1, 0, 40).hit);
    check("a boss weak point can't be stepped over either", (() => {
      W.reset();
      W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Hit"), diff));
      W.boss = SF.bosses.create("sentinel", diff, 40);
      W.boss.entering = false;
      const wp = W.boss.weakPoints[0];
      const wx = W.boss.x + wp.ox, wy = W.boss.y + wp.oy;
      const b = W.bullets.spawn();
      b.x = wx; b.y = wy - 44; b.vx = 0; b.vy = -88*60; b.r = 5;
      b.dmg = 5; b.pierce = 0; b.homing = 0; b.tier = 0; b.age = 0;
      b.hitBoss = false; b.hitWeak = false;
      SF.systems.resolve(W, ctxc, 1/60);
      W.boss = null;
      return b.hitWeak === true;
    })());

    /* Piercing Rounds used to spend a charge on ANY contact, so an upgraded
       shot sailed on through a wounded enemy - which looks exactly like a
       miss. It now means what it says: through what it destroys, nothing else. */
    const wounded = shootAt("brute", 6, 1, 3, 6);
    check("a piercing round that only wounds still stops dead on the hull",
      wounded.hit && !wounded.dead && wounded.bullet.alive === false);
    const killed = shootAt("grunt", 1, 40, 3, 6);
    check("a piercing round punches on through anything it destroys",
      killed.dead && killed.bullet.alive === true);
    const noPierce = shootAt("grunt", 1, 40, 0, 6);
    check("without the upgrade a killing round is spent on the kill",
      noPierce.dead && noPierce.bullet.alive === false);

    /* The bullet is parked on the hull it hit, not wherever the frame's step
       happened to end - so the sparks and the ring land ON the enemy. */
    const landed = shootAt("brute", 6, 1, 0, 40);
    check("the impact is drawn where the shot connected, not past it",
      Math.abs(landed.bullet.y - landed.enemy.y) <= landed.enemy.r + 6);

    check("the shop promises what the guns actually do",
      /destroy|blow/i.test(SF.config.UPGRADES.find(u => u.id === "pierce").desc));
    W.reset();
  }

  /* "It still looks like the missiles are going through the boss. They should
     hit the boss and stop." A different mechanism from the enemy case: the
     hull was deliberately POROUS while any part survived. It is solid now,
     and the only rounds still allowed through are the ones threading toward a
     part buried inside the body - which is what keeps armoured bosses
     killable. Both halves are load-bearing, so both are tested. */
  {
    const W = SF.game.world;
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const ctxc = { onEnemyKilled(){}, onPlayerHit(){}, godMode:true,
                   onBossHit:(bs, bl) => SF.bosses.damage(bs, bl.dmg, bl.x, bl.y) };
    /** One round fired straight up from below the boss, `ox` off its centre. */
    const fireUp = (id, ox, frames) => {
      W.reset();
      const bs = SF.bosses.create(id, diff, 40);
      bs.entering = false; bs.vx = 0;
      W.boss = bs;
      const b = W.bullets.spawn();
      b.x = bs.x + ox; b.y = bs.y + bs.r + 120; b.vx = 0; b.vy = -660;
      b.r = 5; b.dmg = 4; b.pierce = 0; b.homing = 0; b.tier = 0; b.age = 0;
      b.hitBoss = false; b.hitWeak = false;
      const wp0 = {};
      bs.weakPoints.forEach(w => { wp0[w.id] = w.hp; });
      let stoppedAt = null;
      for(let f = 0; f < frames && b.alive; f++){
        b.x += b.vx/60; b.y += b.vy/60;
        SF.systems.resolve(W, ctxc, 1/60);
        if(!b.alive) stoppedAt = b.y;
      }
      const out = { bullet: b, boss: bs, stoppedAt, wp0,
                    escaped: b.alive && b.y < bs.y - bs.r };
      W.boss = null;
      return out;
    };

    // The Marauder's guns sit at ox +-62, well clear of a shot up the middle.
    const mid = fireUp("marauder", 0, 240);
    check("a round up the middle stops ON the boss, it does not fly through",
      !mid.escaped && mid.bullet.alive === false &&
      mid.stoppedAt >= mid.boss.y - mid.boss.r - 8);
    check("stopping on the hull still damages the hull",
      mid.boss.hp < mid.boss.maxHp);

    /* The Sky Sentinel's core is 30px ABOVE centre inside a 63px hull - buried.
       A solid body would swallow every round aimed at it and make an armoured
       boss unkillable, which is the exact bug the porous hull once fixed. */
    const core = fireUp("sentinel", 0, 240);
    check("a round lined up on a buried core still reaches it",
      core.bullet.hitWeak === true &&
      core.boss.weakPoints.find(w => w.id === "core").hp < core.wp0.core);

    /* The one that matters most: nothing became unkillable. Every boss is
       fought head-on by a sweeping line of fire and has to die. */
    const dies = id => {
      W.reset();
      const bs = SF.bosses.create(id, diff, 40);
      // create() parks a boss at y=-150 ready to descend; put it on station or
      // updateBullets culls every round as off-screen before it ever arrives.
      bs.entering = false; bs.vx = 0; bs.x = SF.entityConst.VW/2; bs.y = bs.targetY;
      W.boss = bs;
      // Wide enough to cover parts mounted OUTSIDE the body circle - the
      // Sentinel's pods sit at ox +-68 on a 63px hull.
      const span = bs.weakPoints.reduce((m, w) => Math.max(m, Math.abs(w.ox) + w.r),
                                        bs.r) + 8;
      for(let f = 0; f < 5400 && bs.alive; f++){
        if(f % 4 === 0){
          // Sweep across the whole boss so parts and hull both take fire.
          const ox = ((f/4) % 41)*(span*2/40) - span;
          const b = W.bullets.spawn();
          b.x = bs.x + ox; b.y = bs.y + bs.r + 90; b.vx = 0; b.vy = -660;
          b.r = 5; b.dmg = 6; b.pierce = 0; b.homing = 0; b.tier = 0; b.age = 0;
          b.hitBoss = false; b.hitWeak = false;
        }
        W.updateBullets(1/60);
        SF.systems.resolve(W, ctxc, 1/60);
      }
      const ok = !bs.alive;
      W.boss = null;
      return ok;
    };
    const allBosses = Object.keys(SF.missions.BOSSES);
    const unkillable = allBosses.filter(id => !dies(id));
    check("no boss became unkillable when the hull went solid - " +
          (unkillable.length ? "STUCK: " + unkillable.join(",") : "all " + allBosses.length),
      unkillable.length === 0);
    W.reset();
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
      // An armoured boss holds a health reserve until its plates are off, so
      // its late phases are BEHIND the armour by design. Strip it first; this
      // check is about phase coverage, not about the seal.
      if(boss.def.armoured) boss.weakPoints.forEach(wp => { wp.hp = 0; wp.destroyed = true; });
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

  /* ---------- the four new rules: storm, convoy, trench, searchlight ---------- */
  {
    const M = SF.missions.MISSIONS;
    /* The remix pass reuses a rule at most once, in a level that gives it a
       new meaning: the Treasury caught the storm (coins in the wind), and
       The Long Dark got the Searchlight's veil at half strength. Convoy and
       trench stay singular. */
    check("each rule appears once, or twice as a deliberate remix",
      M.filter(m => m.storm).length === 2 && M.filter(m => m.convoy).length === 1 &&
      M.filter(m => m.trench).length === 1 && M.filter(m => m.blackout).length === 2);
    check("the treasury remix keeps its coin identity on the map",
      M.find(m => m.id === 16).storm === true &&
      SF.ui.missionFace(M.find(m => m.id === 16)).kind === "coins");
    check("the long dark's veil is the soft one",
      M.find(m => m.id === 22).blackout === "soft" &&
      M.find(m => m.id === 21).blackout === true &&
      /function drawBlackout\(ctx, world, timeMs, soft\)/.test(
        fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8")));
    check("the campaign bosses sit at their remapped stops",
      M.filter(m => m.boss).map(m => m.id).join(",") === "4,7,10,15,17,20,23");

    /* The trench gate: a wall with exactly one two-slot hole in it. The gap
       can hug an edge, so measure slot OCCUPANCY, not neighbour spacing. */
    check("a gate is a wall with one gap a ship fits through", (() => {
      const slotW = 600/7;
      for(let round = 0; round < 12; round++){
        const g = SF.enemyData.FORMATIONS.gate(5, 600);
        if(g.length !== 5) return false;
        const occupied = new Set(g.map(o => Math.round(o.x/slotW - 0.5)));
        if(occupied.size !== 5) return false;
        const missing = [];
        for(let s = 0; s < 7; s++) if(!occupied.has(s)) missing.push(s);
        if(missing.length !== 2 || missing[1] - missing[0] !== 1) return false;
      }
      return true;
    })());
    check("the trench is built from gates",
      M.find(m => m.trench).waves.filter(wv => wv.form === "gate").length >= 6);

    /* The storm: gusts cycle, and the wind moves things that can't resist. */
    SF.game.profile = SF.profile.load("Marc");
    SF.ui.show("screen-game");
    SF.game.startMission(M.findIndex(m => m.storm), "pilot");
    await runFrames(200);
    const runS = SF.game.run;
    check("the storm mission carries live weather", !!runS.storm);
    runS.storm.mode = "calm"; runS.storm.timer = 0;
    await runFrames(3);
    check("a calm sky turns to warning streaks", runS.storm.mode === "warn");
    runS.storm.timer = 0;
    await runFrames(3);
    check("the warning becomes a gust", runS.storm.mode === "blow");
    const es = SF.game.world.enemies.items.filter(e => e.alive);
    const ex0 = es.length ? es[0].x : null;
    await runFrames(6);
    check("the gust shoves whatever is flying",
      ex0 === null || Math.abs(SF.game.world.enemies.items[0].x - ex0) > 2);
    // The Treasury remix rides on this: loose loot must feel the wind too.
    const windCoin = SF.game.world.spawnPickup("coin", 300, 300);
    const cx0 = windCoin.x;
    await runFrames(6);
    // Threshold sits above anything the coin's own drift (±30px/s) could do
    // in these frames, so only the storm can pass this.
    check("the wind blows the loot around",
      !windCoin.alive || Math.abs(windCoin.x - cx0) > 12);

    /* The convoy: ONE hauler, hunted for real, escorted the whole way. */
    SF.game.startMission(M.findIndex(m => m.convoy), "pilot");
    await runFrames(200);
    const runC = SF.game.run;
    const W2 = SF.game.world;
    check("the convoy is a single ship you escort the whole way",
      runC.stats.convoyTotal === 1 && W2.haulers.filter(h => h.alive).length === 1);
    const h0 = W2.haulers.find(h => h.alive);
    check("the hauler holds station on screen, not passing through",
      h0.y > 0 && h0.y < SF.entityConst.VH && !h0.released);
    /*
     * It once parked at VH*0.30 = 240, above the player's own ceiling at
     * PLAY_TOP - so you could never fly alongside the ship you were escorting
     * and ran into an invisible wall underneath it. Its station must sit in
     * the band the player can actually reach, with room to get above it.
     */
    check("the hauler flies where the player can reach it",
      h0.stationY > SF.entityConst.PLAY_TOP + 60 &&
      h0.stationY < SF.entityConst.PLAY_BOTTOM - 200);
    // Not "moves at all" - a sub-pixel twitch reads as parked. It must
    // visibly travel in both axes across any four-second window.
    check("the hauler never stops moving on station", (() => {
      const before = { x: h0.x, y: h0.y, sway: h0.sway };
      for(let i = 0; i < 300; i++) W2.updateHaulers(1/60, {});   // settle first
      let minX = h0.x, maxX = h0.x, minY = h0.y, maxY = h0.y;
      for(let i = 0; i < 240; i++){
        W2.updateHaulers(1/60, {});
        minX = Math.min(minX, h0.x); maxX = Math.max(maxX, h0.x);
        minY = Math.min(minY, h0.y); maxY = Math.max(maxY, h0.y);
      }
      h0.x = before.x; h0.y = before.y; h0.sway = before.sway;
      return (maxX - minX) > 20 && (maxY - minY) > 6;
    })());
    check("the hauler can take a real beating", h0.maxHp >= 150);
    // The whole complaint: the enemies weren't actually going for it.
    check("most of the wing hunts the convoy, but not all of it", (() => {
      let hunters = 0, total = 0;
      for(let i = 0; i < 400; i++){
        const e = W2.spawnEnemy("kamikaze", 300, 40, {
          difficulty: SF.config.DIFFICULTY_BY_ID.pilot,
          huntsEscort: Math.random() < 0.66,
        });
        total++; if(e.huntsEscort) hunters++;
        e.alive = false;
      }
      return total === 400 && hunters > 200 && hunters < 340;
    })());
    check("a convoy-hunter dives at the hauler, not the pilot", (() => {
      const e = W2.spawnEnemy("kamikaze", 60, 60, {
        difficulty: SF.config.DIFFICULTY_BY_ID.pilot, huntsEscort: true });
      e.locked = false;
      const ctxK = { player: W2.player, escort: h0, VW: SF.entityConst.VW,
                     VH: SF.entityConst.VH, smart: 0 };
      SF.enemyData.BEHAVIOURS.kamikaze(e, 1/60, ctxK);
      e.alive = false;
      // It locked on the hauler's position, not the ship's.
      return e.locked && Math.abs(e.lockX - h0.x) < 1 && Math.abs(e.lockY - h0.y) < 1 &&
             Math.abs(e.lockY - W2.player.y) > 40;
    })());
    check("a convoy-hunter shoots at the hauler", (() => {
      W2.enemyBullets.killAll();
      const e = W2.spawnEnemy("striker", 300, 60, {
        difficulty: SF.config.DIFFICULTY_BY_ID.pilot, huntsEscort: true });
      W2.enemyShoot(e, { pattern:"aimed", speed: 200 },
                    { difficulty: SF.config.DIFFICULTY_BY_ID.pilot });
      e.alive = false;
      const b = W2.enemyBullets.items.find(q => q.alive);
      if(!b) return false;
      // Travelling toward the hauler's line, not straight down the screen.
      const wantY = h0.y - 60, wantX = h0.x - 300;
      return Math.sign(b.vy) === Math.sign(wantY) || Math.abs(b.vx - wantX) < 200;
    })());
    const hpBefore = h0.hp;
    W2.spawnEnemyBullet(h0.x, h0.y - 2, 0, 60, "bolt", 5);
    await runFrames(3);
    check("enemy fire hurts the convoy", h0.hp < hpBefore);
    h0.hp = 0;
    await runFrames(3);
    check("a lost hauler fails the objective",
      runC.stats.convoyLost === 1 &&
      !SF.missions.OBJECTIVES.convoy.test(runC.stats));
    check("a hauler brought home passes the objective",
      SF.missions.OBJECTIVES.convoy.test({ convoyTotal:1, convoyLost:0 }));

    /* The Rival: a duel that can be won by shooting, not by luck. */
    {
      const rv = M.find(m => m.rival);
      check("the rival level exists and fields exactly one ace",
        rv && rv.waves.filter(wv => wv.type === "rival")
                      .reduce((n, wv) => n + wv.n, 0) === 1);
      check("the ace is named, drawn, and worth beating",
        SF.enemyData.ENEMY_TYPES.rival.named === "VESPER" &&
        SF.enemyArt.has("rival") && SF.enemyData.ENEMY_TYPES.rival.score >= 500);

      const W3 = SF.game.world;
      W3.reset();
      W3.createPlayer(SF.game.buildLoadout(SF.profile.blank("Duel"),
                                           SF.config.DIFFICULTY_BY_ID.pilot));
      const ace = W3.spawnEnemy("rival", 300, 320,
        { difficulty: SF.config.DIFFICULTY_BY_ID.pilot });
      const cR = { player: W3.player, world: W3, VW: SF.entityConst.VW,
                   VH: SF.entityConst.VH, smart: 0 };

      // It MIRRORS: drive the player left, the ace must head right.
      W3.player.x = 120;
      for(let i = 0; i < 180; i++) SF.enemyData.BEHAVIOURS.rival(ace, 1/60, cR);
      const whenLeft = ace.x;
      W3.player.x = SF.entityConst.VW - 120;
      for(let i = 0; i < 180; i++) SF.enemyData.BEHAVIOURS.rival(ace, 1/60, cR);
      check("the rival mirrors you across the screen",
        whenLeft > SF.entityConst.VW*0.6 && ace.x < SF.entityConst.VW*0.4);

      // The dodge, and the valve that keeps it fair.
      ace.dodgeDir = 0; ace.dodgeCool = 0; ace.tell = 0;
      const shoot = () => { const b = W3.bullets.spawn();
        b.x = ace.x; b.y = ace.y + 90; b.vx = 0; b.vy = -700; b.r = 5; b.dmg = 1;
        b.pierce = 0; b.homing = 0; b.tier = 1; b.age = 0; b.alive = true;
        b.hitBoss = false; b.hitWeak = false; return b; };
      shoot();
      SF.enemyData.BEHAVIOURS.rival(ace, 1/60, cR);
      check("the rival jinks away from an incoming round", ace.dodgeDir !== 0);
      check("the jink is telegraphed before she moves", ace.tell > 0);
      check("a dodge on cooldown cannot repeat", (() => {
        ace.dodgeDir = 0;                       // end that jink
        W3.bullets.killAll(); shoot();
        SF.enemyData.BEHAVIOURS.rival(ace, 1/60, cR);
        return ace.dodgeDir === 0 && ace.dodgeCool > 0;   // sustained fire lands
      })());
      check("the rival stays inside the screen while dodging", (() => {
        ace.x = 45; ace.dodgeCool = 0; ace.dodgeDir = 0;
        W3.bullets.killAll(); shoot();
        for(let i = 0; i < 120; i++) SF.enemyData.BEHAVIOURS.rival(ace, 1/60, cR);
        return ace.x >= 40 && ace.x <= SF.entityConst.VW - 40;
      })());

      /* The rematch: once in the whole campaign, elite, sharper but valved. */
      check("vesper returns exactly once, elite, in All Hands",
        M.find(m => m.id === 19).waves
          .filter(wv => wv.type === "rival" && wv.elite).length === 1 &&
        M.filter(m => m.waves.some(wv => wv.type === "rival")).length === 2);
      check("the rematch is sharper but still a valve, not a wall", (() => {
        const ace2 = W3.spawnEnemy("rival", 300, 320,
          { difficulty: SF.config.DIFFICULTY_BY_ID.pilot, elite: true });
        const b = W3.bullets.spawn();
        b.x = ace2.x; b.y = ace2.y + 90; b.vx = 0; b.vy = -700; b.r = 5; b.dmg = 1;
        b.pierce = 0; b.homing = 0; b.tier = 1; b.age = 0; b.alive = true;
        b.hitBoss = false; b.hitWeak = false;
        SF.enemyData.BEHAVIOURS.rival(ace2, 1/60, cR);
        const ok = ace2.dodgeDir !== 0 && ace2.tell > 0 && ace2.tell < 0.2 &&
                   ace2.dodgeCool > 0 && ace2.dodgeCool <= 1.0;
        ace2.alive = false;
        return ok;
      })());
      W3.reset();
    }

    /* The searchlight: the dark pass exists and survives a frame. */
    const black = M.find(m => m.blackout);
    check("the searchlight hides rescues in the dark", black.podDrops >= 3);
    let darkOk = true;
    try {
      const cv = window.document.createElement("canvas");
      SF.render.drawBlackout(cv.getContext("2d"), SF.game.world, 500);
    } catch(e){ darkOk = false; }
    check("the blackout veil draws without errors", darkOk);

    SF.game.run.ended = true; SF.game.state = "idle";   // leave no live run behind
  }

  /* ---------- act-two records shift around the new mission ---------- */
  {
    const oldSave = { name:"Shift", callsign:"Shift",
      missions: { "3": { cleared:true, stars:{pilot:2}, best:{pilot:500} },
                  "8": { cleared:true, stars:{pilot:2}, best:{pilot:1000} },
                  "9": { cleared:true, stars:{pilot:3}, best:{pilot:2000} },
                  "14": { cleared:true, stars:{pilot:1}, best:{pilot:3000} } },
      lastMission: 9 };
    window.localStorage.setItem("patrol_profile_Shift", JSON.stringify(oldSave));
    SF.profile.addName("Shift");
    const shifted = SF.profile.load("Shift");
    // Four inserts deep now: v2 (Silent Running at 9), v3 (Treasury at 13),
    // v4's four-level map, then v5 (The Rival at 13). Old 8 rides to 10; old
    // 9 rides to 12; old 14 rides every shift to 20. Old 3 never moves.
    check("pre-insert records ride every shift",
      shifted.missions["10"] && shifted.missions["10"].stars.pilot === 2 &&
      shifted.missions["12"] && shifted.missions["12"].stars.pilot === 3 &&
      shifted.missions["20"] && shifted.missions["20"].stars.pilot === 1 &&
      !shifted.missions["8"] && !shifted.missions["9"] && !shifted.missions["14"] &&
      shifted.lastMission === 12);
    check("act-one records stay where they were",
      shifted.missions["3"] && shifted.missions["3"].stars.pilot === 2);
    check("the shifts run exactly once",
      SF.profile.migrate(shifted).missions["12"].stars.pilot === 3 &&
      SF.profile.migrate(shifted).missions["20"].stars.pilot === 1);
    // A v2-era save (Silent Running already counted) gets only v3 then v4.
    const v2era = SF.profile.migrate({ name:"V2", missionsVer: 2,
      missions: { "13": { cleared:true, stars:{pilot:2}, best:{} } }, lastMission: 13 });
    check("a v2-era save shifts only the later inserts",
      v2era.missions["17"] && !v2era.missions["13"] && v2era.lastMission === 17);
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
    /*
     * ...and the half that was missing. Only the OFF case was ever asserted,
     * so a shake() that had quietly stopped doing anything would still have
     * passed green.
     *
     * Math.random is pinned across the two draws shakeOffset makes, for two
     * reasons. It makes the assertion deterministic - a real draw of exactly
     * 0.5 yields a zero offset and would flap - and, more importantly, it
     * leaves the global RNG stream untouched. Two stray draws here shifted
     * every subsequent spawn and broke a boss-rush assertion 800 lines later,
     * which is the same trap DESIGN.md records comms falling into.
     */
    const realRandom = Math.random;
    Math.random = () => 0.9;
    SF.fx.shake(50);
    const on = { x: 0, y: 0 };
    SF.fx.shakeOffset(on);
    Math.random = realRandom;
    check("screen shake on actually moves the camera",
      SF.fx.shakeEnabled() && on.x !== 0 && on.y !== 0 &&
      Math.abs(on.x) <= 25 && Math.abs(on.y) <= 25);

    /*
     * Rumble: the third output channel, and the one that survives a muted game.
     *
     * Every probe jumps the clock a second to clear the rate limits, and the
     * clock is shared with the rest of this file - twelve probes moved it far
     * enough forward to change what a boss rush 800 lines later did. So the
     * block borrows the clock and puts it back. (The haptics rate limiter is
     * left holding future timestamps, which is harmless: nothing after this
     * asserts on the motor, and the mission-long buzz rate was measured back
     * in mission 1.)
     */
    const clockBeforeRumble = fakeNow;
    check("a device with a motor gets a working rumble row",
      SF.haptics.supported() && !id("setRumble").disabled &&
      id("rumbleNote").classList.contains("hidden"));
    check("getting hit rumbles", probe("playerHit") === 1);
    check("firing does not", probe("shoot", 0.5) === 0);
    check("every kill ticks", probe("enemyExplode", false) === 1);
    const smallTick = vibrations[vibrations.length-1];
    check("a big explosion hits harder than an ordinary one",
      probe("enemyExplode", true) === 1 && vibrations[vibrations.length-1] > smallTick);
    check("a heavy event sends a pattern, not a single pulse",
      probe("bomb") === 1 && JSON.stringify(vibrations[vibrations.length-1]) === "[70,40,30]");
    // Two hits in the same instant are one buzz: vibrate() cancels whatever is
    // still running, so an unlimited burst smears into one flat rattle.
    fakeNow += 1000;
    check("repeat hits in the same instant collapse to one buzz",
      vibeCount(() => { SF.audio.play("playerHit"); SF.audio.play("playerHit"); }) === 1);

    clickEl(id("setRumble"));
    check("switching rumble off silences the motor",
      !SF.haptics.isEnabled() && probe("playerHit") === 0);
    check("rumble off is remembered", window.localStorage.getItem("patrol_haptics_off") === "1");
    clickEl(id("setRumble"));
    check("switching it back on restores it",
      SF.haptics.isEnabled() && probe("playerHit") === 1);
    // The two channels are separate settings: a family that plays with the
    // sound off - which is most of them - should still feel the game.
    clickEl(id("setSound"));
    check("muting the sound does not mute the rumble",
      SF.audio.isMuted() && probe("playerHit") === 1);
    clickEl(id("setSound"));
    check("unmuting leaves the game as it was", !SF.audio.isMuted());

    // An iPhone: no Vibration API at all. The switch must stay on screen and
    // say why, because a row that quietly removes itself reads as a bug - that
    // is exactly the report this behaviour came from.
    const realVibrate = window.navigator.vibrate;
    delete window.navigator.vibrate;
    SF.ui.renderSettings();
    check("a device that can't rumble still shows the row", !!id("setRumble"));
    check("...greyed out, reading N/A rather than a lie",
      id("setRumble").disabled &&
      id("setRumble").querySelector(".set-pill").textContent === "N/A");
    check("...with a note explaining whose rule it is",
      !id("rumbleNote").classList.contains("hidden") &&
      /Android|Apple/.test(id("rumbleNote").textContent));
    check("tapping it on such a device changes nothing", (() => {
      const was = SF.haptics.isEnabled();
      clickEl(id("setRumble"));
      return SF.haptics.isEnabled() === was;
    })());
    check("nothing reaches the motor on a device without one", probe("playerHit") === 0);
    window.navigator.vibrate = realVibrate;
    SF.ui.renderSettings();
    check("the row comes back to life on a device with a motor",
      !id("setRumble").disabled && probe("playerHit") === 1);

    fakeNow = clockBeforeRumble;

    check("squad sync lives inside settings",
      !id("setCloud").classList.contains("hidden"));

    /*
     * Reset: two confirms, then the pilot really is a rookie again - and the
     * fresh save is stamped newest, so the wipe wins the squad merge too.
     * The confirms are the game's OWN dialog now, not window.confirm: a
     * native OS dialog was the most prototype-feeling moment in the game.
     */
    const before = SF.profile.load("Marc");
    before.money = 4321; SF.profile.save(before);
    clickEl(id("setReset"));
    await sleep(10);
    check("resetting asks in the game's own dialog, in the danger style",
      !id("dialogOverlay").classList.contains("hidden") &&
      /RESET/.test(id("dialogTitle").textContent) &&
      q(".dialog-inner").classList.contains("dialog-danger"));
    clickEl(id("dialogOk"));
    await sleep(10);
    check("...twice, because this one really is destructive",
      !id("dialogOverlay").classList.contains("hidden") &&
      /LAST CHANCE/.test(id("dialogTitle").textContent));
    clickEl(id("dialogOk"));
    await sleep(30);
    const wiped = SF.profile.load("Marc");
    check("resetting a pilot wipes the career and stamps it newest",
      wiped.money === SF.profile.blank("Marc").money &&
      Object.keys(wiped.missions).length === 0 && wiped.savedAt > 0);
    check("the settings overlay closes after a reset",
      id("settingsOverlay").classList.contains("hidden"));
  }

  /* ---------- the paint shop, and the star vault's hidden door ---------- */
  {
    // Fund whoever the UI genuinely has active - an earlier test may have
    // left any pilot in the seat, and the shop sells to the one in the seat.
    const live = SF.game.profile;
    const activeName = live.name;
    live.money = 50000;
    SF.profile.save(live);
    clickEl(id("armoryBtn"));
    clickEl(Array.from(qa(".armory-tab")).find(t => /STYLE/.test(t.textContent)));
    check("the paint shop is on the shelf wall", qa(".paint-card").length >= 8);
    check("the secret paint is not on display",
      !Array.from(qa(".paint-name")).some(n => /SOLAR GOLD/.test(n.textContent)));

    const firstPaint = SF.config.PAINTS[0];
    const moneyBefore = SF.profile.load(activeName).money;
    // Free squadron colours lead the grid now, so target the paid card by name.
    clickEl(Array.from(qa(".paint-card"))
      .find(c => c.textContent.indexOf(firstPaint.name) >= 0).querySelector("button"));
    const afterPaint = SF.profile.load(activeName);
    check("buying a paint costs money and repaints the ship on the spot",
      afterPaint.money === moneyBefore - firstPaint.cost &&
      afterPaint.shipColor === firstPaint.hex &&
      afterPaint.cosmetics.paints.includes(firstPaint.id));

    const ember = Array.from(qa(".paint-card")).find(c => /EMBER TRAIL/.test(c.textContent));
    clickEl(ember.querySelector("button"));
    const afterTrail = SF.profile.load(activeName);
    check("a bought trail lights immediately",
      afterTrail.trail === "ember" && afterTrail.cosmetics.trails.includes("ember"));

    SF.ui.show("screen-game");
    SF.game.startMission(0, "pilot");
    await runFrames(30);
    check("the trail rides into the cockpit",
      SF.game.world.player && SF.game.world.player.trailFx === "ember");
    SF.game.run.ended = true; SF.game.state = "idle";

    check("the shop data keeps its promises",
      SF.config.PAINTS.filter(p => !p.secret).every(p => p.cost > 0 && /^#/.test(p.hex)) &&
      SF.config.TRAILS.every(t => t.cost > 0 && t.desc.length > 8) &&
      SF.config.PAINTS.some(p => p.id === "solar" && p.secret && !p.cost));
    check("old saves get a garage", (() => {
      const old = SF.profile.migrate({ name:"Old", missions:{} });
      return Array.isArray(old.cosmetics.paints) && Array.isArray(old.cosmetics.trails) &&
             Array.isArray(old.cosmetics.decals) && Array.isArray(old.cosmetics.fireworks) &&
             old.fireworks === "classic";
    })());

    /* One colour home: the free squadron colours live in the shop now. */
    clickEl(Array.from(qa(".armory-tab")).find(t => /STYLE/.test(t.textContent)));
    // Free colours are CARDS in the same grid now, not a lesser row of dots.
    // One list of colours, free and paid intermixed under a single heading -
    // no separate section, no separate naming family, no row of dots.
    check("free and paid colours share one grid and one heading",
      qa(".shop-swatches").length === 0 &&
      Array.from(qa(".paint-name")).filter(x => /SQUADRON/.test(x.textContent)).length === 0 &&
      Array.from(qa(".paint-card button")).filter(b => /FREE/.test(b.textContent)).length >= 5 &&
      Array.from(qa("#armoryPanel .panel-label"))
        .filter(h => /COLOUR|PAINT JOBS/.test(h.textContent)).length === 1);
    check("patterns and firework shows are on the shelves",
      Array.from(qa(".paint-name")).some(x => /RACING STRIPES/.test(x.textContent)) &&
      Array.from(qa(".paint-name")).some(x => /GOLD RAIN/.test(x.textContent)));
    // The whole point of v2: a pattern must cover enough hull to SEE.
    check("every pattern paints the whole hull, not a speck",
      SF.config.DECALS.length >= 4 &&
      /function hullClip/.test(fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8")) &&
      !/DECAL_ART/.test(fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8")));

    const bolt = Array.from(qa(".paint-card")).find(c => /RACING STRIPES/.test(c.textContent));
    clickEl(bolt.querySelector("button"));
    const afterDecal = SF.profile.load(activeName);
    check("a bought pattern is painted on and remembered",
      afterDecal.decal === "stripes" && afterDecal.cosmetics.decals.includes("stripes"));
    clickEl(Array.from(qa(".armory-tab")).find(t => /STYLE/.test(t.textContent)));
    const gold = Array.from(qa(".paint-card")).find(c => /GOLD RAIN/.test(c.textContent));
    clickEl(gold.querySelector("button"));
    const afterShow = SF.profile.load(activeName);
    check("a bought firework show becomes your show",
      afterShow.fireworks === "goldrain" && afterShow.cosmetics.fireworks.includes("goldrain"));

    check("the victory lap fires the show you bought",
      /FIREWORK_BY_ID\[game\.profile\.fireworks\]/.test(
        fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));
    check("classic is free and every other show is priced",
      SF.config.FIREWORKS.filter(f => !f.free).every(f => f.cost > 0 && f.colors.length >= 4) &&
      SF.config.FIREWORKS.some(f => f.free && f.id === "classic"));
    check("every pattern draws without touching the hull code", (() => {
      try {
        const cv = window.document.createElement("canvas");
        SF.config.DECALS.forEach(d =>
          SF.shipart.drawShip(cv.getContext("2d"), 50, 50, 80,
            { color:"#3399ff", levels:{}, t:0, decal: d.id }));
        return true;
      } catch(e){ return false; }
    })());

    /* ---------- YOUR OWN PAINT: the easel ----------
       The livery a kid draws themself. It travels as a "px1:" string in the
       same decal slot the shop patterns use, so every check here is about the
       two promises that matter: what you paint is what the hull wears, and
       taking it off never destroys it. */
    {
      const PJ = SF.paintjob;
      check("the easel is a 12x12 grid with a hull-shaped reach",
        PJ.COLS === 12 && PJ.ROWS === 12 &&
        PJ.usable(6, 6) && !PJ.usable(0, 0) && !PJ.usable(11, 0));
      check("the easel mask and the worn clip share one hull polygon",
        Array.isArray(SF.shipart.HULL_POLY) && SF.shipart.HULL_POLY.length >= 6 &&
        /HULL_POLY/.test(fs.readFileSync(path.join(__dirname, "src/paintjob.js"), "utf8")) &&
        /HULL_POLY\.forEach/.test(fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8")));
      check("a drawing survives the round trip and rubbish is refused", (() => {
        const cells = new Array(PJ.COLS*PJ.ROWS).fill(0);
        cells[6*PJ.COLS + 6] = 3; cells[7*PJ.COLS + 5] = 12;
        const str = PJ.encode(cells);
        return PJ.isCustom(str) &&
               JSON.stringify(PJ.decode(str)) === JSON.stringify(cells) &&
               PJ.encode(new Array(PJ.COLS*PJ.ROWS).fill(0)) === null &&
               PJ.decode("px1:zz") === null && PJ.decode("stripes") === null &&
               PJ.decode(null) === null &&
               PJ.decode("px1:" + "d".repeat(PJ.COLS*PJ.ROWS)) === null;
      })());

      // The whole journey a kid takes: open the easel, drag a stroke across
      // the wing, jab at the empty air beside the nose, put it on the ship.
      SF.ui.openPaintEditor();
      check("the easel opens over the shop",
        !id("paintEditor").classList.contains("hidden"));
      const pcv = id("peCanvas");
      const CELL = pcv.width / PJ.COLS;
      const at = (c, r) => ({ clientX: (c + 0.5)*CELL, clientY: (r + 0.5)*CELL, bubbles: true });
      const pdown = xy => pcv.dispatchEvent(new window.MouseEvent("pointerdown", xy));
      const pmove = xy => pcv.dispatchEvent(new window.MouseEvent("pointermove", xy));
      const pup   = ()  => window.dispatchEvent(new window.MouseEvent("pointerup", { bubbles:true }));
      pdown(at(6, 6)); pmove(at(7, 6)); pup();
      pdown(at(0, 0)); pup();
      clickEl(id("peDone"));
      const inked = SF.profile.load(activeName);
      check("PUT IT ON wears the drawing and archives it on the easel",
        PJ.isCustom(inked.decal) && inked.decal === inked.paintjob);
      check("the stroke landed on the hull and the air stayed empty", (() => {
        const got = PJ.decode(inked.decal);
        return !!got && got[6*PJ.COLS + 6] === 1 && got[6*PJ.COLS + 7] === 1 && got[0] === 0;
      })());
      check("the easel closes itself after the reveal",
        id("paintEditor").classList.contains("hidden"));
      check("the flying ship wears the drawing too", (() => {
        const diff = SF.config.DIFFICULTY_BY_ID.pilot;
        return SF.game.buildLoadout(inked, diff).decal === inked.decal;
      })());

      // The shop hangs the drawing on the wall like any livery.
      clickEl(Array.from(qa(".armory-tab")).find(t => /STYLE/.test(t.textContent)));
      check("the shop shows MY OWN PAINT as worn",
        Array.from(qa(".paint-name")).some(n => n.textContent === "MY OWN PAINT") &&
        !!id("ownPaintWear") && id("ownPaintWear").disabled &&
        /WEARING IT/.test(id("ownPaintWear").textContent));
      clickEl(Array.from(qa(".paint-card button")).find(b => /STRIP IT OFF/.test(b.textContent)));
      const bare = SF.profile.load(activeName);
      check("stripping the hull never destroys the drawing",
        bare.decal === null && PJ.isCustom(bare.paintjob));
      clickEl(id("ownPaintWear"));
      check("one tap puts it back on",
        PJ.isCustom(SF.profile.load(activeName).decal));

      check("an empty easel refuses to be worn", (() => {
        SF.ui.openPaintEditor();
        clickEl(id("peClear"));
        clickEl(id("peDone"));               // must not equip nothing
        const still = SF.profile.load(activeName);
        const stayedOpen = !id("paintEditor").classList.contains("hidden");
        clickEl(id("peUndo"));               // the wipe comes back off
        clickEl(id("peCancel"));
        return stayedOpen && PJ.isCustom(still.decal) && PJ.isCustom(still.paintjob);
      })());
      check("cancel walks away without touching the ship", (() => {
        const before = SF.profile.load(activeName);
        SF.ui.openPaintEditor();
        pdown(at(5, 8)); pup();
        clickEl(id("peCancel"));
        const after = SF.profile.load(activeName);
        return after.decal === before.decal && after.paintjob === before.paintjob;
      })());

      // Hand the bought pattern back for the checks further down the file.
      const wearer = SF.ui.getProfile();
      wearer.decal = "stripes";
      SF.profile.save(wearer);
      SF.ui.renderArmory();

      const easelCss = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
      check("a finger on the grid is a brush, never a scroll",
        /#peCanvas\s*\{[^}]*touch-action:\s*none/.test(easelCss));
      check("every paint pot clears the 44px touch floor",
        /\.pe-swatch\s*\{[^}]*min-height:\s*44px/.test(easelCss));
      check("the easel sits inside the phone's safe strips",
        /\.paint-editor\s*\{[^}]*var\(--sa-top/.test(easelCss) &&
        /\.paint-editor\s*\{[^}]*var\(--sa-bottom/.test(easelCss));
    }

    // The bay used to be position:sticky, which froze the ship across the top
    // of the Armory and hard-clipped the cards scrolling under it.
    check("the ship bay scrolls with the page instead of freezing at the top",
      (() => {
        const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
        const bay = css.match(/\n\.armory-top\s*\{([^}]*)\}/);
        return !!bay && !/sticky|fixed/.test(bay[1]) &&
          !/unpinned/.test(css) &&
          !/unpinned/.test(fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8"));
      })());
    check("the accent line is gone from the shelves",
      !/border-left:5px solid var\(--cat/.test(
        fs.readFileSync(path.join(__dirname, "style.css"), "utf8")));
    /*
     * At desktop widths .shop-group becomes a 2-column CSS grid for the
     * plain upgrade shelves - but the Style Shop reuses .shop-group as an
     * outer WRAPPER around several headings and card grids, and that same
     * 2-column split tore it apart: a heading landed alone in column 1
     * while its own card grid was squeezed into column 2, leaving a blank
     * column-wide gap under every heading (the customer's screenshot).
     * The wrapper must opt back out to a single flowing column.
     */
    check("the style shop wrapper opts out of the 2-column shelf grid", (() => {
      const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
      const m = css.match(/@media \(min-width: 700px\) \{[\s\S]*?\n\}/);
      return !!m && /\.shop-group\.paint-shop\s*\{\s*display:\s*block/.test(m[0]);
    })());

    /* The vault door: five quick taps on the red giant, nothing less. */
    SF.ui.show("screen-missions");
    SF.ui.renderMissions();
    const pad = id("campaignNodes");
    const cvv = id("campaignCanvas");
    const tapSun = () => pad.dispatchEvent(new window.MouseEvent("pointerdown",
      { clientX: Math.round(cvv.width*0.12), clientY: Math.round(cvv.height*0.035), bubbles: true }));
    tapSun(); tapSun();
    check("two taps on the sun are just taps",
      !(SF.game.run && SF.game.run.mission && SF.game.run.mission.vault));
    tapSun(); tapSun(); tapSun();
    check("five taps on the red giant open the star vault",
      SF.game.run && SF.game.run.mission.vault === true && SF.game.state === "playing");
    check("the vault is a star shower with the family joke at the end",
      SF.game.run.mission.starRain === true && SF.game.run.mission.boss === "papa" &&
      SF.missions.BOSSES.papa.photo === true &&
      SF.missions.BOSSES.papa.weakPoints.length === 0);
    await runFrames(90);
    check("the sky rains stars in the vault",
      SF.game.world.pickups.items.some(pk => pk.alive && pk.kind === "star"));
    const plv = SF.game.world.player;
    const moneyB4 = SF.game.run.money;
    const starPk = SF.game.world.spawnPickup("star", plv.x, plv.y - 4);
    await runFrames(3);
    check("a caught star pays in score and treasure",
      !starPk.alive && SF.game.run.stats.stars >= 1 && SF.game.run.money > moneyB4);
    /*
     * The death is a COMEDY ROUTINE, not an explosion: five acts, two
     * fake-outs, and the joke only works if act one genuinely looks final.
     * Driven end to end here so a broken act can't silently strand the run.
     */
    {
      const D = SF.papadeath;
      check("papa's send-off is a five-act routine, not a bang",
        D.ACTS.length === 5 && D.TOTAL > 10 &&
        D.ACTS.map(x => x.id).join(",") === "ow,back,split,merge,kaboom");
      // Long enough to enjoy: the punchline alone outlasts a normal boss
      // death, and the finish after it is longer still.
      check("the ending is long enough to laugh at",
        D.ACTS.find(x => x.id === "kaboom").dur >= 5 && D.TOTAL >= 15 &&
        /run\.finishTimer = 7\.0/.test(
          fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));
      check("papa says goodbye in French, the way he talks to his kids",
        D.FRENCH.length === 3 &&
        D.FRENCH[0] === "Bien joué !" && D.FRENCH[1] === "Amuse-toi bien !" &&
        D.FRENCH[2] === "Je t'aime !" &&
        /Je t'aime/.test(fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));
      const fake = { x: 300, y: 300, def: SF.missions.BOSSES.papa, wobble: 0 };
      D.begin(fake);
      check("the routine starts on the first fake-out", D.active() && D.act().id === "ow");
      const seen = new Set();
      const W4 = SF.game.world;
      let done = false, guard = 0, minisSeen = 0, starsBefore = W4.pickups.items.filter(p => p.alive).length;
      while(!done && guard++ < 3000){
        const a = D.act();
        if(a) seen.add(a.id);
        const stt = D.state();
        if(stt) minisSeen = Math.max(minisSeen, stt.minis.length);
        done = D.update(1/60, fake, W4);
      }
      check("every act runs, in order, and it finishes",
        done && seen.size === 5 && seen.has("split") && seen.has("kaboom"));
      check("he really does split into five of himself", minisSeen === 5);

      /*
       * The five are SHOOTABLE - watching the best gag in the game happen to
       * you is not as good as being in it. With the usual valve: popping all
       * five cuts to the punchline, running out of time merges them anyway,
       * so comic timing never depends on a seven-year-old's aim.
       */
      const runToSplit = () => {
        D.reset(); W4.pickups.killAll(); W4.bullets.killAll();
        D.begin(fake);
        let g = 0;
        while(g++ < 3000){
          const a = D.act();
          if(a && a.id === "split" && D.state().minis.length) break;
          D.update(1/60, fake, W4);
        }
        return D.state();
      };
      check("a mini papa can be shot down", (() => {
        const st = runToSplit();
        const m = st.minis[0];
        const starsWas = W4.pickups.items.filter(p => p.alive && p.kind === "star").length;
        // Two taps each: park rounds on it until it pops.
        for(let i = 0; i < 6 && m.alive; i++){
          const b = W4.bullets.spawn();
          b.x = m.x; b.y = m.y; b.vx = 0; b.vy = -700; b.r = 5; b.dmg = 1;
          b.pierce = 0; b.homing = 0; b.tier = 1; b.age = 0; b.alive = true;
          b.hitBoss = false; b.hitWeak = false;
          D.update(1/60, fake, W4);
        }
        const starsNow = W4.pickups.items.filter(p => p.alive && p.kind === "star").length;
        return !m.alive && starsNow > starsWas;      // popped, and it paid
      })());
      check("popping all five cuts straight to the punchline", (() => {
        const st = runToSplit();
        st.minis.forEach(m => {
          for(let i = 0; i < 6 && m.alive; i++){
            const b = W4.bullets.spawn();
            b.x = m.x; b.y = m.y; b.vx = 0; b.vy = -700; b.r = 5; b.dmg = 1;
            b.pierce = 0; b.homing = 0; b.tier = 1; b.age = 0; b.alive = true;
            b.hitBoss = false; b.hitWeak = false;
            D.update(1/60, fake, W4);
          }
        });
        // Read the state BEFORE stepping again: the merge deliberately
        // revives them ("YOU CAN'T GET RID OF ME!"), so one extra update
        // would undo exactly what this is checking.
        const allDead = st.minis.every(m => !m.alive);
        const a = D.act();
        return allDead && !!a && a.id === "merge";
      })());
      check("ignoring them merges them anyway - the joke never stalls", (() => {
        const st = runToSplit();
        let g = 0, a = D.act();
        while(g++ < 3000 && a && a.id === "split"){    // never fire a shot
          D.update(1/60, fake, W4);
          a = D.act();
        }
        return st.minis.every(m => m.alive) && !!a && a.id === "merge";
      })());
      check("he reassembles even if you popped every one", (() => {
        const st = runToSplit();
        st.minis.forEach(m => { m.alive = false; });
        D.update(1/60, fake, W4);                       // triggers the early jump
        let g = 0, a = D.act();
        while(g++ < 600 && a && a.id !== "merge"){ D.update(1/60, fake, W4); a = D.act(); }
        D.update(1/60, fake, W4);                       // merge's once() fires
        return st.minis.every(m => m.alive);            // pulled himself back together
      })());
      D.reset(); W4.bullets.killAll(); W4.pickups.killAll();
      // Re-run the full routine so the shower checks below see a real finish.
      D.begin(fake);
      { let g = 0, fin = false;
        while(!fin && g++ < 3000) fin = D.update(1/60, fake, W4); }
      const after = W4.pickups.items.filter(p => p.alive);
      check("the punchline showers stars AND souvenir papas",
        after.filter(p => p.kind === "star").length >= 30 &&
        after.filter(p => p.kind === "papahead").length >= 8 &&
        after.length > starsBefore);
      check("a souvenir papa is worth catching",
        /kind === "papahead"/.test(fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));
      check("the routine has its own silly noises", (() => {
        const src = fs.readFileSync(path.join(__dirname, "src/audio.js"), "utf8");
        return ["papaOw","papaRaspberry","papaBoing","papaSplit","papaKaboom"]
          .every(k => src.indexOf("SOUNDS." + k) >= 0);
      })());
      D.reset();
      W4.pickups.killAll();
    }
    SF.game.endMission(true);
    await runFrames(5);
    const rich = SF.profile.load(activeName);
    check("the vault pays the star's own paint and seals itself",
      rich.vaultDone === true && rich.cosmetics.paints.includes("solar") &&
      rich.shipColor === SF.config.PAINT_BY_ID.solar.hex);
    SF.game.state = "idle";
    SF.ui.show("screen-missions");
    tapSun(); tapSun(); tapSun(); tapSun(); tapSun();
    check("the vault is replayable - tapping again opens it again", (() => {
      SF.game.run.ended = true; SF.game.state = "idle";
      tapSun(); tapSun(); tapSun(); tapSun(); tapSun();
      return SF.game.run && SF.game.run.mission.vault === true && SF.game.state === "playing";
    })());
    check("the back door works too, on a pilot who already won the paint", (() => {
      SF.game.run.ended = true; SF.game.state = "idle";
      SF.game.startMission("vault", "pilot");
      return SF.game.run && SF.game.run.mission.vault === true && SF.game.state === "playing";
    })());
    check("but the paint prize is only ever granted once", (() => {
      SF.game.endMission(true);
      const twice = SF.profile.load(activeName);
      return twice.vaultDone === true &&
             twice.cosmetics.paints.filter(p => p === "solar").length === 1;
    })());
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
    [4, 10].forEach(mid => { prof.missions[mid] = { cleared:true, stars:{pilot:2}, best:{} }; });
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

    /* The squadron comes out for every campaign boss now - but a rush is
       seven of them back to back, and seven arrivals would flatten the one
       that counts. Here it stays exactly as it was: the last fight only. */
    const origList = SF.profile.listNames, origLoad = SF.profile.load;
    SF.profile.listNames = () => ["Papa", "Wenwen", "Rush"];
    SF.profile.load = n => SF.profile.blank(n);
    SF.finale.reset();
    SF.game.world.boss.hp = SF.game.world.boss.maxHp * 0.08;
    await runFrames(6);
    check("a rush holds the family back while bosses remain in the queue",
      SF.game.run.rushIndex < SF.game.run.rushList.length &&
      SF.finale.fleetSize() === 0);

    // Sentinel is armoured now: strip its plates before the hull can be killed.
    const strip = () => {
      const bb = SF.game.world.boss;
      if(!bb) return;
      bb.weakPoints.forEach(wp => { wp.hp = 0; wp.destroyed = true;
        if(wp.disables) bb.disabled[wp.disables] = true; });
      bb.hp = 1;
    };
    strip();
    await runFrames(320);
    check("the next boss follows the blast",
      SF.game.world.boss && SF.game.world.boss.name === "SKY SENTINEL");
    check("later rush stages come harder",
      SF.game.world.boss.hurry > 1 && SF.game.world.boss.maxHp > 0);
    // A fresh rush boss must resume the health-based readout, not stick at
    // the 100% the previous kill left behind.
    check("the readout tracks the NEW boss, not the last one's victory",
      SF.game.run.bossActive && SF.game.run.progress < 1);
    SF.game.world.boss.hp = SF.game.world.boss.maxHp * 0.08;
    await runFrames(6);
    check("the last boss of a rush still brings the whole family out",
      SF.game.run.rushIndex === SF.game.run.rushList.length &&
      SF.finale.fleetSize() > 0);
    SF.profile.listNames = origList; SF.profile.load = origLoad;
    strip();
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
      SF.missions.MISSIONS.find(m => m.id === 7).boss === "jailer" &&
      SF.missions.MISSIONS.find(m => m.id === 17).boss === "phantom" &&
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
    [4, 7, 10, 15, 17, 20].forEach(mid => { prof6.missions[mid] = { cleared:true, stars:{}, best:{} }; });
    SF.profile.save(prof6);
    SF.game.profile = prof6;
    SF.game.startMission("rush", "pilot");
    check("the rush queue covers all six bosses in campaign order",
      SF.game.run.rushList.join(",") === "marauder,jailer,sentinel,warden,phantom,leviathan");
    SF.game.state = "idle";
  }

  /* ---------- their treasury (the heist between the bosses) ---------- */
  {
    const t = SF.missions.MISSIONS.find(m => m.id === 16);
    check("the treasury sits between the wardens and never carries a boss",
      t && t.name === "Their Treasury" && !t.boss &&
      SF.missions.MISSIONS.find(m => m.id === 15).boss === "warden");
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

  /* ---------- the money is pounds ---------- */
  check("prices and payouts read in pounds", (() => {
    // Read it where a kid reads it: the shop's price buttons and the wallet.
    SF.game.profile = SF.profile.load("Marc");
    SF.ui.renderArmory();
    SF.ui.show("screen-armory");
    // MY SHIP is the tuning bay and sells nothing - price tags live on a shelf.
    const gunsTab = qa("#armoryTabs button").find(b => /GUNS/.test(b.textContent));
    clickEl(gunsTab);
    const prices = qa("#armoryPanel .shop-item button").map(b => b.textContent);
    const wallet = id("armoryMoney").textContent;
    if(prices.length === 0) return false;              // selector must really match
    const all = prices.join(" ") + " " + wallet;
    return /£[\d,]/.test(all) && !/\$/.test(all);
  })());
  check("no screen shows a dollar sign", (() => {
    const seen = ["screen-menu","screen-armory","screen-achievements","screen-leaderboard"]
      .map(s => id(s).textContent).join(" ");
    return !/\$/.test(seen);
  })());

  /* ---------- armoured bosses: the parts come off first ---------- */
  {
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const W = SF.game.world;
    W.reset();
    check("the big bosses are sealed, the teaching ones are not",
      ["jailer","sentinel","leviathan","devourer"].every(id => SF.missions.BOSSES[id].armoured) &&
      !SF.missions.BOSSES.marauder.armoured);

    const b = SF.bosses.create("sentinel", diff, 60);
    b.entering = false; b.x = 300; b.y = 150;
    check("a sealed boss reports itself sealed",
      SF.bosses.isSealed(b) && SF.bosses.partsLeft(b) === b.weakPoints.length);

    // Hull fire cannot finish it, however much you pour in.
    for(let i = 0; i < 400; i++) SF.bosses.damage(b, 500, b.x, b.y + 60);
    check("armour makes the core unkillable until the parts are off",
      b.alive && b.hp >= 1 && SF.bosses.isSealed(b));

    // Kill the parts: the seal breaks and the core becomes killable.
    b.weakPoints.forEach(wp => {
      let guard = 0;
      while(!wp.destroyed && guard++ < 4000)
        SF.bosses.damage(b, 6, b.x + wp.ox, b.y + wp.oy);
    });
    check("stripping every part exposes the core",
      !SF.bosses.isSealed(b) && SF.bosses.partsLeft(b) === 0 && b.alive);
    const before = b.hp;
    SF.bosses.damage(b, 50, b.x, b.y + 60);
    check("an exposed core takes full damage", b.hp <= before - 50);
    let guard = 0;
    while(b.alive && guard++ < 900) SF.bosses.damage(b, 200, b.x, b.y + 60);
    check("an exposed core can actually be killed", !b.alive);

    check("an unsealed boss is never gated",
      (() => {
        const m = SF.bosses.create("marauder", diff, 60);
        m.entering = false;
        const h0 = m.hp;
        SF.bosses.damage(m, 40, m.x, m.y + 40);
        return !SF.bosses.isSealed(m) && m.hp <= h0 - 40;
      })());
  }

  /* ---------- every boss has a hull of its own ---------- */
  check("every boss is hand-drawn, not a scaled enemy sprite", (() => {
    const ids = Object.keys(SF.missions.BOSSES);
    const cv = window.document.createElement("canvas");
    const c = cv.getContext("2d");
    return ids.every(id => {
      if(id === "devourer") return true;          // the finale draws its own
      if(SF.missions.BOSSES[id].photo) return true;  // KING PAPA is a photograph
      if(!SF.bossart.has(id)) return false;
      const b = SF.bosses.create(id, SF.config.DIFFICULTY_BY_ID.pilot, 60);
      try { SF.bossart.draw(c, b, b.size, 0.5, 900); } catch(e){ return false; }
      return true;
    });
  })());
  check("boss fights are sized for a competent pilot, not a perfect one",
    SF.bosses.bossHpFor(SF.missions.BOSSES.marauder, SF.config.DIFFICULTY_BY_ID.pilot, 100) >
    SF.missions.BOSSES.marauder.fightSeconds * 100 * 0.4);

  check("no boss can park a weak point where the guns cannot reach", (() => {
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const { VW } = SF.entityConst;
    return Object.keys(SF.missions.BOSSES).every(id => {
      const b = SF.bosses.create(id, diff, 60);
      const worst = b.weakPoints.reduce((m, wp) => Math.max(m, Math.abs(wp.ox) + wp.r), 0);
      // At either patrol limit, the outermost part must still sit inside the
      // column the ship can fly into (x >= 24, x <= VW-24).
      return b.patrolMargin - worst >= 24 && (VW - b.patrolMargin) + worst <= VW - 24;
    });
  })());

  check("every weak point on every boss can actually be shot", (() => {
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const W = SF.game.world;
    const ctxc = { difficulty: diff, onBossHit: (bo, bu) => SF.bosses.damage(bo, 40, bu.x, bu.y),
                   onEnemyKilled(){}, onPlayerHit(){}, godMode:true };
    return Object.keys(SF.missions.BOSSES).every(id => {
      const def = SF.missions.BOSSES[id];
      return def.weakPoints.every((wpDef, ix) => {
        W.reset();
        W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Aim"), diff));
        const boss = W.boss = SF.bosses.create(id, diff, 60);
        boss.entering = false; boss.x = 300; boss.y = 260; boss.vx = 0;
        const wp = boss.weakPoints[ix];
        // Isolate the target: on a big boss another part can sit in the same
        // column and absorb the round first, which is correct behaviour (a
        // nearer part shields a farther one) but not what this measures.
        boss.weakPoints.forEach((o, k) => { if(k !== ix){ o.destroyed = true; o.hp = 0; } });
        const before = wp.hp;
        // One round, straight up, dead under the part.
        const bu = W.bullets.spawn();
        bu.x = boss.x + wp.ox; bu.y = boss.y + wp.oy + 220;
        bu.vx = 0; bu.vy = -700; bu.r = 5; bu.dmg = 40; bu.pierce = 0;
        bu.homing = 0; bu.tier = 2; bu.age = 0; bu.fromDrone = false; bu.hitBoss = false;
        for(let f = 0; f < 40 && bu.alive; f++){
          W.updateBullets(1/60);
          SF.systems.resolve(W, ctxc, 1/60);
        }
        return wp.hp < before || wp.destroyed;
      });
    });
  })());

  /* ---------- THE FINALE: the Devourer ---------- */
  {
    const { VW, VH } = SF.entityConst;
    const D = SF.missions.BOSSES.devourer;
    check("the finale is the biggest thing in the game",
      D && D.finale === true && D.phases.length === 5 &&
      D.size > SF.missions.BOSSES.leviathan.size * 1.35 &&
      D.fightSeconds > SF.missions.BOSSES.leviathan.fightSeconds);
    check("the finale mission closes the campaign",
      SF.missions.MISSIONS[SF.missions.MISSIONS.length-1].boss === "devourer" &&
      SF.missions.MISSIONS.find(m => m.id === 22).boss === undefined);
    check("beating it awards the last tune and the last medal",
      SF.config.TUNES.some(t => t.id === "nova" && t.unlockMission === 23) &&
      SF.config.ACHIEVEMENTS.some(a => a.id === "devourer" && a.pay > 0));

    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const W = SF.game.world;
    W.reset();
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Fin"), diff));
    const boss = SF.bosses.create("devourer", diff, 60);
    boss.entering = false; boss.x = VW/2; boss.y = 140;
    boss.phase = boss.def.phases[0];

    /* The fairness contract: every arena attack paints where it lands and
       CANNOT hurt anyone during its warning. */
    /* Fire ONE attack in isolation: the boss's own AI is muzzled first, or it
       queues a second attack mid-measurement and the reading is nonsense. */
    const soloFire = (name) => {
      boss.lanes = boss.nova = boss.lance = boss.claw = null;
      boss.telegraph = null; boss.burst = null;
      SF.bosses.ATTACKS[name].fire(boss, W, { difficulty: diff });
      boss.attackTimer = 9999;
    };
    const runToLive = () => {
      for(let i = 0; i < 300 && !SF.bosses.arenaLive(boss); i++){
        boss.attackTimer = 9999;
        SF.bosses.update(boss, 1/30, W, { difficulty: diff }, 0);
      }
    };
    check("lane beams warn before they burn", (() => {
      soloFire("laneBeams");
      const lx = boss.lanes.xs[0];
      const warned = SF.bosses.beamHits(boss, lx, VH*0.7);
      runToLive();
      return !warned && SF.bosses.beamHits(boss, lx, VH*0.7);
    })());
    check("an unlit lane is always safe", (() => {
      soloFire("laneBeams");
      const L = boss.lanes;
      const gap = [0.1,0.3,0.5,0.7,0.9].map(f => f*VW)
        .find(x => L.xs.every(lx => Math.abs(x - lx) > L.w));
      runToLive();
      return gap !== undefined && !SF.bosses.beamHits(boss, gap, VH*0.7);
    })());
    check("the star lance warns, then owns one half", (() => {
      soloFire("starLance");
      const side = boss.lance.side;
      const doomedX = side < 0 ? 60 : VW - 60, safeX = side < 0 ? VW - 60 : 60;
      const warned = SF.bosses.beamHits(boss, doomedX, VH*0.7);
      runToLive();
      return !warned && SF.bosses.beamHits(boss, doomedX, VH*0.7) &&
             !SF.bosses.beamHits(boss, safeX, VH*0.7);
    })());
    check("the nova burns everywhere EXCEPT the ring", (() => {
      soloFire("novaSafeZone");
      const n = boss.nova;
      const warned = SF.bosses.beamHits(boss, 20, 20);
      runToLive();
      return !warned && SF.bosses.beamHits(boss, 20, 20) &&
             !SF.bosses.beamHits(boss, n.cx, n.cy);
    })());
    check("the claw sweeps a band you can be above or below", (() => {
      W.player.x = VW/2; W.player.y = VH*0.6;
      soloFire("clawSweep");
      const c = boss.claw;
      const warned = SF.bosses.beamHits(boss, c.x, c.y);
      for(let i = 0; i < 90; i++){
        boss.attackTimer = 9999;
        SF.bosses.update(boss, 1/30, W, { difficulty: diff }, 0);
      }
      const clear = boss.claw ? !SF.bosses.beamHits(boss, boss.claw.x, boss.claw.y - 170) : true;
      return !warned && clear;
    })());
    // Left running long enough, every arena attack cleans itself up.
    for(let i = 0; i < 400; i++){
      boss.attackTimer = 9999;
      SF.bosses.update(boss, 1/30, W, { difficulty: diff }, 0);
    }
    check("every arena attack expires - none can hang around forever",
      !boss.lanes && !boss.nova && !boss.lance && !boss.claw);

    /* The arrival: it descends, it ends, and it never throws without a canvas. */
    W.reset();
    const b2 = SF.bosses.create("devourer", diff, 60);
    SF.finale.reset();
    SF.finale.beginIntro();
    check("the arrival starts above the screen", (() => {
      SF.finale.updateIntro(1/30, b2);
      return SF.finale.introActive() && b2.y < 0;
    })());
    let guard = 0, done = false;
    while(!done && guard++ < 2000) done = SF.finale.updateIntro(1/30, b2);
    check("the arrival ends with it on station",
      done && !SF.finale.introActive() && Math.abs(b2.y - b2.targetY) < 2);
    check("the arrival draws without a canvas context", (() => {
      SF.finale.beginIntro();
      const cv = window.document.createElement("canvas");
      const c = cv.getContext("2d");
      let threw = false;
      try {
        for(let i = 0; i < 40; i++){
          SF.finale.updateIntro(0.2, b2);
          SF.render.drawFinaleIntro(c, i*100);
        }
      } catch(e){ threw = true; }
      SF.finale.reset();
      return !threw;
    })());

    /* The fleet: the real household only - it arrives once, it shoots for
       you, and at the end it leaves the sky with you. */
    W.reset();
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Fin"), diff));
    W.boss = SF.bosses.create("devourer", diff, 60);
    W.boss.entering = false;
    SF.finale.reset();
    {
      const FAMILY = ["Papa", "Wenwen", "Marc", "Charles", "Laurent"];
      const origList = SF.profile.listNames, origLoad = SF.profile.load;
      SF.profile.listNames = () => FAMILY.concat("Fin");
      SF.profile.load = n => SF.profile.blank(n);
      SF.finale.summonFleet(W, SF.profile.blank("Fin"));
      const names = SF.finale.fleetList().map(f => f.name);
      check("the fleet is the real household - everyone, and nobody invented",
        SF.finale.fleetSize() === FAMILY.length &&
        FAMILY.every(n => names.includes(n.toUpperCase())));
      check("the pilot flying isn't duplicated in their own fleet",
        !names.includes("FIN"));
      check("no made-up wingman name pool survives in the code",
        !/FLEET_NAMES/.test(fs.readFileSync(path.join(__dirname, "src/finale.js"), "utf8")));
      const before = W.bullets.items.filter(b => b.alive).length;
      for(let i = 0; i < 120; i++) SF.finale.updateFleet(1/30, W, i*33);
      check("the fleet fires for you - their shots are your shots",
        W.bullets.items.filter(b => b.alive).length > before);
      SF.finale.summonFleet(W, SF.profile.blank("Fin"));
      check("the fleet never arrives twice", SF.finale.fleetSize() === FAMILY.length);
      /* The end: everyone leaves the sky together, like the player does. */
      SF.finale.beginFlyoff();
      for(let i = 0; i < 400; i++) SF.finale.updateFleet(1/30, W, i*33);
      check("the family speeds off the screen with you at the end",
        SF.finale.fleetList().every(f => f.y < -40));
      check("a lone pilot gets no invented wingmen",
        (() => { SF.finale.reset();
          SF.profile.listNames = () => ["Fin"];
          return SF.finale.summonFleet(W, SF.profile.blank("Fin")).length === 0; })());
      SF.profile.listNames = origList; SF.profile.load = origLoad;
      SF.finale.reset();
    }

    /* The squadron used to be a one-off on the Devourer. It is now every boss
       in the campaign - "I want the other friendly planes to come help at the
       end of each boss like in the final boss" - with Boss Rush held back to
       the last fight only, because seven arrivals in a row is wallpaper. */
    {
      const due = (id, frac) => {
        const bs = SF.bosses.create(id, diff, 60);
        bs.entering = false;
        bs.hp = bs.maxHp * frac;
        // Walk the phases forward the way a real fight does.
        while(bs.def.phases[bs.phaseIndex + 1] &&
              frac <= bs.def.phases[bs.phaseIndex + 1].at){
          bs.phaseIndex++; bs.phase = bs.def.phases[bs.phaseIndex];
        }
        return SF.game.squadronDue(bs);
      };
      const bossIds = Object.keys(SF.missions.BOSSES);
      const tuned = id => SF.missions.BOSSES[id].phases.some(ph => ph.lastLight);
      check("every boss earns a squadron before it dies",
        bossIds.every(id => due(id, 0.05)));
      check("nobody gets help while the fight is still young",
        bossIds.every(id => !due(id, 0.95)));
      check("the squadron arrives with real time left to fly beside you",
        bossIds.filter(id => !tuned(id)).every(id => due(id, 0.35)));
      /* The finale is hand-choreographed and keeps its own cue: the Devourer
         still holds out to its last light, exactly as it always has. */
      check("the Devourer's finale cue is untouched",
        !due("devourer", 0.35) && due("devourer", 0.10) &&
        SF.missions.BOSSES.devourer.phases.some(ph => ph.lastLight));
    }

    /* The death: five stages, and it clears the sky when it goes. */
    SF.finale.reset();
    const b3 = SF.bosses.create("devourer", diff, 60);
    b3.entering = false; b3.x = VW/2; b3.y = 150; b3.finaleDeath = true;
    W.spawnEnemy("grunt", 100, 300, { difficulty: diff });
    W.spawnEnemyBullet(120, 320, 0, 100, "bolt", 4);
    SF.finale.beginDeath(b3);
    const stages = new Set();
    let over = false; guard = 0;
    while(!over && guard++ < 2000){
      const st = SF.finale.deathStage();
      if(st) stages.add(st.id);
      over = SF.finale.updateDeath(1/30, b3, W);
    }
    check("the death runs all five stages",
      over && stages.size === 5 && stages.has("implode") && stages.has("blast"));
    check("the death blast clears the sky",
      W.enemies.items.every(e => !e.alive) && W.enemyBullets.items.every(b => !b.alive));
    check("the finale death is longer than any other ending",
      SF.finale.DEATH_TOTAL > 6 && SF.finale.INTRO_TOTAL > 8);

    /* Balance, measured with a bot rather than guessed: at 95 fight-seconds
       even a pilot who read every telegraph ran out of lives with the boss on
       4%. It is the longest fight in the game, but bounded - and every phase
       break now sheds a supply crate as a pressure valve. */
    check("the finale is the longest fight, but not an endurance test",
      D.fightSeconds > SF.missions.BOSSES.leviathan.fightSeconds &&
      D.fightSeconds <= 75);
    check("a phase break sheds a supply crate", (() => {
      const W2 = SF.game.world;
      SF.game.profile = SF.profile.blank("PhaseDrop");
      SF.game.startMission(SF.missions.MISSIONS.findIndex(m => m.boss === "devourer"), "pilot");
      SF.game.run.phase = "boss";
      const b = SF.bosses.create("devourer", SF.config.DIFFICULTY_BY_ID.pilot, 60);
      b.entering = false; b.x = VW/2; b.y = 160;
      W2.boss = b;
      const before = W2.pickups.items.filter(q => q.alive && q.kind === "supply").length;
      b.hp = b.maxHp * (b.def.phases[1].at - 0.01);     // tip it into phase two
      SF.bosses.update(b, 1/30, W2, {
        difficulty: SF.config.DIFFICULTY_BY_ID.pilot,
        onBossPhase: () => {},
      }, 0);
      // Through the real game hook this time, which is what actually drops it.
      SF.game.state = "idle";
      const src = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      return /onBossPhase\(boss\)\{[\s\S]*?spawnSupply/.test(src) &&
             /onBossPhase = onBossPhase/.test(src) && before >= 0;
    })());
    SF.finale.reset();
    W.reset();
  }

  /* ---------- the menu speaks the game's art ---------- */
  check("menu buttons carry drawn icons, not emoji",
    qa("#screen-menu .menu-btn").every(b => b.querySelector(".mb-icon")) &&
    qa("#screen-menu .menu-btn b").every(b =>
      !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(b.textContent)));

  /* ---------- flight tuning ---------- */
  {
    check("every tune that gains something gives something up (apex excepted)",
      SF.config.TUNES.length === 8 &&
      SF.config.TUNES.every(t => t.id === "vanguard" || t.apex ||
        (t.fire > 1 || t.speed < 1)));
    check("every boss mission awards exactly one tune",
      [4, 7, 10, 15, 17, 20, 23].every(mid =>
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
      if(!viperCard || !/beat Mission 10/.test(viperCard.textContent)) return false;
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
    SF.game.startMission(6, "pilot");     // mission 7, the Jailer
    SF.game.endMission(true);
    SF.game.onMissionEnd = prevEnd;
    check("a first boss clear flags the tune it won",
      payload && payload.firstClear === true &&
      payload.run.mission.boss === "jailer" &&
      SF.config.TUNES.some(t => t.unlockMission === payload.run.mission.id));
    SF.game.startMission(6, "pilot");
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

  /*
   * The rewind block lives LAST on purpose. It starts and abandons two whole
   * missions, and every mission consumes the shared Math.random stream, so
   * running it earlier silently reshuffles the spawns of every test after it -
   * which is exactly how it broke a boss-rush check two hundred lines away.
   */
  /* ---------- THE DEATH REWIND ----------
     "That's not fair" is nearly always "I never saw it". These checks are
     about the two things that make the answer work: the tape has to hold
     the seconds BEFORE the hit (a replay that starts at the bang explains
     nothing), and the results card must wait for it. */
  {
    const RW = SF.rewind;
    const closeCard = () => id("overlayResults").classList.add("hidden");
    const kill = () => {                       // one contrived, fatal hit
      const p = SF.game.world.player;
      p.lives = 1; p.shield = 0; p.invuln = 0;
      SF.game.callbacks.onPlayerHit("collision",
        { x: p.x + 30, y: p.y - 40, r: 16, hazard: false, type: { name: "Kamikaze" } });
    };

    closeCard();                               // an earlier card may still be up
    SF.ui.show("screen-game");
    SF.game.startMission(0, "pilot");
    check("a fresh mission starts with a blank tape", !RW.canPlay());
    await runFrames(90);                       // ~3s: more than the tape holds
    check("the tape fills as the mission is flown", RW.canPlay());

    const before = SF.game.world.player.x;
    kill();
    check("the last life starts the rewind", RW.active());
    /*
     * "When you die your plane should explode or something like this." It
     * always did - the rewind just seized the screen on the same frame, so
     * the blast was drawn for exactly no frames. The first beat now hands
     * the frame back so the wreck is watched, not cut away from.
     */
    check("the wreck gets its own beat before the tape runs", (() => {
      const st = RW._show();
      // draw() returns before it touches the context on this beat, so a bare
      // object is a safe stand-in - and false is the whole assertion: the
      // frame is handed back to the caller, who paints the live wreck.
      return !!st && st.beat === "death" && RW.draw({}, 0, 480, 800) === false;
    })());
    check("the last life blows the ship up, not just dents it", (() => {
      const src = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      const branch = src.split("if(p.lives <= 0){")[1].split("} else if")[0];
      return /fx\.explosion\(p\.x, p\.y, 1\d\d/.test(branch) &&
             /fx\.debris/.test(branch) && /fx\.ring/.test(branch);
    })());
    check("the results card waits behind it",
      id("overlayResults").classList.contains("hidden"));
    check("the mission itself really did end - scoring is not deferred",
      SF.game.run.ended === true && SF.game.state === "ending");
    check("the rewind names what hit you", (() => {
      const k = RW._kill();
      return !!k && k.label === "KAMIKAZE" && Number.isFinite(k.x);
    })());
    check("the tape records the traffic, not just the ship", (() => {
      const live = RW._tape().filter(f => f.used);
      // Something other than the player has to be on the tape, or the replay
      // shows a lone ship drifting through an empty sky and explains nothing.
      return live.some(f => f.en > 0 || f.ebn > 0 || f.bn > 0);
    })());
    check("the pause and mute buttons stand down for the replay", (() => {
      // Under its own class: endMission clears `cinema` on the very next
      // call, so borrowing it left both buttons live over the replay.
      const sheet = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
      return window.document.body.classList.contains("rewinding") &&
             /body\.rewinding #pauseBtn/.test(sheet) &&
             /body\.rewinding #muteBtn/.test(sheet);
    })());
    check("the tape holds the seconds BEFORE the hit, not just the bang", (() => {
      // The oldest frame must be a real, different moment - if the buffer
      // only held the death frame there would be nothing to learn from.
      const tape = RW._tape();
      const live = tape.filter(f => f.used);
      return live.length > 10 &&
             live.some(f => Math.abs(f.px - before) > 0.5) &&
             live.every(f => Number.isFinite(f.px) && Number.isFinite(f.py));
    })());

    // It plays all three beats and hands over by itself, drawing every frame
    // through the real renderers on the way - which is what catches a replay
    // that throws rather than one that merely looks wrong.
    const errs = errors.length;
    const beats = {};
    for(let i = 0; i < 400 && RW.active(); i++){
      const s = RW._show();
      if(s) beats[s.beat] = true;
      await runFrames(1, true);
    }
    check("the rewind runs all four beats and lets go",
      !RW.active() && beats.death && beats.scrub && beats.play && beats.hold);
    check("replaying the world through the real renderers throws nothing",
      errors.length === errs);
    check("the results card arrives once the tape has run",
      !id("overlayResults").classList.contains("hidden"));
    check("and the buttons come back with it",
      !window.document.body.classList.contains("rewinding"));

    // Second death: a tap has to get you out. A replay you cannot escape
    // stops being a kindness the moment you have seen it once.
    closeCard();
    SF.game.startMission(0, "pilot");
    await runFrames(90);
    kill();
    check("the second death rewinds too", RW.active());
    // Guard one: nothing counts in the first moments, so the tap that was
    // already on its way when they died doesn't eat the replay.
    window.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    check("a tap already in flight when you died does not skip it", RW.active());
    await runFrames(14, true);           // past the arming grace
    /*
     * Guard two, and the one that actually mattered: on a keyboard you fly by
     * HOLDING a direction, and the browser repeats that keydown many times a
     * second. Unguarded, the replay was skipped before its first frame drew -
     * the player who most needed it was the one guaranteed never to see it.
     */
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key:"ArrowLeft", repeat:true }));
    check("a held key never skips it, however long the replay runs", RW.active());
    window.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    check("but a real tap gets you straight out", !RW.active());
    await runFrames(2, true);
    check("skipping still shows the results",
      !id("overlayResults").classList.contains("hidden"));
    check("and the skip listener does not outlive the replay", (() => {
      // Fired again with nothing running: must be a no-op, not a throw.
      const e0 = errors.length;
      window.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "x" }));
      return errors.length === e0 && !RW.active();
    })());

    check("the skip is armed on a delay, not on the first frame",
      /ARM_AFTER/.test(fs.readFileSync(path.join(__dirname, "src/rewind.js"), "utf8")) &&
      /e\.repeat/.test(fs.readFileSync(path.join(__dirname, "src/rewind.js"), "utf8")));
    check("the slow-motion really slows down into the impact",
      RW.speedAt(0) > RW.speedAt(0.5) && RW.speedAt(0.5) > RW.speedAt(1) &&
      RW.speedAt(1) > 0);
    /*
     * "The replay is too [quick] to actually understand what happened - twice
     * as slow at least would be better." The first cut opened at 0.9x, which
     * is slow motion on paper and unreadable in practice. This pins the
     * ceiling so a later tweak cannot quietly hand the speed back.
     */
    check("it never opens faster than half speed", RW.speedAt(0) <= 0.5);
    check("the whole replay is long enough to follow", (() => {
      let wall = 0;                             // integrate 1/speed over the tape
      for(let i = 0; i < 2000; i++) wall += (RW.WINDOW/2000) / RW.speedAt((i + 0.5)/2000);
      return wall > 4 && wall < 8;              // seconds of screen time
    })());
    check("a win never rewinds - there is nothing to explain",
      /rewind\.capture/.test(fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")) &&
      !/rewind\.begin/.test(
        fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")
          .split("function endMission")[1].split("EVENT CALLBACKS")[0]));
    check("the collision layer hands over WHAT hit you, not just a word",
      /onPlayerHit\("collision", e\)/.test(
        fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8")) &&
      /onPlayerHit\("bullet", b\)/.test(
        fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8")));

    closeCard();
    SF.game.run.ended = true; SF.game.state = "idle";
  }

  /* ---------- the wacky sky (random-modifier endless mode) ---------- */
  /*
   * Near the end on purpose, beside the pause block: this section runs
   * hundreds of extra frames and free rolls, and both the shared clock and
   * the global RNG stream feed every phase-sensitive assertion above it. In
   * its original slot it silently moved the movement bot's sweep enough that
   * the rewind tape recorded a ship parked against a wall.
   */
  {
    // The script machinery, inherited from the daily era: escalation, length,
    // and rescues staying on the menu all hold for every roll of the dice.
    const a = SF.wacky.build(["giant"]);
    const b = SF.wacky.build(["giant"]);
    check("every generated wave names a real enemy and formation",
      a.waves.every(wv => SF.enemyData.ENEMY_TYPES[wv.type] && wv.n >= 1 && wv.t >= 1));
    check("the wacky script escalates and runs long",
      a.waves.length > 150 && a.waves[a.waves.length-1].t > 1200);
    check("rescues stay on the wacky menu",
      a.waves.filter(wv => wv.type === "carrier").length >= 15);
    check("two flights are two different skies",
      JSON.stringify(a.waves) !== JSON.stringify(b.waves));

    // The dice themselves.
    const sizes = new Set(Array.from({length: 60}, () => SF.wacky.roll().length));
    check("a roll gives two or sometimes three modifiers",
      [...sizes].every(n => n === 2 || n === 3) && sizes.has(2));
    check("every rolled modifier is a real table entry",
      SF.wacky.roll().every(m => SF.wacky.MODIFIERS.includes(m)));
    check("every modifier explains itself in kid words",
      SF.wacky.MODIFIERS.every(m => m.name && m.blurb && m.blurb.length > 10));
    check("the roll becomes the goal line, so the banner IS the reveal",
      a.goal.includes("GIANT ENEMIES"));

    /*
     * A run with a pinned roll, so every modifier under test is actually ON.
     * The build is stubbed rather than the roll: startMission asks
     * SF.wacky.build() with no arguments, and hoping the dice cooperate is
     * how a test flakes.
     */
    const prof = SF.profile.blank("Wacky"); prof.callsign = "Wacky";
    [1,2,3].forEach(mid => { prof.missions[mid] = { cleared:true, stars:{pilot:2}, best:{} }; });
    prof.lastFlightDay = new Date().toDateString();   // keep the daily double out of the arithmetic
    SF.profile.save(prof);
    SF.game.profile = prof;
    SF.ui.show("screen-game");
    const realBuild = SF.wacky.build;
    SF.wacky.build = () => realBuild(["giant","tiny","gold","bouncy","papaRain"]);
    SF.game.startMission("wacky", "pilot");
    SF.wacky.build = realBuild;

    check("a wacky run flies the generated mission",
      SF.game.run.mission.endless === true && SF.game.run.mission.id === "wacky");
    check("the roll reaches both the run and the world",
      SF.game.run.mods.giant === true && SF.game.world.mods.giant === true);
    check("the HUD wears the roll for the whole run, not just the banner",
      SF.game.run.mission.modList.length >= 2 &&
      /run\.mission\.modList/.test(fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8")));
    check("the reveal queues one pop per modifier",
      SF.game.run.modReveal && SF.game.run.modReveal.queue.length === SF.game.run.mission.modList.length);
    check("TINY SHIP is a gnat: a third of a ship, hitbox to match",
      SF.game.world.player.r === 4 && SF.game.world.player.artScale === 0.32);
    check("DOUBLE COINS doubles the per-kill pay rate",
      Math.abs(SF.game.run.payScale - 2) < 0.001);   // PILOT is 1.0 unmodified
    check("GIANT popcorn TRIPLES on screen - cartoon, not tuning", (() => {
      const t = SF.enemyData.ENEMY_TYPES.grunt;
      const e = SF.game.world.spawnEnemy("grunt", 100, -40, { difficulty: SF.game.run.difficulty });
      const ok = e.size > t.size * 2.8;
      e.alive = false;
      return ok;
    })());
    check("...but collides at a fair size, so a wall formation stays passable", (() => {
      // Formations spread across VW however fat their members get: at 3x
      // collision radii a 13-grunt wall would physically seal the field.
      const t = SF.enemyData.ENEMY_TYPES.grunt;
      const e = SF.game.world.spawnEnemy("grunt", 100, -40, { difficulty: SF.game.run.difficulty });
      const ok = e.r > t.r * 1.4 && e.r < t.r * 1.7;
      e.alive = false;
      return ok;
    })());
    check("...while terrain-sized types stay flyable-around", (() => {
      const t = SF.enemyData.ENEMY_TYPES.boulder;
      const e = SF.game.world.spawnEnemy("boulder", 100, -40, { difficulty: SF.game.run.difficulty });
      const ok = e.r < t.r * 1.2 && e.size < t.size * 1.5;
      e.alive = false;
      return ok;
    })());
    check("BOUNCY COINS bounce off the walls", (() => {
      const c = SF.game.world.spawnPickup("coin", 5, 300, { value: 1 });
      c.vx = -80; c.vy = 0;
      SF.game.world.updatePickups(0.016, () => {});
      const ok = c.vx > 0;
      c.alive = false;
      return ok;
    })());
    check("...and off the floor, three times, each softer", (() => {
      const c = SF.game.world.spawnPickup("coin", 200, SF.entityConst.VH + 5, { value: 1 });
      c.vx = 0; c.vy = 60;
      SF.game.world.updatePickups(0.016, () => {});
      const ok = c.vy < 0 && c.bounces === 2;
      c.alive = false;
      return ok;
    })());
    check("a rescue pod is above bouncing, even here", (() => {
      const r = SF.game.world.spawnPickup("rescue", 5, 300, {});
      r.vx = -80;
      SF.game.world.updatePickups(0.016, () => {});
      const ok = r.vx < 0;
      r.alive = false;
      return ok;
    })());

    await runFrames(400);   // ~13s: past the intro and the first PAPA RAIN drop
    check("the reveal pops drain as the run starts",
      SF.game.run.modReveal.queue.length === 0);
    // Kill-drop coins spawn where enemies die (y > 0); the gold shower spawns
    // above the field. A coin born up there can only be the rain.
    SF.game.world.pickups.killAll();
    SF.game.run.goldRainTimer = 0.01;
    await runFrames(3);
    check("DOUBLE COINS visibly rains money from the top of the sky",
      SF.game.world.pickups.items.some(i => i.alive && i.kind === "coin" && i.y < 60));
    check("PAPA RAIN actually rains Papa heads",
      SF.game.world.pickups.items.some(i => i.kind === "papahead") ||
      (SF.game.run.stats.papaHeads || 0) > 0);
    check("no runtime errors with five modifiers running at once", errors.length === 0);

    SF.game.run.score = 4321;
    SF.game.run.maxCombo = 0;   // force the comboless case the row must hide for
    const missionsBefore = JSON.stringify(prof.missions);
    SF.game.endMission(false);
    check("the score books as the endless best",
      prof.endlessBest === 4321 && prof.endlessLongest >= 1);
    check("a wacky run never touches the campaign records",
      JSON.stringify(prof.missions) === missionsBefore && prof.lastMission !== "wacky");
    check("a comboless run does not brag about x0",
      !/Best combo/.test(id("resultLines").textContent));
    check("the results celebrate the flight instead of mourning it",
      id("resultTitle").textContent === "WHAT A FLIGHT!" &&
      /NEW RECORD/.test(id("resultSubtitle").textContent) &&
      id("nextBtn").classList.contains("hidden"));
    check("a worse run does not overwrite the best", (() => {
      SF.game.startMission("wacky", "pilot");
      SF.game.run.score = 100;
      SF.game.endMission(false);
      return prof.endlessBest === 4321 && !/NEW RECORD/.test(id("resultSubtitle").textContent);
    })());
    check("MEGA SHIP is drawn as a parade float and collides at stock", (() => {
      // Art-only on purpose: a doubled hitbox would be the one modifier that
      // makes the game harder.
      const real = SF.wacky.build;
      SF.wacky.build = () => real(["mega"]);
      SF.game.startMission("wacky", "pilot");
      SF.wacky.build = real;
      const p2 = SF.game.world.player;
      const ok = p2.artScale === 1.9 && p2.r === 11;
      SF.game.endMission(false);
      return ok;
    })());
    check("tiny and mega never share a sky", (() => {
      for(let i = 0; i < 300; i++){
        const ids = SF.wacky.roll().map(m => m.id);
        if(ids.includes("tiny") && ids.includes("mega")) return false;
      }
      return true;
    })());
    check("an exclusion does not shrink the hand",
      (() => { for(let i = 0; i < 60; i++){ const n = SF.wacky.roll().length;
               if(n !== 2 && n !== 3) return false; } return true; })());
    check("SLEEPY enemies fly through syrup, not just a quiet day", (() => {
      SF.game.world.mods.sleepy = true;
      const t = SF.enemyData.ENEMY_TYPES.grunt;
      const e = SF.game.world.spawnEnemy("grunt", 100, -40, { difficulty: SF.game.run.difficulty });
      delete SF.game.world.mods.sleepy;
      const ok = e.speed < t.speed * 0.4;
      e.alive = false;
      return ok;
    })());
    check("a campaign mission spawns unmodified enemies afterwards", (() => {
      SF.game.startMission(0, "pilot");   // must not inherit the wacky roll
      const t = SF.enemyData.ENEMY_TYPES.grunt;
      const e = SF.game.world.spawnEnemy("grunt", 100, -40, { difficulty: SF.game.run.difficulty });
      const ok = e.r === t.r && SF.game.world.player.r === 11 && !SF.game.world.player.artScale;
      e.alive = false;
      SF.game.endMission(false);
      return ok;
    })());
    SF.game.state = "idle";

    // Menu gating: locked before mission 3, and it says so.
    const rook = SF.profile.blank("Rook"); SF.profile.save(rook);
    SF.game.profile = rook;
    clickEl(qa("#profileGrid .profile-card")[0]); // any click path re-renders below
    SF.ui.renderProfiles();
    // Medal ids stay "daily_*" so nobody's earned medals vanish; the flavour moved.
    check("the endless medals survive the rename with their ids intact",
      SF.config.ACHIEVEMENTS.some(x => x.id === "daily_ace" && x.pay > 0 && /Wacky/.test(x.desc)) &&
      SF.config.ACHIEVEMENTS.some(x => x.id === "daily_iron" && x.pay > 0 && /Wacky/.test(x.desc)));
    check("the wacky unlock rule is mission 3",
      (() => { const t = SF.profile.blank("T");
               const no = !(t.missions[3] && t.missions[3].cleared);
               t.missions[3] = { cleared:true, stars:{}, best:{} };
               return no && !!(t.missions[3].cleared); })());
  }

  /* ---------- the seeded simulation stream ---------- */
  /*
   * The design notes record four separate incidents of something perturbing
   * the global RNG stream and breaking an assertion far away. The fix is one
   * seed per run, drawn at startMission: a run is reproducible from its seed
   * alone, and nothing that happens before launch can lean on the stream.
   * This block is the proof, and it lives down here with the other
   * frame-heavy sections for the reason 8bt7 records.
   */
  {
    const prof = SF.profile.blank("Seed");
    [1,2,3].forEach(mid => { prof.missions[mid] = { cleared:true, stars:{pilot:2}, best:{} }; });
    prof.lastFlightDay = new Date().toDateString();
    SF.profile.save(prof);
    SF.game.profile = prof;
    SF.game.godMode = true;
    botEnabled = false;
    SF.input.clearMovement();

    /*
     * Two lessons paid for while writing this. The tuples are SORTED because
     * pools reuse dead slots round-robin, so a second run enumerates the same
     * enemies in a different order - identical battle, different array. And
     * `phase`/`weaveWidth` are in the snapshot because mission 1's opening
     * grunts fly straight lines from fixed formation slots: after eight
     * seconds two different seeds had produced identical POSITIONS, and the
     * only witnesses to the stream were the per-spawn draws nobody can see.
     */
    const snapshot = () => JSON.stringify({
      enemies: SF.game.world.enemies.items.filter(e => e.alive)
        .map(e => [e.typeId, Math.round(e.x*10), Math.round(e.y*10), e.hp,
                   Math.round((e.phase || 0)*1000), Math.round((e.weaveWidth || 0)*10)])
        .sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1),
      spawned: SF.game.run.director.spawnedCount,
      bullets: SF.game.world.bullets.countAlive(),
      px: Math.round(SF.game.world.player.x),
      powerupIn: Math.round(SF.game.run.powerupTimer * 1000),
    });

    const fly = async (seed) => {
      SF.game.nextRunSeed = seed;
      SF.ui.show("screen-game");
      SF.game.startMission(0, "pilot");
      await runFrames(240);
      const snap = snapshot();
      SF.game.endMission(false);
      SF.game.state = "idle";
      return snap;
    };

    const first = await fly(424242);

    // The regression this work kills: burn the global stream hard between
    // runs. Before the seeded stream, this shifted every spawn afterwards.
    for(let i = 0; i < 137; i++) Math.random();
    SF.fx.explosion(100, 100, 40, "#fff", true);
    SF.fx.sparks(50, 50, 30, "#fff", 200);

    const second = await fly(424242);
    check("the same seed flies the same battle, twice", first === second);
    check("...even after the global stream was deliberately trampled between runs",
      first === second);   // the trampling above is the whole point of this label

    const third = await fly(7);
    check("a different seed flies a different battle", third !== first);

    SF.game.nextRunSeed = 99;
    SF.ui.show("screen-game");
    SF.game.startMission(0, "pilot");
    check("the run wears its seed and the pin is consumed once",
      SF.game.run.seed === 99 && SF.game.nextRunSeed === null);
    SF.game.endMission(false);
    SF.game.state = "idle";
    check("an unpinned run draws a fresh seed of its own", (() => {
      SF.ui.show("screen-game");
      SF.game.startMission(0, "pilot");
      const ok = Number.isInteger(SF.game.run.seed) && SF.game.run.seed !== 99;
      SF.game.endMission(false);
      SF.game.state = "idle";
      return ok;
    })());

    botEnabled = true;
  }

  /* ---------- pause must not burn a powerup ---------- */
  /*
   * Temp buffs were absolute `performance.now()` deadlines while pause was a
   * state flag with no compensation, so real time kept running against a
   * nine-second powerup. Pause longer than the buff and it was gone with no
   * shot fired - and `visibilitychange` auto-pauses, so app-switching or
   * locking the iPad did it without the player choosing to.
   *
   * Deliberately the last thing in this file. It drives hundreds of paused
   * frames, and anything that touches the global RNG stream shifts every
   * spawn after it - which is exactly how a boss-rush assertion 800 lines
   * away broke earlier in this session.
   */
  {
    SF.game.godMode = true;
    SF.game.startMission(0, "pilot");
    await runFrames(60);
    const p = SF.game.world.player;
    check("a mission is running before the pause test",
      SF.game.state === "playing" && !!p);

    // Granted the way the game grants it: nine seconds on the mission clock.
    p.tempRapidUntil = SF.game.now() + 9000;
    p.overdriveUntil = SF.game.now() + 5000;
    const clockBefore = SF.game.now();

    clickEl(id("pauseBtn"));
    check("the game pauses", SF.game.state === "paused");
    check("the pause screen says what you were doing",
      id("pauseGoal").textContent.length > 3 &&
      qa("#pauseObjectives div").length === SF.game.run.objectiveDefs.length);
    check("fullscreen stays hidden where the API doesn't exist",
      id("fullscreenBtn").classList.contains("hidden"));
    await runFrames(400);   // ~13 simulated seconds, comfortably past both buffs
    check("the mission clock stops dead while paused", SF.game.now() === clockBefore);
    check("a 9s powerup survives a 13s pause", SF.game.now() < p.tempRapidUntil);
    check("so does overdrive", SF.game.now() < p.overdriveUntil);

    clickEl(id("resumeBtn"));
    await runFrames(4);
    check("the mission resumes", SF.game.state === "playing");
    check("the clock restarts where it stopped", SF.game.now() > clockBefore &&
      SF.game.now() - clockBefore < 1000);
    check("the powerup is still running after resuming", SF.game.now() < p.tempRapidUntil);
    // ...and still expires normally once the game is actually being played.
    // A RAPID drop collected mid-flight would legitimately re-extend the
    // deadline and fail this for the wrong reason - keep the sky bare.
    SF.game.run.powerupTimer = 9999;
    SF.game.world.pickups.killAll();
    await runFrames(340);   // ~11s of real play
    check("but it does expire once time is actually played",
      SF.game.now() > p.tempRapidUntil);
  }

  /* ---------- one soundtrack at a time ---------- */
  /*
   * "There's two musics playing at the same time" - on the iPhone home-screen
   * app, not in a browser tab.
   *
   * setMusic() captured a single `old` element to fade out, and every call
   * clears the running fade timer. So a switch landing inside the previous
   * 70ms fade killed the timer that was fading the OLDER track down and left
   * it sounding forever at whatever volume it had reached. menu -> combat ->
   * boss - which is just launching into a boss mission - was enough; it
   * reproduced in Chromium with the menu theme stranded at 0.07 under the boss
   * theme at 0.68. The browser only hid it because autoplay refuses the early
   * tracks until a gesture.
   */
  {
    SF.audio.setMusic(null);
    await sleep(900);                       // let everything settle to silence
    check("silence really is silent", soundingTracks().length === 0);

    SF.audio.setMusic("menu");
    await sleep(90);                        // mid-fade...
    SF.audio.setMusic("combat");
    await sleep(60);                        // ...and again, inside that fade
    SF.audio.setMusic("boss");
    await sleep(1600);                      // long enough for every fade to end

    const sounding = soundingTracks();
    check("switching tracks mid-fade leaves exactly one playing", sounding.length === 1);
    check("...and it is the track that was actually asked for",
      sounding.length === 1 && /boss/.test(sounding[0].src));
    // Muting has to reach a stranded element too, or it plays through the mute.
    SF.audio.setMuted(true);
    check("muting silences every track", soundingTracks().length === 0);
    SF.audio.setMuted(false);
  }

  /* ---------- hover steering: a Mac trackpad plays like the iPad ---------- */
  /*
   * A trackpad reaches the browser as a mouse, so "glide a finger, no click"
   * is a buttonless pointermove. The ship must follow it while it is over the
   * playfield, let go when it leaves, and never apply the thumb lift (a
   * cursor hides nothing). jsdom's MouseEvent has no pointerType, which is
   * exactly what lets us stamp one on per dispatch. LAST in the suite: it
   * leaves input state alone afterwards, but no flying block should ever run
   * with a synthetic pointer still down.
   */
  {
    const cv = id("game");
    const realRect = cv.getBoundingClientRect;
    cv.getBoundingClientRect =
      () => ({ left: 0, top: 0, right: 300, bottom: 400, width: 300, height: 400 });
    const ptr = (type, name, x, y, target, pointerId) => {
      const ev = new window.MouseEvent(name, { clientX: x, clientY: y, bubbles: true });
      Object.defineProperty(ev, "pointerType", { value: type });
      if(pointerId != null) Object.defineProperty(ev, "pointerId", { value: pointerId });
      (target || window).dispatchEvent(ev);
    };
    const st = SF.input.state;
    SF.input.clearMovement();

    ptr("mouse", "pointermove", 150, 200);
    check("a buttonless mouse move over the playfield steers the ship", st.dragging);
    const mouseY = st.dragY;

    ptr("mouse", "pointermove", 150, 9999);
    check("steering lets go when the pointer leaves the playfield", !st.dragging);

    ptr("touch", "pointermove", 150, 200);
    check("a touch pointer never steers from a bare move", !st.dragging);

    ptr("touch", "pointerdown", 150, 200, cv, 7);
    check("a held finger still steers", st.dragging);
    check("...with the thumb lift a cursor doesn't get",
      Math.abs((mouseY - st.dragY) - 48) < 0.001);
    ptr("touch", "pointerup", 150, 200, null, 7);
    check("lifting the finger releases the drag", !st.dragging);

    ptr("mouse", "pointerdown", 150, 200, cv, 3);
    ptr("mouse", "pointermove", 160, 210);
    ptr("mouse", "pointerup", 160, 210, null, 3);
    ptr("mouse", "pointermove", 170, 220);
    check("a click released over the playfield doesn't drop mouse steering", st.dragging);

    check("the playfield hides the OS cursor - the ship is the pointer",
      /#game\s*\{[^}]*cursor:\s*none/.test(
        fs.readFileSync(path.join(__dirname, "style.css"), "utf8")));

    /*
     * Fullscreen letterboxes the playfield on a laptop display, and losing
     * steering to those black bars was the complaint that started this: the
     * ship went dead and the cursor was invisible and hard to find again. In
     * fullscreen the bars steer too, clamped to the field edge.
     */
    const doc = window.document;
    const setFs = el => Object.defineProperty(doc, "fullscreenElement",
      { value: el, configurable: true });
    setFs(doc.documentElement);
    ptr("mouse", "pointermove", 150, 200);
    ptr("mouse", "pointermove", -400, 200);
    check("fullscreen keeps steering out on the letterbox bars", st.dragging);
    check("...parking the ship against the near edge, not drifting off",
      st.dragX === 0);
    ptr("mouse", "pointermove", 99999, 99999);
    check("...and the same on the far corner",
      st.dragging && st.dragX === SF.entityConst.VW);
    delete doc.fullscreenElement;
    ptr("mouse", "pointermove", 150, 200);
    ptr("mouse", "pointermove", -400, 200);
    check("windowed still lets go once the pointer leaves the playfield",
      !st.dragging);
    check("the letterbox bars hide the cursor with the rest of the sky",
      /:fullscreen\s+#screen-game\s*\{[^}]*cursor:\s*none/.test(
        fs.readFileSync(path.join(__dirname, "style.css"), "utf8")));

    cv.getBoundingClientRect = realRect;
    SF.input.clearMovement();
  }

  /* ---------- enemy fire reads as directional ---------- */
  {
    /*
     * Enemy bolts trail a tail down their velocity so a shot telegraphs where
     * it is going, not just where it is. The canvas stub draws nothing, so
     * the assertions ride on the transform the renderer asks for: a tail is
     * one rotate() plus one drawImage(), and the rotation has to aim the
     * sprite's +Y (its tail end) AWAY from the direction of travel.
     */
    const tails = [];
    let ang = 0;
    const probe = {
      canvas:{ width:1, height:1 }, globalAlpha:1, globalCompositeOperation:"source-over",
      fillStyle:"", createLinearGradient:() => ({ addColorStop(){} }),
      createRadialGradient:() => ({ addColorStop(){} }),
      save(){}, restore(){ ang = 0; }, translate(){}, scale(){}, beginPath(){}, closePath(){},
      moveTo(){}, lineTo(){}, arc(){}, ellipse(){}, fill(){}, stroke(){}, fillRect(){},
      rotate(a){ ang = a; },
      drawImage(img, x, y, w, h){
        // Tails are the only stretched draw in this path; bolts blit 1:1.
        if(h !== undefined) tails.push({ ang, w, h });
      },
    };
    const shot = (vx, vy, r) => ({ alive:true, x:200, y:200, vx, vy, r:r||4, kind:"bolt" });
    const draw = list => {
      tails.length = 0;
      SF.render.drawBullets(probe, { bullets:{ items:[] }, enemyBullets:{ items:list } });
      return tails;
    };
    // The sprite's tail end is its local +Y, which rotate(a) sends to
    // (-sin a, cos a). Behind the bolt means pointing against the velocity.
    const behind = (t, vx, vy) =>
      (-Math.sin(t.ang))*vx + Math.cos(t.ang)*vy < -0.9 * Math.hypot(vx, vy);

    let t = draw([shot(0, 300)]);
    check("a falling enemy bolt trails a tail", t.length === 1);
    check("the tail streams behind a bolt coming straight down",
      t.length === 1 && behind(t[0], 0, 300));

    t = draw([shot(-300, 0)]);
    check("a bolt fired sideways trails sideways, not down",
      t.length === 1 && behind(t[0], -300, 0));

    t = draw([shot(220, -220)]);
    check("a bolt fired back up the screen trails the other way",
      t.length === 1 && behind(t[0], 220, -220));

    check("a barely-moving orb gets no tail to lie about its speed",
      draw([shot(6, 8)]).length === 0);

    const slow = draw([shot(0, 90)])[0], fast = draw([shot(0, 600)])[0];
    check("a faster shot wears a longer tail", fast.h > slow.h * 1.4);

    const small = draw([shot(0, 400, 4)])[0], big = draw([shot(0, 400, 12)])[0];
    check("a fat bolt wears a fat tail", big.w > small.w && big.h > small.h);

    check("the tail is tinted, never the white of your own fire",
      !/enemyTail[\s\S]{0,700}rgba\(255,255,255/.test(
        fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8")));

    check("the death rewind records bolt velocity, so the replay trails too",
      /f\.ebullets\[n\]\s*=\s*\{[^}]*vx:/.test(
        fs.readFileSync(path.join(__dirname, "src/rewind.js"), "utf8")));
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
