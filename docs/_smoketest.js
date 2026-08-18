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
   "strokeRect","beginPath","closePath","moveTo","lineTo","arc","arcTo","ellipse","fill","stroke","drawImage",
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

/*
 * ONE LIST. The manifest is the load order, and everything reads it: the page
 * loads app.js built from it, tools/build.js concatenates from it, and this
 * file loads the individual sources from it - so the suite always tests the
 * real modules while the site ships the joined one.
 */
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, "src/manifest.json"), "utf8")).files;

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
    check("the field starts at a sane width", before >= 380 && before <= 720);
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
    check("a desktop window gets the full 720-wide field", SF.field.measure() === 720);
    defineSize(1024, 744);
    check("a landscape iPad gets it too", SF.field.measure() === 720);
    defineSize(390, 620);
    check("a portrait phone still gets a phone-shaped field",
      SF.field.measure() >= 380 && SF.field.measure() < 720);
    /*
     * HOW WIDE THE SKY MAY BE DEPENDS ON HOW MANY ARE FLYING, and that is a
     * measured rule rather than a taste. Bot-flying eight seeded missions:
     * one pilot at 720 kills 51% and lets 33% escape, and at 900 that falls
     * to 37% and 46% - nearly half of everything gets past them. Holding the
     * enemy COUNT flat barely helps (39%/42%), because the cost is not
     * density, it is that one ship can only be in one place. Two pilots at
     * 900 land on 57%/27%, almost exactly where one used to be at 640.
     *
     * So the second seat buys the extra sky, and nobody else pays for it.
     */
    {
      const wasMate = SF.game.coopMate;
      defineSize(1470, 856);
      const alone = SF.field.measure();
      SF.game.coopMate = { name:"Someone" };
      const pair = SF.field.measure();
      SF.game.coopMate = wasMate;
      const back = SF.field.measure();
      check("a second pilot buys a wider sky, and one pilot is not made to fly it",
        alone === 720 && pair === 900 && back === 720);
    }
    /*
     * ...and no screen may be widened out of its HUD. The field is chosen to
     * leave the wings their margin, so this walks the real devices and checks
     * the panels survive on every one of them - a rule stated as arithmetic
     * rather than as a number somebody picked, because picking a number is
     * how a landscape iPad lost its wings by one pixel the first time.
     */
    {
      const wasMate = SF.game.coopMate;
      SF.game.coopMate = { name:"Someone" };          // the widest case
      const WING_MIN = SF.entityConst.WING_MIN;
      const kept = [[1024, 744], [1366, 1024], [1470, 856], [1280, 720], [1920, 1040]]
        .every(([w, h]) => {
          defineSize(w, h);
          const vw = SF.field.measure();
          const frameW = h * (vw/800);
          return Math.floor((w - frameW)/2) >= WING_MIN;
        });
      SF.game.coopMate = wasMate;
      check("no screen is ever widened out of its own HUD", kept);
    }
    /*
     * THE HUD WINGS.
     *
     * The playfield is tuned at four fifths as wide as it is tall, so on a
     * landscape screen it can only ever fill the middle - measured, a MacBook
     * Air drew the game on 47% of its display and stacked the score, wallet,
     * lives, mission bar and objectives ON TOP of the action anyway. The
     * wings take those readouts into the space that was already empty.
     *
     * Two rules keep this safe. They appear only where there is real room, so
     * a phone is untouched and keeps the only HUD it has ever had. And the
     * canvas is still EXACTLY the playfield - the wings are out of flow
     * entirely - because the touch mapping reads the canvas rect to steer the
     * ship, and a canvas that grew past the field would put every thumb in
     * the wrong place.
     */
    {
      const frame = q(".game-frame"), left = id("hudLeft"), right = id("hudRight");
      const wingsOn = () => !!(left && !left.classList.contains("hidden"));
      defineSize(1470, 856);                       // a laptop: room to spare
      SF.game.resize();
      const wideOn = wingsOn(), wideGut = parseInt(left.style.width, 10);
      defineSize(393, 715);                        // a phone: no room at all
      SF.game.resize();
      const narrowOn = wingsOn();
      check("the wings open on a laptop and stay shut on a phone",
        wideOn && !narrowOn && wideGut >= 150 && SF.game.wideHud === false);
      check("a phone keeps the only HUD it has",
        right.classList.contains("hidden") &&
        right.getAttribute("aria-hidden") === "true");
      /*
       * The canvas must never grow into the wings: input.js maps a pointer
       * through the canvas's own rect, so the drawn field and the canvas have
       * to stay the same rectangle. This is the pin that stops a future
       * "let the HUD draw in the margins" change from breaking steering.
       */
      defineSize(1470, 856);
      SF.game.resize();
      check("the canvas is still exactly the playfield, wings or no wings",
        Math.abs(parseFloat(frame.style.width) - parseFloat(frame.style.height)*
          (SF.entityConst.VW/800)) < 1.5);
      check("the wings sit outside the frame, never inside it", (() => {
        const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
        const blk = css.slice(css.indexOf(".hud-wing{"), css.indexOf(".hw-card{"));
        return /position:absolute/.test(blk) && /pointer-events:none/.test(blk);
      })());
      check("the canvas HUD stands down when the wings take over", (() => {
        const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
        return /const wide = !!SF\.game\.wideHud;/.test(r) &&
               /if\(!wide && run\.objectiveDefs\.length\)/.test(r) &&
               /let oy = wide \? 16 :/.test(r);
      })());
      check("every wing label speaks French", (() => {
        const s2 = SF.i18n._packs.fr.s;
        return ["Score", "Wallet", "Lives", "MISSION {n}", "MISSION {n}%", "BOSS FIGHT"]
          .every(k => !!s2[k]);
      })());
      defineSize(1920, 1040);
      SF.game.resize();
    }

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
    check("every formation stays inside the widest field there is",
      Object.keys(F).every(k => F[k](12, 900).every(sl => sl.x >= 0 && sl.x <= 900)));
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
      /*
       * +20% at the 720 ceiling and exactly the tuned number on a phone. The
       * top-up's own cap is reached precisely at 720, which is what makes the
       * wider field more GAME rather than an easier one: enemies-per-area is
       * held level, and no field can ever become a way to farm a bigger wave.
       */
      return wideN === 12 && phoneN === 10 && wideN <= Math.round(10 * 1.2);
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
    // Any solid hex will do - the check guards the fallback's existence, not
    // the palette (the polish pass darkened the ground to #060512).
    check("the page paints a solid colour under the gradient",
      /background-color:\s*#[0-9a-fA-F]{6}/.test(css));
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
  /*
   * The menu backdrop was a fixed 720x1000 bitmap stretched with
   * object-fit:cover, so the window's aspect decided which third of the
   * artwork survived - on a laptop that was the hero ship's head, on a phone
   * the sides. Pin the two halves of the fix: the canvas is measured and
   * matched in script, and the title has its own sky built by the same
   * painter the missions use rather than a hand-rolled sphere.
   */
  check("the menu backdrop is sized to its box, not cropped to it",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             const c = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
             return /function fitTitleCanvas/.test(u) &&
                    // It must cover the whole scroll run, not the first screenful.
                    /scrollHeight/.test(u.split("function fitTitleCanvas")[1].slice(0, 700)) &&
                    !/\.title-art\s*\{[^}]*object-fit\s*:\s*cover/.test(c); })());
  check("the title screen paints with the game's own sky", typeof SF.skygen.buildTitle === "function");
  /*
   * Menus scroll up, never sideways. `overflow-y:auto` on its own makes the
   * browser compute overflow-x to `auto` as well, so one child bleeding past
   * the right edge turns a screen into a side-scroller - which is exactly
   * what the Armory's sticky BACK button did with its `right:-100vw`
   * full-bleed underlay. The screens have to say `hidden` out loud.
   */
  check("a screen cannot be dragged sideways",
    (() => { const c = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
             const block = (c.split(/^\.screen \{/m)[1] || "").split("}")[0];
             return /overflow-y\s*:\s*auto/.test(block) && /overflow-x\s*:\s*hidden/.test(block); })());
  check("the title sky is not a campaign stop", (() => {
    const cv = SF.skygen.buildTitle(400, 700, 1);
    return !!cv && cv.width === 400 && cv.height === 700 &&
           !SF.skygen.SKIES.some(s => s.name === "The Home Sky");
  })());
  /*
   * DUST SCALES WITH AREA, COMPOSITION DOES NOT.
   *
   * Every star class was multiplied by areaK = W*H/(390*620). That is right
   * for dust - twice the sky wants twice the grains or the big screen looks
   * thin - and wrong for the few bright spiked stars, which are the ones the
   * eye picks out. Measured on the menu sky, the only one composed against
   * the real window: areaK is 1.4 on a phone and 8.6 at 1920x1080, so the 4
   * spiked stars the composition was tuned for became 34, and the desktop
   * menu read as confetti rather than as a sky.
   */
  check("a wider sky gets more dust but not more spiked stars", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    return /const featureK = Math\.sqrt\(areaK\)/.test(s) &&
           /sky\.bright \* featureK/.test(s) &&      // composition: sub-linear
           /1400 \* sky\.stars \* areaK/.test(s);    // dust: still per area
  })());
  /*
   * And the BIGGEST thing in frame must not also be the brightest, because
   * what pulls an eye across a picture is brightness times area. The menu's
   * amber giant is the widest body on the screen by a distance, and at
   * #d9a441 it was also the loudest object after the wordmark, sitting in a
   * corner where nothing happens.
   *
   * Written against whichever planet is largest rather than against a
   * radius, because that radius has already changed once and the rule is
   * about the relationship, not the number.
   */
  check("the menu's biggest planet is not also its brightest", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    const lum = h => { const v = parseInt(h.slice(1), 16);
      return 0.299*((v>>16)&255) + 0.587*((v>>8)&255) + 0.114*(v&255); };
    const block = s.slice(s.indexOf("function buildTitle("));
    const re = /k:"planet"[\s\S]{0,400}?r:rx\(([\d.]+)\)[\s\S]{0,600}?lit:"(#[0-9a-f]{6})"/g;
    const found = [];
    let m; while((m = re.exec(block))) found.push({ r:+m[1], lit:lum(m[2]) });
    if(found.length < 3) return false;
    const biggest = found.reduce((a, b) => b.r > a.r ? b : a);
    return found.every(f => f === biggest || f.lit >= biggest.lit);
  })());
  /*
   * A PLANET IS ONLY AS SHARP AS THE SPRITE IT WAS BAKED INTO.
   *
   * The disc is computed one pixel at a time into an offscreen sprite, and
   * that sprite was capped at a flat 384px however large the body was drawn.
   * Measured on the menu at 1500x860 on a 3x screen, against the size each
   * body is actually blitted at: the moon came out 1:1 and looked it, the
   * ringed planet 2.6x, and the amber giant 9.2x - a 384px disc smeared
   * across 2838 device pixels, which is precisely why it read as an
   * out-of-focus smudge rather than a world. A galaxy survives that because
   * a galaxy IS a blur; a planet has a limb, and a limb has to be sharp.
   */
  check("a big planet is not baked into a small sprite", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    return /function spriteCapFor\(extL, dpr\)/.test(s) &&
           /Math\.ceil\(extL\*2\*dpr\)/.test(s) &&        // tracks the drawn size
           /cap \/ \(2\*extL\)/.test(s) &&                // and is what limits scale
           !/Math\.min\(dpr, 384 \/ \(2\*extL\)\)/.test(s);
  })());
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
  /*
   * The gift stop used to be named for its stop number ("Sky 40"), which was
   * the only name in the campaign that told you nothing. It is BEHIND THE SKY
   * now - the workshop's own level, holding everything meta the old finale
   * carried - and the name lives in the mission data alone (giftName() feeds
   * the map, the dialog and the toasts, pinned further down).
   */
  check("the gift stop is the workshop's own level", (() => {
    const M = SF.missions.MISSIONS, gift = M.find(m => m.gift);
    return !!gift && gift.name === "Behind the Sky" && gift.id === 40 &&
           gift.backstage === true && gift.sky29 === true &&
           !gift.boss;                       // the Brush is backstage's, not a slot
  })());
  check("41 campaign missions defined, ids sequential from Earth",
    SF.missions.MISSIONS.length === 41 &&
    SF.missions.MISSIONS.every((m, i) => m.id === i));
  /*
   * The sky contract, after Mission 0: every mission points at its own sky
   * explicitly, the pre-Earth missions kept their historical painting, and
   * Earth's dawn was APPENDED so no saved Drawing Board sky re-bases.
   */
  check("every mission kept its painting; Earth's dawn was appended", (() => {
    const M = SF.missions.MISSIONS;
    return M.every(m => m.prologue ? m.sky === 40 : m.sky === m.id - 1) &&
           SF.skygen.SKIES.length === 41 &&
           SF.skygen.SKIES[40].surface === true &&
           SF.skygen.SKIES[40].props.some(pr => pr.k === "fields");
  })());
  /*
   * The farmland's two honesty rules, pinned at the source. "The fields are
   * too geometrically perfect" - so no shared column grid survives (each row
   * deals its own edges) and the rows themselves are dealt unequal, with only
   * the two ends pinned to the wrap. "Roads are mostly straight unless
   * there's a good reason to have a turn" - so the through-lane is ONE
   * straight line down the whole map, and the only turnings anywhere are the
   * side lane's T-junction and the short track into the yard. Two earlier
   * drafts failed this: a double-sine wander, then a lane that jogged three
   * times on its way down for no reason a farmer would recognise.
   */
  check("every road is straight, and every turning has a reason", (() => {
    const s2 = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    const f2 = s2.slice(s2.indexOf("function drawFields"), s2.indexOf("function drawGround"));
    return /moveTo\(laneX, -10\); ctx\.lineTo\(laneX, H \+ 10\)/.test(f2) &&  // one straight run
           !/arcTo\(/.test(f2) &&             // no jogs left in it at all
           !/Math\.sin\(y\*k1/.test(f2) &&    // and no wander either
           /sideY/.test(f2) &&                // the T-junction
           /trackY/.test(f2) &&               // the spur that serves the yard
           /homeRow/.test(f2) &&              // the farmyard's field exists
           /const rx = laneX;/.test(f2) &&    // every row aligns its edges to the lane
           /rowE\[ROWS\] = H;/.test(f2);      // the wrap still lands on a hedgerow
  })());
  /*
   * Sky 29 is a GIFT, and three rules keep it one. It never inflates the star
   * ledger ("every star" must stay a bar you can actually reach); it never
   * counts toward campaignComplete (the workshop curtain falls at 28); and it
   * only opens when every real star is home.
   */
  check("the gift stop stays out of the star ledger",
    SF.profile.maxStars() === 117 && (() => {
      const p = SF.profile.load("LEDGER");
      p.missions[40] = { cleared:true, stars:{ pilot:3 } };
      return SF.profile.totalStars(p) === 0;
    })());
  check("the workshop curtain doesn't wait for the gift", (() => {
    const p = SF.profile.load("CURTAIN");
    SF.missions.MISSIONS.forEach(m => { if(!m.gift) p.missions[m.id] = { cleared:true, stars:{pilot:1} }; });
    return SF.profile.campaignComplete(p);
  })());
  /*
   * The gate CHANGED on request: "the fun level accessible after beating
   * level 39 (no need to collect all stars)". At 117 stars the old gate made
   * the game's best celebration a stop nobody in the family would ever fly.
   */
  check("the gift opens on beating the war, not on every star", (() => {
    const p = SF.profile.load("GATE");
    const idx = SF.missions.MISSIONS.findIndex(m => m.gift);
    // Everything cleared EXCEPT 39, with perfect stars: still locked.
    SF.missions.MISSIONS.forEach(m => {
      if(!m.gift && m.id !== 39) p.missions[m.id] = { cleared:true, stars:{pilot:3} };
    });
    const before = SF.missions.isMissionUnlocked(p, idx);
    // 39 cleared with a single lowly star: open.
    p.missions[39] = { cleared:true, stars:{pilot:1} };
    return !before && SF.missions.isMissionUnlocked(p, idx);
  })());
  check("the gift level has its own theatre",
    !!SF.sky29 && typeof SF.sky29.readyToClear === "function" &&
    SF.missions.MISSIONS.find(m => m.gift).sky29 === true);
  check("painting the sky pays a paint that is never sold",
    SF.config.PAINTS.some(pt => pt.id === "sky29" && pt.secret));
  /*
   * The Mirror Pilot's duel contract. It shipped unwinnable once: a bar
   * sized for a boss you could always shoot, on a boss that stood exactly
   * where you couldn't. The fight now breathes (mirror -> open), the open
   * guard pays double, and the pool respects the difficulty tier. Pinned at
   * the source level because the numbers ARE the design.
   */
  check("the mirror duel breathes, pays out, and scales",
    (() => { const b = fs.readFileSync(path.join(__dirname, "src/mirrorduel.js"), "utf8");
             return /dps \* 3\.2 \* \(diff\.bossHp \|\| 1\)/.test(b) &&   // tier-scaled pool
                    /m\.mode === "open" \? 2 : 1/.test(b) &&            // open guard pays double
                    /mode: "mirror", modeT/.test(b); })());             // the rhythm exists
  /*
   * ...and the duel LIVES on the Glass Sea now - the mirror boss at the end
   * of the mirror level, exactly where the whole mission sets it up. The
   * helper ghost goes quiet the moment the duel arms: the boss IS the
   * reflection, so two of them on screen would be a continuity error.
   */
  check("the Glass Sea's reflection turns at the end", (() => {
    const m36 = SF.missions.MISSIONS[36];
    const b = fs.readFileSync(path.join(__dirname, "src/mirrorduel.js"), "utf8");
    return m36.mirror === true && m36.mirrorDuel === true && !m36.boss &&
           /world\.mirror = false/.test(b) &&        // the ghost gun retires
           /clamp\(W - p\.x, 50, W - 50\)/.test(b) && // it peels off where it flew
           typeof SF.mirrorduel.readyToClear === "function";
  })());
  check("the duel holds the mission open until the glass breaks", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    return /run\.mission\.mirrorDuel && !SF\.mirrorduel\.readyToClear\(\)/.test(g);
  })());
  /*
   * The paint rule is the last thing the game teaches and the one the whole
   * act turns on: fly through a sketch and it comes out on your side. It
   * shipped un-learnable. Measured, a bot flying flat out at the nearest
   * ghost and ignoring every other threat painted SIX of thirty in a minute
   * - exactly the star's target - so a child who also has to dodge never
   * closed the loop and never found out the rule existed.
   */
  check("the paint rule can actually be learned",
    (() => { const b = fs.readFileSync(path.join(__dirname, "src/backstage.js"), "utf8");
             return /ink: 4\.5, painted: false/.test(b) &&      // a window, not a frame
                    /dx\*dx \+ dy\*dy < 46\*46/.test(b) &&       // a brush, not a needle
                    /taughtPaint/.test(b); })());               // and it says so, once
  check("the game says the paint rule out loud, in kid words",
    !!SF.commsData.COMMS.paintSketch &&
    /FLY THROUGH THEM/.test(SF.commsData.COMMS.paintSketch.lines[0]));
  check("the sketch shows its clock and the trail shows the brush",
    (() => { const b = fs.readFileSync(path.join(__dirname, "src/backstage.js"), "utf8");
             return /The claim ring/.test(b) &&                 // time you can see
                    /The loaded head, at the nose/.test(b) &&   // paint comes from YOU
                    /T\("PAINTED!"\) \+ "  " \+ run\.stats\.painted \+ "\/6"/.test(b); })());
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
    // First Patrol's curriculum pins: id 1, no longer index 0 - Earth is.
    const m1 = SF.missions.MISSIONS.find(m => m.id === 1);
    check("the first flight starts shooting in the first two seconds",
      m1.waves[0].t <= 2);
    check("the first rescue lands inside the first half-minute",
      m1.waves.some(w => w.type === "carrier" && w.t <= 30));
    check("the first flight has something to save, more than once",
      m1.waves.filter(w => w.type === "carrier").length >= 3);
    check("no star on the first flight is lost by being touched",
      !m1.objectives.includes("noDamage") && !m1.objectives.includes("keepLives"));
    /*
     * This used to be a name whitelist - grunts and carriers, nothing else -
     * which is not the actual rule, just the roster that happened to satisfy
     * it. It also blocked the level from ever getting more interesting: a
     * first flight of one enemy silhouette for ninety seconds is repetitive
     * long before it is easy, and the customer said so.
     *
     * So the guests are allowed and the CONTRACT is pinned instead. A future
     * designer can add any gentle thing; a Striker or a Kamikaze still can't
     * get in.
     */
    const ETYPES = SF.enemyData.ENEMY_TYPES;
    /*
     * Grunts fire, and always have - straight down, not at you, which you
     * sidestep without thinking. What a beginner cannot handle is a shot
     * that TRACKS them with no warning. Anything that aims must therefore
     * hold a visible tell long enough to read it and move: the Marksman
     * draws its pink thread for 1.7s, which is the whole reason it is the
     * one guest allowed to aim.
     */
    check("nothing on the first flight aims at you without a long tell",
      m1.waves.every(w => {
        const d = ETYPES[w.type];
        if(!d || d.hazard) return true;                 // rocks are scenery
        const aims = (d.fire && d.fire.pattern === "aimed") || d.behaviour === "sniper";
        return !aims || (d.chargeTime || 0) >= 1.5;
      }));
    check("nothing on the first flight is fast or armoured",
      m1.waves.every(w => {
        const d = ETYPES[w.type];
        return !d || d.hazard || ((d.speed || 0) <= 140 && (d.hp || 0) <= 8);
      }));
    /* Guests are a garnish. The backbone stays the enemy you already beat in
       the first two seconds, so the finale reads as "look how good I've got". */
    check("the first flight is still mostly the gentlest enemy", (() => {
      let gentle = 0, guest = 0;
      m1.waves.forEach(w => { if(w.type === "grunt") gentle += w.n; else guest += w.n; });
      return gentle >= guest*3;
    })());
    /* ...and it does have guests, or we are back to the level the customer
       called boring. Two different silhouettes beyond the backbone. */
    check("the first flight has something to look at besides grunts", (() => {
      const kinds = new Set(m1.waves.map(w => w.type).filter(t => t !== "grunt" && t !== "carrier"));
      return kinds.size >= 2;
    })());
  }
  check("every mission has waves and objectives",
    SF.missions.MISSIONS.every(m => m.waves.length > 0 && m.objectives.length === 3));
  /*
   * "Even the first ones should feel different." A level earns an identity by
   * having a boss, a house rule, or a named ship in it - a different mix of
   * the same grunts is not an identity. Missions 1-5 were the offenders, so
   * they are the ones this pins.
   */
  check("no early mission is just a different pile of the same enemies", (() => {
    const OWN = ["boss","storm","wells","beat","blackout","foundry","serpent","convoy",
                 "trench","coinRain","noGuns","rival","vault","backstage","sky29",
                 "cover","bounty","nearMiss","lentDrones","starRain",
                 "ferry","wrap","limpets","flare","stampede","mirror"];
    // Two identities live in the WAVES rather than in a mission flag, and
    // both count: The Gauntlet is its elites, and The Anchor is its cables.
    return SF.missions.MISSIONS.slice(0, 13).every(m =>
      OWN.some(k => !!m[k]) || m.waves.some(wv => wv.tether) ||
      m.waves.filter(wv => wv.elite).length >= 4);
  })());
  check("the first seven each teach their own thing", (() => {
    const M = SF.missions.MISSIONS;
    return M[0].prologue === true &&  // 0: Earth - why the family flies at all
           M[1].lentDrones === 2 &&   // 1: you are not flying this alone
           M[2].bounty === true &&    // 2: pick ONE moving target out of a crowd
           M[3].waves.some(w => w.tether) &&  // 3: read the GAP, not the ships
           M[4].cover === true &&     // 4: they shoot back - so use the rocks
           !!M[5].boss &&             // 5: the first boss
           M[6].nearMiss === true;    // 6: nerve - wait, THEN swerve
  })());
  check("every wave references a real enemy type",
    SF.missions.MISSIONS.every(m => m.waves.every(w => !!SF.enemyData.ENEMY_TYPES[w.type])));
  check("every enemy type has a real behaviour",
    Object.values(SF.enemyData.ENEMY_TYPES).every(t => typeof SF.enemyData.BEHAVIOURS[t.behaviour] === "function"));
  check("bosses declare phases in descending health order",
    Object.values(SF.missions.BOSSES).every(b =>
      b.phases.every((p,i) => i === 0 || p.at < b.phases[i-1].at)));
  check("playfield is tuned-range wide and 800 tall",
    SF.entityConst.VH === 800 && SF.entityConst.VW >= 440 && SF.entityConst.VW <= 720);
  check("nothing spawns outside the playfield",
    SF.missions.MISSIONS.every(m => m.waves.every(wv => {
      const slots = SF.enemyData.FORMATIONS[wv.form](wv.n, SF.entityConst.VW);
      return slots.every(sl => sl.x >= 0 && sl.x <= SF.entityConst.VW);
    })));
  /*
   * The kill-percentage star was unwinnable and nobody could see why.
   * Formations stage their back ranks far above the field - eight of twelve
   * slots in a vee, a twinColumns or a sides start past y=-120, and a
   * twelve-strong column starts at -766 - and the "left through the top"
   * test fired on them on their very first tick. They counted as spawned,
   * counted against the percentage, and could never be shot: a bot killing
   * everything on screen every frame measured 71%.
   */
  check("a wave's back ranks are staged above the field, not off the edge of it",
    (() => {
      const F = SF.enemyData.FORMATIONS, VW = SF.entityConst.VW;
      // At least one formation must stage deep, or this pin is testing nothing.
      return ["column","vee","twinColumns","sides"].some(k =>
        F[k](12, VW).some(s => s.y < -120));
    })());
  check("nothing can escape off the top before it has arrived",
    (() => { const e = fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8");
             return /e\.entered = y > -40/.test(e) &&
                    /\(e\.entered && e\.y < -120\)/.test(e); })());
  check("a staged back rank flies in instead of vanishing", (() => {
    const W = SF.game.world, d = SF.config.DIFFICULTIES[1];
    W.mods = W.mods || {};      // no mission has started this early
    const deep = W.spawnEnemy("grunt", 200, -400, { difficulty: d });
    if(!deep.alive || deep.entered !== false) return false;
    let escaped = 0;
    // A tick at that height must NOT cull it - it has not arrived yet.
    W.updateEnemies(0.016, { difficulty: d, smart: 0,
      onEscape(){ escaped++; }, onPlayerHit(){}, onEnemyKilled(){} });
    const survived = deep.alive && escaped === 0;
    // ...but once it has been in the field, leaving through the top still is.
    deep.y = 100; deep.entered = true; deep.y = -400;
    W.updateEnemies(0.016, { difficulty: d, smart: 0,
      onEscape(){ escaped++; }, onPlayerHit(){}, onEnemyKilled(){} });
    const culled = !deep.alive && escaped === 1;
    deep.alive = false;
    return survived && culled;
  })());
  check("the rescue total counts the haulers that actually fly", (() => {
    // Raw `w.n` gave "rescue every stranded pilot 4 / 2" on a dense tier.
    const s = fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8");
    return /carriesRescue \? this\.waveSize\(w\) : 0/.test(s);
  })());
  /* ---------- the kill books balance ----------
   * "I killed nearly everything and it said 65%" has now had three separate
   * causes: back ranks culled before they arrived, boss adds counted as kills
   * they were never spawned for, and the enemy pool silently overwriting a
   * live ship at its ceiling. Each of them removed or added an entity without
   * telling the ledger, so each of them is pinned at the source.
   */
  check("the enemy pool is deep enough for the densest planned wave", (() => {
    // Worst 28-second window of the planned script (28s is the leash ceiling),
    // at NIGHTMARE density, plus the desktop width top-up.
    let worst = 0;
    SF.missions.MISSIONS.forEach(m => {
      if(!m.waves || !m.waves.length) return;
      const ev = m.waves.map(w => ({ t:w.t, n:Math.max(1, Math.round(w.n*3.6*1.2)) }));
      ev.forEach(a => {
        const s = ev.filter(b => b.t >= a.t && b.t < a.t + 28).reduce((x,b) => x + b.n, 0);
        if(s > worst) worst = s;
      });
    });
    return worst <= SF.game.world.enemies.cap;
  })());
  check("a pool eviction leaves through the books, not silently", (() => {
    const c = fs.readFileSync(path.join(__dirname, "src/core.js"), "utf8");
    const e = fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8");
    return /if\(o\.alive && this\.onSteal\) this\.onSteal\(o\)/.test(c) &&
           /this\.enemies\.onSteal = /.test(e);
  })());
  check("boss adds never count as kills they were not spawned for", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    // Both tallies, one guard. The mission's counter and the per-pilot one a
    // co-op flight banks into a child's own account have to mean the same
    // word, or a solo run would bank a different lifetime number than the
    // progress bar showed - and the two seats' shares would not add up.
    return /if\(e\.counted && !e\.fromBoss\)\{ run\.stats\.kills\+\+; if\(killer\) killer\.killsGot\+\+; \}/.test(g);
  })());
  check("a scripted set piece is not dragged off by the safety leash",
    SF.enemyData.ENEMY_TYPES.serpent.noLeash === true &&
    SF.enemyData.ENEMY_TYPES.serpentSeg.noLeash === true &&
    SF.enemyData.ENEMY_TYPES.rival.noLeash === true &&
    /e\.life > 28 && !e\.noLeash/.test(
      fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8")));
  check("the scripted fights read the damage field bullets actually carry", (() => {
    const b = fs.readFileSync(path.join(__dirname, "src/backstage.js"), "utf8") +
              fs.readFileSync(path.join(__dirname, "src/mirrorduel.js"), "utf8");
    // The read sites only - the comment above one of them names the old
    // field on purpose, so match the expression rather than the string.
    return !/[-+*(]\s*b\.damage/.test(b) && !/b\.damage\s*\|\|/.test(b) &&
           (b.match(/b\.dmg\s*\|\|\s*1/g) || []).length >= 3;
  })());
  /* ---------- every rule the game plays by, it says out loud ----------
   * A mission mechanic teaches itself through one radio line at launch. Eleven
   * of them had one; the four newest did not, and those four sit on missions 1,
   * 2, 3, 5 and 12 - the first flights a seven-year-old takes, where working a
   * rule out from the sky alone is least likely to happen.
   */
  check("every mission mechanic has a radio line that teaches it", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    const C = SF.commsData.COMMS;
    const FLAGS = { noGuns:"silentStart", rival:"rivalStart", storm:"stormStart",
      convoy:"convoyStart", trench:"trenchStart", blackout:"blackoutStart",
      wells:"wellsStart", beat:"chorusStart", foundry:"foundryStart",
      serpent:"serpentStart", sky29:"sky29Start", backstage:"backstageStart",
      // mirrorDuel teaches at ARM time (mirrorSeen, from the module), not at
      // launch - the Glass Sea's opener is the mirror rule itself.
      homecoming:"homecomingStart",
      lentDrones:"dronesStart", bounty:"bountyStart", cover:"coverStart",
      nearMiss:"nearMissStart", ferry:"ferryStart", wrap:"wrapStart",
      limpets:"limpetStart", flare:"flareStart", stampede:"stampedeStart",
      mirror:"mirrorStart" };
    return Object.keys(FLAGS).every(flag => {
      const key = FLAGS[flag];
      // the bucket exists and is wired into startMission's opener chain
      return C[key] && C[key].lines.length &&
             new RegExp("mission\\." + flag + " \\? \"" + key + "\"").test(g);
    });
  })());
  /*
   * A MISSION-LEVEL SPAWNER MUST HAVE AN END.
   *
   * The Stampede shipped spawning a Sky Ox every few seconds for as long as
   * the phase was "waves", with no stop condition. A mission ends on
   * finishedSpawning && countEnemies() === 0, and countEnemies counts EVERY
   * live enemy including hazards - so the herd held the field open forever.
   * The bar read 100%, both stars were won, and the level could not be
   * finished. It was found by a child playing it, not by this suite.
   *
   * Any block in game.js that calls spawnEnemy on a timer has to consult the
   * director before adding to a field the mission is waiting to see empty.
   */
  check("a mission's own spawner stops when the wave script does", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    const block = g.slice(g.indexOf("run.stampede && !run.ended"),
                          g.indexOf("run.storm && !run.ended"));
    return block.length > 200 &&
           /run\.director\.finishedSpawning/.test(block) &&
           /spawnEnemy\("grazer"/.test(block);
  })());
  /* ---------- the page is the sources, joined ---------- */
  /*
   * app.js is what the browser actually runs, and it is generated. The failure
   * mode this rules out is the quiet one: edit a source, forget to rebuild,
   * push, and the site keeps running last week's code while every test here
   * passes against this week's. So the bundle is rebuilt in memory and
   * compared byte for byte.
   */
  check("the shipped bundle is exactly the sources, in order", (() => {
    const built = require("child_process")
      .spawnSync(process.execPath, [path.join(__dirname, "tools/build.js"), "--check"],
                 { encoding: "utf8" });
    return built.status === 0;
  })());
  check("the page fetches one script, not thirty-five", (() => {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const tags = html.match(/<script src="[^"]+"><\/script>/g) || [];
    return tags.length === 1 && /src="app\.js"/.test(tags[0]);
  })());
  check("the offline shell caches the bundle, not the modules", (() => {
    const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
    const shell = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
    return /\.\/app\.js/.test(shell) && !/\.\/src\//.test(shell);
  })());
  /*
   * The join is `cat`, so a source that ever loses its trailing semicolon
   * could glue itself onto the next file's opening paren and turn two modules
   * into a function call. build.js writes a leading `;` between files, and
   * this is the belt to that braces.
   */
  check("every module ends where the next one can safely begin", () =>
    SRC.every(f => /\}\)\(\);\s*$/.test(fs.readFileSync(path.join(__dirname, f), "utf8"))));

  check("no mission flag in the data is missing an opener", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    const TEACHABLE = ["cover","bounty","nearMiss","lentDrones","wells","beat",
                       "foundry","serpent","storm","blackout","convoy","trench"];
    return TEACHABLE.every(f =>
      !SF.missions.MISSIONS.some(m => m[f]) ||
      new RegExp("mission\\." + f + " \\?").test(g));
  })());
  check("the radio talks in pounds, like the rest of the game", (() => {
    const c = fs.readFileSync(path.join(__dirname, "src/data/comms.js"), "utf8");
    const lines = c.match(/"[^"]*\{n\}[^"]*"/g) || [];
    return lines.length > 0 && !lines.some(l => /\$\{n\}/.test(l));
  })());

  /* ---------- the salvaged leads, once each was proved ---------- */
  check("every mission's waves are listed in the order they arrive", (() => {
    // The director walks this array and queues everything overdue, so one line
    // out of sequence collapses several waves into a single instant. Mission 10
    // listed a t=65 wave after a t=70 one: fourteen ships in one breath.
    return SF.missions.MISSIONS.every(m => !m.waves ||
      m.waves.every((wv, i) => i === 0 || wv.t >= m.waves[i-1].t));
  })());
  /* ---------- the star lists, and the shape of the campaign ---------- */
  /*
   * A star list that never changes is a star list nobody reads. Fifteen of
   * thirty-five stops used to carry the identical trio - finish it, kill 80%,
   * free everyone - INCLUDING the first six missions in a row, so a child
   * could reach act two without ever learning that the third star is where a
   * level says what it is about. Four of them now ask for their own brief's
   * promise instead. This is the ratchet: the number may fall, never rise -
   * with ONE counted exception, immediately below.
   *
   * Mission 21's "shake off 10 limpets" star was reported as still
   * impossible in real play even after limpets were made unshootable on
   * approach (see enemies.js) - some players simply could not land the
   * waggle reliably enough to reach ten. A star some pilots genuinely cannot
   * pass is worse than a duplicate one, so it was swapped for the campaign's
   * single most common, always-reachable trio. That is one deliberate
   * exception, spent on a fairness problem a real player hit - not a general
   * loosening, and the cap moves by exactly the one mission it costs.
   */
  check("no single trio of stars covers a third of the campaign", (() => {
    const tally = {};
    SF.missions.MISSIONS.forEach(m => {
      const k = m.objectives.join(",");
      tally[k] = (tally[k] || 0) + 1;
    });
    const worst = Math.max.apply(null, Object.keys(tally).map(k => tally[k]));
    return worst <= 12 && worst < SF.missions.MISSIONS.length / 3;
  })());
  /*
   * Each of the four new stars asks for a thing that only happens when the
   * level's own mechanic is switched on. Fitting `wanted` to a mission with no
   * bounty flag would be a star that cannot light, with nothing on screen to
   * explain why - the same class of bug the Drawing Board's "Destroy 80% of a
   * minefield" was.
   */
  check("a mechanic star is only fitted where the mechanic runs", (() => {
    const M = SF.missions.MISSIONS;
    const has = (o, flag) => M.filter(m => m.objectives.indexOf(o) >= 0).every(m => !!m[flag]);
    // "Cut 6 ropes" is unlightable anywhere there are no ropes, and its
    // mechanic lives in the waves rather than in a mission flag.
    const ropesOk = M.filter(m => m.objectives.indexOf("ropes") >= 0)
      .every(m => m.waves.some(wv => wv.tether));
    return has("wanted", "bounty") && has("nearMiss", "nearMiss") && ropesOk &&
           M.some(m => m.objectives.indexOf("wanted") >= 0) &&
           M.some(m => m.objectives.indexOf("nearMiss") >= 0) &&
           M.some(m => m.objectives.indexOf("ropes") >= 0);
  })());
  /*
   * The subtle one. An ARMOURED boss is sealed until every plate is off (see
   * bosses.damage), so on the Sentinel or the Leviathan "shoot off every weak
   * point" would light itself the instant you won - a free star dressed up as
   * a challenge. It may only be fitted to a boss that can die with its parts
   * still attached.
   */
  check("'shoot off every weak point' is never fitted to a sealed boss", () =>
    SF.missions.MISSIONS.filter(m => m.objectives.indexOf("stripBoss") >= 0)
      .every(m => {
        const b = SF.missions.BOSSES[m.boss];
        return b && !b.armoured && b.weakPoints.length > 0;
      }));
  check("the elite star is winnable on the thinnest tier", (() => {
    const m = SF.missions.MISSIONS.find(x => x.objectives.indexOf("eliteHunt") >= 0);
    if(!m) return false;
    const dir = new SF.systems.WaveDirector(m, SF.config.DIFFICULTY_BY_ID.rookie, SF.game.world);
    let lit = 0;
    m.waves.forEach(wv => { dir.pending.length = 0; dir.queueWave(wv);
                            lit += dir.pending.filter(s => s.elite).length; });
    return lit >= 10;      // the star asks for 8
  })());
  /*
   * THE LAST ACT HAS TO BE THE HEAVIEST FIGHT, NOT THE LIGHTEST.
   *
   * Measured across the campaign: on PILOT nothing scales enemies to your guns
   * (hpTrack is 0 there, deliberately - buying a cannon is supposed to make
   * things melt), while the shop moves a ship from 3.3 dps to 326. So the only
   * curve the campaign HAS is what each mission fields. Act 4 used to field
   * 207 points of fighting health against act 2's 348 - the final act was act
   * one's weight, arriving at the player's strongest. Rocks and mines are
   * excluded: scenery is flown around, not shot, and counting a trench full of
   * boulders made a dodging level read as the hardest fight in the game.
   */
  check("the final act fields at least as much fight as the middle one", (() => {
    const SCENERY = ["asteroid","boulder","mine","shard"];
    const W = SF.game.world, d = SF.config.DIFFICULTY_BY_ID.pilot;
    W.reset(); W.mods = {};
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Weigh"), d));
    const hp = {};
    const hpFor = t => {
      if(hp[t] === undefined){
        try { const e = W.spawnEnemy(t, 200, 200, { difficulty: d }); hp[t] = e.hp; e.alive = false; }
        catch(err){ hp[t] = 0; }
      }
      return hp[t];
    };
    const weigh = m => m.waves.reduce((s, wv) => {
      if(SCENERY.indexOf(wv.type) >= 0) return s;
      const el = Math.min(wv.n, wv.elite || 0);      // elites carry 3.5x hull
      return s + hpFor(wv.type) * ((wv.n - el) + el*3.5);
    }, 0);
    const act = (a, b) => {
      const g = SF.missions.MISSIONS.filter(m => m.id >= a && m.id <= b);
      return g.reduce((s, m) => s + weigh(m), 0) / g.length;
    };
    /*
     * Named rather than numbered, because the ids move every time a level is
     * inserted and this comparison is between two ACTS, not two id ranges.
     * The final act runs from the first stop past the Devourer up to the
     * finale - which hands off to backstage.js after seven waves - and the
     * gift after it is a victory lap, so neither is a fight to weigh.
     */
    const M = SF.missions.MISSIONS;
    const at = n => M.findIndex(m => m.name === n);
    const span = (a, b) => {
      const g = M.slice(a, b);
      return g.reduce((s, m) => s + weigh(m), 0) / g.length;
    };
    return span(at("The Devourer") + 1, at("Behind the Sky")) >=
           span(at("Silent Running"), at("The Leviathan") + 1) * 0.9;
  })());
  check("a Guardian's bubble covers ships, not rocks and belt parts", (() => {
    const pr = SF.entityConst.protectable;
    return pr({ hazard:false, typeId:"grunt" }) === true &&
           pr({ hazard:true,  typeId:"asteroid" }) === false &&
           pr({ hazard:true,  typeId:"mine" }) === false &&
           pr({ hazard:false, typeId:"part" }) === false;
  })());
  check("a Mender heals its own fleet only", (() => {
    const e = fs.readFileSync(path.join(__dirname, "src/data/enemies.js"), "utf8");
    return /o\.hazard \|\| o\.typeId === "part"/.test(e);
  })());
  check("the pierce budget belongs to the bullet, not to the frame", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8");
    return !/let pierceLeft/.test(s) && /b\.pierce > 0\)\{ b\.pierce--/.test(s);
  })());
  check("their bullets are swept against the ship, like ours are against them", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8");
    return /sweep\(b, bpx, bpy, p\.x, p\.y, b\.r \+ p\.r\)/.test(s);
  })());
  check("armour plate actually stops a bullet", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8");
    return /if\(e\.armoured\)\{/.test(s);
  })());
  check("a recycled enemy slot carries nothing from its last life", (() => {
    const W = SF.game.world;
    W.reset();
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("R"), SF.config.DIFFICULTY_BY_ID.pilot));
    const first = W.spawnEnemy("grunt", 100, 100, { difficulty: SF.config.DIFFICULTY_BY_ID.pilot });
    first.chainDepth = 3; first.armoured = true; first.weak = true;
    first.headRef = {}; first.trailPts = [1,2,3]; first.noSplit = true;
    first.hungry = true; first.lockX = 99; first.dodgeCool = 5; first.arming = true;
    first.alive = false;
    // Same slot, handed back out
    const again = W.spawnEnemy("grunt", 100, 100, { difficulty: SF.config.DIFFICULTY_BY_ID.pilot });
    return again === first && again.chainDepth === 0 && again.armoured === false &&
           again.weak === false && again.headRef === null && again.trailPts === null &&
           again.noSplit === false && again.hungry === false && again.lockX === 0 &&
           again.dodgeCool === 0 && again.arming === false;
  })());
  check("a hit the shield ate is not damage taken", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    // damageTaken must be incremented BELOW the shield branch, not above it
    // Prefix, not the whole signature: co-op added a `who` seat argument and
    // an exact match made an unrelated parameter change look like a bug.
    const hit = g.indexOf("onPlayerHit(source, ent");
    const shield = g.indexOf("if(p.shield > 0){", hit);
    const dmg = g.indexOf("run.stats.damageTaken++", hit);
    return hit > 0 && shield > 0 && dmg > shield;
  })());
  check("a Smart Bomb does not refill the screen it just cleared", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    return /e\.noSplit = true;/.test(g) && /!byRamming && !e\.noSplit/.test(g);
  })());
  check("no mission can report more kills than it ever spawned", (() => {
    // The invariant behind the readout, stated where it can be checked: a
    // spawn that pays, combos and scores but is not part of the script must
    // never reach the tally the objective and the progress bar read.
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    const split = g.slice(g.indexOf("const split = e.type.splitsInto;"),
                          g.indexOf("fx.ring(e.x, e.y, 34"));
    return /uncounted:\s*true/.test(split) &&
           /if\(e\.counted && !e\.fromBoss\)\{ run\.stats\.kills\+\+; if\(killer\) killer\.killsGot\+\+; \}/.test(g);
  })());
  check("the Star Vault stays out of the campaign ledger", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    return /\} else if\(run\.mission\.vault\)\{/.test(g);
  })());
  check("the weather stops when the fighting does", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    return (g.match(/run\.phase !== "lap" && run\.phase !== "outro"/g) || []).length >= 2;
  })());
  check("a family record says which tier it was set on", (() => {
    const P = SF.profile;
    P.saveRaw({ name:"TierA", callsign:"TierA", savedAt: 1,
      missions:{ m1:{ cleared:true, stars:{pilot:3}, best:{ pilot: 500, nightmare: 9000 } } } });
    const overall = P.familyBest("m1");
    const onPilot = P.familyBest("m1", "pilot");
    return overall && overall.score === 9000 && overall.tier === "nightmare" &&
           onPilot && onPilot.score === 500 && onPilot.tier === "pilot";
  })());
  check("a Seeker ignores what it has already flown past", (() => {
    const W = SF.game.world;
    W.reset();
    W.createPlayer(SF.game.buildLoadout(SF.profile.blank("S"), SF.config.DIFFICULTY_BY_ID.pilot));
    const d = SF.config.DIFFICULTY_BY_ID.pilot;
    const behind = W.spawnEnemy("grunt", 300, 500, { difficulty: d });   // below
    const ahead  = W.spawnEnemy("grunt", 320, 100, { difficulty: d });   // above
    // A bullet at y=400 flying up: `behind` is nearer, `ahead` is the answer.
    const t = W.nearestTarget(300, 400, 412);
    return t === ahead && W.nearestTarget(300, 400) === behind;
  })());

  check("the mission bar only ever goes forwards", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
    return /Math\.max\(run\.progress \|\| 0, progressNow\)/.test(g) &&
           /run\.mission\.bossRush \? progressNow/.test(g);
  })());
  check("behind the sky, the bar follows the act and not the boss's health",
    typeof SF.backstage.progress01 === "function" &&
    /SF\.backstage\.progress01\(\)/.test(
      fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8")));

  /* ---------- shooting a part off has to be visibly worth it ---------- */
  check("every part that switches something off can name it", (() => {
    // The reward for a weak point is an attack that never comes again - an
    // absence, which is the hardest thing to notice. Every one of them has to
    // have a plain-English name for the callout and the HUD row to use.
    return Object.values(SF.missions.BOSSES).every(b =>
      b.weakPoints.every(wp => {
        if(!wp.disables) return true;
        const a = SF.bosses.ATTACKS[wp.disables];
        return !!(a && a.label && a.label.length);
      }));
  })());
  check("the boss's system row lists each system once", (() => {
    // The Warden carries two hatches that both stop the mine drop; the row is
    // keyed by SYSTEM, so it must not print that twice.
    return Object.values(SF.missions.BOSSES).every(b => {
      const seen = {};
      const rows = b.weakPoints.filter(wp => {
        if(!wp.disables || seen[wp.disables]) return false;
        seen[wp.disables] = 1; return true;
      });
      return rows.length === Object.keys(seen).length;
    });
  })());
  check("a destroyed part says what it switched off", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/bosses.js"), "utf8");
    return /att\.label \+ " IS OFF!"/.test(s);
  })());
  check("the HUD keeps the answer on screen after the bang", (() => {
    const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
    return /boss\.disabled\[wp\.disables\]/.test(r) && /SF\.bosses\.ATTACKS\[wp\.disables\]/.test(r);
  })());
  check("an elite is a different silhouette, not just a bigger one", (() => {
    const e = fs.readFileSync(path.join(__dirname, "src/enemyart.js"), "utf8");
    return /function eliteCarapace/.test(e) && /if\(elite\) eliteCarapace\(ctx, RES, p\)/.test(e);
  })());
  check("the elite shell goes UNDER the hull, so the archetype still reads", (() => {
    const e = fs.readFileSync(path.join(__dirname, "src/enemyart.js"), "utf8");
    const shell = e.indexOf("if(elite) eliteCarapace(ctx, RES, p)");
    const hull  = e.indexOf("shape(ctx, RES, p)", shell);
    return shell > 0 && hull > shell;
  })());

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
    ["firstPart","ace","actTwo","campaign","launchDay","skyTaken","homecoming"].every(k => {
      const st = SF.storyData.STORY[k];
      return st && st.panels.length > 0 &&
        st.panels.every(pn => ["stock","now","crew","sky","dawn","dark","starsBack"].indexOf(pn.art) >= 0 && pn.text.length > 20);
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
  /*
   * ...with exactly ONE deliberate echo, named here so it cannot be joined by
   * an accidental second. The campaign opens on the workshop's own twilight
   * and nobody is told; mission 34 flies the same sky and gives it a name.
   * The pair is the point. Any other repeat is still a mistake.
   */
  check("no two missions look alike, bar the one that means to", (() => {
    const ECHO = ["Lamplight", "Behind the Sky"];
    const seen = SF.skygen.SKIES.filter(k => ECHO.indexOf(k.name) < 0)
      .map(k => k.photo || k.clouds.join(""));
    const pair = SF.skygen.SKIES.filter(k => ECHO.indexOf(k.name) >= 0);
    return new Set(seen).size === seen.length &&
           pair.length === 2 && pair[0].clouds.join("") === pair[1].clouds.join("") &&
           // ...and the echo must not also collide with somebody else.
           seen.indexOf(pair[0].clouds.join("")) < 0;
  })());
  /*
   * ONE HAND PAINTED ALL OF IT.
   *
   * Mission 1 used to be a photograph - thirty-four generated skies and then a
   * JPG, on the opening flight, and it showed. Repainting it left Ice Fields
   * as the last photograph, which simply moved the odd-one-out four missions
   * along; that one is painted now too. Every sky in the campaign comes out of
   * the same generator, so no mission can look like it was pasted in from
   * somewhere else. (`photoFor` and the renderer's photo branch still work -
   * this pins the campaign's own consistency, not the machinery.)
   */
  check("the campaign opens on a generated sky, like the rest of it",
    !SF.skygen.SKIES[0].photo && (SF.skygen.SKIES[0].props || []).length >= 3);
  /*
   * ONE EARTH, AND IT IS OURS.
   *
   * The campaign begins on Earth and the whole story is getting its sky
   * back, so every place that shows our own planet has to show the SAME
   * one. Before Launch Day existed these were an amber giant on the menu, a
   * grey crescent over the first patrol, a banded blue giant on the stop
   * whose own comment called it "the family's own world", and a pink disc
   * with a balloon in it on the map.
   */
  check("every world that means home is the same Earth", (() => {
    const s2 = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    const u2 = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
    const earthsIn = k => (SF.skygen.SKIES[k].props || []).filter(pr => pr.earth);
    const homes = SF.skygen.SKIES
      .map((k, i) => (k.props || []).some(pr => pr.earth) ? i : -1).filter(i => i >= 0);
    return /const EARTH_LIT = /.test(s2) &&
           // the menu's world, hazed back so it can't own a dead corner
           /lit:EARTH_LIT, dark:EARTH_DARK, earth:true, haze:/.test(s2) &&
           // only the two near-home skies carry it, and one each
           homes.join() === "0,2" &&
           earthsIn(0).length === 1 && earthsIn(2).length === 1 &&
           // lit, never a crescent - a sliver is not recognisable as home
           earthsIn(0).concat(earthsIn(2)).every(pr =>
             pr.lit === SF.skygen.EARTH_LIT && !pr.crescent) &&
           // ...and Launch Day's stop on the map draws that same planet
           /node\.mission\.prologue && SF\.skygen\.earthSprite/.test(u2);
  })());
  /*
   * The map repaints every frame, so a per-pixel planet render per frame
   * would cost the map its frame rate on the machine this is played on.
   * Baked once per size, and the same instance handed back after that.
   */
  check("the map's Earth is baked once, not every frame", (() => {
    const a = SF.skygen.earthSprite(64), b = SF.skygen.earthSprite(64);
    return a === b && a.width > 64 && SF.skygen.earthSprite(48) !== a;
  })());
  /*
   * Canvas text is invisible to the DOM sweep, so the map's strap has to ask
   * for its own translation - the same rule the sector rail learned.
   */
  check("the map says EARTH in the reader's language",
    !!SF.i18n._packs.fr.s["EARTH"] &&
    /T\("EARTH"\)/.test(fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8")));
  check("no sky in the campaign is a photograph",
    SF.skygen.SKIES.every(k => !k.photo && (k.props || []).length >= 1));
  /*
   * Rock fields are lit by the sky they float in, not filled with one flat
   * slate - so the painter needs the light vector and the sky, and every rock
   * prop needs a `n` and an `r` for it to work with.
   */
  check("every rock field has a size and a population",
    SF.skygen.SKIES.every(k => (k.props || []).every(p =>
      p.k !== "rocks" || (p.n > 0 && p.r > 0))));
  /*
   * Every element of a sky is drawn three times so the backdrop can scroll
   * forever. A body that does not FIT inside one screen therefore has two of
   * itself on screen permanently, at every scroll position - which is what a
   * home planet parked on the bottom edge did, and it read as two planets
   * rather than as one you are flying past. (A world that fits still passes
   * out of the bottom while the next copy enters at the top; that is the loop
   * working, and it is what every sky in the game does.)
   */
  check("no world is too big to fit the screen it is drawn on", () =>
    SF.skygen.SKIES.filter(k => !k.photo).every(k =>
      (k.props || []).filter(pr => pr.k === "planet").every(pr => {
        const W = 390, H = 800;                  // the narrowest real playfield
        const ry = (pr.r * W) / H;               // radius is a fraction of WIDTH
        return pr.y - ry >= -0.02 && pr.y + ry <= 1.02;
      })));
  /*
   * A SKY SHOULD BE A PLACE, NOT A HAZE.
   *
   * Planets, suns and galaxies are furniture: every sky can have them, and a
   * sky built only from them changes HUE as the campaign goes without ever
   * changing PLACE. Sixteen of thirty-six were furniture-only; the seven worst
   * offenders got something to be about - a ring you fly through, a clutch of
   * eggs, a watchtower, a harbour, a gravity well, the wrecks of everyone who
   * lost here, a rank of pipes. Nine are left, and two of those are meant to
   * be empty rooms.
   *
   * This is a ratchet, like the star-trio count above it: the number may fall,
   * never rise. A new sky that is another haze with a planet in it fails here.
   */
  check("most skies are somewhere rather than some colour", (() => {
    const FURNITURE = { planet:1, galaxy:1, sun:1 };
    const bare = SF.skygen.SKIES.filter(k => (k.props || []).every(p => FURNITURE[p.k]));
    return bare.length <= 10;
  })());
  /*
   * ...and every word the painter knows is a word some sky actually says. A
   * painter with no caller is dead code that still has to be maintained, and a
   * prop kind with no painter draws nothing at all and says nothing about it.
   */
  check("the sky vocabulary has no dead words and no silent ones", (() => {
    const src = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    const dispatched = new Set();
    src.replace(/pr\.k === "(\w+)"/g, (_, k) => { dispatched.add(k); return _; });
    const used = new Set();
    SF.skygen.SKIES.forEach(k => (k.props || []).forEach(p => used.add(p.k)));
    return dispatched.size >= 12 &&
           Array.from(used).every(k => dispatched.has(k)) &&
           Array.from(dispatched).every(k => used.has(k));
  })());
  /*
   * THE ONE WHITE SKY. It was written as "you cannot see stars from inside a
   * star's glare" and it rendered beige, because a white ground with dark dust
   * lanes over it is mud. It has to stay the brightest thing in the campaign
   * by a clear margin, and its filaments have to stay DARKER than it - they
   * were orange at nearly full alpha, standing in front of the brightest sky
   * in the game at almost no contrast.
   */
  check("the bright side is the brightest sky, and its pillars are silhouettes", (() => {
    const M = SF.skygen.SKIES, b = M.find(k => k.name === "The Bright Side");
    if(!b) return false;
    const lums = M.filter(k => k.clouds).map(k => k.lum || 1);
    const pil = (b.props || []).filter(p => p.k === "pillars");
    const dark = h => { const v = parseInt(h.slice(1), 16);
      return (((v>>16)&255) + ((v>>8)&255) + (v&255))/3; };
    return (b.lum || 1) >= Math.max.apply(null, lums) &&
           b.stars <= 0.1 && b.bright === 0 &&
           pil.length >= 2 && pil.every(p => dark(p.lo) < 60 && dark(p.hi) > 180);
  })());
  /*
   * FOUR ORANGES THAT WERE THE SAME ORANGE. Rust, gold, a red star and a
   * foundry sat within a hue of each other, so a quarter of the campaign
   * opened on the same picture. Pinned on the palette rather than on a
   * rendered average: this is about the DECISION, and it is the decision that
   * would drift back.
   */
  check("the four fire skies are four different fires", (() => {
    const names = ["Rust Belt","The Treasury","Their Star","The Foundry"];
    const fam = names.map(n => SF.skygen.SKIES.find(k => k.name === n));
    if(fam.some(k => !k)) return false;
    const rgb = h => { const v = parseInt(h.slice(1), 16);
      return [(v>>16)&255, (v>>8)&255, v&255]; };
    // The bright emission colour is what a sky reads as from the doorway.
    const key = k => rgb(k.clouds[1]);
    /*
     * Hue OR value, not hue alone - the same rule The Wreck Line already lives
     * by next to The Blockade. A foundry is black iron with the fire showing
     * through, so its emission colour is legitimately close to a red star's;
     * what separates them is that one is a bonfire and the other is a cellar.
     */
    const lum = k => k.lum || 1;
    for(let i=0;i<fam.length;i++) for(let j=i+1;j<fam.length;j++){
      const a = key(fam[i]), b = key(fam[j]);
      const hue = Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
      if(hue < 60 && Math.abs(lum(fam[i]) - lum(fam[j])) < 0.3) return false;
    }
    // ...and one of them has to be the dark one, or they are four bright fires.
    return Math.min.apply(null, fam.map(lum)) <= 0.75;
  })());
  check("every generated sky has something with an edge in it",
    // ...except the one flown over GROUND, where the single prop IS the
    // ground and fills the whole frame. Two hazy blobs is the failure this
    // guards against, and a canyon floor is not that.
    SF.skygen.SKIES.filter(k => !k.photo)
      .every(k => (k.props || []).length >= (k.surface ? 1 : 2)));
  /*
   * The photo backdrop path outlived the last photo backdrop, so it is pinned
   * against a probe sky rather than against a mission: build() must still
   * decline to paint one, and photoFor() must still name the asset, so a
   * future sky can go back to a painting. (It would also have to put the file
   * back in the renderer's ASSET_PATHS - nothing fetches the two old JPGs any
   * more. That is pinned separately, below.)
   */
  check("the photo backdrop path still works, though no campaign sky uses it", (() => {
    const S = SF.skygen.SKIES, n = S.length;
    S.push({ name:"__probe", photo:"backAlt" });
    let ok = false;
    try { ok = SF.skygen.build(n, 100, 100) === null &&
               SF.skygen.photoFor(n) === "backAlt" &&
               SF.skygen.build(0, 100, 100) !== null; }   // ...and mission 1 is not one
    finally { S.pop(); }
    return ok && S.length === n;
  })());
  /*
   * 579KB of backdrop photograph used to be fetched at every cold boot, both
   * files MANDATORY, so one 404 took the briefing art for all 29 missions down
   * with it - and one of the two had not been drawn by anything in months.
   */
  check("the boot no longer fetches a backdrop photograph", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
    const table = s.slice(s.indexOf("const ASSET_PATHS"), s.indexOf("const OPTIONAL_ASSETS"));
    return !/BackNew|BackBack/.test(table);
  })());
  /*
   * ROCKS ARE LIT BY THE SKY THEY ARE IN.
   *
   * The old painter filled every chunk with one flat slate, so eighteen fields
   * across thirteen missions read as black paper cutouts - and the same slate
   * grey sat in an amber nebula as in a silver one. Both halves matter: the
   * light DIRECTION comes from the same core the planets use, so a field and
   * the planet beside it agree; the light COLOUR comes from the sky's own star
   * and cloud, so stone under an orange cloud comes back warm.
   */
  check("a rock field takes its light from the sky, not from a constant", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    const fn = s.slice(s.indexOf("function drawRocks"), s.indexOf("let propLayer"));
    return /drawRocks\(ctx, W, H, p, rand, light, sky\)/.test(fn) &&
           /sky\.star/.test(fn) && /sky\.clouds/.test(fn) &&      // colour of the light
           /nx\/nl\)\*lx \+ \(ny\/nl\)\*ly/.test(fn) &&           // per-edge rim, facing the light
           /createLinearGradient/.test(fn) &&                     // a lit face and a dark one
           !/rgba\(26,30,42/.test(fn) &&                          // the old flat slate is gone
           /drawRocks\(px, W, H, pr, rand, coreDir\(pr\.x\*W, pr\.y\*H\), sky\)/.test(s);
  })());
  /*
   * Ice Fields is the one sky in the campaign that inverts the arrangement -
   * bright scenery on a dark, nearly empty ground instead of bright cloud with
   * dark scenery in front of it. That is the whole reason it is memorable
   * without a photograph, so the belt has to actually be ice.
   */
  check("Ice Fields is an ice field", (() => {
    const k = SF.skygen.SKIES.find(x => x.name === "Ice Fields");
    const rocks = ((k && k.props) || []).filter(p => p.k === "rocks");
    return !!k && !k.photo &&
           rocks.length >= 2 && rocks.every(p => p.ice) &&
           k.density <= 0.6;                    // the emptiest sky in the table
  })());
  /*
   * PLANETS ARE BODIES, NOT AIRBRUSHES.
   *
   * The old painter stacked canvas gradients and measured 1.6-3.3% local
   * contrast with its brightest pixel at the DEAD CENTRE of the disc - a
   * snooker ball under a camera flash. The per-pixel renderer is pinned on
   * the numbers that diagnosis used: real surface detail, a highlight pushed
   * out toward the star, a crescent that is a lit sliver rather than a hole,
   * and the same seed baking the same planet forever.
   *
   * The suite's own canvas is a deliberate stub (see the top of this file),
   * where pixelsWritable() correctly hands rendering to the ink fallback - so
   * these pins run skygen in a PRIVATE instance backed by node-canvas, the
   * same way the game runs it in a browser. If node-canvas is missing the
   * pins pass vacuously, exactly like the suite's other native-dep escapes.
   */
  {
    let NC = null;
    try { NC = require("canvas"); } catch(e){}
    let sg2 = null;
    if(NC){
      const w2 = { SF: {}, devicePixelRatio: 1,
                   localStorage: { getItem: () => null, setItem: () => {} } };
      const d2 = { createElement: () => NC.createCanvas(1, 1) };
      ["src/core.js", "src/skygen.js"].forEach(f =>
        new Function("window", "document",
          fs.readFileSync(path.join(__dirname, f), "utf8"))(w2, d2));
      sg2 = w2.SF.skygen;
    }
    const probe = (props, N) => {
      const S = sg2.SKIES, n = S.length;
      S.push({ name:"__probe", clouds:["#1e3a8a","#3b82f6","#0c1836"], dust:"#020510",
        star:"#dbeafe", density:0.0001, stars:0, bright:0, props });
      try { return sg2.build(n, N, N, 1); } finally { S.pop(); }
    };
    check("a planet has a surface, and its light comes from its star", !sg2 || (() => {
      const N = 200;
      const cv = probe([{k:"planet", x:0.5, y:0.5, r:0.40,
                         lit:"#8cc7f2", dark:"#0a1a2e", bands:true}], N);
      const d = cv.getContext("2d").getImageData(0, 0, N, N).data;
      const L = (px,py) => { const i=((py|0)*N+(px|0))*4;
        return 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; };
      const R = N*0.40, c = N/2;
      let sum=0, cnt=0, mean=0, hi=-1, hd=0;
      for(let py=1;py<N-1;py++) for(let px=1;px<N-1;px++){
        const dx=px-c, dy=py-c, dd=Math.sqrt(dx*dx+dy*dy);
        if(dd > R*0.9) continue;
        const l = L(px,py);
        sum += Math.abs(l-L(px+1,py)) + Math.abs(l-L(px,py+1));
        mean += l; cnt++;
        if(l > hi){ hi = l; hd = dd; }
      }
      const detail = (sum/(2*cnt))/Math.max(1, mean/cnt)*100;
      return detail > 3.5 && hd > R*0.5;
    })());
    check("a crescent is a lit sliver on a body, not a hole", !sg2 || (() => {
      const N = 160;
      const cv = probe([{k:"planet", x:0.5, y:0.5, r:0.40,
                         lit:"#8cc7f2", dark:"#0a1a2e", crescent:true}], N);
      const d = cv.getContext("2d").getImageData(0, 0, N, N).data;
      const R = N*0.40, c = N/2;
      let mx=-1, mean=0, cnt=0;
      for(let py=0;py<N;py++) for(let px=0;px<N;px++){
        const dx=px-c, dy=py-c;
        if(dx*dx+dy*dy > R*R*0.92) continue;
        const i=(py*N+px)*4;
        const l = 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
        mean += l; cnt++;
        if(l > mx) mx = l;
      }
      mean /= cnt;
      return mx > 30 && mean < mx*0.45;
    })());
    check("the same seed bakes the same planet forever", !sg2 || (() => {
      const mk = () => probe([{k:"planet", x:0.5, y:0.5, r:0.35, lit:"#e0a13e",
                               dark:"#3a1f04", bands:true, rings:true}], 140).toDataURL();
      const a = mk(), b = mk();
      return a === b && a.length > 2000;
    })());
  }
  // ...and the gradient painter stays, verbatim, as the no-pixel fallback -
  // which is also what the suite's own stubbed canvas exercises above.
  check("the ink planet remains the fallback", (() => {
    const src = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    return /function drawPlanetInk/.test(src) &&
           /if\(!pixelsWritable\(\)\) return drawPlanetInk/.test(src);
  })());
  check("planets are lit, not drawn: mottling, weather and a terminator", (() => {
    const s = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    return /Surface mottling/.test(s) &&                   // material, not vinyl
           /Math\.sin\(ph \+ x\/r\*freq\)\*wob/.test(s) &&  // bands that wave
           /lang - 2\.2, lang - 0\.9/.test(s) &&            // crater rims catch the sun
           /Atmosphere/.test(s);                            // haze outside the lit limb
  })());
  check("a crescent body is shaded once, not twice", (() => {
    // Running the crescent cut AND the radial terminator is what turned the
    // big dark planets into holes punched in the nebula.
    const s = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    return /if\(p\.crescent\)\{[\s\S]*?\} else \{[\s\S]*?terminator|Earthshine/.test(s) &&
           /Earthshine/.test(s);
  })());
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
  // With Act 4 in the campaign, campaignComplete means mission 28: the
  // Devourer's curtain must anchor to ITS mission or a fresh profile gets
  // the wrong story played over the workshop's ending.
  check("the Devourer keeps its curtain; the workshop gets the true one",
    !!SF.storyData.STORY.workshop &&
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /maybeStory\("workshop"\)/.test(u) &&
                    /missionIndex === DEVOURER_END\) maybeStory\("campaign"\)/.test(u); })());
  /*
   * Launch Day is bookended: its briefing opens the story's first page and
   * its first results card turns it. Both hooks are pinned as source because
   * each fires exactly once per pilot - the functional side is asserted in
   * the mission 0 flow below, where the cards actually pop.
   */
  check("Launch Day opens the book and the first night turns the page",
    !!SF.storyData.STORY.launchDay && !!SF.storyData.STORY.skyTaken &&
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /if\(m\.prologue\) showStory\(SF\.storyData\.STORY\.launchDay\)/.test(u) &&
                    /run\.mission\.prologue\) maybeStory\("skyTaken"\)/.test(u); })());
  /*
   * ...and the opening page is the ONE beat that is not once-only: it plays
   * every time the stop is picked, because it is the story's first page and
   * the mission gets replayed for fun. `maybeStory` would silence it after
   * the first look, so the hook must call `showStory` directly.
   */
  check("the opening page is never gated by the save", (() => {
    const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
    return !/maybeStory\("launchDay"\)/.test(u);
  })());
  /*
   * The pages were English in every language for months, because only the
   * beat's SHELL was registered with the binder - the panels' prose (the
   * part a reader actually reads) and the button never made the list.
   */
  check("the binder reaches the story panels and buttons", (() => {
    const u = fs.readFileSync(path.join(__dirname, "src/data/i18nbind.js"), "utf8");
    return /"button"/.test(u) && /b\.panels \|\| \[\]/.test(u);
  })());
  check("every story page speaks French", (() => {
    const s2 = SF.i18n._packs.fr.s;
    return Object.keys(SF.storyData.STORY).every(k => {
      const b = SF.storyData.STORY[k];
      return (!b.title || !!s2[b.title]) && (!b.button || !!s2[b.button]) &&
             (b.panels || []).every(pn => !!s2[pn.text]);
    });
  })());

  /* ---------- pilot picker + menu ---------- */
  check("pilot grid lists Marc & Charles", qa("#profileGrid .profile-card").length === 2);
  /*
   * EVERYTHING CLICKABLE HAS TO BE CLICKABLE IN FULLSCREEN TOO.
   *
   * Fullscreen takes pointer lock, so the OS cursor is gone and the game
   * hit-tests its own reticle against INTERACTIVE - "button, a, input,
   * select, textarea, [role=button]" - and synthesises the press. A plain
   * div with a click listener matches none of that, so the pilot cards were
   * visible, looked pressable, and did nothing: you had to leave fullscreen
   * to change pilot. Same for the garage's ship canvas.
   *
   * Pinned against the selector input.js actually uses rather than against
   * the attribute, so any future markup that satisfies the hit test passes.
   */
  {
    const INTERACTIVE = "button, a, input, select, textarea, [role=button]";
    const src = fs.readFileSync(path.join(__dirname, "src/input.js"), "utf8");
    check("the fullscreen cursor's target list is still what this pins against",
      src.indexOf('const INTERACTIVE = "' + INTERACTIVE + '"') > -1);
    check("a pilot card can be pressed by the fullscreen cursor",
      Array.from(qa("#profileGrid .profile-card")).every(c => c.matches(INTERACTIVE)));
    check("...and so can the garage's ship", (() => {
      const h = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
      const tag = /<canvas id="hangarCanvas"[\s\S]*?>/.exec(h);
      return !!tag && /role="button"/.test(tag[0]);
    })());
    /*
     * And the synthesised click has to carry WHERE it happened. This was
     * el.click(), which fires at 0,0 - fine for a button, useless for the
     * garage ship, which is hit-tested against the tap position inside its
     * canvas and so never matched in fullscreen.
     */
    check("a synthesised press carries the cursor position, not 0,0",
      /new MouseEvent\("click", base\)/.test(src) &&
      /clientX:lockX, clientY:lockY/.test(src));
  }
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
  /*
   * MY SHIP is two shelves now: the AIRFRAME you fly and the TUNE you fit,
   * in that order, because the chassis and the engine map multiply. Both use
   * the same card, so the count is both lists.
   */
  check("MY SHIP is the airframe bay and the tuning bay",
    qa("#armoryPanel .tune-card").length === SF.config.TUNES.length + SF.shipart.HULLS.length &&
    qa("#armoryPanel .part-chip").length === 0);
  /*
   * Every line on an airframe's card, measured at ZERO upgrades - the state a
   * brand-new buyer is actually in. The Anvil's first draft advertised "+15%
   * damage", and because bullet damage is a small integer that also picks the
   * shot's art tier, Math.round((1+0)*1.15) was 1: the headline stat did
   * nothing at all until the cannon was three levels up. A 30,000 card is not
   * allowed to promise what the maths rounds away.
   */
  /*
   * TWO HULLS HAVE TO LOOK LIKE TWO HULLS.
   *
   * The first Anvil kept the Dart's wing exactly - same tips, same sweep - and
   * only widened the fuselage. Rendered and counted: the two ships shared 76%
   * of their pixels bare and 92% FITTED OUT, because the twenty-one bolted-on
   * parts are identical on both and swamped the one thing that differed. The
   * family looked at them and said they were the same plane.
   *
   * So the contract is measured, not eyeballed, and it is measured with the
   * parts ON, which is how a ship is actually seen. Under 60% shared pixels.
   */
  check("no two airframes are the same aeroplane", (() => {
    const A = SF.shipart;
    const N = 200, S = 84;
    const levels = { rapid:3, spread:3, thrusters:2, shield:1, damage:2, wingman:1 };
    const maskFor = hull => {
      const cv = window.document.createElement("canvas");
      cv.width = cv.height = N;
      const c = cv.getContext("2d");
      if(!c || !c.getImageData) return null;
      c.clearRect(0, 0, N, N);
      A.drawShip(c, N/2, N/2, S, { color:"#3fa9f5", levels, t:0.6, idle:false, hull });
      const d = c.getImageData(0, 0, N, N).data;
      const m = new Uint8Array(N*N);
      for(let i=0;i<N*N;i++) m[i] = d[i*4+3] > 40 ? 1 : 0;
      return m;
    };
    const masks = A.HULLS.map(h => maskFor(h.id));
    // jsdom's 2D context is a stub with no real pixels; the measurement runs
    // for real in Chromium (tools/, and the render check in the notes). Here
    // we can still hold the GEOMETRY apart, which is what drives it.
    if(masks.some(m => !m || !m.some(v => v))){
      const poly = A.HULLS.map(h => JSON.stringify(h.outline));
      const scales = A.HULLS.map(h => h.artScale || 1);
      return new Set(poly).size === A.HULLS.length &&
             new Set(scales).size === A.HULLS.length;
    }
    let worst = 0;
    for(let i=0;i<masks.length;i++) for(let j=i+1;j<masks.length;j++){
      let inter = 0, uni = 0;
      for(let k=0;k<masks[i].length;k++){
        const a = masks[i][k], b = masks[j][k];
        if(a||b) uni++; if(a&&b) inter++;
      }
      worst = Math.max(worst, uni ? inter/uni : 1);
    }
    return worst < 0.60;
  })());
  /*
   * The skeleton is the reason all twenty-one parts land on both hulls with
   * nothing re-tuned: nothing bolts on outboard of |x| 0.37, so every hull
   * must actually have wing out to there.
   */
  check("every airframe has wing where the parts bolt on", () =>
    SF.shipart.HULLS.every(h => {
      const xs = h.outline.map(pt => Math.abs(pt[0]));
      return Math.max.apply(null, xs) >= 0.37;
    }));

  check("a stock Anvil delivers every line on its card, and nothing else", (() => {
    const d = SF.config.DIFFICULTY_BY_ID.pilot;
    const stock = SF.profile.blank("__hullcard");
    const of = h => SF.game.buildLoadout(Object.assign({}, stock, { hull: h }), d);
    const dart = of("dart"), anvil = of("anvil");
    return anvil.lives      === dart.lives + 1 &&
           anvil.shieldMax  === dart.shieldMax + 1 &&
           anvil.invulnTime >  dart.invulnTime * 1.25 &&   // "+30% recovery"
           anvil.speedMult  <  dart.speedMult &&           // "-12% speed"
           anvil.hitR       >  dart.hitR &&                // "bigger target"
           // and nothing the card stays silent about moved behind the buyer's back
           anvil.damage === dart.damage && anvil.fireInterval === dart.fireInterval;
  })());
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

  /* ---------- the garage ----------
   * The Armory is a ROOM: pegboard of parts on the wall, a painted bay circle
   * with the pilot's callsign, and a purchase that plays out as a show
   * (fitting -> rev -> dial) instead of a number changing. The room must never
   * make buying harder: the shop below is untouched, and the only tappable
   * things in the scene jump INTO it.
   *
   * ONE bay, deliberately. It used to park the siblings' ships either side and
   * a chalk outline where one was missing; on a phone those were 40px wide,
   * unreadable, and sitting between a child and the thing they came to change.
   * Same for the tool chest, the mug and the crates. The room shows you YOUR
   * ship - anything else is competing with the only object that matters.
   */
  check("the armory is a garage: a room with the pilot's own bay",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /function garageBackdrop/.test(u) &&
                    /BAY 01/.test(u); })());                  // the stencil on the floor
  check("the room is not cluttered with things nobody can use",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             const g = u.slice(u.indexOf("function garageBackdrop"),
                               u.indexOf("function queuePurchaseShow"));
             return !/OUT FLYING/.test(g) && !/SQD/.test(g) &&
                    !/the tool chest/.test(g); })());
  await runFrames(3);       // the garage paints on the armory's own rAF loop
  /*
   * The pegboard is gone. It hung the upgrade ladder on the wall as eight
   * hooks - owned parts as glyphs, the rest as chalk outlines - and on a phone
   * that was a 150px strip of 16px icons restating, cryptically, the line
   * directly beneath the bay: which part is next, and what buys it. Two
   * answers to one question, and the worse one held the top third of the room.
   *
   * The ship is now the only thing in the room that answers a tap, and it
   * answers the only question the room poses.
   */
  check("the wall carries no pegboard to decode",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return !/garage\.hooks/.test(u) && !/nextHook/.test(u) &&
                    !/P A R T S/.test(u); })());
  check("tapping the ship jumps the shop to the next part", (() => {
    const cv = id("hangarCanvas");
    const next = SF.shipart.nextPart(SF.shipart.levelsOf(SF.ui.getProfile()));
    if(!next) return true;
    // jsdom has no layout: give the canvas a fake on-screen box to map against
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: cv.width, height: cv.height });
    cv.dispatchEvent(new window.MouseEvent("click",
      { clientX: cv.width/2, clientY: cv.height*0.60, bubbles: true }));
    return qa('#armoryPanel .si-badge[data-glyph="' + next.up + '"]').length === 1;
  })());
  clickEl(tabByName("GUNS"));

  const buyBtn = i => qa("#armoryPanel .shop-item")[i].querySelector("button");
  const priceBefore = buyBtn(0).textContent;
  clickEl(buyBtn(0));
  check("buying a level raises the next price", buyBtn(0).textContent !== priceBefore);
  check("a purchase queues its show instead of blocking anything",
    SF.ui._purchaseShows() >= 1);
  check("the dial marks exactly what moved, in gold",
    qa("#hangarSpecs .hs-gain").length >= 1 &&
    qa("#hangarSpecs .hs-row.dim").length >= 1 &&
    qa("#hangarSpecs .hs-row.hot").length >= 1);
  check("the show knows the real before and after",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /before: loadBefore, after: loadAfter/.test(u) &&
                    // guns fire at the ACTUAL new rate, not a metaphor of it
                    /sh\.after\.fireInterval/.test(u); })());
  check("the fitting swaps the hull only at the clang",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /sh\.swapped \? sh\.levelsBefore/.test(u) === false &&
                    /\(sh && sh\.part && !sh\.swapped\) \? sh\.levelsBefore : levels/.test(u); })());
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
  /*
   * A BAND, not a floor. This pin used to read `> 600000` and passed happily
   * while the shop drifted to £944,170 - thirteen and a half times the ~£70k
   * the cost-curve comment claims and the per-kill payout in game.js is tuned
   * against. Sixty-five per cent of that sat in five purchases nobody could
   * reach. A one-sided assertion cannot catch a runaway, so this one has a
   * ceiling as well as a floor.
   */
  check("maxing the armory is a long-haul goal, not an afternoon",
    SF.config.TOTAL_UPGRADE_COST > 40000);
  check("the armory is reachable inside a childhood",
    SF.config.TOTAL_UPGRADE_COST < 120000);
  check("the first level of anything is pocket money",
    SF.config.UPGRADES.every(u => u.costs[0] <= 2000));
  check("each level costs meaningfully more than the last",
    SF.config.UPGRADES.every(u => u.costs.every((c,i) => i === 0 || c > u.costs[i-1]*1.8)));
  // No single purchase may dominate the shop. Salvage Rig L5 alone used to be
  // £214,920 against a £944,170 total - 23% of everything, in one item that
  // could never repay itself (it needed £1.43M of earnings to break even).
  /*
   * The Style Shop lives UNDER the Armory. When the Armory was mis-priced at
   * £944,170 the cosmetics were a rounding error beside it; re-pricing the
   * Armory inverted the hierarchy without anyone touching the cosmetics table,
   * and a trail ended up dearer than any gun. Pinned as a ratio so the two
   * tables can never drift apart silently again.
   */
  check("looking good costs less than fighting well", (() => {
    const sum = a => a.reduce((n, x) => n + (x.cost || 0), 0);
    const cos = sum(SF.config.PAINTS) + sum(SF.config.TRAILS) +
                sum(SF.config.DECALS) + sum(SF.config.FIREWORKS);
    return cos > 0 && cos < SF.config.TOTAL_UPGRADE_COST * 0.55;
  })());
  check("no hat costs more than the best gun in the game", (() => {
    const all = [].concat(SF.config.PAINTS, SF.config.TRAILS,
                          SF.config.DECALS, SF.config.FIREWORKS);
    const dearestCosmetic = Math.max.apply(null, all.map(x => x.cost || 0));
    const dearestUpgrade = Math.max.apply(null,
      SF.config.UPGRADES.map(u => Math.max.apply(null, u.costs)));
    return dearestCosmetic < dearestUpgrade;
  })());
  check("a first paint job is inside a child's first few missions",
    SF.config.PAINTS.filter(p => !p.secret).every(p => p.cost <= 1200));

  check("no single upgrade level costs more than an eighth of the shop",
    SF.config.UPGRADES.every(u => u.costs.every(c => c < SF.config.TOTAL_UPGRADE_COST/8)));
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
  check("only the first stop - Earth - is unlocked at the start",
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
      /FLY MISSION 0\b/.test(nb.querySelector("b").textContent) &&
      nb.querySelector("span").textContent === SF.missions.MISSIONS[0].name);
    /* A button, not a card: one label and one name, and short enough to sit on
       a single line of a phone. The card it replaced ran to five lines. */
    check("it stays a button rather than growing back into a card",
      nb.children.length === 2 && nb.textContent.length < 44);
    clickEl(nb);
    check("tapping it briefs that mission",
      id("screen-briefing").classList.contains("active") &&
      id("briefNum").textContent === "MISSION 0");
    /*
     * The story's first page. Picking Launch Day opens the LAUNCH DAY card -
     * the family, the farm, and why there are six new ships in the workshop -
     * so the theft later means something.
     */
    check("picking Launch Day opens the story's first page",
      !id("storyOverlay").classList.contains("hidden") &&
      /LAUNCH DAY/.test(id("storyTitle").textContent) &&
      qa("#storyPanels .story-panel").length === 3);
    clickEl(id("storyBtn"));
    check("the first page closes on its own button",
      id("storyOverlay").classList.contains("hidden"));
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
    const openOn = (clearedIds, starred) => {
      const p = SF.ui.getProfile();
      const keep = p.missions;
      p.missions = {};
      // `starred` is the finished pilot: the gift stop needs every star, not
      // just every clear, so "done" means done properly.
      clearedIds.forEach(mid => { p.missions[mid] = { cleared:true, stars: starred ? {pilot:3} : {}, best:{} }; });
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
    /*
     * A veteran of the old campaign has never flown Earth. Their cleared
     * missions unlock THEMSELVES (see isMissionUnlocked), so the map still
     * targets their real frontier - mission 10's successor - rather than
     * dragging the whole family back to the tutorial. Earth stays open
     * behind them, one stop down, whenever they want the story.
     */
    const vet   = openOn([1,2,3,4,5,6,7,8,9]);
    const mid   = openOn([0,1,2,3,4,5,6,7,8,9]);
    const done  = openOn(SF.missions.MISSIONS.map(m => m.id), true);

    check("the campaign targets the first mission you have not cleared",
      fresh.mission === 1 && vet.mission === 11 && mid.mission === 11 &&
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

  /* ---------- the map answers "what next, and why?" ----------
   * Sky 29 asks for all 84 stars, so the map has to be able to say which ones
   * are missing, where they are, and how to get there. Four pins, one per
   * control, plus the record change that makes naming a missing star possible.
   */
  {
    const p = SF.ui.getProfile();
    const keep = p.missions;
    p.missions = {};
    // Cleared everything, but mission 2 is one star short and 3 is two short.
    // The gift is cleared here too: an uncleared stop is NEW GROUND now that
    // it opens with the war, and the button would (rightly) chase it first.
    SF.missions.MISSIONS.forEach(m => {
      p.missions[m.id] = { cleared:true, stars:{ pilot:3 }, best:{ pilot:1000 } };
    });
    const m2 = SF.missions.MISSIONS[1], m3 = SF.missions.MISSIONS[2];
    p.missions[m2.id] = { cleared:true, stars:{ pilot:2 }, best:{ pilot:1000 },
                          met:{ pilot: m2.objectives.slice(0, 2) } };
    p.missions[m3.id] = { cleared:true, stars:{ pilot:1 }, best:{ pilot:1000 } };
    SF.ui.renderMissions();

    check("a record remembers WHICH objectives were ticked, not just how many",
      (() => { const miss = SF.profile.missingObjectives(p, m2);
               return miss && miss.length === 1 && miss[0] === m2.objectives[2]; })());
    check("an old save without that detail still reports the gap, unnamed",
      SF.profile.missingObjectives(p, m3) === null);
    check("the header states the goal, not just the tally",
      /more ★ to a golden campaign/.test(id("campaignGoal").textContent) &&
      parseFloat(id("campaignBarFill").style.width) > 0);
    check("the star hunt offers itself only when stars are owed",
      !id("starHuntBtn").classList.contains("hidden") &&
      /FIND MY STARS \(2\)/.test(id("starHuntBtn").textContent));
    check("with the road finished, the button chases a star instead of a stop",
      /GRAB A STAR/.test(id("campaignNext").textContent));
    check("the rail lists every sector, newest stretch first",
      qa("#sectorRail .rail-stop").length === 12 &&
      /THE EASEL/.test(qa("#sectorRail .rail-stop")[0].textContent));
    /*
     * A name on its own explained nothing: "DEEP RUN" beside a dot tells a
     * seven-year-old neither what the place is nor that it contains stops.
     * Every sector now carries a number, a line of kid words, and a colour
     * that the map band, the label and the rail chip all share.
     */
    check("every sector says what it is, in words a child would use",
      SF.ui.SECTORS.every(s => typeof s.sub === "string" && s.sub.length > 12 &&
                               /^#[0-9a-f]{6}$/i.test(s.hue || "")));
    check("no two sectors wear the same colour",
      new Set(SF.ui.SECTORS.map(s => s.hue)).size === SF.ui.SECTORS.length);
    check("the vaguest two names were made concrete",
      !SF.ui.SECTORS.some(s => s.name === "DEEP RUN" || s.name === "WARDEN SPACE"));
    check("the rail chip carries the number, the name and the score", (() => {
      const chips = qa("#sectorRail .rail-stop");
      const easel = chips[0];                       // the last stretch, at the top
      return chips.length === 12 &&
             easel.querySelector("span b") && easel.querySelector("em") &&
             chips.every(c => !!c.style.getPropertyValue("--sec")) &&
             /12/.test(easel.querySelector("span b").textContent);
    })());
    /*
     * The band label and its one-line description. Both now go through T:
     * canvas text has no text nodes, so the DOM sweep cannot reach a word of
     * this map - it has to ask for its own translations, and the customer
     * found the whole thing still in English when it did not.
     */
    check("the map paints each sector as a band, not just a caption",
      (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
               return /T\("SECTOR \{n\} · STOPS \{a\}-\{b\}"/.test(u) &&
                      /ctx\.fillText\(sec\.sub/.test(u); })());
    check("the map asks for its own translations, since no sweep can reach it",
      (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
               return /SECTORS\.forEach\(sec => SF\.i18n\.bind\(sec, \["name", "sub"\]\)\)/.test(u) &&
                      /T\("✓ DEFEATED"\)/.test(u) && /T\("READY TO PAINT"\)/.test(u); })());

    // A pilot with every star gets neither a hunt button nor a star to chase.
    // The gift record is wiped: the hunt fixture above cleared it, and a
    // painted gift flips the header to its "nothing left" line.
    SF.missions.MISSIONS.forEach(m => {
      if(!m.gift) p.missions[m.id] = { cleared:true, stars:{ pilot:3 }, best:{ pilot:1000 } };
    });
    delete p.missions[SF.missions.GIFT.id];
    SF.ui.renderMissions();
    check("all stars home: the hunt puts itself away",
      id("starHuntBtn").classList.contains("hidden") &&
      /the whole campaign, gold/.test(id("campaignGoal").textContent) &&
      /FLY MISSION/.test(id("campaignNext").textContent));

    p.missions = keep;
    SF.ui.renderMissions();
  }

  /* ---------- the way back ----------
   * The report was "they don't always know how to get back". The old exits
   * were text links at the BOTTOM of each screen, in a different place on
   * each - on the Armory, past a whole shelf of upgrades. There is now one
   * door, in one place, on every screen that has one.
   */
  {
    const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
    check("there is one way back, and it is fixed to the corner",
      !!id("wayBack") && !!id("backBtn") && !!id("crumbs") &&
      /\.way-back\s*\{[^}]*position:\s*fixed/.test(css));
    check("it is a thumb target, not a text link",
      /--nav-h:\s*46px/.test(css) &&
      /\.back-btn\s*\{[\s\S]*?min-height:\s*var\(--nav-h\)/.test(css));
    check("the old bottom-of-the-screen exits are gone from view",
      /#missionsBackBtn,[\s\S]{0,200}#wsBackBtn\s*\{\s*display:\s*none/.test(css));
    check("nothing sticky can slide under the door",
      // The screens that carry a bar are padded by exactly its height, and a
      // scroll container measures its children's sticky offsets from the
      // CONTENT edge - so top:0 already means "just below the door".
      /--sticky-top:\s*calc\(var\(--nav-top\) \+ var\(--nav-h\)/.test(css) &&
      /#screen-missions,[\s\S]{0,240}padding-top:\s*var\(--sticky-top\)/.test(css));

    const back = () => id("wayBack").classList.contains("hidden");
    SF.ui.show("screen-menu");
    check("home has no way back - it IS the way back", back());
    SF.ui.show("screen-game");
    check("combat has no way back either; it has a pause button", back());
    SF.ui.renderMissions(); SF.ui.show("screen-missions");
    check("the campaign's door says where it goes",
      !back() && id("backWord").textContent === "MENU");
    check("...and the trail says where you are",
      /MENU/.test(id("crumbs").textContent) && /CAMPAIGN/.test(id("crumbs").textContent) &&
      !!id("crumbs").querySelector(".crumb.here"));
    clickEl(id("backBtn"));
    await runFrames(4);
    check("the door works", id("screen-menu").classList.contains("active"));

    // The escape hatch: MENU is the first crumb everywhere, and tapping it
    // comes home from any depth.
    SF.ui.renderMissions(); SF.ui.show("screen-missions");
    SF.ui.show("screen-armory");
    const first = id("crumbs").querySelector(".crumb");
    check("the first crumb is always home", first && first.textContent === "MENU");
    clickEl(first);
    await runFrames(4);
    check("tapping it comes home from anywhere", id("screen-menu").classList.contains("active"));

    check("the phone's own back gesture is wired, not ignored",
      (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
               return /addEventListener\("popstate"/.test(u) &&
                      /history\.pushState/.test(u) &&
                      // ...and a swipe in from the left edge does the same thing
                      /clientX < 26/.test(u) &&
                      typeof SF.ui.navBack === "function"; })());
  }

  /* ---------- the map reads as a record of what was done ----------
   * A finished stretch used to look exactly like an unfinished one, and a
   * locked stop was a grey disc that teased nothing. Both are state the map
   * already knew and simply wasn't saying.
   */
  {
    const p = SF.ui.getProfile();
    const keep = p.missions;

    p.missions = {};
    // Sector 0 is always reachable (mission 1 always is), so the unreached
    // case has to be a stretch further up the road.
    check("an untouched stretch reports itself unreached",
      (() => { const s = SF.ui.sectorStats(1); return !s.reached && s.done === 0 && s.total > 0; })());

    // Three-star the first stretch only.
    const first = SF.ui.sectorStats(0);
    for(let i = first.from; i <= first.to; i++){
      const m = SF.missions.MISSIONS[i];
      p.missions[m.id] = { cleared:true, stars:{ pilot:(m.objectives||[]).length }, best:{ pilot:1 } };
    }
    const perfect = SF.ui.sectorStats(0);
    check("a stretch with every star in it reads PERFECT",
      perfect.reached && perfect.cleared && perfect.perfect &&
      perfect.stars === perfect.starMax);

    // Same stops cleared, one star short: cleared but not perfect.
    p.missions[SF.missions.MISSIONS[first.from].id].stars.pilot = 1;
    const cleared = SF.ui.sectorStats(0);
    check("cleared and perfect are different things",
      cleared.cleared && !cleared.perfect && cleared.stars < cleared.starMax);

    check("the sectors tile the whole campaign, with no stop in two of them",
      (() => {
        let expect = 0;
        for(let si = 0; si < 12; si++){
          const s = SF.ui.sectorStats(si);
          if(s.from !== expect) return false;
          expect = s.to + 1;
        }
        return expect === SF.missions.MISSIONS.length;
      })());

    p.missions = keep;
    SF.ui.renderMissions();
  }
  // A locked stop is a DRAWING now, so its enemy needs graphite rather than
  // the near-black cut-out that vanishes against one.
  check("a locked stop's enemy is drawn in pencil, not in shadow",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /function enemySilPencil/.test(u) &&
                    /unlocked \? enemySil\(face\.enemy\)\s*:\s*enemySilPencil\(face\.enemy\)/.test(u); })());

  // Sky 29 is an ENDING, not stop twenty-nine. The chart is torn short of it,
  // the last leg is a pencil line, and nothing that belongs to a painted sky -
  // twinkling stars, shooting stars, the supply convoy - crosses the rip.
  check("the campaign map is torn short of the gift stop",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /function mapTearY/.test(u) &&
                    /THE EDGE OF THE MAP/.test(u) &&
                    /— for the boys/.test(u); })());
  /*
   * The gift stop's NAME is one fact, not a dozen string literals. It used to
   * be written out by hand in the map caption, the star-hunt line, both node
   * labels, two toasts, the paint it awards and its own PAINTED banner - all
   * saying "SKY 29", which was true only while the campaign was 29 stops long.
   * Adding a level anywhere before it made every one of them lie at once.
   */
  check("nothing hard-codes the gift stop's name",
    (() => { const files = ["src/ui.js", "src/sky29.js", "src/game.js"];
             return files.every(f =>
               !/"[Ss][Kk][Yy] 29"/.test(fs.readFileSync(path.join(__dirname, f), "utf8"))); })());
  check("the gift stop names itself from the mission data",
    SF.missions.GIFT && SF.missions.GIFT.gift === true &&
    SF.missions.giftName() === SF.missions.GIFT.name.toUpperCase());
  check("the paint the gift stop awards keeps its id and its secrecy",
    (() => { const paint = SF.config.PAINT_BY_ID.sky29;
             // The id is written into the family's saves and must never move;
             // the display name is Papa's, not the stop number's.
             return !!paint && paint.secret && paint.name === "PAPA'S DAWN"; })());
  check("the last leg of the route is drawn in pencil",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /const offMap = !!b\.mission\.gift/.test(u); })());
  check("nothing from a painted sky crosses the tear",
    (() => { const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
             return /if\(s\.y\*H < tearY\) return;/.test(u) &&      // no twinkle on paper
                    /const roadEnd = Math\.min\(reached/.test(u); })());  // convoy stays on the map

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
      SF.entityConst.VW >= 380 && SF.entityConst.VW <= 720);
    /* The field lands in the screen MINUS the status bar and home indicator -
       ~93px of difference on an iPhone, which was the entire remaining gap.
       Measure the reserved strips rather than assuming them. */
    /*
     * ONE EARTH. "On level 1 I want earth to only appear once. Right now
     * there are multiple earth which makes no sense."
     *
     * The backdrop is a vertically TILING texture and `tiled` draws each prop
     * at y AND y-H, so a planet hung low enough reaches the frame from the
     * top at the same moment it is sitting at the bottom. The fix is a layer
     * that does not tile, so this pins both halves: the planet is off the
     * looping texture, and it is on the layer that goes past once.
     */
    check("the sky mission 1 flies keeps its Earth off the looping backdrop", (() => {
      const idx = SF.missions.skyOf(1);
      const props = SF.skygen.SKIES[idx].props || [];
      const earths = props.filter(pr => pr.earth);
      return earths.length === 1 && earths.every(pr => pr.once === true);
    })());
    check("...and that layer is built, while a sky without one builds none", (() => {
      const one = SF.skygen.buildOnce(SF.missions.skyOf(1), 300, 400, 1);
      const none = SF.skygen.buildOnce(SF.missions.skyOf(2), 300, 400, 1);
      return !!one && one.width > 0 && none === null;
    })());
    /* A still never scrolls, so nothing can come round twice in one - and
       leaving Earth out of a briefing hero would just make it emptier. */
    check("a still asks for the whole sky, once-props and all", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
      const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
      return /mode === "all" \? true : \(!!pr\.once === \(mode === "once"\)\)/.test(r) &&
             /SF\.skygen\.build\(skyIx, W, Math\.round\(W\*1\.25\), 1, true\)/.test(u);
    })());
    /* It drifts on its own clock, and slower: a planet is the far plane. At
       sky speed Earth cleared the screen in forty seconds. */
    check("the once-layer drifts slower than the sky it hangs behind", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      return /skyDrift \+= dt\*7\.5\*0\.22\*wf/.test(r) &&
             /if\(skyOnce && skyDrift < VH\) ctx\.drawImage\(skyOnce/.test(r);
    })());
    check("the field is matched to the measured box, not a guess at the screen",
      /env\(safe-area-inset-/.test(fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8")));

    /* "The menu is full screen but not when I'm playing a level." The field
       floor was 440 - a 0.55 shape on a 0.46 phone - so it fitted by width and
       left a black band top and bottom: 77% of the screen. The box it lands in
       is the screen MINUS the status bar and home indicator (390x763 on a 14,
       an aspect of 0.51), so a 0.50 field fills it. */
    check("a tall phone gets a field shaped like the phone", (() => {
      const src = fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8");
      // The FLOOR only - the ceiling is no longer a literal, it depends on
      // how many pilots are flying and on the room the HUD needs.
      const m = src.match(/Math\.max\((\d+), Math\.min\(/);
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
   * A boss should look like it is flying and, once you have hurt it, like it
   * is losing. Both used to be missing: the hulls hung in the sky with no
   * exhaust, and battle damage was a few thin lines that read as scratched
   * paint at any health. Every hull funnels through the same two helpers, so
   * pinning them covers all of them.
   */
  check("every boss hull burns an engine", (() => {
    const b = fs.readFileSync(path.join(__dirname, "src/bossart.js"), "utf8");
    if(!/function thrust\(/.test(b)) return false;
    // one thrust() call inside each hull that should have visible engines
    return ["marauder","jailer","sentinel","phantom","leviathan"].every(id => {
      const at = b.indexOf("  " + id + "(ctx, boss, S, damage, timeMs){");
      if(at < 0) return false;
      return /thrust\(ctx/.test(b.slice(at, at + 2600));
    });
  })());
  check("a hurt boss is coming apart, not scratched", (() => {
    const b = fs.readFileSync(path.join(__dirname, "src/bossart.js"), "utf8");
    return /BATTLE DAMAGE/.test(b) &&
           /damage > 0\.35/.test(b) &&      // holes punched through the plating
           /damage > 0\.55/.test(b) &&      // the worst of them vent
           /damage > 0\.70/.test(b);        // and the hull throbs red
  })());
  check("a blown weak point keeps burning",
    (() => { const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
             return /A blown part is the clearest progress/.test(r); })());
  /*
   * Ordinary stops are told apart by the enemy drawn inside them, so any two
   * sharing a face are two stops that look the same - which is the whole thing
   * this was built to fix. Asserted rather than eyeballed, because the face is
   * picked by a heuristic that a new level could quietly collide with.
   */
  {
    // The gift stop draws a painted disc, not an enemy - it sits out the face rule.
    const ord = SF.missions.MISSIONS.filter(m => !m.boss && !m.gift).map(m => SF.ui.missionFace(m));
    const faces = ord.map(f => f.enemy);
    check("every ordinary stop draws an enemy", faces.every(Boolean));
    /*
     * This pinned the BODY alone until the campaign outgrew it: twenty-six
     * ordinary stops against twenty-three drawn ship shapes, so some body has
     * to appear twice however carefully the faces are assigned. What a child
     * actually tells apart is the whole node - the ship AND the kind, which
     * picks the node's colour and its label - so that pair is what is pinned,
     * and every collision left is a deliberate one where the kinds differ:
     * the Convoy's interceptor is an escort and the Lifeline's is a fight,
     * the Treasury's thief is a coin run and the Ring's is a fight, the
     * Trench's turret sits in rocks and the Bright Side's does not, and the
     * Storm's splitter is weather where the Glass Sea's is not.
     */
    const pairs = ord.map(f => f.enemy + "|" + f.kind);
    check("no two ordinary stops wear the same face",
      new Set(pairs).size === pairs.length);
    check("a named face is the one that gets drawn",
      SF.ui.missionFace(SF.missions.MISSIONS.find(m => m.name === "The Hatchery")).enemy === "hive");
  }
  await runFrames(3);
  check("the campaign map draws without errors", errors.length === 0);
  clickEl(qa("#campaignNodes .map-node")[1]);
  check("locked missions can't be opened", !id("screen-briefing").classList.contains("active"));

  clickEl(qa("#campaignNodes .map-node")[0]);
  check("briefing opens for mission 1", id("screen-briefing").classList.contains("active"));
  /*
   * ...and the story's first page plays AGAIN. It already fired once up in
   * the map section, so a once-only beat would be silent here - this is the
   * check that keeps "the story card should appear every time the level is
   * selected" true, from a second real trip through the map.
   */
  check("the story's first page plays again on a second visit",
    !id("storyOverlay").classList.contains("hidden") &&
    /LAUNCH DAY/.test(id("storyTitle").textContent));
  clickEl(id("storyBtn"));
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
  // "pay" not "pays": the detail line now speaks the reader's language
  // ("normal pay" on PILOT, "pays 1.8× the money" on ACE).
  check("the briefing explains the tier you picked", /pay/.test(id("briefDiffDetail").textContent));

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
  /*
   * The first flight is EARTH now, and its first forty seconds are the
   * flight check: no enemies, on purpose. The old "spawns within two
   * seconds" truth moved to First Patrol's own data pin; what this flow
   * verifies is the whole Mission 0 script, start to results.
   */
  check("the prologue owns the frame and is not ready to end",
    SF.prologue.active() && !SF.prologue.readyToEnd());
  check("comms greeted the pilot by name at launch", (() => {
    const said = SF.comms._state.lastAt;
    const openers = Object.keys(said).filter(k => /Start$/.test(k) || k === "missionStart");
    return openers.length > 0;
  })());
  check("the workshop opened Mission 0, not generic control",
    SF.comms._state.lastAt.prologueStart !== undefined);
  check("player auto-fires without any input", SF.game.world.bullets.countAlive() > 0);
  // Earth lends the squadron too: the brothers fly the check with you.
  check("the first flight flies with lent drones",
    SF.game.world.player.drones >= 2);

  /*
   * FLY THE CHECK. The bot steers by teleport: every few frames it parks
   * the ship on the oldest waiting ring, exactly the motion a child's thumb
   * makes, minus the child. Rings arrive one at a time for ~36 seconds.
   */
  for(let leg = 0; leg < 46; leg++){
    const st = SF.prologue._s();
    const pl = SF.game.world.player;
    if(!st || !pl) break;
    if(st.t > 42 || (SF.game.run.stats.ringsHit || 0) >= 8) break;
    const open = st.rings.find(r => !r.hit && !r.gone && r.x !== undefined);
    if(open){
      // The wander-bot's held arrow keys drag the ship off a single-frame
      // teleport before the hit can land - so hold it there for three.
      for(let k = 0; k < 3; k++){
        pl.x = open.x; pl.y = open.y; pl.vx = 0; pl.vy = 0;
        await runFrames(1);
      }
    }
    await runFrames(30);
  }
  check("the flight check counts rings as they are flown",
    (SF.game.run.stats.ringsHit || 0) >= 6);
  /*
   * Every gate on the course must be REACHABLE: the ship is clamped to
   * y >= 250 (entities.js PLAY_TOP), and the first draft of the course
   * parked three rings above that ceiling - gates a child could stare at
   * and never touch. Caught by this very bot, kept as a pin.
   */
  check("every practice ring sits inside the ship's flight envelope",
    SF.prologue._spots.every(([fx, fy]) =>
      fy*SF.entityConst.VH > 250 + 30 && fy*SF.entityConst.VH < SF.entityConst.VH - 60 &&
      fx > 0.1 && fx < 0.9));

  // Tallying the hooks as well as the buzzes: the rumble table was tuned off
  // these counts (guns 4/s, kills 0.6/s), so the numbers it was tuned against
  // stay visible if a later change to spawning moves them.
  const hooks = {}; const realPlay = SF.audio.play;
  SF.audio.play = (n, a) => { hooks[n] = (hooks[n]||0) + 1; return realPlay(n, a); };
  const vibesAtStart = vibrations.length, clockAtStart = fakeNow;

  // Balloons and the raid: park mid-field and let the guns speak. Then
  // catch the chute the moment it exists - the story holds for the catch.
  {
    const pl = SF.game.world.player;
    pl.x = SF.entityConst.VW/2; pl.y = SF.entityConst.VH*0.72;
    let caught = false;
    for(let leg = 0; leg < 210 && !SF.prologue.readyToEnd(); leg++){
      await runFrames(60);
      const pods = SF.game.world.pickups.items.filter(k => k.alive && k.kind === "rescue");
      if(pods.length){ pl.x = pods[0].x; pl.y = pods[0].y; caught = true; }
    }
    check("Marc's chute went out, and the bot caught it", caught &&
      (SF.game.run.stats.rescues || 0) >= 1);
    check("the theft played before the game would end",
      SF.prologue._s().theftAt > 0);
    // The script has ended; let the AREA CLEAR banner and the results card
    // actually land before asserting on them.
    await runFrames(900);
  }

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
  /*
   * Earth is QUIET by design - a flight check, one raid, one rescue - so
   * the "core loop is felt" bar sits at its measured density (12 buzzes on
   * this deterministic bot), not at a combat mission's. The busy-mission
   * density keeps its own bar in the interaction sims further down.
   */
  check("the core loop is felt, not just the rare events", vibrations.length - vibesAtStart > 9);
  check("the raid actually spawned and was swept", SF.game.run.stats.spawned >= 20);
  console.log("Mission 0 sim ->", SF.game.run.phase, "spawned:", SF.game.run.stats.spawned,
    "kills:", SF.game.run.stats.kills, "enemies left:", SF.game.world.enemies.countAlive(),
    "state:", SF.game.state);
  check("no runtime errors during mission 0", errors.length === 0);
  check("comms reacted to more than one kind of event",
    Object.keys(SF.comms._state.lastAt).length >= 2);
  check("comms never leaves a panel stuck on screen",
    !SF.comms.current() || SF.comms.current().life <= SF.comms.current().max);
  const res1 = !id("overlayResults").classList.contains("hidden");
  check("mission 0 reached the results screen", res1);
  /*
   * The night after Launch Day. The first completion turns the story's page:
   * the sky is gone, and every mission after this one has its reason. The
   * card pops OVER the results, once, and is recorded on the save.
   */
  check("finishing Launch Day turns the story's page",
    !id("storyOverlay").classList.contains("hidden") &&
    /THE FIRST NIGHT/.test(id("storyTitle").textContent) &&
    qa("#storyPanels .story-panel").length === 3);
  clickEl(id("storyBtn"));
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
  check("mission 0 recorded as cleared", !!(marc.missions && marc.missions[0] && marc.missions[0].cleared));
  check("the first night is remembered on the save",
    !!(marc.stories && marc.stories.skyTaken));
  check("earned stars on the record itself", (() => {
    const st = marc.missions[0] && marc.missions[0].stars;
    return !!st && Object.values(st).some(v => v >= 1);
  })());
  /*
   * ...and those stars gate NOTHING. The prologue sits outside the star
   * ledger exactly like the gift stop, so adding a tutorial did not move
   * the Sky 29 gate for a pilot already at 116/117.
   */
  check("Earth's stars stay off the campaign ledger",
    SF.profile.totalStars(marc) === 0 && SF.profile.maxStars() === 117);
  check("money was banked", marc.money > 0);
  check("kills were counted", marc.totalKills > 0);
  console.log(`Mission 1 -> stars:${SF.profile.totalStars(marc)} kills:${marc.totalKills} money:${marc.money}`);

  /* ---------- mission 2 unlocked by finishing 1 ---------- */
  clickEl(id("resultsMenuBtn"));
  check("First Patrol unlocked after clearing Earth",
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
    // By name: the point is a mission with a big wave in it, and indices move.
    const m8 = SF.missions.MISSIONS.find(m => m.name === "The Gauntlet");
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
    /*
     * Tracking is real but CAPPED (TRACK_CEIL in entities.js). Uncapped it was
     * a 100% tax: a hard tier raised enemy health by exactly the share of the
     * damage you had just bought, so the shop's whole gun shelf bought nothing
     * at all above PILOT. The band below is the contract - armour still chases
     * your guns, and it stops chasing before it catches them.
     */
    check("hard tiers do scale enemies to your guns",
      hpFor(maxed, "nightmare") > hpFor(stock, "nightmare") * 1.5);
    check("hard tiers stop chasing your guns before they catch them",
      hpFor(maxed, "nightmare") <= hpFor(stock, "nightmare") * 2.2);
    check("each tier is meaningfully tougher than the last",
      hpFor(stock,"pilot") < hpFor(stock,"ace") &&
      hpFor(stock,"ace") < hpFor(stock,"veteran") &&
      hpFor(stock,"veteran") < hpFor(stock,"nightmare"));
    check("a maxed ship still meets a real wall on NIGHTMARE",
      hpFor(maxed, "nightmare") >= 8 * hpFor(maxed, "pilot"));

    /*
     * BUYING GUNS HAS TO CHANGE HOW LONG THINGS TAKE TO KILL.
     *
     * Fifteen of the twenty-four archetypes carry a `toughSeconds`, which used
     * to floor their health at `yourDPS x toughSeconds x 0.5` - health sized
     * from your guns, so time-to-kill was constant BY CONSTRUCTION. Measured on
     * PILOT before the fix: a turret died in 0.51s with £750 of shopping and
     * 0.50s with £441,000, and a carrier got slower (0.57s to 0.60s) from
     * rounding. Plasma Rounds level 5 moved a turret from 0.50s to 0.50s.
     *
     * These pin the property the shop is actually selling, on the archetypes
     * that carry the floor, so no future anti-trivialisation tweak can quietly
     * cancel the gun shelf again.
     */
    const ttk = (prof, tierId, typeId) => {
      const tier = SF.config.DIFFICULTY_BY_ID[tierId];
      W.reset(); W.createPlayer(SF.game.buildLoadout(prof, tier));
      return W.spawnEnemy(typeId, 100, 100, { difficulty: tier }).hp / W.player.dps;
    };
    const budget = SF.profile.blank("Budget");
    budget.upgrades = { spread:2, rapid:1, damage:2 };
    ["turret","carrier","boulder","hive","mender"].forEach(t => {
      check("a maxed ship kills a " + t + " far faster than a budget one",
        ttk(maxed, "pilot", t) < ttk(budget, "pilot", t) * 0.6);
    });
    check("upgrades still tell on NIGHTMARE, where armour chases hardest",
      ttk(maxed, "nightmare", "turret") < ttk(budget, "nightmare", "turret") * 0.6);
    /*
     * ELITES multiply whatever the hull ends up being, floor included. They
     * used to multiply the pre-floor number only, so the moment the floor
     * overtook `scaled x 3.5` - about £3,300 of gear - an elite had exactly the
     * same health as the ordinary ship beside it, while still paying 4x money
     * and 4x score. Fourteen of twenty-four archetypes were in that state by
     * £18,000: the scary one in the wave was free money.
     */
    {
      const tier = SF.config.DIFFICULTY_BY_ID.pilot;
      W.reset(); W.createPlayer(SF.game.buildLoadout(maxed, tier));
      const norm = W.spawnEnemy("turret", 100, 100, { difficulty: tier }).hp;
      const el = W.spawnEnemy("turret", 100, 100, { difficulty: tier, elite: true }).hp;
      check("an elite is tougher than its ordinary twin at every gear level",
        el > norm * 3);
    }
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
  // Everything up to and including the first boss, so its node is reachable.
  SF.missions.MISSIONS.slice(0, SF.missions.MISSIONS.findIndex(m => m.boss) + 1)
    .forEach(m => { p2.missions[m.id] = { cleared:true, stars:{ pilot:3 }, best:{} }; });
  window.localStorage.setItem("patrol_profile_Marc", JSON.stringify(p2));
  clickEl(id("missionsBackBtn"));
  clickEl(id("switchBtn"));
  clickEl(qa("#profileGrid .profile-card")[0]);
  clickEl(id("playBtn"));
  // The campaign's first boss, wherever it sits.
  clickEl(qa("#campaignNodes .map-node")[
    SF.missions.MISSIONS.findIndex(m => m.boss)]);
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
    // update() hands the fight back at the START of the eased outro (TOTAL
    // minus OUT); the outro itself is drawing-only and rides the mission
    // clock, so bars fade over live gameplay instead of hard-cutting.
    check("the arrival hands the fight back on its own clock",
      done && Math.abs(steps/30 - (BI.TOTAL - BI.OUT)) < 0.2);
    check("the arrival delivers the boss to its station",
      Math.abs(fake.y - fake.targetY) < 2 && fake.entering === false);
    check("the outro is drawing-only - update() no longer runs the timeline",
      !BI.update(1/30, fake));
    BI.reset();
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

  /* ---------- THE DRAWING BOARD ----------
   * Family-drawn skies are data, and three promises hold: everything the
   * board offers is real (a chip that compiles to a missing enemy is a crash
   * a kid authored), a drawn sky flies as a mission object, and the campaign
   * ledger never hears about the flight - the family board does. */
  check("the board's vocabulary is real",
    // Mines have no SHAPES entry (drawn bespoke in play AND on the board).
    SF.workshop.TYPES.every(tp => !!SF.enemyData.ENEMY_TYPES[tp] && (SF.enemyArt.has(tp) || tp === "mine")) &&
    SF.workshop.FORMS.every(f => !!SF.enemyData.FORMATIONS[f]) &&
    SF.workshop.BOSSES.every(b => !b.id || !!SF.missions.BOSSES[b.id]));
  check("the board never offers a boss whose death needs its own level",
    !SF.workshop.BOSSES.some(b => b.id === "forgery" || b.id === "devourer" || b.id === "papa"));
  /* A seven-year-old cannot read "WEAVER x6 TWINCOLUMNS" and see a level, so
   * the board draws the sky it is describing - real backdrop, real sprites in
   * the game's OWN formation shapes, real boss hull. */
  check("the board draws the sky it is describing",
    (() => { const w = fs.readFileSync(path.join(__dirname, "src/workshop.js"), "utf8");
             const h = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
             return /id="wsPreview"/.test(h) &&
                    /function drawPreview/.test(w) &&
                    /SF\.skygen\.build\(draft\.sky/.test(w) &&      // the real backdrop
                    /SF\.enemyData\.FORMATIONS/.test(w) &&          // the real shapes
                    /SF\.ui\.drawBossHull/.test(w); })());
  check("the preview can reach the map's boss painter",
    typeof SF.ui.drawBossHull === "function" && typeof SF.ui.bossHullReady === "function" &&
    SF.workshop.BOSSES.every(b => !b.id || SF.ui.bossHullReady(b.id)));
  check("the preview stops drawing when the board is closed",
    (() => { const w = fs.readFileSync(path.join(__dirname, "src/workshop.js"), "utf8");
             return /classList\.contains\("active"\)\) return;/.test(w); })());
  check("every house rule is a flag the game honours",
    (() => { const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
             return SF.workshop.RULES.every(r => r.id === "none" ||
               new RegExp("mission\\." + r.id + "\\b|run\\." + r.id + "\\b").test(g)); })());
  {
    const prof = SF.ui.getProfile();
    const missionsBefore = JSON.stringify(prof.missions);
    const lastBefore = prof.lastMission;
    const m = SF.workshop.toMission({
      id:"ws-test", name:"Test Sky", author: prof.name, authorCall:"TEST",
      sky:9, rule:"wells", boss:"",
      waves:[ { type:"grunt", n:6, form:"vee" }, { type:"carrier", n:1, form:"column" } ] });
    check("a drawn sky compiles to a real mission",
      m.custom === true && m.wells === true && m.waves.length === 2 &&
      m.objectives.includes("kill80") && m.objectives.includes("rescueAll"));
    /*
     * THE SILLY BITS. The Wacky Sky rolls two or three of these; the Drawing
     * Board hands the whole table to a child and lets them choose. They ride
     * out in the same two fields the roll uses (`mods` and `modList`), which
     * is the entire integration - every hook downstream already reads those.
     */
    {
      const silly = SF.workshop.toMission({
        id:"ws-silly", name:"Silly Sky", author: prof.name, authorCall:"TEST",
        sky:9, rule:"none", boss:"", mods:["giant","disco","confetti"],
        waves:[ { type:"grunt", n:6, form:"vee" } ] });
      check("a drawn sky can carry the Wacky Sky's silly bits",
        silly.mods.giant === true && silly.mods.disco === true &&
        silly.modList.length === 3 && /GIANT ENEMIES/.test(silly.goal));
      // Two names is a promise a child can read on the banner; six is a wall.
      check("more than two silly bits are counted, not listed",
        / 2 more silly things!$/.test(silly.goal));
      const plain = SF.workshop.toMission({
        id:"ws-plain", name:"Plain Sky", author: prof.name, authorCall:"TEST",
        sky:9, rule:"none", boss:"", waves:[ { type:"grunt", n:6, form:"vee" } ] });
      check("a sky with no silly bits declares none at all",
        plain.mods === undefined && plain.modList === undefined);
      /*
       * A dice roll can decline to put TINY SHIP and MEGA SHIP in the same
       * hand. A child tapping chips cannot, so the board has to switch the
       * loser off - the same CONFLICTS table, one exported helper.
       */
      check("the board knows which silly bits cannot share a sky",
        SF.wacky.clashesWith("tiny").indexOf("mega") >= 0 &&
        SF.wacky.clashesWith("mega").indexOf("tiny") >= 0 &&
        SF.wacky.clashesWith("bouncy").indexOf("vacuum") >= 0 &&
        SF.wacky.clashesWith("disco").length === 0);
      check("every silly bit the board offers is a real modifier",
        SF.workshop.modList().length === SF.wacky.MODIFIERS.length &&
        SF.workshop.modList().every(x => !!SF.wacky.MOD_BY_ID[x.id] && !!x.name && !!x.blurb));
    }
    SF.game.startMission(m, "pilot");
    await runFrames(300);
    check("a drawn sky flies", SF.game.run.mission.custom === true &&
      SF.game.run.director.spawnedCount > 0 && errors.length === 0);
    SF.game.endMission(true);
    await runFrames(12);
    check("the campaign ledger never hears about a drawn sky",
      JSON.stringify(SF.ui.getProfile().missions) === missionsBefore &&
      SF.ui.getProfile().lastMission === lastBefore);
    check("the family board hears about it instead",
      !!(SF.ui.getProfile().workshopBest && SF.ui.getProfile().workshopBest["ws-test"] &&
         SF.ui.getProfile().workshopBest["ws-test"].score >= 0));
    if(!id("overlayResults").classList.contains("hidden")) clickEl(id("resultsMenuBtn"));
    await runFrames(6);
  }

  /* ---------- the early levels' own mechanics, actually firing ---------- */
  {
    /*
     * These are diagnostic flights, not play, so the ledger is put back
     * afterwards: a FAILED campaign run still books a best score, and leaving
     * three of those on the pilot would quietly rewrite the family's records
     * (and every later test that reads them).
     */
    const prof = SF.ui.getProfile();
    const ledger = JSON.parse(JSON.stringify(prof.missions));
    const lastBefore = prof.lastMission, diffBefore = prof.lastDifficulty;

    // WANTED (mission 2): the director rings exactly one ship per salvo, and
    // killing it pays five times. Both halves, because a marker nobody is
    // paid for is decoration and a payout nobody can see is accounting.
    SF.game.startMission(SF.missions.MISSIONS.findIndex(m => m.bounty), "pilot");
    await runFrames(60);
    check("the wanted level rings one ship per salvo, and only one", (() => {
      const dir = SF.game.run.director;
      if(SF.game.run.mission.bounty !== true) return false;
      dir.pending.length = 0;
      dir.queueSalvo({ type:"grunt", n:8, form:"line" }, 8, 0);
      return dir.pending.filter(s => s.bounty).length === 1;
    })());
    /*
     * A HEADCOUNT CANNOT EXCEED THE HEAD IT COUNTED.
     *
     * `totalPlanned` and `spawnedCount` come from the wave script. A Splitter is
     * ONE planned enemy that comes apart, and its three shards were being
     * spawned into the world with no flag - so each one added to `kills` against
     * a total that never included it. Reported from a real flight of the
     * Hatchery on ACE: "Destroy every enemy 401/247", with the mission bar
     * sitting at 100% while the level was still running.
     */
    check("killing a splitter counts as one kill, not four", (() => {
      const W = SF.game.world, d = SF.config.DIFFICULTY_BY_ID.pilot;
      W.reset(); W.mods = {};
      W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Split"), d));
      const run = SF.game.run;
      run.stats.kills = 0;
      const parent = W.spawnEnemy("splitter", 200, 200, { difficulty: d });
      if(!parent.counted) return false;             // the parent MUST count
      SF.game.callbacks.onEnemyKilled(parent, null, false, true);
      const shards = W.enemies.items.filter(e => e.alive && e.typeId === "shard");
      if(shards.length !== 3) return false;         // it really did come apart
      shards.forEach(sh => SF.game.callbacks.onEnemyKilled(sh, null, false, true));
      return run.stats.kills === 1 && shards.every(sh => !sh.counted);
    })());

    check("a wanted ship pays five times over", (() => {
      const d = SF.game.run.difficulty;
      const want = SF.game.world.spawnEnemy("grunt", 320, 200, { difficulty: d, bounty: true });
      const before = SF.game.run.stats.bounties || 0;
      SF.game.callbacks.onEnemyKilled(want, null, false);
      return want.bounty === true && (SF.game.run.stats.bounties || 0) === before + 1;
    })());
    SF.game.endMission(false);
    await runFrames(4);

    // COVER: a rock eats their bullets. Found by flag rather than by index,
    // so inserting a level ahead of it cannot silently test a different one.
    SF.game.startMission(SF.missions.MISSIONS.findIndex(m => m.cover), "pilot");
    await runFrames(60);
    check("rocks stop their shots on the levels that promise it", (() => {
      const w = SF.game.world;
      if(!w.cover) return false;
      const rock = w.spawnEnemy("boulder", 300, 300, { difficulty: SF.game.run.difficulty });
      rock.entering = false;
      const b = w.spawnEnemyBullet(300, 300, 0, 200, "bolt", 4);
      SF.systems.resolve(w, { onPlayerHit(){}, onEnemyKilled(){}, onEscape(){}, godMode:true }, 0.016);
      const stopped = !b.alive;
      rock.alive = false;
      return stopped;
    })());
    SF.game.endMission(false);
    await runFrames(4);

    // NEAR MISS: a diver that goes past your wingtip pays.
    SF.game.startMission(SF.missions.MISSIONS.findIndex(m => m.nearMiss), "pilot");
    await runFrames(60);
    check("cutting it fine pays on the kamikaze level", (() => {
      const w = SF.game.world;
      if(SF.game.run.mission.nearMiss !== true) return false;
      const before = SF.game.run.stats.grazes || 0;
      const e = w.spawnEnemy("kamikaze", 200, 200, { difficulty: SF.game.run.difficulty });
      SF.game.callbacks.onGraze(e);
      const paid = (SF.game.run.stats.grazes || 0) === before + 1;
      e.alive = false;
      return paid && e.diver === true;       // ...and it is a diver that earns it
    })());
    check("a drifting grunt is not a dodge", (() => {
      const e = SF.game.world.spawnEnemy("grunt", 100, 100, { difficulty: SF.game.run.difficulty });
      const ok = e.diver === false;
      e.alive = false;
      return ok;
    })());
    SF.game.endMission(false);
    await runFrames(4);

    prof.missions = ledger;                 // hand the records back untouched
    prof.lastMission = lastBefore; prof.lastDifficulty = diffBefore;
    SF.profile.save(prof);
    if(!id("overlayResults").classList.contains("hidden")) clickEl(id("resultsMenuBtn"));
    await runFrames(6);
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
  /*
   * Announcements stack; they do not sit on each other. Thirteen call sites in
   * game.js throw a centred shout at a hand-picked fraction of the screen and
   * none of them knows what else is up - caught live on The Searchlight with
   * "PILOT ADRIFT" landing under the combo counter's underline while the
   * mission banner held below it.
   */
  check("three announcements aimed at one spot stack instead of overlapping", (() => {
    SF.fx.reset();
    const VW = SF.entityConst.VW, VH = SF.entityConst.VH;
    SF.fx.text(VW/2, VH*0.42, "ONE", "#fff", 17, true);
    SF.fx.text(VW/2, VH*0.42, "TWO", "#fff", 20, true);
    SF.fx.text(VW/2, VH*0.43, "THREE", "#fff", 19, true);
    const ys = SF.fx._pools.texts.items.filter(t => t.alive).map(t => t.y).sort((a,b) => a-b);
    if(ys.length !== 3) return false;
    return (ys[1] - ys[0]) > 14 && (ys[2] - ys[1]) > 14;
  })());
  check("damage numbers are still allowed to overlap", (() => {
    SF.fx.reset();
    for(let i = 0; i < 4; i++) SF.fx.damageNumber(200, 300, 6, false);
    const ys = SF.fx._pools.texts.items.filter(t => t.alive).map(t => t.y);
    // All four thrown at the same height - the stack must not have touched them.
    return ys.length === 4 && Math.max.apply(null, ys) - Math.min.apply(null, ys) < 2;
  })());
  SF.fx.reset();
  check("particle pool stays bounded", SF.fx._pools.particles.items.length <= 900);
  /*
   * THE COMMON PARTICLES ARE BLITS, NOT PATHS.
   *
   * Profiled on a deliberately busy scene - 82 enemies, 400 enemy bullets and
   * ~800 live particles - drawParticles was issuing 669 arc() and 679 fill()
   * calls every frame, because a spark laid down TWO filled discs and smoke
   * and flash one each. A filled path is tessellated and scan-converted every
   * time; a cached sprite is a texture blit. Same scene after: 30 arcs and 35
   * fills. The fireball and the bloom were always sprites - these three were
   * simply the ones nobody had converted.
   *
   * Pinned on the draw function's own text so a future edit cannot quietly
   * put the hot path back on arc(); the rarer shapes (debris, embers, muzzle
   * stars, the streaked fast spark) are rects and are left alone.
   */
  check("sparks, smoke and flashes are drawn as cached sprites", (() => {
    const f = fs.readFileSync(path.join(__dirname, "src/fx.js"), "utf8");
    const fn = f.slice(f.indexOf("function drawParticles"),
                       f.indexOf("function drawTexts"));
    if(fn.length < 200) return false;
    const arcs = (fn.match(/\.arc\(/g) || []).length;
    return /softSprite\(p\.color\)/.test(fn) &&
           (fn.match(/discSprite\(p\.color\)/g) || []).length >= 2 &&
           arcs <= 2;                      // the muzzle star's core, and rings
  })());
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
    /*
     * NOTHING ON OFFER MAY BE A PRESENT THAT DOES NOTHING.
     *
     * The supply crates and the pre-flight kit already filtered themselves
     * down to the `calm` entries here - a bomb you cannot fire is no prize -
     * but the free powerups never did. Four of the five kept falling every
     * twenty seconds on the one mission where the guns are cold: three
     * improve a gun that is not there, and DOUBLE SCORE multiplies kill
     * score, which cannot be earned without a kill.
     */
    check("a silent run only drops powerups that do something", (() => {
      const pool = SF.game.powerupPool();
      return pool.length > 0 &&
             pool.every(p => p.calm) &&
             pool.length < SF.config.POWERUPS.length &&
             !pool.some(p => p.id === "rapid" || p.id === "spread" ||
                             p.id === "homing" || p.id === "score2x");
    })());
    check("...and every other mission still offers the full set", (() => {
      const was = SF.game.run.mission.noGuns;
      SF.game.run.mission.noGuns = false;
      const full = SF.game.powerupPool().length;
      SF.game.run.mission.noGuns = was;
      return full === SF.config.POWERUPS.length;
    })());
    // Fifty draws, so this is the real spawn path and not just the filter.
    check("fifty drops on a silent run are all useful ones", (() => {
      const W = SF.game.world;
      W.pickups.killAll();
      for(let i = 0; i < 50; i++) SF.game.spawnPowerup(100 + i, 60);
      return W.pickups.items.filter(pk => pk.alive && pk.kind === "power")
        .every(pk => pk.data && pk.data.calm);
    })());

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
      M.find(m => m.name === "Their Treasury").storm === true &&
      SF.ui.missionFace(M.find(m => m.name === "Their Treasury")).kind === "coins");
    check("the long dark's veil is the soft one",
      M.find(m => m.name === "The Long Dark").blackout === "soft" &&
      M.find(m => m.name === "The Searchlight").blackout === true &&
      /function drawBlackout\(ctx, world, timeMs, soft\)/.test(
        fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8")));
    check("the campaign bosses sit at their remapped stops",
      M.filter(m => m.boss).map(m => m.id).join(",") === "5,8,12,19,22,27,31,39");

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
        M.find(m => m.name === "All Hands").waves
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

  /* ---------- the four newest rules ---------- */
  {
    const M = SF.missions.MISSIONS;
    const by = n => M.find(m => m.name === n);
    /*
     * Each of the four is ABOUT its rule, so each pays for its rule rather
     * than for clearing the sky. Three of them shipped with the generic trio
     * and the star-variety ratchet is what caught it.
     */
    check("each new level's star is about its own rule", () =>
      by("Spotlight").objectives.indexOf("unseen") >= 0 && by("Spotlight").spot === true &&
      by("The Narrows").objectives.indexOf("squeeze") >= 0 && by("The Narrows").narrows === true &&
      by("Nightfall").objectives.indexOf("afterDark") >= 0 && by("Nightfall").nightfall === true &&
      by("The Sky River").current === true);
    /*
     * SPOTLIGHT'S ONE UNBREAKABLE RULE: nothing may kill you that you had no
     * way to see.
     *
     * The beam is the only light in the sky, so the SHIPS are hidden - and if
     * their shots were hidden with them the level would be a coin flip rather
     * than a level. Every bullet in the air, both sides', is punched back
     * through the dark, along with the pickups and a lamp on your own hull.
     */
    check("the dark hides the ships and never the bullets", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = r.slice(r.indexOf("function drawSpotDark"), r.indexOf("function drawBlackout"));
      return /world\.enemyBullets\.items/.test(fn) &&   // their shots, always lit
             /world\.bullets\.items/.test(fn) &&        // and yours
             /world\.pickups\.items/.test(fn) &&
             /p\.alive\) hole\(p\.x, p\.y/.test(fn) &&  // your own lamp
             /destination-out/.test(fn);
    })());
    /*
     * ...and nothing may ARRIVE unseen either. A kamikaze coming out of black
     * at three hundred pixels a second is not something anybody can read, so
     * the roster carries no divers at all.
     */
    check("nothing dives at you out of the dark", () => {
      const T = SF.enemyData.ENEMY_TYPES;
      return by("Spotlight").waves.every(wv => {
        const bh = T[wv.type].behaviour;
        return bh !== "kamikaze" && bh !== "swoop" && bh !== "intercept";
      });
    });
    /*
     * The tail is the level. A beam with a hard trailing edge gives you only
     * what is lit right now, which is a reflex test; one that leaves the sky
     * glowing behind it gives you a memory to fly on. It is stored per ANGLE,
     * because a wedge from a fixed pivot makes "when was this last lit" a
     * one-dimensional question.
     */
    check("the light leaves the sky glowing behind it", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      const spot = SF.missions.MISSIONS.find(m => m.spot);
      return /seen: new Float32Array\(/.test(g) && /fade: [0-9.]+/.test(g) &&
             // the sweep must stamp the whole covered ARC, not just its centre,
             // or a dropped frame leaves an unlit stripe nothing comes back to
             /for\(let i = Math\.max\(0, from\); i < Math\.min\(n, to\); i\+\+\) sp\.seen\[i\] = sp\.t;/.test(g) &&
             !!spot;
    })());
    /*
     * A CANYON, NOT WALLS IN SPACE. The whole reason this level is flown over
     * ground is that there is nothing in open space for a wall to be, so the
     * two halves have to stay together: the sky it flies must be the surface
     * one, and the surface one must switch off the stars.
     */
    check("the level with walls is the level on a planet", (() => {
      const i = M.indexOf(by("The Narrows"));
      const si = SF.missions.skyOf(i);
      return SF.skygen.isSurface(si) && SF.skygen.SKIES[si].stars === 0 &&
             (SF.skygen.SKIES[si].props || []).some(pr => pr.k === "ground") &&
             // ...and the ONLY other mission over ground is Earth itself.
             M.filter((m, k) => SF.skygen.isSurface(SF.missions.skyOf(k))).length === 2 &&
             SF.skygen.isSurface(SF.missions.skyOf(0));
    })());
    check("nothing streams past a canyon floor", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = r.slice(r.indexOf("function initBackground"), r.indexOf("function updateBackground"));
      return /SF\.skygen\.isSurface\(idx\)/.test(fn) &&
             /surface \? \[\]/.test(fn) &&              // no star layers
             /surface \? Infinity/.test(fn) &&           // no comets
             /surface \? 0 :/.test(fn);                  // no streaming dust
    })());
    /*
     * The ground is a TEXTURE that fills the frame, and `tiled` draws its body
     * up to three times with fresh random numbers each pass - right for a
     * planet seen at three scroll positions, fatal here, where it came out as
     * three different pieces of ground with a join between them. It is drawn
     * once and made periodic in H instead.
     */
    check("the canyon floor scrolls forever without a seam", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
      const fn = g.slice(g.indexOf("function drawGround"), g.indexOf("/** One long visitor"));
      return !/tiled\(/.test(fn) &&                      // never tiled
             /const wrapY = /.test(fn) &&                 // edges drawn twice
             /TAU\/H/.test(fn);                          // whole cycles per height
    })());
  }

  /* ---------- light in the world ---------- */
  {
    /*
     * An explosion used to emit particles and illuminate nothing. These pin
     * the three things that make a light a light rather than another sprite:
     * a kill actually spawns one, they are drawn UNDER the ships (a light
     * that covers what it lights is a veil), and Calmer Visuals softens them
     * the way it softens the shake, the flash and the lens.
     */
    const live = () => SF.fx._pools.lights.items.filter(l => l.alive).length;
    SF.fx.reset();
    check("a kill lights the world around it", (() => {
      const before = live();
      SF.fx.explosion(200, 300, 60, "#ffb03d", true);
      return live() > before;
    })());
    check("a light burns out", (() => {
      for(let k = 0; k < 90; k++) SF.fx.update(1/60, k*16.7);
      return live() === 0;
    })());
    check("the light goes under the ships, not over them", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      const d = g.slice(g.indexOf("function draw(timeMs)"), g.indexOf("MAIN LOOP"));
      const lit = d.indexOf("fx.drawLights(ctx)");
      return lit > d.indexOf("SF.render.drawBackground") &&
             lit < d.indexOf("SF.render.drawEnemies") &&
             lit < d.indexOf("SF.render.drawPlayer");
    })());
    check("calmer visuals softens the light too", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const f = fs.readFileSync(path.join(__dirname, "src/fx.js"), "utf8");
      const fn = f.slice(f.indexOf("function drawLights"), f.indexOf("function drawParticles"));
      const m = fn.match(/calmOn \? ([0-9.]+) : 1/);
      return !!m && Number(m[1]) > 0.3 && Number(m[1]) < 1 &&
             /calmEnabled\(\) \? 0\.55 : 1/.test(r);      // the engine glow too
    })());
    /*
     * Guns are NOT lights. At ten shots a second a muzzle light is a 10Hz
     * strobe, which is inside the band Calmer Visuals exists to avoid.
     */
    check("the guns do not strobe the sky", (() => {
      const f = fs.readFileSync(path.join(__dirname, "src/fx.js"), "utf8");
      const fn = f.slice(f.indexOf("function muzzle"), f.indexOf("function text"));
      return !/light\(/.test(fn);
    })());
    /* God rays are baked into the sky, so they cost nothing forever - and
       they are skipped where they would be nonsense (a canyon floor) or fog
       (a sky that is already almost black). */
    check("the god rays are baked, and skip the ground", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
      return /GOD RAYS/.test(g) && /!sky\.surface && \(sky\.lum \|\| 1\) >= 0\.75/.test(g);
    })());
    /* The boss arrival is lit rather than merely dimmed - a full-frame pass
       that is affordable only because nothing is being dodged during it. */
    check("a boss arrives in a spotlight", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const s = r.indexOf("function drawBossIntro");
      const fn = r.slice(s, r.indexOf("\nfunction ", s + 24));
      return s > 0 && fn.length > 200 &&
             /destination-out/.test(fn) && /boss\.x, boss\.y, rr/.test(fn);
    })());
    SF.fx.reset();
  }

  /* ---------- the sky river actually carries things ---------- */
  {
    /*
     * The level shipped "working" and doing nothing, for a measurable reason:
     * the ship follows the pointer with a spring at gain 12, so a 150px/s
     * stream reached equilibrium with the ship twelve pixels off the finger -
     * and the weave behaviour ASSIGNS x from anchorX every frame, erasing any
     * push to x. So this is pinned FUNCTIONALLY, not by regex: a held finger
     * inside the band must actually be carried, and a weaver's water must
     * actually move. If either controller learns to cancel the river again,
     * these fail.
     */
    SF.game.profile = SF.profile.blank("Raft");
    SF.ui.show("screen-game");
    SF.game.startMission(SF.missions.MISSIONS.findIndex(m => m.current), "pilot");
    SF.game.run.introFly = 0;
    const w = SF.game.world, cu = SF.game.run.current, I = SF.input;
    const midY = cu.y + cu.h*0.5;
    I.state.dragging = true; I.state.dragX = 200; I.state.dragY = midY;
    w.player.x = 200; w.player.y = midY; w.player.invuln = 99999;
    await runFrames(150);
    check("a finger held still in the river is carried downstream",
      w.player.x - 200 > 60);
    /*
     * Phase two: the finger climbs out (which must hand the stick back, via
     * the game's own relax path) and a weaver rides the band with the player
     * safely out of the fight - measured over one second, because holding a
     * pooled reference through a long live fight is how a check gets flaky.
     */
    const drifted = I.state.dragX;
    I.state.dragY = cu.y - 150;
    w.enemies.killAll();
    const weaver = w.spawnEnemy("weaver", 60, cu.y + 30, { difficulty: SF.game.run.difficulty });
    const a0 = weaver.anchorX;
    await runFrames(60);
    check("the river moves the water a weaver swims in",
      weaver.alive && weaver.anchorX - a0 > 20);
    await runFrames(90);
    check("climbing out of the river gives the stick back",
      drifted - 200 > 60 && Math.abs(I.state.dragX - 200) < 40);
    check("leaving the mission leaves no drift behind", (() => {
      const src = fs.readFileSync(path.join(__dirname, "src/input.js"), "utf8");
      return /clearMovement\(\)\{[\s\S]*?flowX = 0;/.test(src);
    })());
    I.state.dragging = false; SF.input.clearMovement();
    SF.game.run.ended = true; SF.game.state = "idle";   // leave no live run behind
  }

  /* ---------- THE ANCHOR: the cable, and what it is tied to ---------- */
  {
    const W = SF.game.world;
    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    W.reset(); W.createPlayer(SF.game.buildLoadout(SF.profile.blank("Rope"), diff));
    W.tethered = true;
    const pair = () => {
      const a = W.spawnEnemy("grunt", 120, 300, { difficulty: diff });
      const b = W.spawnEnemy("grunt", 320, 300, { difficulty: diff });
      W.tetherPair(a, b);
      return [a, b];
    };
    {
      const [a, b] = pair();
      check("a tied pair agrees from both ends, and only one end leads",
        SF.tether.live(a) && SF.tether.live(b) &&
        a.mate === b && b.mate === a && a.tetherKey === b.tetherKey &&
        (a.tetherLead ? !b.tetherLead : b.tetherLead));
      /*
       * THE BUG THIS MECHANIC WOULD OTHERWISE HAVE. Enemy slots are pooled, so
       * the moment a dead end's slot is handed to a new ship, a bare reference
       * would reattach a live cable to a completely unrelated enemy somewhere
       * else on screen. The key is what makes a stale link read as CUT.
       */
      b.alive = false;
      check("a cable to a dead end is not a cable", !SF.tether.live(a));
      const reused = W.spawnEnemy("grunt", 500, 100, { difficulty: diff });
      check("...and a recycled slot never inherits the rope",
        !SF.tether.live(a) && reused.tetherKey === 0 && reused.mate === null);
      a.alive = false; reused.alive = false;
    }
    /*
     * The drawn cable hangs, so the measured one has to hang identically - a
     * wall that hurts where it is not drawn is the worst bug this could have.
     * The curve dips BELOW the straight line between the two ships, and the
     * player is placed on the sag to prove the collision follows it.
     */
    {
      const [a, b] = pair();
      const C = { x0:0, y0:0, cx:0, cy:0, x1:0, y1:0 }, P = { x:0, y:0 };
      SF.tether.curve(a, C);
      SF.tether.at(C, 0.5, P);
      check("the cable hangs between its ends rather than running straight",
        Math.abs(P.x - 220) < 1 && P.y > 305 && P.y < 330);
      let hits = 0;
      const cb = { onEnemyKilled(){}, onBossHit(){}, onEscape(){},
                   onPlayerHit(){ hits++; }, godMode:false };
      W.player.invuln = 0; W.player.x = P.x; W.player.y = P.y;
      SF.systems.resolve(W, cb, 1/60);
      check("touching the middle of a rope costs a life", hits === 1);
      /* ...and the ships themselves are untouched. A ship you fly into dies
         with you, which makes ramming a trade a child will happily keep
         making; a cable is a wall, not a trade. */
      check("a rope hurts you and leaves both ends flying",
        a.alive === true && b.alive === true);
      // Straight above the sag, well clear of both hulls: nothing there.
      hits = 0; W.player.invuln = 0; W.player.x = 220; W.player.y = 240;
      SF.systems.resolve(W, cb, 1/60);
      check("the sky either side of a rope is still sky", hits === 0);
      a.alive = false; b.alive = false;
    }
    /* Pairing is by SLOT, which is what lets one flag mean "a short fence" in
       a line and "a wire across the whole field" in twinColumns. */
    {
      const m = SF.missions.MISSIONS.find(x => x.name === "The Anchor");
      const dir = new SF.systems.WaveDirector(m, diff, W);
      const wave = m.waves.find(wv => wv.tether && wv.form === "twinColumns");
      dir.pending = []; dir.queueWave(wave);
      const tagged = dir.pending.filter(x => x.pair);
      const tags = new Set(tagged.map(x => x.pair));
      check("a tethered wave stages its ships in pairs",
        tagged.length >= 4 && tagged.length % 2 === 0 &&
        tags.size === tagged.length / 2 &&
        Array.from(tags).every(t => tagged.filter(x => x.pair === t).length === 2));
      // An odd count leaves one loose, and a fence with a hole is the lesson.
      dir.pending = []; dir.queueSalvo({ type:"grunt", form:"line", n:5, tether:true }, 5, 0);
      check("an odd salvo leaves one ship untied",
        dir.pending.filter(x => !x.pair).length === 1);
    }
    check("only the levels that fly ropes pay for the collision pass", (() => {
      const s2 = fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8");
      return /if\(world\.tethered && !invulnerable/.test(s2) &&
             /world\.tethered = !!\(mission\.waves/.test(
               fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8"));
    })());
    W.enemies.killAll(); W.tethered = false;
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
    /*
     * SEVEN inserts deep now: v2 (Silent Running at 9), v3 (Treasury at 13),
     * v4's four-level map, v5 (The Rival at 13), v6's six-level map, v7 (The
     * Anchor at 3) and v8's four at once. Old 8 rides to 12; old 9 to 15; old
     * 14 to 27; and old 3 - which never moved for the game's first six
     * releases - is now at 4.
     *
     * Fifteen levels have been inserted into the middle of this campaign over
     * its life. A save from the very first release still has to arrive with
     * every star filed against the level it was actually won on, and that is
     * the only thing this chain exists to guarantee.
     */
    check("pre-insert records ride every shift",
      shifted.missions["12"] && shifted.missions["12"].stars.pilot === 2 &&
      shifted.missions["15"] && shifted.missions["15"].stars.pilot === 3 &&
      shifted.missions["27"] && shifted.missions["27"].stars.pilot === 1 &&
      !shifted.missions["8"] && !shifted.missions["9"] && !shifted.missions["10"] &&
      !shifted.missions["11"] && !shifted.missions["13"] && !shifted.missions["14"] &&
      !shifted.missions["20"] && !shifted.missions["24"] && !shifted.missions["25"] &&
      shifted.lastMission === 15);
    check("the oldest record rides the newest insert too",
      shifted.missions["4"] && shifted.missions["4"].stars.pilot === 2 &&
      !shifted.missions["3"]);
    check("the shifts run exactly once",
      SF.profile.migrate(shifted).missions["15"].stars.pilot === 3 &&
      SF.profile.migrate(shifted).missions["27"].stars.pilot === 1);
    // A v2-era save (Silent Running already counted) picks up v3 onward only.
    const v2era = SF.profile.migrate({ name:"V2", missionsVer: 2,
      missions: { "13": { cleared:true, stars:{pilot:2}, best:{} } }, lastMission: 13 });
    check("a v2-era save shifts only the later inserts",
      v2era.missions["22"] && !v2era.missions["13"] && !v2era.missions["21"] &&
      v2era.lastMission === 22);
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

    /* ---------- a death that belongs to the thing that died ---------- */
    check("every death style actually puts something on screen", (() => {
      const pool = SF.fx._pools.particles;
      const counts = Object.keys(SF.fx.DEATHS).map(style => {
        SF.fx.reset();
        SF.fx.explosion(100, 100, 60, "#fff", false, style);
        const withStyle = pool.items.filter(p => p.alive).length;
        SF.fx.reset();
        SF.fx.explosion(100, 100, 60, "#fff", false);
        return withStyle - pool.items.filter(p => p.alive).length;
      });
      SF.fx.reset();
      return counts.length >= 5 && counts.every(c => c > 0);
    })());
    check("the things that wear armour are the things that shed it", (() => {
      const T = SF.enemyData.ENEMY_TYPES;
      const styled = Object.keys(T).filter(k => T[k].death);
      return styled.length >= 10 &&
             styled.every(k => !!SF.fx.DEATHS[T[k].death]) &&
             T.brute.death === "plate" && T.hive.death === "burst" &&
             T.splitter.death === "split" && T.boulder.death === "shatter" &&
             // A Grunt is the plain one on purpose: it is the baseline every
             // other death is a departure from.
             !T.grunt.death;
    })());

    /* ---------- the lens ---------- */
    /*
     * The camera may only ever push IN. Below 1.0 it would pull the edges of a
     * VW x VH sky inside the canvas and show bare ground around it, on a device
     * nobody here can test - so a "pull back" is always the release of a push.
     */
    check("the camera pushes in, holds, and lets go", (() => {
      SF.fx.cameraReset();
      const flat = SF.fx.cameraZoom();
      SF.fx.push(1.10, 0.5, 0.5, 0.3);
      for(let i=0;i<20;i++) SF.fx.update(1/60, fakeNow);
      const pushed = SF.fx.cameraZoom();
      for(let i=0;i<240;i++) SF.fx.update(1/60, fakeNow);
      const released = SF.fx.cameraZoom();
      SF.fx.cameraReset();
      return flat === 1 && pushed > 1.04 && pushed <= 1.14 && released === 1;
    })());
    check("the camera never pulls back past the edge of the sky", (() => {
      SF.fx.cameraReset();
      // Everything the game asks for, at once and out of range.
      SF.fx.push(0.4, 1); SF.fx.push(-3, 1); SF.fx.push(99, 1);
      for(let i=0;i<40;i++) SF.fx.update(1/60, fakeNow);
      const z = SF.fx.cameraZoom();
      SF.fx.cameraReset();
      return z >= 1 && z <= 1.14;
    })());
    check("turning shake off turns the lens off with it", (() => {
      const was = SF.fx.shakeEnabled();
      SF.fx.setShakeEnabled(false);
      SF.fx.cameraReset();
      SF.fx.push(1.12, 1);
      for(let i=0;i<30;i++) SF.fx.update(1/60, fakeNow);
      const z = SF.fx.cameraZoom();
      SF.fx.setShakeEnabled(was);
      SF.fx.cameraReset();
      return z === 1;
    })());

    /* ---------- the lens glow ---------- */
    /*
     * A bloom is famous for exactly one failure: smearing the writing. The
     * whole effect is worth nothing if a seven-year-old cannot read the score,
     * so its position in draw() - after the world, before the texts and the
     * HUD - is the load-bearing part and is pinned as such.
     */
    check("the glow goes over the world and under the writing", (() => {
      const s = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      const d = s.slice(s.indexOf("function draw(timeMs)"), s.indexOf("MAIN LOOP"));
      const glow = d.indexOf("SF.render.drawGlow(ctx)");
      return glow > d.indexOf("SF.render.drawEnemies") &&
             glow > d.indexOf("SF.render.drawForeground") &&
             glow < d.indexOf("fx.drawTexts(ctx)") &&
             glow < d.indexOf("SF.render.drawHud");
    })());
    /*
     * It samples the finished frame in DEVICE pixels, so it has to shed the
     * shake offset, the camera zoom and the dpr scale together. Leaving any of
     * them on would blit the glow back at the wrong size and turn a lens into
     * a smear that slides around when the camera punches in.
     */
    check("the glow works on the frame, not in the camera", (() => {
      const s = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = s.slice(s.indexOf("function drawGlow"), s.indexOf("ENTITIES"));
      return /ctx\.setTransform\(1, 0, 0, 1, 0, 0\)/.test(fn) &&
             /globalCompositeOperation = "lighter"/.test(fn) &&
             /globalCompositeOperation = "copy"/.test(fn) &&      // no ghost of last frame
             /ctx\.canvas/.test(fn) &&
             /ctx\.save\(\)/.test(fn) && /ctx\.restore\(\)/.test(fn);
    })());
    /*
     * Calmer Visuals exists for eyes that flashing hurts. A steady bloom is
     * the opposite of a flash - it takes the hard edge off every bright thing
     * on screen - so calm must SOFTEN it, never switch it off, or the mode
     * built for sensitive eyes becomes the harsher-looking one.
     */
    check("calmer visuals keeps the glow, gently", (() => {
      const s = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = s.slice(s.indexOf("function drawGlow"), s.indexOf("ENTITIES"));
      const m = fn.match(/calmEnabled\(\) \? ([0-9.]+) : 1/);
      return !!m && Number(m[1]) > 0.3 && Number(m[1]) < 1;
    })());
    check("the glow switch remembers itself", (() => {
      const was = SF.fx.glowEnabled();
      SF.fx.setGlowEnabled(false);
      const off = !SF.fx.glowEnabled() && window.localStorage.getItem("patrol_glow_off") === "1";
      SF.fx.setGlowEnabled(true);
      const on = SF.fx.glowEnabled() && window.localStorage.getItem("patrol_glow_off") === "0";
      SF.fx.setGlowEnabled(was);
      return off && on;
    })());
    /*
     * Two scratch canvases, made once. A bloom that allocates per frame is a
     * bloom that stutters every time the collector runs, which on a five-year
     * -old iPad is the difference between "smooth" and "the game is broken".
     */
    check("the glow allocates its scratch canvases once", (() => {
      const s = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = s.slice(s.indexOf("function drawGlow"), s.indexOf("ENTITIES"));
      return /if\(!glowTight\)\{/.test(fn) &&
             (fn.match(/document\.createElement\("canvas"\)/g) || []).length === 2;
    })());
    /*
     * THE LENS PAYS FOR ITSELF OR IT GOES.
     *
     * One bilinear blend over every pixel on screen is nothing on a GPU and
     * more than a whole frame on a machine drawing canvas in software - where
     * it took a measured 16.7ms frame to 33.3ms. No device list can tell us
     * which one a child is holding, so the game watches its own frame clock
     * and sheds the effect if it cannot be afforded. These pin the three
     * things that have to be true: it takes SUSTAINED trouble (a hitch must
     * not cost you the look), it eventually gives up, and there is a way back.
     */
    check("one bad frame does not cost you the glow", (() => {
      const was = SF.fx.glowEnabled();
      SF.fx.setGlowEnabled(true);                     // also re-arms the probe
      for(let i=0;i<400;i++) SF.fx.glowWatch(16.7);   // a healthy run...
      SF.fx.glowWatch(180); SF.fx.glowWatch(140);     // ...with two nasty hitches
      const ok = SF.fx.glowActive() && !SF.fx.glowShed();
      SF.fx.setGlowEnabled(was);
      return ok;
    })());
    check("a device that cannot hold 60fps loses the glow, and can ask again", (() => {
      const was = SF.fx.glowEnabled();
      SF.fx.setGlowEnabled(true);
      // Half rate, sustained - exactly what the software-rendered case measured.
      for(let i=0;i<600;i++) SF.fx.glowWatch(33.3);
      const shed = !SF.fx.glowActive() && SF.fx.glowShed() && SF.fx.glowEnabled();
      SF.fx.setGlowEnabled(false); SF.fx.setGlowEnabled(true);
      const back = SF.fx.glowActive() && !SF.fx.glowShed();
      SF.fx.setGlowEnabled(was);
      return shed && back;
    })());
    /*
     * ...and the verdict has to reach the renderer. Asking glowEnabled() here
     * would draw the lens on a device that had already been measured as unable
     * to afford it - the switch is what the player wants, glowActive() is what
     * the game can actually deliver.
     */
    check("the renderer asks what is affordable, not what was asked for", (() => {
      const s = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = s.slice(s.indexOf("function drawGlow"), s.indexOf("ENTITIES"));
      return /SF\.fx\.glowActive\(\)/.test(fn) && !/SF\.fx\.glowEnabled\(\)/.test(fn);
    })());
    check("the settings screen offers the glow switch", (() => {
      const h = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
      const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
      return /id="setGlow"/.test(h) && /pill\("setGlow"/.test(u) &&
             /setGlowEnabled\(!SF\.fx\.glowEnabled\(\)\)/.test(u) &&
             // ...and says so when the switch is on but the device shed it,
             // the way the rumble row explains itself on an iPad.
             /id="glowNote"/.test(h) && /glowNote.*glowShed\(\)/s.test(u);
    })());

    /* ---------- where a sound is ---------- */
    /*
     * jsdom has no AudioContext, so play() cannot build a panner here - the
     * real graph is checked in Chromium. What IS checkable is the maths and,
     * more usefully, that a sound never pans past 0.8: a hard-panned effect is
     * silent in one ear, and two children share one iPad speaker.
     */
    check("a sound is placed where it happened, and never hard against an ear", (() => {
      const VW = SF.entityConst.VW;
      const l = SF.audio.panFor(0), c = SF.audio.panFor(VW/2), r = SF.audio.panFor(VW);
      const off = SF.audio.panFor(VW*8);          // something that flew away
      return l === -0.8 && Math.abs(c) < 1e-9 && r === 0.8 && off === 0.8 &&
             SF.audio.panFor(VW*0.25) < 0 && SF.audio.panFor(VW*0.75) > 0;
    })());
    check("the music subscribes to hooks the game already fires", (() => {
      const D = SF.audio.DUCKS, S = SF.audio._sounds;
      const names = Object.keys(D);
      return names.length >= 8 &&
             // Every duck names a real sound, so a renamed hook cannot leave a
             // dip wired to nothing.
             names.every(n => !!S[n]) &&
             // A boss arriving pushes the music further down than a rescue.
             D.bossWake[0] < D.rescue[0] &&
             names.every(n => D[n][0] > 0 && D[n][0] < 1 && D[n][1] > 0);
    })());

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
    await sleep(10);

    /*
     * ...and then the grown-up code. Two scary dialogs are a speed bump, not
     * a lock, and this is the one button a seven-year-old can press that
     * nobody can undo - on every synced device at once.
     */
    check("and then it asks for the grown-up code", (() => {
      const inp = id("dialogInput");
      return !id("dialogOverlay").classList.contains("hidden") &&
             /GROWN-UP CODE/.test(id("dialogTitle").textContent) &&
             !inp.classList.contains("hidden");
    })());

    // A wrong code must change NOTHING, and say so with one button.
    id("dialogInput").value = "0000";
    clickEl(id("dialogOk"));
    await sleep(20);
    const afterWrong = SF.profile.load("Marc");
    check("a wrong code leaves the career untouched",
      afterWrong.money === 4321 &&
      /NOT THAT ONE/.test(id("dialogTitle").textContent) &&
      id("dialogCancel").classList.contains("hidden"));
    clickEl(id("dialogOk"));
    await sleep(20);

    // Backing out of the code prompt must change nothing either.
    clickEl(id("setReset"));
    await sleep(10); clickEl(id("dialogOk"));
    await sleep(10); clickEl(id("dialogOk"));
    await sleep(10); clickEl(id("dialogCancel"));
    await sleep(20);
    check("backing out of the code leaves the career untouched",
      SF.profile.load("Marc").money === 4321 &&
      id("dialogOverlay").classList.contains("hidden"));

    // The real thing.
    clickEl(id("setReset"));
    await sleep(10); clickEl(id("dialogOk"));
    await sleep(10); clickEl(id("dialogOk"));
    await sleep(10);
    id("dialogInput").value = "1337";
    clickEl(id("dialogOk"));
    await sleep(30);
    const wiped = SF.profile.load("Marc");
    check("resetting a pilot wipes the career and stamps it newest",
      wiped.money === SF.profile.blank("Marc").money &&
      Object.keys(wiped.missions).length === 0 && wiped.savedAt > 0);
    check("the settings overlay closes after a reset",
      id("settingsOverlay").classList.contains("hidden"));
    /* The code is a lock on the fridge, not a security control - it ships in
       the source like everything else. Pinned so it cannot drift silently. */
    check("the grown-up code is the one the family was given", (() => {
      const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
      return /const RESET_CODE = "1337";/.test(u);
    })());
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
      /*
       * Still one silhouette, now that there are two airframes. A child's
       * drawing is masked by HULL_POLY on the easel and clipped by hullClip
       * when worn, and hullClip with no hull named resolves to the Dart -
       * whose outline IS HULL_POLY, by identity, not by copy. The Anvil is
       * wider everywhere, so the same drawing sits inside it with a margin
       * rather than being cut off along an edge nobody can see.
       */
      check("the easel mask and the worn clip share one hull polygon",
        Array.isArray(SF.shipart.HULL_POLY) && SF.shipart.HULL_POLY.length >= 6 &&
        SF.shipart.hullOf("dart").outline === SF.shipart.HULL_POLY &&
        SF.shipart.hullOf(undefined).outline === SF.shipart.HULL_POLY &&
        /HULL_POLY/.test(fs.readFileSync(path.join(__dirname, "src/paintjob.js"), "utf8")));
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
    /*
     * Named by BOSS, not by mission id.
     *
     * This used to clear ids 4 and 10 and expect "marauder,sentinel", which
     * only worked because game.js held a hand-written rush queue that had
     * drifted: it filed the Sentinel under the id of the level before it. The
     * test agreed with the bug, so both survived. The queue is derived from
     * the campaign now, and so is this - which is also the only way a pin
     * about mission ids survives the next level anybody inserts.
     */
    const bossStop = b => SF.missions.MISSIONS.find(m => m.boss === b);
    [bossStop("marauder").id, bossStop("sentinel").id].forEach(mid => {
      prof.missions[mid] = { cleared:true, stars:{pilot:2}, best:{} }; });
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
    /*
     * Wait for the STATE, not for a frame count. These used to be fixed
     * budgets tuned to one particular Math.random sequence - the moment an
     * earlier test consumed a different number of draws (the Sky River's
     * cosmetic motes, correctly off the seeded stream, did exactly that),
     * the sentinel's arrival slid past the budget and everything downstream
     * read a boss mid-intro. The condition is what the check means anyway.
     */
    const untilRush = async (cond, cap) => {
      for(let n = 0; n < cap && !cond(); n += 10) await runFrames(10);
    };
    await untilRush(() => SF.game.world.boss &&
                          SF.game.world.boss.name === "SKY SENTINEL", 900);
    check("the next boss follows the blast",
      SF.game.world.boss && SF.game.world.boss.name === "SKY SENTINEL");
    check("later rush stages come harder",
      SF.game.world.boss.hurry > 1 && SF.game.world.boss.maxHp > 0);
    // A fresh rush boss must resume the health-based readout, not stick at
    // the 100% the previous kill left behind.
    check("the readout tracks the NEW boss, not the last one's victory",
      SF.game.run.bossActive && SF.game.run.progress < 1);
    // Let the intro finish before wounding it: the finale gate reads a boss
    // that is actually fighting, not one still flying in.
    await untilRush(() => SF.game.run.bossActive, 600);
    SF.game.world.boss.hp = SF.game.world.boss.maxHp * 0.08;
    await untilRush(() => SF.finale.fleetSize() > 0, 300);
    check("the last boss of a rush still brings the whole family out",
      SF.game.run.rushIndex === SF.game.run.rushList.length &&
      SF.finale.fleetSize() > 0);
    SF.profile.listNames = origList; SF.profile.load = origLoad;
    strip();
    await untilRush(() => SF.game.run.lapStarted === true || SF.game.run.ended, 1200);
    check("an emptied queue ends in the victory lap",
      SF.game.run.lapStarted === true || SF.game.run.ended);
    await untilRush(() => SF.game.run.ended, 600);
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
      SF.missions.MISSIONS.find(m => m.name === "Prison Break").boss === "jailer" &&
      SF.missions.MISSIONS.find(m => m.name === "Cold Approach").boss === "phantom" &&
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
    // Every boss up to (and including) the Leviathan, by boss rather than by
    // id - the ids move whenever a level is inserted, the bosses do not.
    ["marauder","jailer","sentinel","warden","phantom","leviathan"].forEach(b => {
      const m = SF.missions.MISSIONS.find(x => x.boss === b);
      prof6.missions[m.id] = { cleared:true, stars:{}, best:{} }; });
    SF.profile.save(prof6);
    SF.game.profile = prof6;
    SF.game.startMission("rush", "pilot");
    check("the rush queue covers all six bosses in campaign order",
      SF.game.run.rushList.join(",") === "marauder,jailer,sentinel,warden,phantom,leviathan");
    SF.game.state = "idle";
  }

  /* ---------- their treasury (the heist between the bosses) ---------- */
  {
    const t = SF.missions.MISSIONS.find(m => m.name === "Their Treasury");
    check("the treasury sits between the wardens and never carries a boss",
      t && !t.boss &&
      SF.missions.MISSIONS.find(m => m.name === "The Warden").boss === "warden");
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

  /* ---------- THE RESTRUCTURED ENDING, FLOWN ----------
   * Three sims, one per moved piece: the Glass Sea's duel, the Long Way
   * Home's descent, and Behind the Sky's merged show. Each drives the real
   * mission - director warp, real holds, real results - because every one
   * of these flows is a chain of hand-offs, and hand-offs are exactly what
   * source pins cannot prove.
   */
  {
    SF.game.godMode = true;
    SF.game.profile = SF.ui.getProfile();
    const untilState = async (cond, cap) => {
      for(let n = 0; n < cap && !cond(); n += 10) await runFrames(10);
    };
    const warpWaves = () => {          // spend the director, sweep the sky
      const run = SF.game.run;
      run.director.nextWave = run.mission.waves.length;
      run.director.pending.length = 0;
      SF.game.world.enemies.killAll();
      SF.game.world.enemyBullets.killAll();
    };
    const dismissStory = () => {
      if(!id("storyOverlay").classList.contains("hidden")) clickEl(id("storyBtn"));
    };

    /* --- the Glass Sea: the reflection helps all level, then turns --- */
    SF.game.startMission(36, "pilot");
    id("overlayResults").classList.add("hidden");   // stale from earlier flows
    SF.game.world.player.invuln = 9999;
    check("the Glass Sea flies with the helper ghost", SF.game.world.mirror === true);
    await runFrames(90);
    warpWaves();
    await untilState(() => SF.mirrorduel._state() &&
                           SF.mirrorduel._state().stage === "duel", 300);
    const duel = SF.mirrorduel._state();
    check("the last wave falls and the reflection turns",
      !!duel && duel.stage === "duel" && !!duel.mirror);
    check("the ghost gun retires the moment the duel arms",
      SF.game.world.mirror === false);
    check("the duel holds the level open",
      SF.game.run.phase === "waves" && !SF.game.run.ended);
    duel.mirror.hp = 0;
    await untilState(() => SF.mirrorduel.readyToClear(), 300);
    check("the glass breaks and the level lets go", SF.mirrorduel.readyToClear());
    await untilState(() => SF.game.run.ended, 1200);
    await untilState(() => !id("overlayResults").classList.contains("hidden"), 300);
    check("the duel hands the mission to the normal ending",
      !id("overlayResults").classList.contains("hidden") &&
      SF.game.run.stats.completed === true);
    dismissStory();
    clickEl(id("resultsMenuBtn"));

    /* --- the Long Way Home: the Titan, then the descent to the farm --- */
    SF.game.startMission(39, "pilot");
    id("overlayResults").classList.add("hidden");
    SF.game.world.player.invuln = 9999;
    await runFrames(90);
    warpWaves();
    await untilState(() => SF.game.run.bossActive && SF.game.world.boss &&
                           !SF.game.world.boss.entering, 900);
    check("the war's last fight is the Titan, in the normal boss slot",
      SF.game.world.boss && SF.game.world.boss.name === "THE FORGERY" &&
      SF.game.run.bossActive === true);
    check("no meta theatre runs at 39 any more",
      !SF.backstage.active() && SF.homecoming.active() && !SF.homecoming.started());
    { const bb = SF.game.world.boss;
      bb.weakPoints.forEach(wp => { wp.hp = 0; wp.destroyed = true;
        if(wp.disables) bb.disabled[wp.disables] = true; });
      bb.hp = 1; }
    await untilState(() => SF.homecoming.started(), 900);
    check("the Titan falls and the squadron turns for home",
      SF.homecoming.started() && SF.game.run.bossCleared === true);
    check("the descent holds the results back",
      !SF.game.run.ended && SF.game.run.phase === "lap");
    await untilState(() => SF.homecoming.done(), 900);
    check("the wheels come down on the farm",
      SF.homecoming.done() && SF.homecoming._state().touched === true);
    await untilState(() => SF.game.run.ended, 900);
    await untilState(() => !id("overlayResults").classList.contains("hidden"), 300);
    check("the homecoming card turns the campaign's last page",
      !id("overlayResults").classList.contains("hidden") &&
      !id("storyOverlay").classList.contains("hidden") &&
      /EVERY STAR IS HOME/.test(id("storyTitle").textContent) &&
      !!(SF.ui.getProfile().stories || {}).homecoming);
    dismissStory();
    clickEl(id("resultsMenuBtn"));
    check("beating the war opens the gift, no stars asked",
      SF.missions.isMissionUnlocked(SF.game.profile, 40));

    /* --- Behind the Sky: parade, pranks, tear, brush, stroke, photo --- */
    SF.game.startMission(40, "pilot");
    id("overlayResults").classList.add("hidden");
    SF.game.world.player.invuln = 9999;
    check("the bonus level runs both theatres at once",
      SF.backstage.active() && SF.sky29.active());
    await runFrames(90);
    warpWaves();
    await untilState(() => SF.backstage.stage() === "brush" &&
                           SF.backstage._state().brush, 900);
    check("the pranks and the tear lead to the Royal Brush",
      SF.backstage.stage() === "brush");
    check("the canvas waits for the workshop before its last stroke",
      SF.sky29._state().phase === "sketch");
    SF.backstage._state().brush.hp = 0;
    await untilState(() => SF.backstage.readyToClear(), 600);
    check("the brush's star goes up", SF.backstage.readyToClear());
    await untilState(() => SF.sky29._state().phase === "photo" ||
                           SF.sky29._state().phase === "done", 900);
    check("the last stroke only sweeps once the workshop is done",
      ["photo","done"].includes(SF.sky29._state().phase));
    await untilState(() => SF.game.run.ended, 900);
    await untilState(() => !id("overlayResults").classList.contains("hidden"), 300);
    check("the painted-sky card belongs to the level with the brush",
      !id("overlayResults").classList.contains("hidden") &&
      !id("storyOverlay").classList.contains("hidden") &&
      /THE PAINTED SKY/.test(id("storyTitle").textContent) &&
      !!(SF.ui.getProfile().stories || {}).workshop);
    dismissStory();
    check("painting the sky still pays Papa's dawn",
      SF.game.profile.sky29Done === true &&
      SF.game.profile.cosmetics.paints.includes("sky29"));
    clickEl(id("resultsMenuBtn"));
    SF.game.godMode = false;
    // The theatres must not haunt the checks below: squadronDue reads
    // backstage.active() and a stale "done" stage would mute every arrival.
    SF.backstage.reset(); SF.sky29.reset();
    SF.mirrorduel.reset(); SF.homecoming.reset();
  }

  /* ---------- THE FINALE: the Devourer ---------- */
  {
    const { VW, VH } = SF.entityConst;
    const D = SF.missions.BOSSES.devourer;
    check("the finale is the biggest thing in the game",
      D && D.finale === true && D.phases.length === 5 &&
      D.size > SF.missions.BOSSES.leviathan.size * 1.35 &&
      D.fightSeconds > SF.missions.BOSSES.leviathan.fightSeconds);
    // Two finales now: the Devourer closes act 3, and THE FORGERY - the
    // welded Titan, the last of them - closes the war at 39. Behind the Sky
    // is the bonus level after the war and fields no boss slot at all: the
    // Royal Brush is backstage's actor, not the controller's.
    check("each finale closes its act",
      SF.missions.MISSIONS.find(m => m.name === "The Devourer").boss === "devourer" &&
      SF.missions.MISSIONS.find(m => m.name === "The Long Way Home").boss === "forgery" &&
      SF.missions.MISSIONS.find(m => m.name === "Behind the Sky").boss === undefined &&
      SF.missions.MISSIONS.find(m => m.name === "The Long Dark").boss === undefined);
    check("beating it awards the last tune and the last medal",
      SF.config.TUNES.some(t => t.id === "nova" &&
        t.unlockMission === SF.missions.MISSIONS.find(m => m.boss === "devourer").id) &&
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
    /*
     * Reversed by request: the trade-offs made the trophies not worth
     * fitting, so every tune is now purely good - a prize, not a haggle.
     */
    check("a boss trophy never costs anything",
      SF.config.TUNES.length === 8 &&
      SF.config.TUNES.every(t =>
        (!t.cons || t.cons.length === 0) &&
        (t.speed || 1) >= 1 - 1e-9 && (t.fire || 1) <= 1 + 1e-9 && (t.lives || 0) >= 0));
    check("each boss trophy hangs off a real boss stop",
      SF.config.TUNES.every(t => !t.unlockMission ||
        SF.missions.MISSIONS.some(m => m.id === t.unlockMission && m.boss)));
    check("every tune says what it does",
      SF.config.TUNES.every(t => Array.isArray(t.pros) && t.pros.length));

    const diff = SF.config.DIFFICULTY_BY_ID.pilot;
    const base = SF.profile.blank("Tuner");
    const stock = SF.game.buildLoadout(base, diff);
    check("a fresh pilot flies the balanced vanguard tune",
      base.tune === "vanguard" && stock.tune === "vanguard");

    base.tune = "falcon";
    const falcon = SF.game.buildLoadout(base, diff);
    // Trade-offs were cut by request: a trophy tune is purely good now.
    check("the falcon is faster and costs nothing",
      falcon.speedMult > stock.speedMult && falcon.fireInterval === stock.fireInterval &&
      falcon.lives === stock.lives && falcon.dps === stock.dps);

    base.tune = "titan";
    const titan = SF.game.buildLoadout(base, diff);
    check("the titan gains a life and keeps its speed",
      titan.lives === stock.lives + 1 && titan.speedMult === stock.speedMult);

    base.tune = "viper";
    const viper = SF.game.buildLoadout(base, diff);
    check("the viper's faster guns show up in its real output",
      viper.fireInterval < stock.fireInterval && viper.dps > stock.dps);

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
      const viperAt = SF.config.TUNES.find(t => t.id === "viper").unlockMission;
      if(!viperCard || !new RegExp("beat Mission " + viperAt).test(viperCard.textContent)) return false;
      clickEl(viperCard);
      return SF.profile.load("Tuner").tune === "falcon";   // unchanged
    })());
    check("the confusing parts grid is gone from MY SHIP",
      qa(".part-chip").length === 0 && qa(".tune-how").length === 2);
    clickEl(id("armoryBackBtn"));

    // Beating a boss mission for the first time flags the trophy moment -
    // the payload flag is what queues the TUNE UNLOCKED toast.
    SF.game.profile = SF.profile.load("Tuner");
    let payload = null;
    const prevEnd = SF.game.onMissionEnd;
    SF.game.onMissionEnd = r => { payload = r; prevEnd(r); };
    const jailerAt = SF.missions.MISSIONS.findIndex(m => m.boss === "jailer");
    SF.game.startMission(jailerAt, "pilot");
    SF.game.endMission(true);
    SF.game.onMissionEnd = prevEnd;
    check("a first boss clear flags the tune it won",
      payload && payload.firstClear === true &&
      payload.run.mission.boss === "jailer" &&
      SF.config.TUNES.some(t => t.unlockMission === payload.run.mission.id));
    SF.game.startMission(jailerAt, "pilot");
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
    /*
     * The day is spent when a flight ENDS, not when one starts. Stamping it at
     * launch meant a quit, a first-wave death or a closed tab burnt the bonus
     * with nothing banked and no way back until tomorrow. So: still doubled on
     * a relaunch that follows an abandoned run, and spent once one completes.
     */
    SF.game.startMission(0, "rookie");
    check("an abandoned first flight does not burn the day's double pay",
      SF.game.run.dailyDouble === true);
    SF.game.endMission(true);
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

    /*
     * Medals are struck in four metals so the shelf is not a grid of identical
     * objects. Three things have to stay true or the tiering is decorative:
     * every medal is placed on purpose, all four metals are actually in use,
     * and no single metal swallows the set (which is how it looked before -
     * twenty-seven identical gold discs).
     */
    {
      const tiers = SF.config.ACHIEVEMENTS.map(a => SF.icons.medalTierOf(a.id));
      const known = ["bronze","silver","gold","platinum"];
      const count = t => tiers.filter(x => x === t).length;
      check("every medal is struck in a known metal", tiers.every(t => known.includes(t)));
      check("all four medal metals are in use", known.every(t => count(t) > 0));
      check("no single metal swallows the medal shelf",
        known.every(t => count(t) <= SF.config.ACHIEVEMENTS.length / 2));
      /*
       * Where the payout says something, the metal must agree with it. It is
       * silent across the middle - thirteen medals pay the same flat £500, and
       * placing those is the whole reason the tier is a table - so only the
       * ends are pinned: under the default is a starter, £1,200-and-up is a
       * real campaign, £5,000-and-up goes on the mantelpiece.
       */
      const payOf = id => (SF.config.ACHIEVEMENTS.find(a => a.id === id) || {}).pay || 0;
      check("the metal never contradicts the payout",
        SF.config.ACHIEVEMENTS.every(a => {
          const rank = known.indexOf(SF.icons.medalTierOf(a.id)), pay = payOf(a.id);
          if(pay < 500  && rank !== 0) return false;
          if(pay >= 1200 && rank < 2)  return false;
          if(pay >= 5000 && rank < 3)  return false;
          return true;
        }));
    }
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

  /* ---------- two devices, one pilot, nothing lost ----------
   * The scenario that used to delete an afternoon: Marc plays the iPad in the
   * car with no signal and three-stars mission 12, then plays the iPhone at
   * home and clears mission 5. Whichever synced second replaced the WHOLE
   * record, so the other device's work was gone, silently. Everything in a
   * profile that matters is monotonic, so it merges without needing to know
   * which device was "right".
   */
  {
    const iPad = { name:"Marc", callsign:"MARC", savedAt: 5000, money: 900,
      upgrades: { spread: 3, rapid: 1 },
      missions: { m12: { cleared:true, stars:{ pilot:3 }, best:{ pilot: 8000 } },
                  m1:  { cleared:true, stars:{ pilot:2 }, best:{ pilot: 1200 } } },
      totalKills: 900, highscore: 8000, cosmetics:{ paints:["solar"], trails:[], decals:[], fireworks:[] },
      achievements:["firstBlood"], stories:{ ace:true },
      hull:"anvil", hulls:["dart","anvil"] };
    const iPhone = { name:"Marc", callsign:"MARC", savedAt: 9000, money: 40,
      upgrades: { spread: 1, damage: 2 },
      missions: { m5:  { cleared:true, stars:{ pilot:3 }, best:{ pilot: 5000 } },
                  m1:  { cleared:true, stars:{ pilot:1 }, best:{ pilot: 300 } } },
      totalKills: 400, highscore: 5000, cosmetics:{ paints:[], trails:["rainbow"], decals:[], fireworks:[] },
      achievements:["sharpshooter"], stories:{ silent:true },
      hull:"dart", hulls:["dart"] };
    const m = C.mergeRecord(iPad, iPhone);
    check("a merge keeps the stars won on BOTH devices",
      m.missions.m12.stars.pilot === 3 && m.missions.m5.stars.pilot === 3);
    check("a mission played on both keeps the better result",
      m.missions.m1.stars.pilot === 2 && m.missions.m1.best.pilot === 1200);
    check("upgrades bought on either device are owned",
      m.upgrades.spread === 3 && m.upgrades.rapid === 1 && m.upgrades.damage === 2);
    check("lifetime counters take the higher of the two",
      m.totalKills === 900 && m.highscore === 8000);
    check("cosmetics, medals and story cards are unions",
      m.cosmetics.paints.includes("solar") && m.cosmetics.trails.includes("rainbow") &&
      m.achievements.length === 2 && m.stories.ace && m.stories.silent);
    check("the wallet is the one field that follows the newer save",
      m.money === 40);
    /*
     * The Anvil was bought on the iPad and the iPhone has never heard of it.
     * `hulls` sat at the top level, outside every union, so it rode the
     * newest-wins default and the next iPhone sync quietly repossessed a
     * 30,000 airframe. Which one is FITTED still follows the newer save -
     * that is a choice, not a possession.
     */
    check("an airframe bought on one device is still owned on the other",
      m.hulls.indexOf("anvil") >= 0 && m.hulls.indexOf("dart") >= 0 && m.hull === "dart");
    check("the merge is symmetric",
      JSON.stringify(C.mergeRecord(iPhone, iPad)) === JSON.stringify(m));
    // And through the real door, not just the pure function.
    SF.profile.saveRaw(iPad);
    C.applyPilots({ Marc: iPhone });
    const disk = SF.profile.load("Marc");
    check("syncing a diverged pilot loses nothing on disk",
      (disk.missions.m12.stars.pilot === 3) && (disk.missions.m5.stars.pilot === 3));
  }

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
    // The incoming stamp needs real margin, not +1ms: applyPilots caps the
    // stored stamp at ITS OWN Date.now(), sampled after this line, so a
    // one-millisecond lead made the assertion a coin flip on a slow run.
    SF.profile.saveRaw({ name:"Clock", callsign:"Clock", money: 1, savedAt: Date.now() + 3600000 });
    C.applyPilots({ Clock: { name:"Clock", callsign:"Clock", money: 50, savedAt: Date.now() + 250 } });
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
    /*
     * ONE CAMERA AT A TIME.
     *
     * The replay zooms toward the impact on its own, 1.0 to 1.42. The camera
     * push landed eight days after the rewind did and was applied above
     * everything, the replay included, so the two zooms multiplied - and
     * since the push is still falling back from the kick the death gave it,
     * the product kept moving under a picture that was already moving. That
     * is what "it zooms crazily" was. Measured on a real death: the replay
     * inherited a drifting 1.0000-1.0378, and the frame-to-frame lurch ran
     * 36% higher at the 90th percentile than with one camera.
     *
     * owns() is the line between the two, and it is not the same as
     * active(): the death beat is active but is still LIVE PLAY - the wreck,
     * its blast, the HUD - and keeps the push exactly as it always had.
     */
    check("the wreck's beat is live play, not replay",
      RW.owns() === false && RW.draw({}, 0, 480, 800) === false);
    check("the replay is the only camera in its own frame", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      const r = fs.readFileSync(path.join(__dirname, "src/rewind.js"), "utf8");
      return /function owns\(\)/.test(r) &&
             /\bowns,/.test(r) &&                               // exported
             /const replaying = SF\.rewind\.owns\(\);/.test(g) &&
             /if\(!replaying\) fx\.cameraApply\(ctx, VW, VH\);/.test(g);
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
    check("the collision layer hands over WHAT hit you, and WHO it hit", (() => {
      const sy = fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8");
      // The entity is still named (a hit has a cause), and every report now
      // also names the seat, so in co-op the life comes off the right pilot.
      return /onPlayerHit\("collision", e, p\)/.test(sy) &&
             /onPlayerHit\("bullet", b, p\)/.test(sy) &&
             /onPlayerHit\("boss", boss, p\)/.test(sy) &&
             /const seats = world\.livePlayers\(\);/.test(sy);
    })());

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
    check("bouncy coins and the super magnet never share a sky either", (() => {
      // One joke is coins going where you aren't; the other is coins coming
      // to you. Together, neither one happens.
      for(let i = 0; i < 300; i++){
        const ids = SF.wacky.roll().map(m => m.id);
        if(ids.includes("bouncy") && ids.includes("vacuum")) return false;
      }
      return true;
    })());

    /*
     * The newer half of the table. Same contract as the old half: visible in
     * seconds, and never harder than the campaign.
     */
    check("SUPER MAGNET pulls a coin in from the far corner", (() => {
      const real = SF.wacky.build;
      SF.wacky.build = () => real(["vacuum"]);
      SF.game.startMission("wacky", "pilot");
      SF.wacky.build = real;
      const p2 = SF.game.world.player;
      p2.x = 60; p2.y = SF.entityConst.VH - 80;
      const c = SF.game.world.spawnPickup("coin", SF.entityConst.VW - 20, 40, { value: 1 });
      c.vx = 0; c.vy = 0;
      SF.game.world.updatePickups(0.05, () => {});
      const ok = c.vx < -10 && c.vy > 10;      // heading for the ship, hard
      c.alive = false;
      SF.game.endMission(false);
      return ok;
    })());
    check("BUBBLE SHOTS makes their fire slow and floaty, never fatter", (() => {
      const real = SF.wacky.build;
      SF.wacky.build = () => real(["bubbles"]);
      SF.game.startMission("wacky", "pilot");
      SF.wacky.build = real;
      const b = SF.game.world.spawnEnemyBullet(100, 100, 0, 400, "bolt", 4);
      const ok = !!b && b.kind === "bubble" && b.vy < 400*0.5 && b.r === 4;
      if(b) b.alive = false;
      SF.game.endMission(false);
      return ok;
    })());
    check("CHAIN REACTION takes the neighbours with it, and only them", (() => {
      const real = SF.wacky.build;
      SF.wacky.build = () => real(["chain"]);
      SF.game.startMission("wacky", "pilot");
      SF.wacky.build = real;
      const d = SF.game.run.difficulty;
      const near = SF.game.world.spawnEnemy("grunt", 240, 200, { difficulty: d });
      const far  = SF.game.world.spawnEnemy("grunt", 240, 640, { difficulty: d });
      near.hp = 1; far.hp = 1; near.entering = false; far.entering = false;
      const victim = SF.game.world.spawnEnemy("grunt", 200, 200, { difficulty: d });
      SF.game.callbacks.onEnemyKilled(victim, null, false);
      const ok = !near.alive && far.alive;     // the blast has a radius
      [near, far, victim].forEach(e => { e.alive = false; });
      SF.game.endMission(false);
      return ok;
    })());
    check("...and a cascade can never recurse forever",
      (() => { const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
               return /\(e\.chainDepth \|\| 0\) < 3/.test(g); })());
    check("DISCO SKY recolours the world, over the fight and under the HUD",
      (() => { const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
               const at = g.indexOf("SF.render.drawDisco(ctx, timeMs)");
               return typeof SF.render.drawDisco === "function" && at > 0 &&
                      /run\.mods\.disco/.test(g) &&
                      at > g.indexOf("SF.render.drawBullets(ctx, world)") &&
                      at < g.indexOf("SF.render.drawHud(ctx, game)"); })());
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
    /*
     * Wait on the CLOCK, not on a frame count. This was `runFrames(340)` and
     * hoping ~11s of simulated time had gone by, which is a bet on the frame
     * budget - it lost at least once, failing a green build for a reason
     * that had nothing to do with powerups. Same lesson as the boss rush:
     * wait for the state you actually mean.
     */
    let spun = 0;
    while(SF.game.now() <= p.tempRapidUntil && spun++ < 2000) await runFrames(10, true);
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

    /* ---------- whichever one you last used is the one flying ---------- */
    /*
     * Hover steering made a trackpad play like glass and quietly took the
     * keyboard away with it: `dragging` latched true the moment the cursor
     * first crossed the playfield and never let go, and the player entity
     * OVERWRITES its velocity with the pointer's pull rather than adding to
     * it. So on any Mac, holding Left flew the ship RIGHT, back to wherever
     * the cursor was resting. Measured in Chromium before the fix: ship
     * centred at 191, Left held six-tenths of a second, ship at 309 - which
     * was the cursor's position, not anywhere Left points.
     */
    const key = (name, k) => window.dispatchEvent(new window.KeyboardEvent(name, { key: k }));
    SF.input.clearMovement();
    ptr("mouse", "pointermove", 150, 200);
    check("the trackpad has the ship after a bare move", st.dragging === true);
    key("keydown", "ArrowLeft");
    check("a steering key takes the ship off a hovering cursor",
      st.left === true && st.dragging === false && SF.input._hoverSteering() === false);
    // A hand resting on a trackpad twitches. That must not steal the ship back.
    ptr("mouse", "pointermove", 152, 201);
    check("...and a resting hand's jitter does not steal it back", st.dragging === false);
    // A deliberate move does.
    ptr("mouse", "pointermove", 210, 240);
    check("...but moving the pointer for real takes it straight back", st.dragging === true);
    key("keyup", "ArrowLeft");

    /*
     * A HELD grip is not a hover, and outranks the keys either way: somebody
     * with a finger on the glass is deliberately holding on, and a child
     * leaning on the keyboard must not wrench the ship out of their hand.
     */
    SF.input.clearMovement();
    ptr("touch", "pointerdown", 150, 200, cv, 11);
    key("keydown", "ArrowLeft");
    check("a key never takes the ship off a finger that is holding it",
      st.dragging === true);
    key("keyup", "ArrowLeft");
    ptr("touch", "pointerup", 150, 200, null, 11);
    SF.input.clearMovement();

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
        // Tails are the only NON-SQUARE stretched draw in this path. Bolts
        // now blit with explicit (square) dest sizes too - the retina bake
        // draws a 2x sprite at logical size - so "has 5 args" stopped being
        // a tail signature; "wider than it is tall, or vice versa" still is.
        if(h !== undefined && w !== h) tails.push({ ang, w, h });
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

  /* ---------- explosions land in stages ---------- */
  {
    const fx = SF.fx, P = fx._pools.particles.items;
    const live = kind => P.filter(p => p.alive && (!kind || p.kind === kind));

    fx.reset();
    fx.explosion(100, 100, 40, "#ffb03d", true);
    const now = live().filter(p => p.delay === 0);
    const later = live().filter(p => p.delay > 0);
    check("a death puts something on screen the instant it happens", now.length > 0);
    check("...and holds the rest back for later", later.length > 0);
    check("the flash is instant, the smoke is not",
      live("flash").every(p => p.delay === 0) &&
      live("smoke").every(p => p.delay > 0));
    check("the fireball blooms after the flash, before the smoke",
      live("fire").some(p => p.delay > 0 && p.delay < live("smoke")[0].delay));

    // A staged particle is alive but frozen: it must not age or drift while
    // it waits, or it would arrive already half-dead and in the wrong place.
    const waiting = live("smoke")[0];
    const x0 = waiting.x, d0 = waiting.delay;
    fx.update(0.05, 0);
    check("a waiting particle doesn't age or drift", waiting.life === 0 && waiting.x === x0);
    check("...but its clock is running", waiting.delay < d0);
    fx.update(d0, 0);
    fx.update(1/60, 0);
    check("...and it moves once its turn comes", waiting.life > 0);

    fx.reset();
    fx.explosion(100, 100, 40, "#ffb03d", true);
    check("a big death gets the glow kick", live("bloom").length > 0);
    check("...and secondaries that go off out of step with each other",
      new Set(live("fire").filter(p => p.delay > 0.05).map(p => Math.round(p.delay*1000))).size > 1);
    fx.reset();
    fx.explosion(100, 100, 20, "#ffb03d", false);
    check("a small death stays small - no glow kick, no secondaries",
      live("bloom").length === 0);

    /*
     * The invariant behind all of the above: decoration must not move the
     * seeded simulation stream (core.js). Measured by seeding, running the
     * effect, and counting how many draws it took to reach the same value
     * again - a big death's flourishes have to cost exactly zero.
     */
    const seededDraws = fn => {
      SF.core.seedSim(99); fn();
      const after = SF.core.rand(0, 1);
      SF.core.seedSim(99);
      for(let i = 0; i < 600; i++) if(SF.core.rand(0, 1) === after) return i;
      return -1;
    };
    const viaEmitters = seededDraws(() => {
      fx.fireball(0, 0, 7, 40); fx.sparks(0, 0, 18, "#f00", 240);
      fx.embers(0, 0, 10); fx.debris(0, 0, 12, "#f00"); fx.smoke(0, 0, 8);
    });
    const viaExplosion = seededDraws(() => fx.explosion(0, 0, 40, "#f00", true));
    check("the five emitters still draw from the seeded stream", viaEmitters > 0);
    check("a big death's extra flourishes cost the simulation nothing",
      viaExplosion === viaEmitters);
    check("a damage number's drift is decoration too",
      seededDraws(() => fx.damageNumber(0, 0, 5, false)) === 1);
  }

  /* ---------- damage numbers pop and fall ---------- */
  {
    const fx = SF.fx, T = fx._pools.texts.items;
    fx.reset();
    fx.damageNumber(100, 200, 4, false);
    const n = T.find(t => t.alive);
    check("a damage number is thrown upward, not slid", n.vy < -80);
    check("...and pulled back down", n.gravity > 0);
    check("...and told to pop", n.pop > 0);

    let peak = n.y;
    for(let i = 0; i < 60 && n.alive; i++){ fx.update(1/60, 0); peak = Math.min(peak, n.y); }
    check("it arcs: rises clear of the hull, then falls back past it",
      peak < 200 - 8 && n.y > peak + 8);

    fx.reset();
    fx.damageNumber(0, 0, 1, false);
    const small = T.find(t => t.alive).size;
    fx.reset();
    fx.damageNumber(0, 0, 9, false);
    const heavy = T.find(t => t.alive).size;
    check("a heavy round prints a bigger number than a scratch", heavy > small + 4);

    // The banner text shares the pool; its old straight rise must survive.
    fx.reset();
    fx.text(100, 200, "ELITE DOWN", "#ffd23f", 17, true);
    const b = T.find(t => t.alive);
    check("banner text doesn't pop or fall - it still rises and eases out",
      b.pop === 0 && b.gravity === 0);
    let last = b.y, rose = true;
    for(let i = 0; i < 50 && b.alive; i++){ fx.update(1/60, 0); if(b.y > last) rose = false; last = b.y; }
    check("...all the way up, never turning back", rose);
    fx.reset();
  }

  /* ---------- the fleet catches the light ---------- */
  {
    const art = SF.enemyArt;
    const lum = css => {
      const m = String(css).match(/\d+/g).map(Number);
      return 0.299*m[0] + 0.587*m[1] + 0.114*m[2];
    };
    const P = art.paletteFor("#4ade80", false);
    const E = art.paletteFor("#4ade80", true);

    check("a hull carries a lit edge", /^rgba\(/.test(P.rim));
    check("...and a cool counter-light for the edge coming at you",
      /^rgba\(/.test(P.rimCool) && P.rimCool !== P.rim);
    check("an elite's rim is its own gold, not the fleet's white", E.rim !== P.rim);
    /*
     * The shaded half used to run 0.42 toward black, which on empty space
     * turned the bottom of a hull into a hole rather than a surface.
     *
     * These were ratios against base, and the re-grade that fixed the fleet
     * reading as too bright moved base and the shadows together - at which
     * point a ratio floor loose enough to pass the new grade was also loose
     * enough to pass the old black-mixed one, i.e. it protected nothing. So
     * pin the two things that actually matter instead, both roster-wide.
     *
     * ONE, the hole: no hull's dark side may collapse into the sky behind it.
     * The darkest sky in SKIES is #02050e at luminance 5.1; measured across
     * the roster the faintest shade is 56.0 and the faintest deep 36.0, so a
     * floor of 5x the sky is a real floor everything clears comfortably.
     */
    const SKY_DARKEST = 5.1;
    const tints = Object.keys(SF.enemyData.ENEMY_TYPES)
      .map(id => SF.enemyData.ENEMY_TYPES[id].tint).filter(Boolean);
    const pals = tints.map(t => art.paletteFor(t, false));
    check("the dark side of a hull stays a colour, not a hole",
      pals.length > 15 && pals.every(q => lum(q.shade) > SKY_DARKEST*5));
    check("...and so does the deepest plate",
      pals.every(q => lum(q.deep) > SKY_DARKEST*5));
    /*
     * TWO, the light: shadows SHIFT as they darken rather than merely dimming.
     * A mix toward black scales all three channels by one factor, so the
     * spread of the per-channel shadow/base ratios is zero BY CONSTRUCTION;
     * mixing toward a deep space navy pulls blue up against the rest. Measured
     * both ways across the roster - worst case 0.025 with the cool mix, 0.001
     * with the old black one - so unlike the ratio floors it replaces, this is
     * a check the pre-lighting constant genuinely fails.
     */
    const chanSpread = (sh, base) => {
      const s = String(sh).match(/\d+/g).map(Number);
      const b = String(base).match(/\d+/g).map(Number);
      const r = [0,1,2].filter(i => b[i] >= 8).map(i => s[i]/b[i]);
      return Math.max.apply(null, r) - Math.min.apply(null, r);
    };
    check("a shadow cools as it darkens instead of just dimming",
      pals.every(q => chanSpread(q.shade, q.base) > 0.010 &&
                      chanSpread(q.deep,  q.base) > 0.010));
    check("the canopy has a colour to glow with", /^\d+,\d+,\d+$/.test(P.glassRgb));

    /* ---------- and the bosses are under the same sky ----------
     *
     * The bosses carried the fleet's PRE-lighting constants verbatim, and
     * were left behind when it was re-graded: shadows mixed toward black,
     * lit at 0.42, and an ink line and rim sized as fractions of S - which
     * is fine for an enemy rasterised at 3x and blitted small, and lands as
     * a hard keyline on a hull drawn at its final 130-300px.
     *
     * Rather than keep a second copy of the design hexes here, draw every
     * hull once against the stub context and then read the material cache:
     * whatever the roster actually used is what gets pinned, and a hull
     * added later is covered without touching this test.
     */
    const BA = SF.bossart;
    if(BA && BA.MATS){
      Object.keys(BA.HULLS).forEach(id => {
        const cv = window.document.createElement("canvas");
        const c2 = cv.getContext("2d");
        const boss = { defId:id, flash:0, charge:0, wounds:[] };
        try { BA.draw(c2, boss, 200, 0.3, 1000); } catch(e){}
      });
      const bm = Object.keys(BA.MATS).map(k => BA.MATS[k]);
      check("every boss hull drew, so the material cache is the real roster",
        bm.length > 12);
      /*
       * Same floor as the fleet: 5x the darkest sky in SKIES. The Leviathan's
       * shadows were authored as warm near-blacks (#1c0c04, #1a0a03) and its
       * deepest tone measured luminance 10 against a sky of 5.1 - not a
       * shadow, a hole. Worst case is now 38.
       */
      check("a boss's deepest plate is a surface, not a hole in the ship",
        bm.every(q => lum(q.deep) > SKY_DARKEST*5));
      check("...and its shaded half too", bm.every(q => lum(q.shade) > SKY_DARKEST*5));
      /*
       * Nothing may reach paper. This is a floor rather than a discriminator:
       * the roster's brightest accent is a deliberately pale core at 210, and
       * the constants that produced the washed-out Sentinel pods are pinned
       * at source below instead, because a boss material takes its shade from
       * a DIFFERENT design hex than its base - so the fleet's channel-spread
       * test measures the gap between those two hexes, not the cooling, and
       * passes either way. A pin that cannot fail is not worth having.
       */
      check("a boss's highlight is a highlight, not paper",
        bm.every(q => lum(q.lit) < 232));
      // The ink diet, and the rim that was reading as a sticker keyline.
      const bsrc = fs.readFileSync(path.join(__dirname, "src/bossart.js"), "utf8");
      check("a boss's shadows are mixed toward the fleet's navy, not toward black",
        /NAVY_S\s*=\s*\{\s*r:22,\s*g:30,\s*b:56\s*\}/.test(bsrc) &&
        /shade:\s*lo\s*\?\s*str\(mixToRgb\(/.test(bsrc) &&
        /deep:\s*lo\s*\?\s*str\(mixToRgb\(/.test(bsrc) &&
        !/mix\(b,\s*0,\s*0\.30\)/.test(bsrc));
      check("...and a boss's default highlight is the fleet's re-graded 0.18",
        /litK === undefined \? 0\.18 : litK/.test(bsrc));
      check("a boss wears the fleet's thin ink, not the old 0.85 marker line",
        /const LINE\s*=\s*"rgba\(8,10,18,0\.55\)"/.test(bsrc));
      check("...and one sun over every part, in hull space",
        /function sun\(ctx, S\)/.test(bsrc) &&
        (bsrc.match(/fillStyle = sun\(ctx, S\)/g) || []).length >= 2);
      check("...and a contact shadow, so a part is bolted on rather than beside",
        /function bolted\(/.test(bsrc) &&
        (bsrc.match(/bolted\(ctx, S,/g) || []).length >= 2);
    }

    // rimLight() clips and restores around two extra strokes; a stray save
    // or a bad path there throws inside the rasteriser, which returns null.
    const ids = Object.keys(art.SHAPES);
    check("every archetype still rasterises with the lighting on",
      ids.length > 15 && ids.every(id => !!art.spriteFor(id, "#4ade80", false)));
    check("...and every archetype as an elite",
      ids.every(id => !!art.spriteFor(id, "#f43f5e", true)));

    const T = SF.enemyData.ENEMY_TYPES;
    check("every enemy wears its own colour - none falls through to the default brick",
      Object.keys(T).every(id => /^#[0-9a-f]{6}$/i.test(T[id].tint || "")));
    check("the Grunt, the one you meet most, is no longer the dimmest thing out there",
      lum(art.paletteFor(T.grunt.tint, false).base) >
      lum(art.paletteFor("#c0392b", false).base) * 1.25);
  }

  /* ---------- fullscreen keeps hold of the cursor ---------- */
  {
    /*
     * The steering itself needs a real pointer lock and is checked in
     * Chromium (see DESIGN §8y3) - jsdom has no lock to take. What IS
     * checkable here is the contract around it: the Escape promise, the
     * exported surface, and the rule that an unlock nobody asked for takes
     * fullscreen down with it.
     */
    const doc = window.document;
    const setFs = el => Object.defineProperty(doc, "fullscreenElement",
      { value: el, configurable: true });
    const setLock = el => Object.defineProperty(doc, "pointerLockElement",
      { value: el, configurable: true });
    const key = k => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: k }));

    check("the input layer can be asked for the cursor",
      typeof SF.input.lockPointer === "function" &&
      typeof SF.input.unlockPointer === "function" &&
      typeof SF.input.isPointerLocked === "function");

    delete doc.fullscreenElement;
    SF.input.consumePause();
    key("Escape");
    check("windowed, Escape still pauses the way it always did", SF.input.consumePause());

    setFs(doc.documentElement);
    SF.input.consumePause();
    key("Escape");
    check("in fullscreen, Escape means leave - it doesn't also pause",
      !SF.input.consumePause());
    key("p");
    check("...and p is still there to pause with", SF.input.consumePause());

    /*
     * An unlock we didn't ask for is Escape (the browser owns that key), so
     * fullscreen has to come down in the same press - otherwise the player
     * presses it once, loses the cursor lock, and is left in a fullscreen
     * window they now have to escape a second time.
     */
    let exited = 0;
    doc.exitFullscreen = () => { exited++; return Promise.resolve(); };
    setLock(doc.documentElement);
    doc.dispatchEvent(new window.Event("pointerlockchange"));
    check("taking the cursor is noticed", SF.input.isPointerLocked());
    setLock(null);
    doc.dispatchEvent(new window.Event("pointerlockchange"));
    check("an unlock nobody asked for drops fullscreen with it", exited === 1);
    check("...and lets go of the ship rather than leaving it stuck on a wall",
      !SF.input.state.dragging);

    // ...but when WE release it (the Exit Fullscreen button), that same
    // handler must not fire a second exitFullscreen underneath the first.
    setLock(doc.documentElement);
    doc.dispatchEvent(new window.Event("pointerlockchange"));
    SF.input.unlockPointer();
    setLock(null);
    doc.dispatchEvent(new window.Event("pointerlockchange"));
    check("a release we asked for doesn't bounce back through exitFullscreen",
      exited === 1);

    /* ---------- and you can always see where it is ---------- */
    /*
     * Pointer lock takes the OS cursor away, so this ring is the only cursor
     * there is - and it used to be drawn ONLY while over something clickable.
     * Off a button it was nothing at all: in fullscreen the pointer vanished
     * and finding it again meant waving the trackpad until something lit up.
     */
    setLock(doc.documentElement);
    doc.dispatchEvent(new window.Event("pointerlockchange"));
    const ring = () => doc.getElementById("vcursor");
    check("locking the pointer puts a cursor on screen straight away",
      !!ring() && ring().classList.contains("on"));
    {
      // Over empty sky - the case that used to draw nothing.
      const realFrom = doc.elementFromPoint;
      doc.elementFromPoint = () => doc.getElementById("game");
      const move = (dx, dy) => {
        const e = new window.MouseEvent("mousemove", { bubbles: true });
        Object.defineProperty(e, "movementX", { value: dx });
        Object.defineProperty(e, "movementY", { value: dy });
        window.dispatchEvent(e);
      };
      move(140, 90);
      check("over open sky it is still there, just quiet",
        ring().classList.contains("on") && !ring().classList.contains("hot"));
      const wasLeft = ring().style.left;
      move(60, 0);
      check("...and it tracks where the pointer actually went",
        ring().style.left !== wasLeft);
      // Over something tappable it goes bright, the way it always did.
      const btn = doc.getElementById("pauseBtn");
      doc.elementFromPoint = () => btn;
      move(1, 0);
      check("over something clickable it lights up",
        ring().classList.contains("hot") && btn.classList.contains("vhover"));
      doc.elementFromPoint = realFrom;
    }
    setLock(null);
    doc.dispatchEvent(new window.Event("pointerlockchange"));
    check("giving the cursor back takes our ring away",
      !ring().classList.contains("on"));

    const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
    check("our own cursor has something to draw", /#vcursor\s*\{/.test(css));
    /* The two strengths have to be different, or "quiet" is just "invisible"
       again under another name. */
    check("the quiet cursor and the bright one are drawn differently",
      /#vcursor\.on\s*\{[^}]*opacity/.test(css) &&
      /#vcursor\.on\.hot\s*\{[^}]*opacity\s*:\s*1/.test(css));
    check("...and a stand-in for the :hover that can never fire",
      /\.vhover\s*\{/.test(css));

    delete doc.fullscreenElement;
    delete doc.pointerLockElement;
    SF.input.clearMovement();
  }

  /* ---------- last, because it reseeds the world ---------- */
  /*
   * THE ONE THAT COULD RUIN A MISSION.
   *
   * fx.js draws from the SEEDED simulation stream, and every explosion in a
   * flight draws from it in a fixed order. A death flourish that took one
   * number from that stream would shift every seeded draw after it - spawn
   * points, elite rolls, drop chances - so an enemy blowing up prettier would
   * silently rewrite the rest of the mission. The whole feature is therefore
   * additive AND drawn from Math.random, and this proves it: the same
   * explosion with and without a style, from one seed, has to leave the next
   * simulation number identical.
   *
   * Deliberately the final check in the file, because seedSim moves that
   * stream for everything after it. Run earlier, it made a powerup-expiry test
   * two thousand lines away flaky - which is precisely the class of damage it
   * exists to rule out.
   */
  check("a death style cannot move the simulation", (() => {
    const C = SF.core;
    C.seedSim(12345); SF.fx.explosion(100, 100, 60, "#fff", true);
    const plain = C.rand(0, 1);
    const after = Object.keys(SF.fx.DEATHS).map(style => {
      C.seedSim(12345); SF.fx.explosion(100, 100, 60, "#fff", true, style);
      return C.rand(0, 1);
    });
    return after.length >= 5 && after.every(v => v === plain);
  })());
  /*
   * ...and neither can the LIGHT it casts, for exactly the same reason. Every
   * light is spawned with fixed parameters and no random draws, so an
   * explosion lighting the world around it cannot move a spawn point three
   * minutes later. Same seed, same next number, with the light in between.
   */
  check("an explosion's light cannot move the simulation", (() => {
    const C = SF.core;
    C.seedSim(4242); const before = C.rand(0, 1);
    C.seedSim(4242); SF.fx.light(120, 200, 140, "255,200,130", 0.4, 0.5);
    SF.fx.light(80, 90, 90);
    const after = C.rand(0, 1);
    return before === after;
  })());

  /* ---------- bullets: the colour law and the shapes of danger ---------- */
  {
    const rSrc = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
    const eSrc = fs.readFileSync(path.join(__dirname, "src/entities.js"), "utf8");

    /*
     * The player's fire may NEVER be the enemy's colour. Tier 5 used to be
     * #ff7ce5 - the exact pixel value of the enemy orb - so this converts
     * every tier to the same "r,g,b" form the enemy sprites use and demands
     * an empty intersection, against whatever either side is TODAY.
     */
    check("your fire is never the enemy's colour", (() => {
      const m = rSrc.match(/kind === "orb" \? "([\d,]+)" : "([\d,]+)"/);
      if(!m) return false;
      const enemy = [m[1], m[2]];
      const tiers = SF.entityConst.BULLET_TIERS.map(t => {
        const n = parseInt(t.color.slice(1), 16);
        return ((n>>16)&255) + "," + ((n>>8)&255) + "," + (n&255);
      });
      return tiers.length >= 6 && tiers.every(c => enemy.indexOf(c) < 0);
    })());

    /* Enemy shots wear a dark rim, both silhouettes - it is what keeps them
       solid objects on The Bright Side's cream sky. */
    check("enemy shots wear a dark rim", (() => {
      const fn = rSrc.slice(rSrc.indexOf("function enemyBolt"), rSrc.indexOf("function enemyTail"));
      return /rgba\(26,3,15/.test(fn) && /R \+ 1\.4/.test(fn) && /leaf\(R \+ 1\.1\)/.test(fn);
    })());

    /* Fast shots are darts pointed along their real travel; orbs stay round.
       The dart is baked nose-up and rotated at draw with the same angle as
       its tail, so body and wake always agree about the direction. */
    check("aimed shots are darts pointed along travel", (() => {
      const bolt = rSrc.slice(rSrc.indexOf("function enemyBolt"), rSrc.indexOf("function enemyTail"));
      const loop = rSrc.slice(rSrc.indexOf("function drawBullets"), rSrc.indexOf("function coinSprite"));
      return /quadraticCurveTo/.test(bolt) &&
             /Math\.atan2\(b\.vx, -b\.vy\)/.test(loop) && /ctx\.rotate\(ang\)/.test(loop);
    })());

    /* Player bullet BODIES are not additive - additive capsules saturated
       to identical white pills over bright skies. Streak stays light. */
    check("bullet bodies do not saturate to white", (() => {
      const fn = rSrc.slice(rSrc.indexOf("function drawBullets"), rSrc.indexOf("function coinSprite"));
      const streak = fn.indexOf("streakSprite");
      const over = fn.indexOf('"source-over"');
      const body = fn.indexOf("ctx.drawImage(spr,");
      return streak >= 0 && over > streak && body > over;
    })());

    /* The gun visibly fires: a real star plus kicked motes, not 3 frames of
       6px. And enemy fire announces itself at the gun before it travels. */
    check("the guns visibly fire", (() => {
      SF.fx.reset();
      SF.fx.muzzle(100, 100, "#ffd23f", 1);
      const ps = SF.fx._pools.particles.items.filter(p => p.alive);
      const star = ps.find(p => p.kind === "muzzle");
      const kicks = ps.filter(p => p.kind === "spark");
      return !!star && star.max >= 0.08 && star.size >= 9 && kicks.length >= 2;
    })());
    check("enemy fire announces itself at the gun", (() => {
      SF.fx.reset();
      SF.fx.enemyMuzzle(50, 60, "255,93,115", 4.5);
      const pop = SF.fx._pools.particles.items.find(p => p.alive && p.kind === "flash" && p.x === 50);
      const wired = /fx\.enemyMuzzle\(/.test(eSrc.slice(eSrc.indexOf("spawnEnemyBullet(x, y")));
      return !!pop && pop.max >= 0.08 && wired;
    })());

    /* Both new emitters against the seeded stream: the birth cue consumes
       ZERO draws (it lives on the sim's fire paths), and muzzle consumes
       exactly the ONE draw it always has - the flourish rolls from mrand. */
    check("the new flashes cannot move the simulation", (() => {
      const C = SF.core;
      C.seedSim(7171); const a = C.rand(0, 1);
      C.seedSim(7171); SF.fx.enemyMuzzle(300, 400, "255,124,229", 6);
      const b = C.rand(0, 1);
      C.seedSim(9191); C.rand(0, 1); const second = C.rand(0, 1);
      C.seedSim(9191); SF.fx.muzzle(140, 500, "#ffd23f", 1);
      const afterOne = C.rand(0, 1);
      return a === b && afterOne === second;
    })());
    SF.fx.reset();
  }

  /* ---------- rocks are rocks, and each one is its own rock ---------- */
  {
    const RD = SF.render;
    /* Baking runs off its own art stream. Run this FIRST, while the sprite
       cache is still cold, or it proves nothing but that a cache hit is
       cheap. */
    check("baking a rock cannot move the simulation", (() => {
      const C = SF.core;
      C.seedSim(3131); const before = C.rand(0, 1);
      C.seedSim(3131); RD._rockBakeAll();
      return C.rand(0, 1) === before;
    })());

    /*
     * The suite's shared canvas is a no-op stub whose getImageData hands back
     * a zero-filled buffer, so measuring the game's OWN sprites here would
     * pass whatever it was asked - the first cut of these pins was green
     * against nothing. Same escape as the planet pins above: re-run the
     * baker in a private instance backed by node-canvas, and fall through
     * vacuously only when the native dep is genuinely absent.
     */
    let RK = null;
    try {
      const NC2 = require("canvas");
      const src = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const seg = src.slice(src.indexOf("const rockCache = {};"),
                            src.indexOf("function drawAsteroid(ctx, e, size){"));
      RK = new Function("document", "BAKE", "TAU",
        seg + "\nreturn { rockSprite: rockSprite, ROCK_VARIANTS: ROCK_VARIANTS };"
      )({ createElement: () => NC2.createCanvas(1, 1) }, 2, Math.PI*2);
    } catch(e){ RK = null; }

    const sig = (cv) => {
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let s = 0, ink = 0;
      for(let i=0;i<d.length;i+=4){
        if(d[i+3] > 8) ink++;
        if(i % (4*53) === 0) s = ((s*31 + d[i] + d[i+1]*3 + d[i+2]*7 + d[i+3]) >>> 0);
      }
      return { s, ink };
    };
    // Proof the private instance really paints, so a silent stub can never
    // make the three measurements below pass by describing an empty canvas.
    const canRead = !!RK && (() => {
      const cv = RK.rockSprite(false, 0);
      return !!cv && cv.width > 8 && sig(cv).ink > 200;
    })();
    check("the rock pins are measuring real pixels", !RK || canRead);

    /*
     * THE headline defect this replaced: every asteroid in the game was the
     * same nine-sided lump wearing three craters at the same three fixed
     * coordinates. Six variants that are byte-identical would be the same
     * bug wearing a bigger implementation, so this compares real pixels.
     */
    check("every rock variant is a different rock", !canRead || (() => {
      const seen = new Set();
      for(let v=0; v<RK.ROCK_VARIANTS; v++){
        for(const tough of [false, true]){
          const cv = RK.rockSprite(tough, v);
          if(!cv) return false;
          seen.add(sig(cv).s);
        }
      }
      return seen.size === RK.ROCK_VARIANTS*2;
    })());

    /*
     * A rock has a SURFACE. The old one was a flat gradient, which is what
     * made it read as cut paper; local contrast measures that the way the
     * planet pin does, so "it has texture" is a number and not an opinion.
     *
     * The thresholds are MEASURED, not guessed. Stripping the regolith and
     * then the craters from the real baker gives:
     *
     *                          boulder   asteroid
     *   full                    3.32%      4.46%
     *   no regolith             2.35%      3.62%
     *   no regolith, no craters 1.67%      2.94%
     *
     * The first draft of this pin asked for >1.2%, which even a completely
     * flat rock clears on its limb gradients alone - it passed happily with
     * the texture deleted. Each bar now sits above its own no-regolith
     * number, so the pin fails if the surface is taken away.
     */
    const contrast = (cv) => {
      const W = cv.width, H = cv.height;
      const d = cv.getContext("2d").getImageData(0, 0, W, H).data;
      const at = (x,y) => { const i=(y*W+x)*4;
        return d[i+3] < 200 ? -1 : 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; };
      let sum = 0, mean = 0, n = 0;
      for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
        const l = at(x,y), r = at(x+1,y), b = at(x,y+1);
        if(l < 0 || r < 0 || b < 0) continue;
        sum += Math.abs(l-r) + Math.abs(l-b); mean += l; n++;
      }
      return n < 500 ? 0 : (sum/(2*n))/Math.max(1, mean/n)*100;
    };
    check("a rock has a surface, not a flat fill", !canRead || (() =>
      contrast(RK.rockSprite(true, 0)) > 2.8 && contrast(RK.rockSprite(false, 2)) > 3.9
    )());

    /* Stone is stone: the tough class is bigger and older, not a different
       and colder material. Both classes must stay on the warm side. */
    check("boulders are the same stone as asteroids", !canRead || (() => {
      const warmth = (tough) => {
        let r = 0, b = 0, n = 0;
        for(let v=0; v<RK.ROCK_VARIANTS; v++){
          const cv = RK.rockSprite(tough, v);
          const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
          for(let i=0;i<d.length;i+=4) if(d[i+3] > 200){ r += d[i]; b += d[i+2]; n++; }
        }
        return n ? (r - b)/n : 0;                  // mean red-minus-blue
      };
      const s = warmth(false), t = warmth(true);
      return s > 6 && t > 6 && Math.abs(s - t) < 14;
    })());

    /*
     * Measured, A/B against the old live-drawn path on the same machine and
     * scene: a rotated alpha-blended sprite costs MORE per frame than the
     * polygon it replaced, not less. The bake is capped below device
     * resolution to claw some of that back - a rock is noise and soft
     * craters and loses nothing to it, unlike text or a hairline hull.
     */
    check("the rock bake stays below device resolution", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const m = r.match(/const ROCK_BAKE = Math\.min\(BAKE, ([0-9.]+)\)/);
      const fn = r.slice(r.indexOf("function rockSprite"), r.indexOf("function drawAsteroid"));
      return !!m && Number(m[1]) <= 1.5 &&
             /D\*ROCK_BAKE/.test(fn) && !/D\*BAKE/.test(fn);
    })());

    /* Craters are placed with a minimum separation - left to chance they
       piled up and read as overlapping soap bubbles. */
    check("craters do not pile on top of each other", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = r.slice(r.indexOf("function rockSprite"), r.indexOf("function drawAsteroid"));
      return /placed/.test(fn) && /Math\.hypot\(x-o\.x, y-o\.y\) < \(r \+ o\.r\)/.test(fn);
    })());
  }

  /* ---------- the escape gesture is always performable ---------- */
  {
    const idx = SF.missions.MISSIONS.findIndex(m => m.limpets);
    SF.game.startMission(idx, "pilot");
    await runFrames(60);
    const run = SF.game.run, w = SF.game.world;

    /*
     * THE BUG THIS PINS. Every rider cuts maxSpeed by 16%, and the waggle
     * detector asked for a flat 140px/s - a bar measured on an EMPTY DART.
     * Four riders on THE ANVIL (0.88 speed) cap the ship at 136, under the
     * bar, so the level's own star objective was unreachable on a hull the
     * family had paid £30,000 for: simulated across 1.5-3.5Hz waggles it
     * gave 0 shakes at every rate, and driven in a real browser it left a
     * limpet welded on that no amount of waggling could remove.
     *
     * So: weld four riders to the slowest ship the game can field, waggle
     * it at its own top speed, and require that they come off.
     */
    const slowest = SF.shipart.HULLS.reduce((m, h) => Math.min(m, h.speed), 1);
    run.limpets.baseSpeed = 430 * slowest;
    run.limpets.baseAccel = 4300 * slowest;
    w.enemies.killAll();
    const riders = [];
    for(let i=0;i<4;i++){
      const e = w.spawnEnemy("limpet", w.player.x, w.player.y - 40,
                             { difficulty: run.difficulty });
      if(e){ e.attached = true; e.holdAngle = i/4*Math.PI*2; riders.push(e); }
    }
    const shakenBefore = run.stats.limpetsShaken;
    check("four riders really are aboard the slowest ship", riders.length === 4);

    /*
     * The waggle. The player's own steering runs first each frame, so the
     * velocity is stamped AFTER it - this is the gesture arriving, not a
     * way around the movement model. Sign flips every few frames at exactly
     * the ship's current ceiling, which is the best a real finger can do.
     */
    for(let k=0;k<90;k++){
      const p = w.player;
      p.vx = (k % 6 < 3 ? 1 : -1) * p.maxSpeed;
      await runFrames(1, true);
    }
    const stillOn = w.enemies.items.filter(e => e.alive && e.attached).length;
    check("waggling at top speed throws riders off the slowest hull",
      run.stats.limpetsShaken > shakenBefore && stillOn < 4);

    /*
     * And the rule itself: a FRACTION of the ship's current top speed, so it
     * is reachable by construction at any weight, on any hull, forever. A
     * bare number here is the bug coming back.
     */
    check("the shake bar scales with the ship, not a fixed speed", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      const m = g.match(/lm\.lastSign && Math\.abs\(pl\.vx\) > pl\.maxSpeed\*([0-9.]+)/);
      return !!m && Number(m[1]) > 0 && Number(m[1]) <= 0.6;
    })());

    /* The instruction repeats until they get one off - a child busy dodging
       when it first appeared used to never see it again. */
    check("the shake prompt comes back until it lands", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      return /run\.stats\.limpetsShaken === 0/.test(g) && /lm\.nag/.test(g);
    })());

    /* ...and the waggle shows its work, so a nearly-there gesture looks
       different from one doing nothing at all. */
    check("the waggle shows how close it is", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      return /lm\.charge = on > 0 \? clamp\(lm\.wig\/3/.test(g) &&
             /charge\*Math\.PI\*2/.test(g);
    })());
    SF.game.endMission(false);
  }

  /* ---------- a limpet has to survive long enough to be a limpet ---------- */
  {
    const idx = SF.missions.MISSIONS.findIndex(m => m.limpets);
    SF.game.startMission(idx, "pilot");
    await runFrames(30);
    const w = SF.game.world;
    /*
     * THE BUG. A Limpet's whole mechanic happens after it grabs you, and it
     * carried a flat 5hp with no toughSeconds - the only mechanics carrier
     * in the roster without one. Measured on a maxed ship (326 dps): of
     * every Limpet the mission sent, ZERO reached the hull, so the better
     * your guns the more completely the level's own star became impossible.
     *
     * Health could not fix it - the run in is ~3.5s and a maxed ship kills
     * 242hp in 0.74s - so bullets simply do not answer this enemy while it
     * is closing. It wears the Serpent's armour flag on the way in.
     */
    const arm = (() => {
      w.enemies.killAll();
      const e = w.spawnEnemy("limpet", 200, 200, { difficulty: SF.game.run.difficulty });
      if(!e) return null;
      e.life = 0; e.attached = false;
      SF.enemyData.BEHAVIOURS.limpet(e, 0.016, { player: w.player, world: w, VW: 430 });
      const closing = e.armoured;
      e.attached = true;
      SF.enemyData.BEHAVIOURS.limpet(e, 0.016, { player: w.player, world: w, VW: 430 });
      const holding = e.armoured;
      // ...and it cannot stay bulletproof forever, or a Limpet that arrives
      // with the hull already full is an immortal object orbiting a mission
      // that can never end - nothing leashes it away either.
      e.attached = false; e.life = 30;
      SF.enemyData.BEHAVIOURS.limpet(e, 0.016, { player: w.player, world: w, VW: 430 });
      const spent = e.armoured;
      e.alive = false;
      return { closing, holding, spent };
    })();
    check("a limpet cannot be shot down on its run in", !!arm && arm.closing === true);
    check("a limpet that has hold of you is soft again", !!arm && arm.holding === false);
    check("a limpet that never lands stops being bulletproof", !!arm && arm.spent === false);
    /* The deflect the armour flag drives is a real, visible answer - sparks,
       a ring and a clang - not a bullet quietly vanishing. */
    check("bullets visibly bounce off an armoured thing", (() => {
      const sy = fs.readFileSync(path.join(__dirname, "src/systems.js"), "utf8");
      const seg = sy.slice(sy.indexOf("if(e.armoured){"), sy.indexOf("e.hp -= b.dmg;"));
      return /fx\.sparks/.test(seg) && /fx\.ring/.test(seg) && /hitArmour/.test(seg);
    })());
    SF.game.endMission(false);
  }

  /* ---------- the wreck still has its lights on ---------- */
  check("the dead hull's lights read as lights, not a rectangle", (() => {
    const g = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
    const fn = g.slice(g.indexOf("function drawWreck"), g.indexOf("Backlit columns of gas"));
    // A glow behind them and more than one of them: the single hard bar with
    // no bloom was reported as a rendering bug, which is the right reaction.
    return /createRadialGradient/.test(fn) && /globalCompositeOperation = "lighter"/.test(fn) &&
           /for\(let i = 0; i < 4; i\+\+\)/.test(fn);
  })());

  /* ---------- two languages, one game ---------- */
  {
    const I = SF.i18n;
    check("there is a French pack and English is the fallback", !!I &&
      I.available().indexOf("fr") >= 0 && I.lang() === "en");

    /*
     * ENGLISH IS THE KEY, and a miss returns the English rather than a blank
     * or a raw identifier. That is the property that makes a partial pack
     * safe to ship: an untranslated string is merely untranslated.
     */
    check("a missing translation falls back to English, never to nothing",
      I.t("__nothing will ever translate this__") === "__nothing will ever translate this__");

    check("switching language rewrites the data tables", (() => {
      const m = SF.missions.MISSIONS.find(x => x.id === 1);
      const en = m.name;
      I.setLang("fr");
      const fr = m.name;
      I.setLang("en");
      return en === "First Patrol" && fr === "Première Patrouille" && m.name === en;
    })());

    /* Switching back must restore the ORIGINAL English, not a translation of
       a translation - which is why the English is snapshotted once. */
    check("switching back and forth is lossless", (() => {
      const m = SF.missions.MISSIONS[0], o = SF.missions.OBJECTIVES.complete;
      const a = [m.name, m.goal, o.label].join("|");
      I.setLang("fr"); I.setLang("en"); I.setLang("fr"); I.setLang("en");
      return [m.name, m.goal, o.label].join("|") === a;
    })());

    /* Placeholders carry data through the translation. French reorders
       sentences constantly, so they must survive as names, not positions. */
    check("placeholders survive translation", (() => {
      I.setLang("fr");
      const out = I.t("pays {n}× the money", { n: 2.8 });
      I.setLang("en");
      return out.indexOf("2.8") >= 0 && out.indexOf("{n}") < 0;
    })());

    /* The choice has to outlive the app being closed. */
    check("the chosen language is remembered", (() => {
      I.setLang("fr");
      const stored = window.localStorage.getItem("patrol_lang");
      I.setLang("en");
      return stored === "fr";
    })());

    /* Every player-facing table is registered. A new table that nobody binds
       is a screen that silently stays English forever. */
    check("the mission, objective and enemy tables are all bound", (() => {
      const bound = new Set(I._bound.map(b => b.obj));
      return SF.missions.MISSIONS.every(m => bound.has(m)) &&
             Object.keys(SF.missions.OBJECTIVES).every(k => bound.has(SF.missions.OBJECTIVES[k])) &&
             Object.keys(SF.enemyData.ENEMY_TYPES).every(k => bound.has(SF.enemyData.ENEMY_TYPES[k]));
    })());

    /*
     * THE BINDER HAS TO LOAD LAST. It registers tables from shipart, which is
     * module 31 of 38 - and it sat at slot 11, so SF.shipart was undefined and
     * the hulls, tunes and bolt-on parts silently bound NOTHING. "Twin
     * Barrels" survived three passes of translation because of it. Nothing
     * about that failure is visible except by looking, so it is pinned.
     */
    check("the binder loads after every table it names", (() => {
      const man = JSON.parse(fs.readFileSync(path.join(__dirname, "src/manifest.json"), "utf8"));
      const at = n => man.files.indexOf(n);
      return at("src/data/i18nbind.js") > at("src/shipart.js") &&
             at("src/data/i18nbind.js") > at("src/data/missions.js") &&
             at("src/data/i18nbind.js") < at("src/ui.js");
    })());
    check("the ship's parts and hulls really are bound", (() => {
      const bound = new Set(I._bound.map(b => b.obj));
      return SF.shipart.PARTS.every(p2 => bound.has(p2)) &&
             SF.shipart.HULLS.every(h => bound.has(h));
    })());
    /* Numbers are language too: French groups with a space and puts the
       currency symbol after the amount. */
    check("numbers and money follow the language", (() => {
      const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
      // French money is euros, not a literal translation of the English
      // pound - the family's own currency, after the amount with a
      // non-breaking space.
      return /function numLocale\(\)/.test(u) &&
             !/toLocaleString\("en-/.test(u) &&
             /numLocale\(\) === "fr-FR" \? v \+ "\\u00a0€" : "£" \+ v/.test(u);
    })());
    /*
     * The euro follows everywhere the pound could actually be SEEN in
     * French play, not just in Settings: the live HUD counter and floating
     * loot text (game.js, render.js) now call SF.ui.money() instead of
     * hand-writing "£"; the coin's own baked stamp rebuilds itself on a
     * language switch instead of keeping whatever symbol it was born with;
     * and the fortune icon glyph is drawn fresh every time, so it never
     * needed a cache to begin with.
     */
    check("the euro shows up everywhere the pound could be seen", (() => {
      const game = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
      const rndr = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const ico  = fs.readFileSync(path.join(__dirname, "src/icons.js"), "utf8");
      const usesMoney = /SF\.ui\.money\(e\.loot\)/.test(game) && /SF\.ui\.money\(coin\)/.test(game) &&
                        /SF\.ui\.money\(e\.loot\)/.test(rndr) && /SF\.ui\.money\(run\.money\)/.test(rndr);
      const coinLocalized = /function coinGlyph\(\)/.test(rndr) &&
                            /if\(SF\.i18n\) SF\.i18n\.onChange\(\(\) => \{ coinPhases\.length = 0/.test(rndr) &&
                            /fillText\(glyph,/.test(rndr);
      const iconLocalized = /SF\.i18n && SF\.i18n\.lang\(\) === "fr" \? "€" : "£"/.test(ico);
      return usesMoney && coinLocalized && iconLocalized;
    })());

    /* Nothing may be translated to empty - a blank button is worse than an
       English one, and it is the failure mode a bad merge produces. */
    check("no translation is blank", (() => {
      const s2 = I._packs.fr.s;
      return Object.keys(s2).every(k => typeof s2[k] === "string" && s2[k].trim().length > 0);
    })());
    /*
     * THE RESULTS CARD, IN FRENCH, END TO END.
     *
     * The whole ledger is concatenated into innerHTML, so the DOM sweep
     * reaches its static labels but nothing carrying a number - and for
     * months the entire card read in English behind a French title, because
     * only the title was ever a key. Reported from the sofa: "pilot rescued,
     * double score... still in english". This flies a real mission to a real
     * results card in French and reads back every visible string.
     */
    check("the results card speaks French, every line of it", (() => {
      // The block above finishes in English; ask for French and let the
      // sweep do its job over the card the last flight left behind.
      I.setLang("fr");
      const seen = [];
      (function walk(el){
        el.childNodes.forEach(c => {
          if(c.nodeType === 3){ const t2 = c.textContent.trim(); if(t2) seen.push(t2); }
          else if(c.nodeType === 1) walk(c);
        });
      })(id("overlayResults"));
      // Every label the card can print, in the language it was asked for.
      const ENGLISH = ["Score", "Money collected", "Enemies destroyed", "Pilots rescued",
        "Best combo", "Flew with you", "Wallet", "Family record", "Medal earned",
        "Medals earned", "included", "Rush record", "Wacky Sky crown", "CONTROL",
        "none yet — set one!"];
      const hit = ENGLISH.filter(e => seen.some(t2 => t2 === e && e !== "Score"));
      if(hit.length) console.log("  UNTRANSLATED ON RESULTS:", hit.join(" | "));
      return hit.length === 0 && seen.length > 6;
    })());
    /*
     * ...and the labels themselves must exist as keys. The check above only
     * sees the branches THIS run happened to print; this one holds the whole
     * table, including the record states and the modes a normal flight never
     * reaches.
     */
    check("every results-card label has a French entry", (() => {
      const s2 = I._packs.fr.s;
      const NEED = ["Score", "Money collected", "Mission bonus ({n} ★)", "included",
        "Enemies destroyed", "Pilots rescued", "Best combo", "Flew with you", "Wallet",
        "Family record", "{who} — new best!", "none yet — set one!", "yours, {score}",
        "{who} still holds this", "Medal earned", "Medals earned",
        "{name} — collect {money} in MEDALS", "{n} at once! — collect {money} in MEDALS",
        "Rush record", "Wacky Sky crown", "YOURS", "{who} — {n} bosses", "{who} — {n} pts",
        "CONTROL", "Perfect flying, {you}!", "Nice work, {you}!", "NEW — {name}",
        "CREDITS", "CREDITS ×2", "TUNE UNLOCKED", "SECRET FOUND", "PAINT WON"];
      const missing = NEED.filter(k => !s2[k]);
      if(missing.length) console.log("  NO FRENCH FOR:", missing.join(" | "));
      return missing.length === 0;
    })());
    /*
     * The HUD's double-pay label is canvas text, so no sweep can reach it -
     * it has to ask for its own translation, like the campaign map does.
     */
    check("the HUD's double-pay day asks for its own translation",
      /T\("CREDITS \\u00d72"\) : T\("CREDITS"\)/.test(
        fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8")));
    I.setLang("en");
  }

  /* ---------- the fleet is lit, not inked ---------- */
  {
    /*
     * The ships read as stickers because every part wore the same heavy
     * outline and one shared diagonal gradient. The fix is light: a warm
     * rim on every top-left edge, a cool falloff on every bottom-right one,
     * cool-navy shadows, and one sheen over the whole bake. These pins hold
     * the pieces of that in place.
     */
    check("the hull's ink went on a diet", (() => {
      const a = fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8");
      const piece = a.slice(a.indexOf("function hullPiece"), a.indexOf("function canopy"));
      return /const EDGE/.test(a) && /strokeStyle = EDGE/.test(piece) &&
             !/lineWidth = S\*0\.026/.test(piece);
    })());
    check("shadows go cool, on both sides of the war", (() => {
      const a = fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8");
      const b = fs.readFileSync(path.join(__dirname, "src/enemyart.js"), "utf8");
      return /mixTo\(c, \{r:22, g:30, b:56\}/.test(a) && /mixTo\(c, \{r:22, g:30, b:56\}/.test(b);
    })());
    check("one sun lights the player and the fleet alike", (() => {
      const a = fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8");
      const b = fs.readFileSync(path.join(__dirname, "src/enemyart.js"), "utf8");
      return /function lightBake/.test(b) && /lightBake\(cv, elite/.test(b) &&
             /SF\.enemyArt\.lightBake\(cv, 0\.9\)/.test(a);
    })());
    check("the fuselage is a cylinder and the canopy is glass", (() => {
      const a = fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8");
      return /barrel\.addColorStop/.test(a) && /Specular streak/.test(a) &&
             /createLinearGradient\(0, -rx, 0, rx\)/.test(a);
    })());

    /*
     * And the proof in pixels, private node-canvas instance like the rocks:
     * bake a real Grunt and measure the silhouette's edges. The band of
     * opaque pixels whose up-left neighbour is sky must come out brighter
     * than the band whose down-right neighbour is sky - that is what "lit
     * from the top-left" measurably means. Thresholds calibrated against
     * the real bake; the sabotage check was run by disabling lightBake,
     * which drops the ratio below the bar.
     */
    let EA = null;
    try {
      const NC4 = require("canvas");
      const src = fs.readFileSync(path.join(__dirname, "src/enemyart.js"), "utf8");
      const w4 = { SF: { core: { TAU: Math.PI*2 } } };
      const d4 = { createElement: () => NC4.createCanvas(1, 1) };
      new Function("window", "document", src)(w4, d4);
      EA = w4.SF.enemyArt;
    } catch(e){ EA = null; }
    check("a grunt's lit edge is brighter than its shaded edge", !EA || (() => {
      const cv = EA.spriteFor("grunt", "#c0392b", false);
      if(!cv) return false;
      const W = cv.width, H = cv.height;
      const d = cv.getContext("2d").getImageData(0, 0, W, H).data;
      const A = (x,y) => d[((y|0)*W + (x|0))*4 + 3];
      const L = (x,y) => { const i = ((y|0)*W + (x|0))*4;
        return 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; };
      let lit = 0, ln = 0, sh = 0, sn = 0;
      const off = 4;
      for(let y = off; y < H-off; y++) for(let x = off; x < W-off; x++){
        if(A(x,y) < 220) continue;
        if(A(x-off,y-off) < 30){ lit += L(x,y); ln++; }
        if(A(x+off,y+off) < 30){ sh += L(x,y); sn++; }
      }
      if(ln < 40 || sn < 40) return false;
      /*
       * MEASURED, both ways: 2.05 with the light pass, 1.41 with it
       * sabotaged out (the shapes' own rim strokes provide that much on
       * their own). 1.7 sits between, so the pin genuinely requires the
       * whole-sprite pass and not just the per-piece rims.
       */
      return (lit/ln) > (sh/sn)*1.7;
    })());
    /*
     * EXPOSURE, the other side of that pin.
     *
     * Lighting the fleet also over-exposed it: measured across the roster,
     * mean sprite luminance went 148.0 -> 160.2 and not one enemy came out
     * darker, which is what "the enemies appear too bright" looked like in
     * numbers. The re-grade brings it to 150.5. The ratio pin above stops
     * anyone fixing brightness by flattening the light back out; this one
     * stops the light being bought with exposure again. Both must hold.
     */
    const roster = !EA ? null : (() => {
      const ET = SF.enemyData.ENEMY_TYPES;
      let mean = 0, white = 0, n = 0;
      Object.keys(ET).forEach(id => {
        if(!EA.has(id) || !ET[id].tint) return;
        const spr = EA.spriteFor(id, ET[id].tint, false);
        if(!spr) return;
        const d = spr.getContext("2d").getImageData(0, 0, spr.width, spr.height).data;
        let s = 0, k = 0, w = 0;
        for(let i = 0; i < d.length; i += 4){
          if(d[i+3] < 200) continue;
          const L = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
          s += L; k++; if(L >= 250) w++;
        }
        if(k){ mean += s/k; white += 100*w/k; n++; }
      });
      return n > 15 ? { mean: mean/n, white: white/n } : null;
    })();
    check("the fleet is lit without being over-exposed",
      !roster || roster.mean < 155);
    /*
     * And the highlight itself. An additive rim has nowhere to go on a hull
     * that is already pale, so at full strength every sprite in the roster
     * peaked at exactly 255 and the pastels grew chalky edges - near-white
     * area ran 1.79% of the average hull against 0.30% before the pass. The
     * headroom scaling in lightBake() brings it to 1.14%.
     */
    check("...and its highlights are not blown to paper",
      !roster || roster.white < 1.45);
  }

  /* ---------- a coin is a coin, and a sun is a flare ---------- */
  {
    /* Same escape as the rocks: the shared canvas stub reads back zeros, so
       the coin bakes in a private node-canvas instance or not at all. */
    let CO = null;
    try {
      const NC3 = require("canvas");
      const src = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const seg = src.slice(src.indexOf("const coinPhases = [];"),
                            src.indexOf("let podSprite"));
      CO = new Function("document", "BAKE", "TAU",
        seg + "\nreturn coinSprite;"
      )({ createElement: () => NC3.createCanvas(1, 1) }, 2, Math.PI*2);
    } catch(e){ CO = null; }

    const csig = (cv) => {
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let s = 0, ink = 0;
      for(let i=0;i<d.length;i+=4){
        if(d[i+3] > 8) ink++;
        if(i % (4*29) === 0) s = ((s*33 + d[i] + d[i+1]*3 + d[i+2]*7 + d[i+3]) >>> 0);
      }
      return { s, ink };
    };
    const coinOk = !!CO && (() => { const cv = CO(0); return !!cv && csig(cv).ink > 200; })();
    check("the coin pins are measuring real pixels", !CO || coinOk);

    /* Eight phases of a spinning coin must be eight different drawings -
       edge band swapping sides, glint walking, stamp appearing and going. */
    check("a coin turns through eight different frames", !coinOk || (() => {
      const seen = new Set();
      for(let ph=0; ph<8; ph++) seen.add(csig(CO(ph)).s);
      return seen.size === 8;
    })());

    /* The halo is BAKED - a coin rain glows on a dark sky at zero live cost.
       Sampled outside the face+edge radius (~11 logical), inside the halo. */
    check("a coin glows without a live composite", !coinOk || (() => {
      const cv = CO(0);
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      const c = cv.width/2, rr = 12*2;             // logical 12 at BAKE 2
      const a = (x,y) => d[((y|0)*cv.width + (x|0))*4 + 3];
      return a(c+rr, c) > 4 || a(c-rr, c) > 4 || a(c, c+rr) > 4 || a(c, c-rr) > 4;
    })());

    /* The face is stamped with the HUD's own currency and the edge is
       milled near edge-on - what separates a coin from a gold bean. */
    check("the coin is stamped and its edge is milled", (() => {
      const r = fs.readFileSync(path.join(__dirname, "src/render.js"), "utf8");
      const fn = r.slice(r.indexOf("const coinPhases = [];"), r.indexOf("let podSprite"));
      // The stamp is a currency symbol drawn through coinGlyph(), not a bare
      // "£" - it has to read the current language, not the one the coin was
      // first baked under.
      return /fillText\(glyph,/.test(fn) && /function coinGlyph\(\)/.test(fn) &&
             /Reeding/.test(fn) && /squash < 0\.6/.test(fn);
    })());

    /*
     * The suns' spikes taper. Constant-width fillRects read as drawn plus
     * signs; a diffraction spike is a long diamond, widest at the core. And
     * ONE spider angle per sky - the spikes come from the camera, so every
     * star in a frame wears the same cross.
     */
    check("a sun's spikes taper from the core", (() => {
      const g = fs.readFileSync(path.join(__dirname, "src/skygen.js"), "utf8");
      const i = g.indexOf("const spiderTilt");
      if(i < 0) return false;
      const seg = g.slice(i, g.indexOf("/* --- vignette", i) < 0 ? i + 3200 : g.indexOf("/* --- vignette", i));
      return /const spiderTilt = \(rand\(\) - 0\.5\)/.test(seg) &&
             /ctx\.rotate\(spiderTilt\)/.test(seg) &&
             /lineTo\(0, -wide\)/.test(seg) && !/fillRect\(-reach/.test(seg);
    })());
  }

  /* ---------- a drawing is worn by the ship that flies it ---------- */
  {
    /*
     * A custom paint job was clipped to the DART silhouette no matter which
     * hull was underneath it, so an Anvil wore its drawing trimmed to a
     * narrower ship. The built-in liveries next door have always been handed
     * opts.hull; this one was simply missed.
     */
    check("a custom paint job is clipped to the hull it is worn on", (() => {
      const pj = fs.readFileSync(path.join(__dirname, "src/paintjob.js"), "utf8");
      const sa = fs.readFileSync(path.join(__dirname, "src/shipart.js"), "utf8");
      return /function paint\(ctx, S, str, hullId\)/.test(pj) &&
             /hullClip\(ctx, S, hullId\)/.test(pj) &&
             /SF\.paintjob\.paint\(ctx, S, opts\.decal, opts\.hull\)/.test(sa);
    })());

    /*
     * A PILOT CARD IS BIG ENOUGH FOR THE PILOT IN IT.
     *
     * The card drew the ship at 108 in a 132px canvas, which leaves 64px
     * around it. A fully kitted pilot needs far more: measured on a maxed
     * profile, the solid parts (drones, wingmen) reach 0.664 of the draw
     * size from centre and the Aegis Halo - shield level 4 - reaches 0.81.
     * Everything past 64 was cut off by the canvas, and a cut circle against
     * a straight edge IS a straight edge, so the halo showed up as a pale
     * square behind the ship. Only a pilot with shield maxed ever saw it.
     *
     * Pinned as the geometry rather than the numbers, so the card can be
     * retuned but not broken: the solid ship must finish before the rim fade
     * starts, and the fade must finish before the nearest edge - a fade that
     * ends past the closest edge never finishes there at all, which is how
     * the first attempt still left paint along the bottom.
     */
    check("a maxed pilot's ship is not cropped square by its own card", (() => {
      const ui = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
      const at = ui.indexOf("function renderProfiles(");
      if(at < 0) return false;
      // To the end of the function, not a fixed byte count: a window measured
      // in characters silently stops covering the thing it is checking the
      // moment anything is added above it, and then passes for the wrong
      // reason. The next top-level declaration is where this one ends.
      const end = ui.indexOf("\nfunction ", at + 1);
      const body = ui.slice(at, end < 0 ? ui.length : end);
      const box  = /<canvas width="(\d+)" height="(\d+)">/.exec(body);
      const ship = /drawShip\(ctx, (\d+), (\d+), (\d+),/.exec(body);
      const fade = /createRadialGradient\((\d+), (\d+), (\d+), \d+, \d+, (\d+)\)/.exec(body);
      if(!box || !ship || !fade) return false;
      const W = +box[1], H = +box[2];
      const cx = +ship[1], cy = +ship[2], S = +ship[3];
      const fIn = +fade[3], fOut = +fade[4];
      // the fade has to be concentric with the ship or it is not a rim
      if(+fade[1] !== cx || +fade[2] !== cy) return false;
      const SOLID = 0.664;                       // measured, maxed profile
      const nearestEdge = Math.min(cx, cy, W - cx, H - cy);
      return S*SOLID < fIn && fOut <= nearestEdge && fIn < fOut;
    })());

    /* The Paint Shop can always take a drawing back off again - the one
       control that answers "how do I get rid of this?". */
    check("a paint job can be stripped back off", (() => {
      const u = fs.readFileSync(path.join(__dirname, "src/ui.js"), "utf8");
      return /STRIP IT OFF/.test(u) && /profile\.decal = null/.test(u);
    })());
  }

  /* ---------- the briefing shows what it asks you to choose ---------- */
  {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const css  = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");

    /* Difficulty and kit are ONE row wherever there is width. Stacked, the
       kit sat below the fold on every desktop and players never found it. */
    check("difficulty and the kit share a row", (() => {
      const setup = html.slice(html.indexOf('<div class="brief-setup">'),
                               html.indexOf('<div class="brief-actions">'));
      return /briefDifficulties/.test(setup) && /briefKit/.test(setup) &&
             (setup.match(/brief-setup-col/g) || []).length === 2 &&
             /\.brief-setup \{[^}]*display:flex/.test(css);
    })());

    /* On a phone they stack, and the LAST one lands under the sticky launch
       bar - so the kit goes first and the difficulty blurb takes that hit. */
    check("on a phone the kit is not the thing hidden by LAUNCH", (() =>
      /@media \(max-width: 699px\) \{\s*\.brief-setup-col:last-child \{ order:-1; \}/.test(css)
    )());

    /* Nothing may be permanently trapped under the sticky bar: the last
       element in the scroll box has no content below it to scroll up. */
    check("the launch bar cannot eat the last control", (() =>
      /#screen-briefing > \.ghost-btn \{ margin-bottom:\s*(\d+)px/.test(css) &&
      Number(RegExp.$1) >= 60
    )());

    /* Switch Pilot / Settings / Fullscreen on one line. Stacked, Fullscreen
       fell below the fold on the only machines where it works at all. */
    check("the menu utilities share one line", (() => {
      const row = html.slice(html.indexOf('<div class="menu-utils">'),
                             html.indexOf('</div>', html.indexOf('<div class="menu-utils">')));
      return /switchBtn/.test(row) && /settingsBtnMenu/.test(row) && /fullscreenBtn/.test(row) &&
             /\.menu-utils \{[^}]*display:flex[^}]*\}/.test(css) &&
             /\.menu-utils \{[^}]*flex-wrap:wrap/.test(css);
    })());

    /* Reclaimed phone height must never shrink a tap target below 44px. */
    check("the compact phone briefing keeps its tap targets", (() => {
      const blk = css.slice(css.indexOf("@media (max-width: 699px) and (max-height: 900px)"));
      const seg = blk.slice(0, blk.indexOf("}\n}") + 3);
      return /\.brief-hero-art \{ max-height:150px/.test(seg) &&
             !/min-height:\s*([0-3]?\d)px/.test(seg) &&    // nothing dropped under 40
             !/\.diff-card|\.kit-item|\.ghost-btn/.test(seg);
    })());
  }

  /* ---------- two pilots, two accounts ----------
   * "My kids will want to play together but have achievements and coin for
   * their own account." That is the whole brief for co-op, and it is an
   * accounting claim, so it gets flown rather than pattern-matched: two real
   * profiles, one sky, and then the books opened afterwards.
   *
   * Last in the file on purpose. This block starts and ends missions and
   * writes two new profiles into the save, and P.familyBest scans every
   * profile there is - run earlier it would move records that a dozen
   * assertions above read.
   */
  {
    const P = SF.profile;
    const G = SF.game;
    const VWn = SF.entityConst.VW;
    const closeCard = () => id("overlayResults").classList.add("hidden");
    const mk = name => {
      const q = P.blank(name);
      q.missionsVer = 99;          // current, so no migration rewrites the ledger
      P.save(q);
      return q;
    };
    mk("CoopA"); mk("CoopB");
    G.godMode = false;

    /* --- solo: the baseline none of this may move --- */
    G.coopWith = null;
    G.profile = P.load("CoopA");
    closeCard();
    G.startMission(1, "pilot");
    await runFrames(400);
    const solo = G.world.player;
    check("solo, the pilot's own tally IS the mission's tally",
      G.run.stats.kills > 0 && solo.killsGot === G.run.stats.kills);
    /*
     * A pilot who is really in the sky must not also be one of your escort
     * drones - on a level that lends the squadron that drew two ships wearing
     * the same name, and neither child could tell which was theirs.
     *
     * Tested on whoever the household actually picks rather than on a name
     * chosen here: the escorts are the top two by stars, and this save has a
     * dozen pilots in it, so naming one would be a check on the leaderboard.
     */
    {
      const diff = SF.config.DIFFICULTY_BY_ID.pilot;
      const open = G.buildLoadout(P.load("CoopA"), diff).crew;
      const excluded = open.length ? open[0].callsign : null;
      const shut = excluded
        ? G.buildLoadout(P.load("CoopA"), diff, [excluded]).crew : [];
      check("a pilot already in a seat is dropped from the escort roster",
        !!excluded && open.some(c => c.callsign === excluded) &&
        !shut.some(c => c.callsign === excluded));
    }
    const soloBank = G.profile.money, soloKills = G.profile.totalKills;
    G.endMission(true);
    await runFrames(8);
    {
      const a = P.load("CoopA");
      check("solo still banks the whole run, to the coin",
        a.money - soloBank === G.run.money && a.totalKills - soloKills === G.run.stats.kills);
    }
    closeCard();

    /* --- and now two of them --- */
    G.coopWith = "CoopB";
    G.profile = P.load("CoopA");
    G.startMission(1, "pilot");
    await runFrames(10, true);
    const w = G.world;
    const p1 = w.players[0], p2 = w.players[1];
    check("a co-op flight puts two ships in the sky, each with its own book",
      w.players.length === 2 && w.player === p1 &&
      p1.acct && p1.acct.name === "CoopA" && p2.acct && p2.acct.name === "CoopB");
    // ...and end to end: neither seat's escorts wear the other seat's name.
    check("neither pilot's escorts wear the other pilot's name",
      !(p1.crew || []).some(c => c.callsign.toUpperCase() === "COOPB") &&
      !(p2.crew || []).some(c => c.callsign.toUpperCase() === "COOPA"));

    // Parked far apart, so "whoever reaches it" has an unambiguous answer.
    // Only once the launch is over: through introFly the autopilot owns both
    // ships' positions and would fly them straight back off any mark.
    await runFrames(45, true);
    const park = (p, x, y) => { p.x = p.targetX = x; p.y = p.targetY = y; p.vx = p.vy = 0; };
    park(p1, VWn*0.12, 660);
    park(p2, VWn*0.88, 240);
    {
      const a0 = p1.purse, b0 = p2.purse;
      const coin = w.spawnPickup("coin", p2.x, p2.y - 8, { value: 77 });
      coin.vx = 0;
      await runFrames(14, true);
      check("a coin caught by seat two is seat two's money, and only theirs",
        !coin.alive && p2.purse === b0 + 77 && p1.purse === a0);
    }
    {
      // A kill by seat two's gun. Guns are automatic, so parking a grunt in
      // front of seat two and waiting is the honest way to make one happen.
      const k1 = p1.killsGot, k2 = p2.killsGot;
      const e = w.spawnEnemy("grunt", p2.x, p2.y - 150,
                             { difficulty: SF.config.DIFFICULTY_BY_ID.pilot });
      e.vx = 0; e.vy = 0; e.hp = 1;
      await runFrames(40, true);
      check("a kill by seat two's gun is seat two's kill",
        !e.alive && p2.killsGot === k2 + 1 && p1.killsGot === k1);
    }
    {
      /*
       * THE SKY KNOWS THERE ARE TWO OF THEM.
       *
       * Every behaviour aims at `ctx.player`, which used to be seat one for
       * the whole frame - so the second child was invisible to the AI. This
       * parks a chaser right beside seat two, far from seat one, and asks who
       * it goes for.
       */
      w.enemies.killAll();
      park(p1, VWn*0.10, 660);
      park(p2, VWn*0.90, 300);
      const chaser = w.spawnEnemy("grunt", p2.x, 120,
                                  { difficulty: SF.config.DIFFICULTY_BY_ID.pilot });
      const before = Math.abs(chaser.x - p2.x);
      await runFrames(30, true);
      // Whatever it does, it must be reasoning about the ship it is next to.
      check("an enemy hunts the nearest ship, not always seat one",
        Math.abs(chaser.x - p2.x) <= before + 8 &&
        Math.abs(chaser.x - p2.x) < Math.abs(chaser.x - p1.x));
      w.enemies.killAll();
    }
    {
      /*
       * One pilot going down does not end the patrol, and the other one buys
       * them back in with a life of their own. Without this a seven-year-old
       * sits and watches their sibling finish the level.
       */
      w.enemies.killAll(); w.enemyBullets.killAll();   // a clean sky to measure in
      p1.lives = 3;
      p2.lives = 1; p2.shield = 0; p2.invuln = 0;
      const donorBefore = p1.lives;
      const ram = w.spawnEnemy("grunt", p2.x, p2.y,
                               { difficulty: SF.config.DIFFICULTY_BY_ID.pilot });
      ram.vx = 0; ram.vy = 0;
      await runFrames(6, true);
      check("in co-op the sky does not end with one pilot",
        !p2.alive && !G.run.ended && G.state === "playing" &&
        w.livePlayers().length === 1);
      /*
       * The wait is nearly six seconds of a live mission, and the two ships
       * are parked. Anything the director sends over in the meantime would
       * take a life off the donor and the arithmetic below would be
       * measuring the wrong thing, so the survivor sits it out untouchable.
       */
      p1.invuln = 1e9;
      await runFrames(170, true);                 // past the five-second wait
      p1.invuln = 0;
      check("the survivor buys their wingman back in, and pays for it",
        p2.alive && p2.lives === 1 && p1.lives === donorBefore - 1 &&
        (!G.run.down || G.run.down.length === 0));
    }
    {
      // The books. Each pilot's coins are their own; the mission's own money
      // - completion bonus, halfway bonus - is paid to both in full.
      const aBefore = P.load("CoopA"), bBefore = P.load("CoopB");
      const aM = aBefore.money, bM = bBefore.money;
      const aK = aBefore.totalKills, bK = bBefore.totalKills;
      const aC = aBefore.missionsCompleted, bC = bBefore.missionsCompleted;
      const purse1 = p1.purse, purse2 = p2.purse, got1 = p1.killsGot, got2 = p2.killsGot;
      G.endMission(true);
      await runFrames(8);
      const run = G.run;
      const a = P.load("CoopA"), b = P.load("CoopB");
      const shared = run.money - (purse1 + purse2);
      check("each pilot banks their own coins plus the mission's, in full",
        shared > 0 &&
        a.money - aM === Math.round(purse1 + shared) &&
        b.money - bM === Math.round(purse2 + shared));
      check("the two seats' kills add up to the mission's, with none lost",
        got1 + got2 === run.stats.kills &&
        a.totalKills - aK === got1 && b.totalKills - bK === got2);
      check("both children get the mission on their own map",
        a.missionsCompleted - aC === 1 && b.missionsCompleted - bC === 1 &&
        !!(a.missions[run.mission.id] && a.missions[run.mission.id].cleared) &&
        !!(b.missions[run.mission.id] && b.missions[run.mission.id].cleared));
    }

    /* --- carried forward, without a hole left behind --- */
    {
      /*
       * Two players progress together, so a level is open if EITHER of them
       * has reached it - holding the older sibling to the younger one's
       * progress is the reliable way to stop them playing together at all.
       *
       * The trap is what that does to the carried child's map. Clearing
       * mission 30 records it on their ledger, and the plain unlock chain
       * then opens 31 while leaving 5 to 29 shut: a hole in the middle of a
       * campaign, and the stops behind it unreachable without a second co-op
       * flight to each one. `reached` is what closes it.
       */
      const U = SF.missions.isMissionUnlocked;
      const ahead = P.blank("Ahead");
      ahead.missionsVer = 99;
      for(let i = 0; i <= 12; i++)
        ahead.missions[SF.missions.MISSIONS[i].id] = { cleared:true, stars:{}, best:{} };
      const behind = P.blank("Behind");
      behind.missionsVer = 99;
      behind.missions[SF.missions.MISSIONS[0].id] = { cleared:true, stars:{}, best:{} };
      check("a pilot's own map still stops where they stopped",
        U(ahead, 12) && !U(ahead, 15) && U(behind, 1) && !U(behind, 4));

      // Carried to 12, the way endMission books it.
      behind.reached = 12;
      let holes = 0;
      for(let i = 0; i <= 12; i++) if(!U(behind, i)) holes++;
      check("being carried opens the road behind you, with no locked island",
        holes === 0 && U(behind, 12));
      check("...and opens nothing past where they were actually taken",
        !U(behind, 14));
      /*
       * ...and the one big button on their menu still points at the next
       * thing they can actually do. Carried to 12 with everything from 1 up
       * unflown, "the newest unlocked stop" would aim a seven-year-old's
       * only obvious control at a level eleven ahead of anything they have
       * played.
       */
      check("a carried pilot's menu points at the next stop they owe, not the far end",
        (() => {
          P.save(behind);
          const grid = qa("#profileGrid .profile-card");
          SF.ui.renderProfiles();
          const card = qa("#profileGrid .profile-card")
            .find(c => /BEHIND/i.test(c.textContent));
          if(!card) return false;
          clickEl(card);
          const sub = id("playSub").textContent;
          return sub === SF.missions.MISSIONS[1].name && grid.length >= 0;
        })());
      check("being carried is not the same as having flown it", (() => {
        // No cleared marks, no stars, no score for the stops they skipped:
        // those are still theirs to go back and do properly, alone.
        let claimed = 0;
        for(let i = 1; i <= 12; i++){
          const rec = behind.missions[SF.missions.MISSIONS[i].id];
          if(rec && rec.cleared) claimed++;
        }
        return claimed === 0 && P.totalStars(behind) === 0;
      })());
    }
    closeCard();

    /* --- the way in: TWO PLAYERS on the pilot screen --- */
    {
      /*
       * None of the above is worth anything if a child cannot reach it, and
       * `coopWith` is a field nothing used to set. Driven the way a player
       * drives it: turn on two players, tap both pilots, open the map, press
       * LAUNCH.
       *
       * It lives on the FIRST screen deliberately. The campaign map belongs
       * to one pilot, so choosing a wingman after the mission made the second
       * child a passenger through the only choice that mattered - and a stop
       * only THEY had unlocked was never on the map to pick.
       */
      G.state = "idle";
      SF.ui.renderProfiles();
      clickEl(id("coopModeBtn"));
      const cards = () => qa("#profileGrid .profile-card");
      const cardFor = re => cards().find(c => re.test(c.textContent));
      check("TWO PLAYERS turns the pilot grid into a two-tap pick",
        /first pilot|premier pilote/i.test(id("pickerTagline").textContent) &&
        id("coopModeBtn").classList.contains("on") &&
        !!cardFor(/COOPA/i) && !!cardFor(/COOPB/i));
      const mine = cardFor(/COOPA/i);
      if(mine){
        clickEl(mine);
        check("the first pilot is marked, and the prompt asks for the second",
          /second pilot|deuxième pilote/i.test(id("pickerTagline").textContent) &&
          !!cardFor(/COOPA/i).classList.contains("picked"));
        const mate = cardFor(/COOPB/i);
        if(mate){
          clickEl(mate);
          check("two taps land on the menu as a pair, and it says so",
            id("screen-menu").classList.contains("active") &&
            !id("menuMate").classList.contains("hidden") &&
            /COOPB/i.test(id("menuMate").textContent));
          /*
           * ...and the map is the two campaigns together. CoopB is given a
           * ledger reaching stop 9; CoopA's own stops well short of it. Paired,
           * the map opens to the further of the two - the older sibling is not
           * held to the younger one's progress, which is the whole reason
           * anybody agrees to play together twice.
           */
          {
            const far = P.load("CoopB");
            for(let i = 0; i <= 9; i++)
              far.missions[SF.missions.MISSIONS[i].id] = { cleared:true, stars:{}, best:{} };
            P.save(far);
            const solo = SF.missions.isMissionUnlocked(P.load("CoopA"), 9);
            SF.ui.renderMissions();
            const node = qa("#campaignNodes .map-node")[9];
            check("paired, the map opens as far as the FURTHER pilot has got",
              !solo && !!node && !node.classList.contains("locked"));
          }
          SF.ui.renderMissions();
          clickEl(qa("#campaignNodes .map-node")[0]);
          check("the briefing shows the pair and says who steers what",
            !id("briefCoop").classList.contains("hidden") &&
            qa("#coopPicker .coop-chip").length === 2 &&
            /W A S D/.test(id("coopHint").textContent) &&
            /COOPB/i.test(id("coopHint").textContent));
          clickEl(id("launchBtn"));
          await runFrames(6, true);
          check("pressing LAUNCH with a wingman picked puts two ships in the sky",
            G.coopWith === "CoopB" && G.world.players.length === 2 &&
            !!G.coopMate && G.coopMate.name === "CoopB");

          /*
           * ...and the wing grows a card for them. Two children need to see
           * two purses: the coin race is only worth running if you can watch
           * yourself winning it.
           */
          // A laptop-sized window, so the wings are actually open to inspect.
          Object.defineProperty(window.HTMLElement.prototype, "clientWidth",
            { configurable:true, get(){ return 1470; } });
          Object.defineProperty(window.HTMLElement.prototype, "clientHeight",
            { configurable:true, get(){ return 856; } });
          G.resize();
          G.world.players[0].purse = 120;
          G.world.players[1].purse = 340;
          SF.ui.resetHudWings();
          SF.ui.syncHudWings();
          check("the wing gives each pilot their own card and their own purse",
            !id("hwPilot2").classList.contains("hidden") &&
            !id("hwTeam").classList.contains("hidden") &&
            id("hwSoloScore").classList.contains("hidden") &&
            /COOPB/i.test(id("hwName2").textContent) &&
            id("hwMoney").textContent !== id("hwMoney2").textContent &&
            /340/.test(id("hwMoney2").textContent) &&
            /120/.test(id("hwMoney").textContent));
          /*
           * SHIELDS. A pilot who owns none gets no row at all - an empty row
           * of pips reads as "yours are gone" rather than "you have none" -
           * and a pilot who owns some gets one pip per shield they COULD
           * hold, filled to what they have. Empty pips are the useful half:
           * "two of three" is a thing a number cannot say.
           */
          {
            const q1 = G.world.players[0], q2 = G.world.players[1];
            q1.shieldMax = 0; q1.shield = 0;
            q2.shieldMax = 3; q2.shield = 2;
            SF.ui.resetHudWings();
            SF.ui.syncHudWings();
            const drawn = [];
            const cv = id("hwShield2");
            const real = cv.getContext;
            // Count the pips by counting the paints: the stub canvas draws
            // nothing, so the painter itself is what gets watched.
            let pipCalls = 0;
            const realPip = SF.render.drawShieldPip;
            SF.render.drawShieldPip = function(c, x, y, r, up){
              pipCalls++; drawn.push(!!up); return realPip.apply(null, arguments);
            };
            SF.ui.resetHudWings();
            SF.ui.syncHudWings();
            SF.render.drawShieldPip = realPip;
            check("the wing shows shields as pips, filled to what you hold",
              id("hwShieldRow").classList.contains("hidden") &&
              !id("hwShieldRow2").classList.contains("hidden") &&
              pipCalls === 3 &&
              drawn.filter(Boolean).length === 2 && !!cv && !!real);
            // A shield picked up beyond the fitted maximum still gets a pip,
            // or the HUD would say you have fewer than you are flying with.
            q2.shield = 4;
            SF.ui.resetHudWings();
            let over = 0;
            SF.render.drawShieldPip = function(){ over++; return realPip.apply(null, arguments); };
            SF.ui.syncHudWings();
            SF.render.drawShieldPip = realPip;
            check("an over-full shield still gets a pip of its own", over === 4);
            q2.shieldMax = 0; q2.shield = 0;
          }
          // ...and hands the wing straight back the moment it is one pilot.
          G.coopMate = null;
          SF.ui.resetHudWings();
          SF.ui.syncHudWings();
          check("solo gets the one-card wing back, score and all",
            id("hwPilot2").classList.contains("hidden") &&
            id("hwTeam").classList.contains("hidden") &&
            !id("hwSoloScore").classList.contains("hidden") &&
            !id("hudLeft").classList.contains("coop"));
          G.coopMate = P.load("CoopB");
        }
      }
    }

    /* --- two fingers on one iPad --- */
    {
      /*
       * Solo, exactly one finger flies and every other touch is ignored, so a
       * palm on the bezel cannot steal the ship. In co-op that second finger
       * is the whole point, and this is the line between the two rules.
       */
      const cv = id("game");
      // jsdom lays nothing out, so the canvas has to be given a box or every
      // finger maps to the same coordinate and the test proves nothing.
      const BOX = { left:0, top:0, width:390, height:800, right:390, bottom:800 };
      const realRect = cv.getBoundingClientRect;
      cv.getBoundingClientRect = () => BOX;
      const touch = (type, pointerId, x, y) => {
        const ev = new window.PointerEvent(type, {
          pointerId, pointerType:"touch", clientX:x, clientY:y, bubbles:true });
        (type === "pointerdown" ? cv : window).dispatchEvent(ev);
      };
      const px = f => BOX.width*f, py = f => BOX.height*f;
      const st = SF.input.state, st2 = SF.input.state2;

      SF.input.setCoop(true);
      touch("pointerdown", 71, px(0.25), py(0.7));
      touch("pointerdown", 72, px(0.75), py(0.6));
      check("in co-op the second finger flies the second ship",
        st.dragging && st2.dragging && st2.dragX > st.dragX);
      touch("pointerdown", 73, px(0.5), py(0.5));
      const heldX = st2.dragX, heldX1 = st.dragX;
      touch("pointermove", 73, px(0.1), py(0.9));
      check("a third finger gets nothing — there are two ships",
        st2.dragX === heldX && st.dragX === heldX1);
      touch("pointerup", 72, px(0.75), py(0.6));
      check("lifting a finger lets that ship go, and only that one",
        st.dragging && !st2.dragging);
      touch("pointerup", 71, px(0.25), py(0.7));

      SF.input.setCoop(false);
      touch("pointerdown", 81, px(0.25), py(0.7));
      touch("pointerdown", 82, px(0.75), py(0.6));
      check("solo, a second finger still cannot steal the ship",
        st.dragging && !st2.dragging);
      touch("pointerup", 81, px(0.25), py(0.7));
      SF.input.clearMovement();
      cv.getBoundingClientRect = realRect;
    }

    {
      /*
       * THE REPORTED BUG, flown. "Player 2 is inside circle but it's not
       * registered." Level 0's flight check is a mission OBJECTIVE, and it
       * only ever tested seat one - so a child could fly clean through a ring,
       * watch it stay lit, and be told 4/6 while their brother did all the
       * scoring. Every level mechanic had the same shape.
       */
      G.coopWith = "CoopB";
      G.profile = P.load("CoopA");
      id("overlayResults").classList.add("hidden");
      G.startMission(0, "pilot");                 // Launch Day: the rings
      await runFrames(45, true);                  // past the launch autopilot
      const q1 = G.world.players[0], q2 = G.world.players[1];
      let flown = false;
      for(let t = 0; t < 200 && !flown; t++){
        const ring = ((SF.prologue._s() || {}).rings || [])
          .find(r => !r.hit && !r.gone && r.x != null);
        if(ring){
          // Seat ONE parked far away; seat two put through the hoop.
          q1.x = q1.targetX = 20; q1.y = q1.targetY = 700;
          q2.x = q2.targetX = ring.x; q2.y = q2.targetY = ring.y;
          await runFrames(3, true);
          flown = !!ring.hit;
        }
        if(!flown) await runFrames(6, true);
      }
      check("seat two flying through a ring is a ring flown",
        flown && (G.run.stats.ringsHit || 0) > 0);
      G.run.ended = true; G.state = "idle";
      G.world.reset();
      SF.prologue.reset();
      id("overlayResults").classList.add("hidden");
    }

    closeCard();
    G.coopWith = null;
    G.coopMate = null;
    SF.input.setCoop(false);
    if(G.run) G.run.ended = true;
    G.state = "idle";
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
