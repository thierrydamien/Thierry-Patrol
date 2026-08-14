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
  /*
   * Leaving the garage ends whatever ceremony was mid-flight. The show queue
   * used to survive the exit - buy something, walk away while the sparks are
   * still going, and the fitting resumed from its frozen frame days later, on
   * a ship that had long since been built.
   */
  if(id !== "screen-armory" && screens["screen-armory"] &&
     screens["screen-armory"].classList.contains("active")){
    hangar.show = null; hangar.shows.length = 0; hangar.celebrate = 0;
  }
  Object.keys(screens).forEach(k => screens[k].classList.remove("active"));
  screens[id].classList.add("active");
  if(id === "screen-game") SF.game.resize();
  if(id === "screen-profiles" || id === "screen-menu") startTitleLoop();
  // Every screen that isn't combat gets menu music - except the pilot picker,
  // which owns the title fanfare. Launch swaps in the combat track.
  if(id !== "screen-game")
    audio.setMusic(id === "screen-profiles" ? "title" : "menu");
  syncWayBack(id);
}

/* ---------------------------------------------------------
   THE WAY BACK
   The report was "my seven-year-olds don't always know how to
   get back to the previous menu", and the reason was in the
   markup: the way out was a text link called "Back to Menu",
   at the BOTTOM of each screen, in a different place on each
   one. On the Armory that means scrolling past a whole shelf
   of upgrades to leave the room. Children do not scroll to
   leave a room, and pre-readers do not find an exit by
   reading it.

   So there is now exactly ONE way out, and it never moves:
   top-left, big, an arrow AND the name of where it goes. It
   works four ways, so whichever one a child reaches for is
   the right one - the button, the crumb trail beside it, a
   swipe from the left edge, or the phone's own back gesture.
   --------------------------------------------------------- */

/*
 * Where each screen goes when you leave it, and what to call that place.
 * `run` is the screen's existing exit handler, so the way back does exactly
 * what the old button did - renders what needs rendering, in the same order -
 * rather than becoming a second, subtly different way to navigate.
 */
const WAY_BACK = {
  "screen-missions":     { to:"screen-menu",     word:"MENU",     crumbs:["MENU","CAMPAIGN"] },
  "screen-briefing":     { to:"screen-missions", word:"CAMPAIGN", crumbs:["MENU","CAMPAIGN","MISSION"] },
  "screen-armory":       { to:"screen-menu",     word:"MENU",     crumbs:["MENU","MY SHIP"] },
  "screen-achievements": { to:"screen-menu",     word:"MENU",     crumbs:["MENU","MEDALS"] },
  "screen-leaderboard":  { to:"screen-menu",     word:"MENU",     crumbs:["MENU","CHAMPIONSHIP"] },
  "screen-workshop":     { to:"screen-menu",     word:"MENU",     crumbs:["MENU","DRAWING BOARD"] },
};
/* The pilot picker is the root, the menu is home, and combat has its own
   pause button - none of them get one. */
let wayBackScreen = null;

/** The exit each screen already had, so there is one behaviour, not two. */
function goBackFrom(id){
  const w = WAY_BACK[id];
  if(!w) return false;
  audio.play("uiClick");
  if(w.to === "screen-menu"){ renderMenu(); show("screen-menu"); }
  else if(w.to === "screen-missions"){ renderMissions(); show("screen-missions"); }
  else show(w.to);
  return true;
}
/** The escape hatch: however deep you are, MENU is one visible tap away. */
function goHome(){
  if(!WAY_BACK[wayBackScreen]) return false;
  if(navDepth > 0 && typeof history !== "undefined" && history.go){
    const n = navDepth;          // drop every entry we own in one jump
    navDepth = 0;
    history.go(-n);              // async; lands on a screen with no way out
  }
  audio.play("uiClick");
  renderMenu(); show("screen-menu");
  return true;
}

function syncWayBack(id){
  wayBackScreen = id;
  const bar = $("wayBack");
  if(!bar) return;
  const w = WAY_BACK[id];
  bar.classList.toggle("hidden", !w);
  if(!w) return;
  // Entering a room that has a way out earns a history entry, so the phone's
  // back gesture leaves it. Not while the browser is already moving us -
  // that would put an entry back on the stack we are in the middle of
  // walking, and every press would land on the same screen.
  if(!inPop) pushNav();
  $("backWord").textContent = w.word;
  // The trail: MENU is always the first step and always tappable, so home is
  // one visible tap away from anywhere. The last step is where you are and is
  // not a button - a breadcrumb you can tap to "go" to where you already are
  // teaches a child that taps do nothing.
  const nav = $("crumbs");
  nav.innerHTML = "";
  const parts = w.crumbs.slice();
  if(id === "screen-briefing" && MISSIONS[selectedMissionIndex])
    parts[2] = "MISSION " + MISSIONS[selectedMissionIndex].id;
  parts.forEach((label, i) => {
    if(i) nav.appendChild(Object.assign(document.createElement("span"),
      { className:"crumb-sep", textContent:"›" }));
    const last = i === parts.length - 1;
    const el = document.createElement(last ? "span" : "button");
    el.className = "crumb" + (last ? " here" : "");
    el.textContent = label;
    if(!last) el.addEventListener("click", () => (i === 0 ? goHome() : navBack()));
    nav.appendChild(el);
  });
}

/*
 * The phone's own back gesture. Without this, Android's back and the installed
 * app's system back either did nothing or dropped the kids out of the game
 * entirely - the most frightening button on the device.
 *
 * Everything routes through navBack(), so the screen and the history stack can
 * never disagree: tapping the button walks the history back, which fires
 * popstate, which performs the screen change. One path, four triggers.
 */
let navDepth = 0;      // history entries we own
let inPop = false;     // true while the browser is already moving us

function pushNav(){
  if(typeof history === "undefined" || !history.pushState) return;
  history.pushState({ sf:1 }, "");
  navDepth++;
}
/** The one back action: the button, the crumb, the swipe and the gesture. */
function navBack(){
  if(navDepth > 0 && typeof history !== "undefined" && history.back){
    history.back();       // popstate does the screen half
    return true;
  }
  return goBackFrom(wayBackScreen);
}
if(typeof window !== "undefined" && window.addEventListener){
  window.addEventListener("popstate", () => {
    inPop = true;
    if(navDepth > 0) navDepth--;
    goBackFrom(wayBackScreen);
    inPop = false;
  });
  /*
   * A swipe in from the left edge. Kids arrive already knowing this gesture
   * from every other app on the iPad, and it costs one listener. Only the
   * first 26px start a swipe, so it can never eat a drag on the campaign map.
   */
  let sx = 0, sy = 0, live = false;
  window.addEventListener("touchstart", e => {
    const t = e.touches && e.touches[0];
    live = !!t && t.clientX < 26 && !!WAY_BACK[wayBackScreen];
    if(live){ sx = t.clientX; sy = t.clientY; }
  }, { passive:true });
  window.addEventListener("touchend", e => {
    if(!live) return;
    live = false;
    const t = e.changedTouches && e.changedTouches[0];
    if(!t) return;
    if(t.clientX - sx > 62 && Math.abs(t.clientY - sy) < 70) navBack();
  }, { passive:true });
}
function $(id){ return document.getElementById(id); }
function qa(sel){ return Array.from(document.querySelectorAll(sel)); }
/** Prices run to six figures now, so they need separators to stay readable. */
function money(n){ return "£" + Math.round(n).toLocaleString("en-GB"); }
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
/*
 * THE IN-GAME DIALOG - the themed replacement for prompt()/confirm().
 *
 * A native OS dialog was the single most prototype-feeling moment in the
 * game: unthemed system chrome over a hand-built UI, and visibly foreign on
 * an iPhone home-screen install. This is the same overlay language as the
 * story cards. ask() resolves to the entered string or null; confirmDlg()
 * to true/false. One dialog at a time - a second request while one is up
 * auto-cancels the first, which cannot happen from the UI anyway.
 */
let dialogResolve = null;
function dialog(opts){
  return new Promise(resolve => {
    if(dialogResolve) dialogResolve(null);
    dialogResolve = resolve;
    $("dialogTitle").textContent = opts.title || "";
    $("dialogText").textContent = opts.text || "";
    $("dialogText").classList.toggle("hidden", !opts.text);
    const input = $("dialogInput");
    input.classList.toggle("hidden", !opts.input);
    input.value = opts.value || "";
    input.placeholder = opts.placeholder || "";
    $("dialogOk").textContent = opts.okLabel || "OK";
    $("dialogCancel").textContent = opts.cancelLabel || "CANCEL";
    $("dialogOverlay").querySelector(".dialog-inner").classList.toggle("dialog-danger", !!opts.danger);
    $("dialogOverlay").classList.remove("hidden");
    if(opts.input) setTimeout(() => { try { input.focus(); } catch(e){} }, 60);
  });
}
function closeDialog(result){
  $("dialogOverlay").classList.add("hidden");
  const r = dialogResolve; dialogResolve = null;
  if(r) r(result);
}
function ask(title, opts){ return dialog(Object.assign({ title, input:true }, opts || {})); }
function confirmDlg(title, text, opts){
  return dialog(Object.assign({ title, text, okLabel:"YES" }, opts || {}))
    .then(v => v !== null);
}

/*
 * Post-render glyph fill: innerHTML can't embed a painted canvas, so markup
 * leaves `.lock-slot` / `[data-glyph]` placeholders and this sweeps them into
 * drawn icons. One place, so every screen's chrome is painted the same way.
 */
function fillGlyphs(root, name, color, px){
  qa2(root, ".lock-slot").forEach(slot => {
    slot.appendChild(SF.icons.el("lock", color || "rgba(255,255,255,0.75)",
      slot.classList.contains("lock-slot-lg") ? 26 : (px || 14)));
    slot.classList.remove("lock-slot");
  });
}
function qa2(root, sel){ return Array.from(root.querySelectorAll(sel)); }

/** The mute button's speaker, drawn to match the current state. */
function paintMuteBtn(){
  const btn = $("muteBtn");
  let cv = btn.querySelector("canvas");
  if(!cv){
    btn.textContent = "";
    cv = document.createElement("canvas");
    cv.width = 40; cv.height = 40;
    cv.style.width = "20px"; cv.style.height = "20px";
    btn.appendChild(cv);
  }
  SF.icons.paint(cv, audio.isMuted() ? "soundOff" : "soundOn", "#fff");
}

function click(el, fn){
  if(!el) return;
  el.addEventListener("click", (e) => { audio.play("uiClick"); fn(e); });
}

/* ---------------------------------------------------------
   TITLE ART
   The home screens used to sit on a borrowed promotional
   image, complete with somebody else's logo. This paints our
   own instead: a generated sky, a planet, and the pilot's ship
   coming at you. (The file itself is gone from assets/.)
   --------------------------------------------------------- */
/*
 * The home screens are alive, not a poster: the wing bobs, exhausts flicker
 * and a handful of stars twinkle, driven by one rAF loop that only runs while
 * a menu-bg screen is up. The sky itself stays a cached canvas - the per-frame
 * cost is four small ships and a dozen twinkles.
 */
let titleRaf = 0, titleT = 0;
/*
 * The sky really is built once. The comment above always promised a cached
 * canvas; the code was rebuilding the whole nebula - hundreds of gradients -
 * sixty times a second on the two screens kids sit on longest, which is why
 * the menus ran an iPad warm. Keyed by size so a rotation rebuilds it.
 */
const titleSky = { cv: null, key: "" };
function titleSkyFor(W, H, dpr, topH){
  const key = W + "x" + H + "@" + dpr + ":" + topH;
  if(titleSky.key !== key){
    titleSky.cv = SF.skygen.buildTitle(W, H, dpr, topH);
    titleSky.key = key;
  }
  return titleSky.cv;
}
/*
 * The backing store follows the element, at device resolution.
 *
 * It used to be a fixed 720x1000 bitmap stretched with object-fit:cover, and
 * that one line cost the first screen of the game everything: cover CROPS to
 * whatever the window's aspect happens to be, so on a laptop it ate ~90px off
 * the top - the hero ship was beheaded - and on a phone it ate the sides. The
 * middle third that survived was the part with nothing in it, which is why the
 * home screen read as "mostly empty and black". Same bitmap stretched over a
 * 3x phone was soft, too. Measure the box, match it, draw in CSS pixels.
 */
function fitTitleCanvas(cv){
  /*
   * Cover the SCROLL RUN, not the first screenful. The menu scrolls - a full
   * pilot card plus every mode pushes SETTINGS and FULLSCREEN past the fold -
   * and a backdrop sized to the viewport left everything down there sitting
   * on flat page ground. The canvas is absolutely positioned, so sizing it
   * to scrollHeight can't feed back into scrollHeight.
   */
  const sec = cv.parentElement;
  const W = Math.max(1, Math.round(sec.clientWidth));
  const H = Math.max(1, Math.round(Math.max(sec.scrollHeight, sec.clientHeight)));
  if(cv.style.height !== H + "px") cv.style.height = H + "px";
  // Capped: a 3x tablet would otherwise ask for a 30-megapixel menu backdrop.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(W*dpr), bh = Math.round(H*dpr);
  if(cv.width !== bw || cv.height !== bh){ cv.width = bw; cv.height = bh; }
  return { W, H, dpr };
}
/*
 * The wing, cached. drawTitleArt runs every frame and profiles live in
 * localStorage as JSON - loading the family sixty times a second would be
 * silly. Rebuilt whenever the pilot roster or the active pilot changes.
 */
const titleFleet = { key:"", ships:[] };
function titleFleetFor(p){
  const names = P.listNames();
  const key = names.join("|") + "::" + (p ? p.name : "");
  if(titleFleet.key !== key){
    const others = names.filter(n => !p || n !== p.name).map(n => {
      const q = P.load(n);
      return { color: q.shipColor, levels: SF.shipart.levelsOf(q),
               tune: q.tune, decal: q.decal };
    });
    // A lone pilot still gets escorts - stock hulls in squadron colours.
    while(others.length < 2)
      others.push({ color: SF.config.SHIP_COLORS[(others.length + 1) % SF.config.SHIP_COLORS.length],
                    levels: {} });
    titleFleet.key = key;
    titleFleet.ships = others;
  }
  return titleFleet.ships;
}

function drawTitleArt(canvasId, p, t){
  const cv = $(canvasId);
  const ctx = cv && cv.getContext("2d");
  if(!ctx) return;
  const { W, H, dpr } = fitTitleCanvas(cv);
  t = t || 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);       // draw in CSS pixels throughout
  ctx.clearRect(0, 0, W, H);

  // The first screenful: the show anchors here even when the menu scrolls.
  const topH = Math.min(H, Math.max(1, cv.parentElement.clientHeight || H));
  const sky = titleSkyFor(W, H, dpr, topH);
  if(sky) ctx.drawImage(sky, 0, 0, W, H);
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

  /*
   * The fleet, composed against the real frame.
   *
   * Two rules, both learned the hard way. Sizes come off the SHORT side, not
   * the width - tie a ship to W on a landscape laptop and it grows taller than
   * the band it is supposed to sit in. And every ship is clamped so its own
   * radius clears the top edge, because "it fits at 720x1000" is not the same
   * promise as "it fits".
   *
   * On a wide window the menu is a 700px column with empty gutters either
   * side, so the wing flies THERE - the black bars either side of the cards
   * were most of what made this screen feel unfinished.
   */
  const levels = p ? SF.shipart.levelsOf(p) : {};
  const col = p ? p.shipColor : "#f5a623";
  const u = Math.min(W, topH);
  const gutter = (W - Math.min(W, 700))/2;
  const wide = gutter > 120;                     // room to fly beside the menu

  /*
   * THE FORGERY, looming. The campaign's last monster hangs far off in the
   * title sky - small, dim, patient - so the menu carries a promise as well
   * as a fleet. Behind everything, and drawn dead calm: menace is stillness.
   */
  if(mapHullReady("forgery")){
    ctx.save();
    ctx.globalAlpha = 0.34;
    const fx2 = wide ? W - gutter*0.42 : W*0.82;
    const fy2 = wide ? topH*0.10 : topH*0.055;
    ctx.translate(fx2, fy2 + Math.sin(t*0.4)*3);
    drawMapHull(ctx, "forgery", u*0.20, 0, t*180);
    ctx.restore();
  }

  /*
   * The squadron is the FAMILY, not four copies of one ship: the wing flies
   * the other pilots' actual hulls in their actual paint. Falls back to
   * stock escorts in squadron colours when there is only one pilot.
   */
  const fleet = titleFleetFor(p);
  const fly = (x, y, size, seed, ship) => {
    const half = size*0.62;                                  // wingspan + glow
    SF.shipart.drawShip(ctx, clamp(x, half, W - half), Math.max(y, half + 6) +
      Math.sin(t*1.15 + seed)*u*0.006, size,
      { color: (ship && ship.color) || col, levels: (ship && ship.levels) || {},
        t: t + seed, idle:false, tune: ship && ship.tune, decal: ship && ship.decal });
  };
  const me = { color: col, levels, tune: p && p.tune, decal: p && p.decal };

  if(wide){
    // The kitted hero gets the right gutter, big, in front of the ringed
    // world. Sized off the gutter as well as the frame so it leans into the
    // cards rather than landing on them.
    fly(W - gutter*0.5, topH*0.34, Math.min(gutter*1.3, u*0.30), 1.1, me);
    [[gutter*0.50, 0.30, 0.13], [gutter*0.44, 0.62, 0.10], [W - gutter*0.55, 0.68, 0.11]]
      .forEach(([x, y, sz], i) =>
        fly(x, topH*y, Math.min(gutter*0.7, u*sz), i*2.4 + 0.6, fleet[i % fleet.length]));
  } else {
    /*
     * No gutters: the menu owns the middle of the glass, so the wing becomes
     * distant traffic across the top instead of a hero parked on the pilot
     * card. Everything is small enough to sit behind the wordmark and still
     * clear the first card - depth, not clutter.
     */
    const band = Math.min(topH*0.15, u*0.34);
    [[0.16, 0.42, 0.17], [0.83, 0.52, 0.15], [0.40, 0.20, 0.10], [0.66, 0.78, 0.12]]
      .forEach(([x, y, sz], i) =>
        fly(W*x, band*y, Math.min(u*sz, band*0.62), i*2.4 + 0.6,
            i === 0 ? me : fleet[i % fleet.length]));
  }
  // The scroll's middle third gets quiet traffic, so the road down to
  // SETTINGS isn't dead space.
  if(H > topH*1.35){
    fly(W*0.12, topH*1.15 + (H - topH)*0.35, u*0.07, 5.2, fleet[0]);
    fly(W*0.88, topH*1.05 + (H - topH)*0.62, u*0.055, 6.8, fleet[1 % fleet.length]);
  }

  /*
   * Readability scrim. The old one was a full-width ramp to 82% black, which
   * is how a hand-painted sky ends up looking like a dark rectangle. This
   * darkens only where the UI actually is - a soft column down the middle -
   * and leaves the gutters, the planet and the wing in the clear.
   */
  const colHalf = Math.min(W, 760)/2;
  const scrim = ctx.createLinearGradient(W/2 - colHalf, 0, W/2 + colHalf, 0);
  scrim.addColorStop(0, "rgba(5,4,15,0)");
  scrim.addColorStop(0.5, "rgba(5,4,15,0.46)");
  scrim.addColorStop(1, "rgba(5,4,15,0)");
  ctx.fillStyle = scrim;
  ctx.fillRect(W/2 - colHalf, 0, colHalf*2, H);
  const fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, "rgba(5,4,15,0.20)");     // settles the wordmark
  fade.addColorStop(0.45, "rgba(5,4,15,0.06)");
  fade.addColorStop(1, "rgba(5,4,15,0.34)");
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
      <div class="pstats"><b>${P.totalStars(p)}</b> ★ <i>·</i> <b>${p.highscore}</b> best</div>
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
  // The Wacky Sky opens once the basics are learned (mission 3 cleared).
  // Its sub is the score to beat - yours, or the leading brother's. The old
  // Daily Patrol bests carry straight over: same field, new party.
  {
    const open = wackyUnlocked(profile);
    $("wackyBtn").classList.toggle("locked", !open);
    const rivals = P.listNames().map(P.load).filter(q => (q.endlessBest || 0) > 0)
      .sort((a,b) => b.endlessBest - a.endlessBest);
    setSub("wackySub", !open ? "opens after Mission 3"
      : rivals.length
        ? "beat " + (rivals[0].callsign || rivals[0].name) + "'s " +
          rivals[0].endlessBest.toLocaleString("en-US") + " pts"
        : "every flight is a surprise");
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
  {
    const drawn = SF.workshop ? SF.workshop.familySkies().length : 0;
    setSub("workshopSub", drawn
      ? drawn + " sk" + (drawn > 1 ? "ies" : "y") + " on the family board"
      : "draw a sky, dare the family");
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

  paint("wackyBtn", c => {              // a tumbling die, mid-roll
    glowSet(c, "#ffd23f");
    c.save();
    c.translate(38, 40); c.rotate(-0.35);
    c.fillStyle = "#ffd23f";
    const r = 17;
    // rounded square
    c.beginPath();
    c.moveTo(-r+6, -r); c.arcTo(r, -r, r, r, 6); c.arcTo(r, r, -r, r, 6);
    c.arcTo(-r, r, -r, -r, 6); c.arcTo(-r, -r, r, -r, 6); c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = "#241a00";
    [[-7,-7],[0,0],[7,7]].forEach(([x,y]) => {   // three pips on the diagonal
      c.beginPath(); c.arc(x, y, 3.4, 0, Math.PI*2); c.fill();
    });
    c.restore();
    // motion sparkles: the roll is still happening
    c.fillStyle = "#ffd23f";
    [[12,14],[62,20],[58,60]].forEach(([x,y]) => {
      c.beginPath();
      c.moveTo(x, y-4); c.lineTo(x+2.6, y); c.lineTo(x, y+4); c.lineTo(x-2.6, y);
      c.closePath(); c.fill();
    });
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

  paint("workshopBtn", c => {           // the Royal Brush, at rest
    glowSet(c, "#c9b458");
    c.strokeStyle = "#c9b458"; c.lineWidth = 8; c.lineCap = "round";
    c.beginPath(); c.moveTo(52, 12); c.lineTo(34, 34); c.stroke();   // handle
    c.fillStyle = "#c9b458";
    c.beginPath();                                                    // bristles
    c.moveTo(34, 30); c.lineTo(42, 38); c.lineTo(26, 56); c.quadraticCurveTo(18, 60, 16, 52);
    c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = "#ff9e7d";                                          // a wet drop
    c.beginPath(); c.arc(20, 62, 4.5, 0, Math.PI*2); c.fill();
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

  // Near-black base, like the mission skies. The map used to open on a
  // brighter pastel indigo that read as a different game from the playfield;
  // pulling the ground down lets the gold route own the screen.
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#171238");
  bg.addColorStop(0.5, "#0c0a24");
  bg.addColorStop(1, "#060512");
  c.fillStyle = bg; c.fillRect(0, 0, W, H);

  // Nebula: a few big soft clouds, deliberately low contrast so the route
  // stays the brightest thing on the map.
  [["#7c3aed", 0.30, 0.22, 0.46], ["#0ea5e9", 0.76, 0.44, 0.40],
   ["#db2777", 0.24, 0.72, 0.38], ["#14b8a6", 0.62, 0.90, 0.30]]
    .forEach(([col, x, y, r]) => {
      const g = c.createRadialGradient(x*W, y*H, 0, x*W, y*H, r*W);
      g.addColorStop(0, col + "36");
      g.addColorStop(0.5, col + "14");
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
      // Bands on the big one.
      if(idx === 0){
        c.save();
        c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI*2); c.clip();
        c.globalAlpha = 0.18; c.fillStyle = "#ffd9a8";
        [-0.45, -0.1, 0.3, 0.6].forEach(o =>
          c.fillRect(cx - rr, cy + o*rr, rr*2, rr*0.14));
        c.restore();
        c.globalAlpha = 1;
      }
      // Limb light inside the sunward (upper-left) edge - the floating
      // highlight arc these wore before read as gloss on a marble. Anchoring
      // the gradient at the far side lights only the rim facing the light.
      c.save();
      c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI*2); c.clip();
      const limb = c.createRadialGradient(cx + rr*0.5, cy + rr*0.55, rr*0.2,
                                          cx + rr*0.5, cy + rr*0.55, rr*1.62);
      limb.addColorStop(0.82, "rgba(255,235,200,0)");
      limb.addColorStop(1, "rgba(255,235,200,0.22)");
      c.fillStyle = limb;
      c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI*2); c.fill();
      c.restore();
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

  /*
   * The locked reaches. The top half of the map was near-solid navy - moody,
   * but it read as unfinished rather than unknown. Everything here stays
   * under ~0.14 alpha: enemy space should feel occupied, never bright.
   */
  // Cold thin wisps through the middle heights the route hasn't reached.
  c.globalAlpha = 0.10;
  [["#4c5f96", 0.62, 0.30, 0.30], ["#5b4a86", 0.28, 0.42, 0.26]]
    .forEach(([col, x, y, r]) => {
      const g = c.createRadialGradient(x*W, y*H, 0, x*W, y*H, r*W);
      g.addColorStop(0, col); g.addColorStop(1, col + "00");
      c.fillStyle = g;
      c.save(); c.translate(x*W, y*H); c.scale(1.8, 0.5); c.translate(-x*W, -y*H);
      c.fillRect(x*W - r*W*2, y*H - r*W, r*W*4, r*W*2);
      c.restore();
    });
  c.globalAlpha = 1;
  // A watch-station holding the approach to their star: a dark hex on a
  // spine, lit windows, a red beacon. The tease, not a threat.
  (function watchStation(cx, cy, s){
    c.fillStyle = "#0b0e1e";
    c.strokeStyle = "rgba(170,180,220,0.30)";
    c.lineWidth = 1.2;
    c.beginPath();
    for(let i=0;i<6;i++){
      const a = i/6*Math.PI*2 + Math.PI/6;
      c.lineTo(cx + Math.cos(a)*s, cy + Math.sin(a)*s);
    }
    c.closePath(); c.fill(); c.stroke();
    c.fillRect(cx - s*0.14, cy - s*2.1, s*0.28, s*1.2);   // the spine
    c.fillRect(cx - s*1.9, cy - s*0.12, s*1.0, s*0.24);   // a docking arm
    c.strokeStyle = "rgba(170,180,220,0.16)";
    c.strokeRect(cx - s*1.9, cy - s*0.12, s*1.0, s*0.24);
    // Somebody's home: three lit windows and the mast beacon.
    c.fillStyle = "rgba(255,200,120,0.55)";
    [[-0.4, -0.1], [0.1, 0.25], [0.45, -0.3]].forEach(([wx, wy]) =>
      c.fillRect(cx + wx*s, cy + wy*s, 1.6, 1.6));
    const halo = c.createRadialGradient(cx, cy - s*2.2, 0, cx, cy - s*2.2, s*1.6);
    halo.addColorStop(0, "rgba(255,90,90,0.45)");
    halo.addColorStop(1, "rgba(255,90,90,0)");
    c.fillStyle = halo;
    c.fillRect(cx - s*1.6, cy - s*3.8, s*3.2, s*3.2);
    c.fillStyle = "rgba(255,110,110,0.9)";
    c.beginPath(); c.arc(cx, cy - s*2.2, 1.8, 0, Math.PI*2); c.fill();
  })(W*0.11, H*0.155, W*0.034);
  // A drift of wreck-line rocks where the dead sectors sit.
  c.fillStyle = "#0f1322";
  c.strokeStyle = "rgba(160,175,210,0.10)";
  for(let i=0;i<9;i++){
    const rx2 = (0.30 + skyRand(i+600)*0.34)*W, ry2 = (0.20 + skyRand(i+640)*0.14)*H;
    const rr2 = 2.5 + skyRand(i+680)*5;
    c.beginPath();
    for(let kk=0;kk<6;kk++){
      const a = kk/6*Math.PI*2;
      c.lineTo(rx2 + Math.cos(a)*rr2*(0.7+skyRand(i*7+kk)*0.5),
               ry2 + Math.sin(a)*rr2*(0.7+skyRand(i*9+kk)*0.5));
    }
    c.closePath(); c.fill(); c.stroke();
  }

  /*
   * THE EDGE OF THE MAP. Everything above here is torn away: no printed sky,
   * just the drafting paper the chart was drawn on, with the grid, the compass
   * circles, the roughed-in stars and his handwriting still on it. Their star
   * is up here too, pencilled and never inked. The point is that arriving at
   * Sky 29 should not feel like arriving at stop twenty-nine - it should feel
   * like flying off the end of everything anyone finished drawing.
   */
  const tearY = mapTearY(H);
  const edge = [];                                   // the torn lip, left to right
  for(let x = -20; x <= W + 40; x += 22)
    edge.push([x, tearY + (skyRand(x*0.37 + 900) - 0.5)*30 + Math.sin(x*0.021)*10]);

  c.save();
  c.beginPath();                                     // clip to everything ABOVE the rip
  c.moveTo(-20, 0); c.lineTo(W + 40, 0);
  for(let i = edge.length - 1; i >= 0; i--) c.lineTo(edge[i][0], edge[i][1]);
  c.closePath();
  c.clip();

  const paper = c.createLinearGradient(0, 0, 0, tearY + 40);
  paper.addColorStop(0, "#0a0c18");
  paper.addColorStop(1, "#141931");
  c.fillStyle = paper; c.fillRect(-20, 0, W + 60, tearY + 60);

  c.strokeStyle = "rgba(150,170,220,0.09)"; c.lineWidth = 1;   // the drafting grid
  for(let x = 0; x <= W; x += 34){ c.beginPath(); c.moveTo(x, 0); c.lineTo(x, tearY + 40); c.stroke(); }
  for(let y = 0; y <= tearY + 40; y += 34){ c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }

  c.setLineDash([7, 8]);                             // circles for planets never painted
  c.strokeStyle = "rgba(174,195,239,0.30)"; c.lineWidth = 1.6;
  [[0.26, 0.62, 0.17], [0.76, 0.30, 0.10], [0.56, 0.86, 0.06]].forEach(([x, y, r]) => {
    c.beginPath(); c.arc(x*W, y*tearY, r*W, 0, Math.PI*2); c.stroke();
  });
  // Their star, roughed in and abandoned: the ring plus the rays you draw
  // first and ink last. It was a painted red giant before the tear reached it.
  const gx = W*0.12, gy = H*0.035, gr = W*0.085;
  c.beginPath(); c.arc(gx, gy, gr, 0, Math.PI*2); c.stroke();
  c.setLineDash([]);
  c.strokeStyle = "rgba(174,195,239,0.26)"; c.lineWidth = 1.2;
  for(let i=0;i<10;i++){
    const a = i/10*Math.PI*2 + 0.3;
    c.beginPath();
    c.moveTo(gx + Math.cos(a)*gr*1.15, gy + Math.sin(a)*gr*1.15);
    c.lineTo(gx + Math.cos(a)*gr*1.5, gy + Math.sin(a)*gr*1.5);
    c.stroke();
  }

  c.strokeStyle = "rgba(174,195,239,0.40)"; c.lineWidth = 1.2;  // stars, roughed as crosses
  for(let i=0;i<26;i++){
    const x = skyRand(i+960)*W, y = skyRand(i+1000)*tearY, s = 3 + skyRand(i+1040)*4;
    c.beginPath();
    c.moveTo(x - s, y); c.lineTo(x + s, y);
    c.moveTo(x, y - s); c.lineTo(x, y + s);
    c.stroke();
  }

  // His handwriting, still on the page - kept high and central, where neither
  // the last stop nor its sector ribbon can sit on top of it.
  c.fillStyle = "rgba(186,204,245,0.55)";
  c.font = "italic 16px Rajdhani, Arial, sans-serif";
  c.textAlign = "left";
  // Papa's own note names the sky, so it tracks the sky's name - lowercased,
  // because he wrote it in pencil and not in a stylesheet.
  c.fillText(SF.missions.GIFT.name.toLowerCase() + " — for the boys", W*0.33, tearY*0.13);
  c.fillStyle = "rgba(174,195,239,0.32)";
  c.font = "italic 12px Rajdhani, Arial, sans-serif";
  c.fillText("never finished it", W*0.33, tearY*0.13 + 19);
  c.fillText("their star", gx - gr*0.35, gy + gr + 16);
  c.restore();

  // The lip: a dark under-edge with a pale paper edge riding on it. Two
  // strokes are what make this read as TORN instead of as a second backdrop.
  const lip = () => {
    c.beginPath();
    c.moveTo(edge[0][0], edge[0][1]);
    for(let i=1;i<edge.length;i++) c.lineTo(edge[i][0], edge[i][1]);
    c.stroke();
  };
  c.lineJoin = "round";
  c.strokeStyle = "rgba(3,4,12,0.85)"; c.lineWidth = 7; lip();
  c.strokeStyle = "rgba(214,226,255,0.45)"; c.lineWidth = 2; lip();
  return cv;
}

/*
 * The map draws the monsters. A boss stop used to be a red disc with a number
 * on it, which tells you the game THINKS something scary is there. Drawing the
 * boss's actual battle hull - the same painter the fight uses - shows you.
 * Ahead of you they loom as dark silhouettes; beaten, they stay behind as
 * cracked wrecks. Only enough of a boss is faked here for the painters to run.
 */
/** A five-point star pip: gold and glowing when earned, a thin ring when not. */
function drawStarPip(ctx, x, y, r, earned){
  ctx.save();
  ctx.beginPath();
  for(let i=0;i<5;i++){
    const a = -Math.PI/2 + i*Math.PI*2/5, b = a + Math.PI/5;
    ctx.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r);
    ctx.lineTo(x + Math.cos(b)*r*0.45, y + Math.sin(b)*r*0.45);
  }
  ctx.closePath();
  if(earned){
    ctx.shadowColor = "rgba(255,210,63,0.8)"; ctx.shadowBlur = 5;
    ctx.fillStyle = "#ffd23f";
    ctx.fill();
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/** A tiny drawn skull for the map's BOSS strap - a font ☠ is a different
    face on every device, and it sat off-baseline in all of them. */
function drawMiniSkull(ctx, x, y, s, ink){
  ctx.save();
  ctx.translate(x, y); ctx.scale(s/10, s/10);
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(0, -1.4, 4.4, Math.PI, 0); ctx.fill();
  ctx.fillRect(-4.4, -1.6, 8.8, 4.2);
  ctx.beginPath();
  ctx.moveTo(-3.4, 2.6); ctx.lineTo(3.4, 2.6); ctx.lineTo(2.4, 5); ctx.lineTo(-2.4, 5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ink;                 // eye sockets cut back to the strap
  ctx.beginPath(); ctx.arc(-1.9, -0.6, 1.3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(1.9, -0.6, 1.3, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

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
 * The same silhouette in graphite. A locked stop is a DRAWING of a stop now,
 * and the near-black cut-out that reads perfectly against a lit disc simply
 * disappeared into the pencil one - so the tease showed nothing, which is
 * the whole thing it exists to avoid.
 */
const silPencilCache = {};
function enemySilPencil(type){
  if(silPencilCache[type] !== undefined) return silPencilCache[type];
  const base = enemySil(type);
  if(!base) return (silPencilCache[type] = null);
  const cv = document.createElement("canvas");
  cv.width = base.width; cv.height = base.height;
  const k = cv.getContext("2d");
  if(!k) return (silPencilCache[type] = null);
  k.drawImage(base, 0, 0);
  k.globalCompositeOperation = "source-in";
  k.fillStyle = "#aec3ef";
  k.fillRect(0, 0, cv.width, cv.height);
  return (silPencilCache[type] = cv);
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
const DEVOURER_END = MISSIONS.findIndex(m => m.boss === "devourer");

const MAP_W = 640;
const ROUTE_GAP = 108;          // vertical pixels between stops, canvas-space
const ROUTE_SPAN = 0.80;        // fraction of the height the route occupies
function mapHeight(){
  return Math.round(ROUTE_GAP * (MISSIONS.length - 1) / ROUTE_SPAN);
}

/**
 * Where the printed chart runs out. Sky 29 is not another stop on the route -
 * it is the one Papa never finished - so the map itself is TORN just short of
 * it, and the last stop floats on bare drafting paper above the rip. Both the
 * baked backdrop and the live layer need the same line, hence a function.
 */
function mapTearY(H){ return H*(0.90 - ROUTE_SPAN) + ROUTE_GAP*0.55; }

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

/*
 * Named stretches, so the route reads as a journey rather than fourteen dots.
 *
 * The names alone were not enough. "DEEP RUN" floating beside a dot tells a
 * seven-year-old nothing about what it is, whether it contains anything, or
 * how it relates to the stop they are looking at - and three of the eleven
 * ("ENEMY SPACE", "WARDEN SPACE", "THEIR STAR") were three ways of saying
 * "their side", which blurred the middle of the campaign into one long grey
 * stretch. So every sector now carries three things:
 *
 *   a NUMBER - what a kid actually holds on to, and proof these are in order
 *   a SUB    - what the place is, in the words a child would use
 *   a HUE    - its own colour, worn by the map band, the label and the rail,
 *              so a sector is somewhere you can SEE rather than a caption
 *
 * `at` is the first node index in the stretch; the last is the next entry's
 * `at` minus one (see sectorStats).
 */
const SECTORS = [
  { at:0,  name:"HOME PATROL",     hue:"#6ee7a8",
    sub:"our own sky, and how to fly in it" },              // 1-2
  { at:2,  name:"THE BELT",        hue:"#f5a623",
    sub:"rocks, raiders and the first big one" },           // 3-5
  { at:5,  name:"THE STORM",       hue:"#7cc4ff",
    sub:"wild wind, and friends to get out" },              // 6-7
  { at:7,  name:"THE SUPPLY ROAD", hue:"#fbbf24",
    sub:"guard the hauler, all the way to their flagship" },// 8-10
  { at:10, name:"ENEMY SPACE",     hue:"#f472b6",
    sub:"behind their lines, where nobody is friendly" },   // 11-13
  { at:13, name:"WARDEN'S REACH",  hue:"#34d399",
    sub:"his nest, his ring, and his money" },              // 14-16
  { at:16, name:"THE TRENCHES",    hue:"#94a3b8",
    sub:"straight down the middle of their fortress" },     // 17-19
  { at:19, name:"THEIR STAR",      hue:"#fb7185",
    sub:"the dark at the end, and the thing living in it" },// 20-23
  { at:23, name:"THE CRACK",       hue:"#a78bfa",
    sub:"where space stops behaving itself" },              // 24-26
  { at:26, name:"THE WORKSHOP",    hue:"#22d3ee",
    sub:"behind the sky, where skies get made" },           // 27-28
  { at:28, name:"THE EASEL",       hue:"#ffd23f",
    sub:"the one Papa never finished" },                    // 29
];

/*
 * STAR HUNT.
 *
 * Sky 29 asks for all 84 stars, which turns "which ones am I missing?" into
 * the most important question this screen can answer - and it couldn't. The
 * hunt is a view over the same map: finished stops go quiet, unfinished ones
 * keep their colour and say what is still owed. Off by default, because the
 * map is a story first and a checklist second.
 */
let starHunt = false;

/** Stops still owed a star, nearest-to-done first, then earliest. */
function starDebts(){
  const out = [];
  MISSIONS.forEach((m, i) => {
    // The gift's own stars are outside the 84 (see profile.totalStars), so
    // hunting them would tell a pilot they are short when they are not.
    if(m.gift || !isMissionUnlocked(profile, i)) return;
    const earned = P.starsForMission(profile, m.id);
    const total = (m.objectives || []).length;
    if(earned >= total) return;
    out.push({ mission:m, index:i, earned, total,
               missing: P.missingObjectives(profile, m) });
  });
  out.sort((a, b) => (b.earned - a.earned) || (a.index - b.index));
  return out;
}

/** The label for one owed star, short enough to sit under a stop. */
function debtLabel(d){
  if(d.missing && d.missing.length){
    const def = SF.missions.OBJECTIVES[d.missing[0]];
    const extra = d.missing.length > 1 ? " +" + (d.missing.length - 1) : "";
    return (def ? def.label : d.missing[0]) + extra;
  }
  const n = d.total - d.earned;
  return n + " star" + (n > 1 ? "s" : "") + " left";
}

/*
 * What a stretch of the route is worth, and how much of it the family owns.
 * A sector runs from its own stop up to the one before the next sector, so
 * the spans come out of the SECTORS table rather than being written twice.
 */
function sectorStats(si){
  const from = SECTORS[si].at;
  const to = (si + 1 < SECTORS.length ? SECTORS[si+1].at : MISSIONS.length) - 1;
  let done = 0, total = 0, stars = 0, starMax = 0, reached = false;
  for(let i = from; i <= to && i < MISSIONS.length; i++){
    const m = MISSIONS[i], rec = profile.missions[m.id];
    total++;
    starMax += (m.objectives || []).length;
    stars += P.starsForMission(profile, m.id);
    if(rec && rec.cleared) done++;
    if(isMissionUnlocked(profile, i)) reached = true;
  }
  return { from, to, done, total, stars, starMax, reached,
           cleared: total > 0 && done === total,
           perfect: total > 0 && starMax > 0 && stars >= starMax };
}

/** True when both ends of a route segment are fully starred. */
function masteredSegment(i){
  const a = MISSIONS[i], b = MISSIONS[i+1];
  if(!a || !b) return false;
  return P.starsForMission(profile, a.id) >= (a.objectives || []).length &&
         P.starsForMission(profile, b.id) >= (b.objectives || []).length;
}

function renderMissions(){
  const stars = P.totalStars(profile), want = P.maxStars();
  // The second half explains the little initial chips on the stops - they
  // were the one mark on the map the map never explained.
  $("missionStars").innerHTML = stars + " / " + want + " ★ collected";

  /*
   * The header states the goal. A bare tally tells a kid nothing about what
   * it is FOR; the bar plus one sentence turns it into a target with a prize
   * on the end of it - and once the prize is won, into a record of it.
   */
  const fill = $("campaignBarFill");
  if(fill) fill.style.width = Math.round((stars/Math.max(1, want))*100) + "%";
  const goal = $("campaignGoal");
  if(goal){
    const left = want - stars;
    const giftIdx = MISSIONS.findIndex(m => m.gift);
    const giftDone = giftIdx >= 0 && profile.missions[MISSIONS[giftIdx].id] &&
                     profile.missions[MISSIONS[giftIdx].id].cleared;
    goal.textContent = left > 0
      ? left + " more ★ to open " + SF.missions.giftName() + " — the sky Papa never finished"
      : giftDone ? "Every star home, and " + SF.missions.GIFT.name + " painted. Nothing left but the flying."
                 : "Every star is home — " + SF.missions.giftName() + " is open at the top of the map";
    goal.classList.toggle("camp-goal-done", left <= 0);
  }
  const debts = starDebts();
  const hunt = $("starHuntBtn");
  if(hunt){
    // Nothing to hunt is worth saying out loud, and the button turns itself off.
    if(!debts.length){ starHunt = false; hunt.classList.add("hidden"); }
    else {
      hunt.classList.remove("hidden");
      hunt.classList.toggle("on", starHunt);
      hunt.textContent = starHunt ? "✕ SHOW THE WHOLE MAP"
                                  : "★ FIND MY STARS (" + debts.length + ")";
    }
  }
  renderSectorRail();

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
    // The gift stop explains itself when tapped early: a locked stop that
    // says nothing reads as a bug, and this one has a real answer.
    else if(node.mission.gift) click(btn, () => {
      audio.play("uiClick");
      dialog({
        title: SF.missions.giftName(),
        text: "Papa left one sky unfinished - this one. It has your names pencilled in the corner." +
              "\n\nEarn EVERY star in the campaign - all " + P.maxStars() + " - and the squadron paints it together." +
              "\n\n★ " + P.totalStars(profile) + " / " + P.maxStars() + " so far.",
        okLabel: "WE'LL EARN THEM", cancelLabel: "CLOSE",
      });
    });
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
  /*
   * The button used to always point at the newest unlocked stop, which is
   * exactly right until the campaign is finished - then it is stuck on the
   * last mission forever while nineteen stars sit unclaimed behind it. So
   * once there is no new ground to take (or while the hunt is on), it offers
   * the nearest star instead: the stop closest to done.
   */
  const lastUnlockedDone = profile.missions[MISSIONS[next].id] &&
                           profile.missions[MISSIONS[next].id].cleared;
  const debt = debts[0];
  const chase = debt && (starHunt || lastUnlockedDone) ? debt : null;
  const target = chase ? chase.index : next;
  const nextBtn = $("campaignNext");
  if(nextBtn){
    const nm = MISSIONS[target];
    nextBtn.innerHTML = chase
      ? `<b><canvas class="btn-ico" data-glyph="play" width="22" height="22"></canvas>GRAB A STAR · ${nm.id}</b>` +
        `<span>${esc(debtLabel(chase))}</span>`
      : `<b><canvas class="btn-ico" data-glyph="play" width="22" height="22"></canvas>FLY MISSION ${nm.id}</b>` +
        `<span>${esc(nm.name)}</span>`;
    const ico = nextBtn.querySelector(".btn-ico");
    if(ico){
      ico.style.width = (ico.width/2) + "px"; ico.style.height = (ico.height/2) + "px";
      SF.icons.paint(ico, "play", getComputedStyle(nextBtn).color);
    }
    nextBtn.onclick = () => { audio.play("uiClick"); openBriefing(target); };
  }

  startCampaignLoop();
  scrollToNextStop(target);
}

/*
 * The sector rail: the map is 29 stops and about 3,000px tall, so getting
 * from Sky 29 back to mission 6 to farm a star was a long thumb-drag with no
 * landmarks. The rail is the map's table of contents - one tap per stretch,
 * the one you are looking at lit.
 */
function renderSectorRail(){
  const rail = $("sectorRail");
  if(!rail) return;
  rail.innerHTML = "";
  // Top of the screen is the END of the route, so the rail reads top-down in
  // the same order the map does.
  SECTORS.forEach((sec, si) => {
    const b = document.createElement("button");
    const st = sectorStats(si);
    const unlocked = isMissionUnlocked(profile, sec.at);
    b.className = "rail-stop" + (unlocked ? "" : " locked") +
                  (st.perfect ? " perfect" : st.cleared ? " cleared" : "");
    // The rail wears the sector's own colour, so the chip and the band on the
    // map are visibly the same place. Without that, the rail is a word list.
    b.style.setProperty("--sec", sec.hue);
    // A number, the name, and how much of it is done: a table of contents
    // with a score on each line, which is also what teaches a kid that a
    // sector is a THING CONTAINING STOPS rather than a label near a dot.
    const score = !st.reached ? "locked"
                : st.perfect  ? "★ " + st.stars + "/" + st.starMax
                : st.done + "/" + st.total;
    b.innerHTML = `<i></i><span><b>${si+1}</b>${esc(sec.name)}</span>` +
                  `<em>${esc(score)}</em>`;
    b.setAttribute("aria-label", "Sector " + (si+1) + ", " + sec.name + ": " + sec.sub);
    b.title = sec.sub;
    click(b, () => scrollToNextStop(sec.at));
    rail.insertBefore(b, rail.firstChild);   // top of the rail is the END of the route
  });
  /*
   * A PHONE OPENS THE STRIP WHERE THE PILOT IS.
   *
   * The rail is built end-of-route first, because on a tablet it sits vertically
   * beside the map and has to read top-down in the same order the map does. On a
   * phone the same list becomes a horizontal scrolling strip - and "first" there
   * means LEFTMOST, which is where a scroller starts. So the campaign opened
   * showing three locked sectors nobody can visit yet, and finding your own
   * sector meant scrolling a strip you had no reason to think was scrollable.
   * The map below it already opens on the stop you are going to fly next; the
   * strip above it should agree.
   *
   * Deferred for the same reason scrollToNextStop is: every caller does
   * `renderMissions(); show(...)` - render, THEN show - so this runs while the
   * section is still display:none and every measurement comes back 0. The
   * generation counter drops a pending scroll if another render supersedes it,
   * and the try budget stops a screen that is never opened asking forever.
   */
  let here = null;
  SECTORS.forEach((sec, si) => { if(isMissionUnlocked(profile, sec.at)) here = si; });
  if(here === null) return;
  const chip = rail.children[SECTORS.length - 1 - here];   // built in reverse
  if(!chip) return;
  const gen = ++railScrollGen;
  let tries = 0;
  const apply = () => {
    if(gen !== railScrollGen) return;
    if(!(rail.clientWidth > 0 && chip.offsetWidth > 0)){
      if(++tries < 40) requestAnimationFrame(apply);
      return;
    }
    // Vertical rail (tablet and up): it already reads top-down with the map.
    if(rail.scrollWidth <= rail.clientWidth + 4) return;
    rail.scrollLeft = Math.max(0,
      chip.offsetLeft - (rail.clientWidth - chip.offsetWidth) / 2);
  };
  apply();
}
let railScrollGen = 0;

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

  // Stars only twinkle where there is still a sky to twinkle in: above the
  // tear the map is paper, and paper does not shine.
  const tearY = mapTearY(H);
  campaign.stars.forEach(s => {
    if(s.y*H < tearY) return;
    ctx.globalAlpha = 0.35 + Math.sin(t*1.6 + s.tw)*0.3;
    ctx.fillStyle = "#dbe6ff";
    ctx.fillRect(s.x*W, s.y*H, s.r, s.r);
  });
  ctx.globalAlpha = 1;

  // A shooting star every few seconds. Pure theatre, and nearly free.
  {
    const period = 5.5, k = Math.floor(t/period), f = (t - k*period)/1.1;
    if(f < 1){
      const sx = (0.1 + skyRand(k*5+1)*0.8)*W;
      const sy = tearY + skyRand(k*5+2)*(H - tearY);   // never across the paper
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

  /*
   * The route: travelled stretches are lit, the rest is a faint dashed plan -
   * and a stretch between two fully-starred stops is brighter still, with a
   * pale core running through it. Three states in one hue, so "mastered"
   * doesn't invent a colour that fights "travelled".
   */
  for(let i=0;i<nodes.length-1;i++){
    const a = nodes[i], b = nodes[i+1];
    const done = i < reached;
    const mastered = done && masteredSegment(i);
    // The last leg leaves the chart. However much of the route you have lit,
    // the road to Sky 29 stays a pencil line - there was never a road there.
    const offMap = !!b.mission.gift;
    const curve = () => {
      ctx.beginPath();
      ctx.moveTo(px(a), py(a));
      ctx.quadraticCurveTo((px(a)+px(b))/2 + (i%2 ? 70 : -70), (py(a)+py(b))/2, px(b), py(b));
      ctx.stroke();
    };
    ctx.save();
    if(offMap){
      ctx.setLineDash([9, 12]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = done ? "rgba(214,226,255,0.6)" : "rgba(174,195,239,0.26)";
      curve();
      ctx.restore();
      continue;
    }
    ctx.setLineDash(done ? [] : [10, 12]);
    ctx.lineWidth = done ? (mastered ? 6 : 5) : 3;
    ctx.strokeStyle = mastered ? "rgba(255,205,70,0.95)"
                    : done ? "rgba(245,166,35,0.75)" : "rgba(255,255,255,0.16)";
    if(done){
      ctx.shadowColor = mastered ? "rgba(255,214,90,0.95)" : "rgba(245,166,35,0.7)";
      ctx.shadowBlur = mastered ? 18 : 12;
    }
    curve();
    if(mastered){                       // the pale core - a polished road
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(255,248,214,0.75)";
      curve();
    }
    ctx.restore();
  }

  // A little supply convoy runs the lit stretch: the road you opened is in
  // use. Three gold sparks chasing each other up the route, nothing more.
  // ...but only as far as the chart goes. Supply runs don't leave the map.
  const roadEnd = Math.min(reached, nodes.length - 1 -
                           (nodes[nodes.length-1].mission.gift ? 1 : 0));
  if(roadEnd > 0){
    const quad = (a, b, i, u) => {
      const cx = (px(a)+px(b))/2 + (i%2 ? 70 : -70), cy = (py(a)+py(b))/2;
      const q = 1-u;
      return [q*q*px(a) + 2*q*u*cx + u*u*px(b), q*q*py(a) + 2*q*u*cy + u*u*py(b)];
    };
    ctx.save();
    ctx.lineCap = "round";
    for(let j=0;j<3;j++){
      const u = ((t*0.16 + j*0.37) % 1) * roadEnd;
      const seg = Math.min(roadEnd-1, Math.floor(u));
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

  /*
   * The sectors keep score. A stretch you have finished used to look exactly
   * like one you had not - the same grey words floating beside the route -
   * so scrolling the map told you nothing about what the family had actually
   * done. Now each stretch carries its own state: how many stops are down,
   * a green CLEARED when they all are, and gold when every star in it is
   * home. Scrolling the campaign reads as a record instead of a list.
   */
  /*
   * The bands come first, under everything: each sector washes its own
   * stretch of the map in its own colour, from its first stop to its last.
   * This is what turns a sector from a caption floating near one dot into a
   * PLACE with edges - you can see where THE BELT stops and THE STORM starts
   * without reading a word, which is the whole point for a pre-reader.
   */
  SECTORS.forEach((sec, si) => {
    const st = sectorStats(si);
    const top = nodes[st.to] ? py(nodes[st.to]) : 0;          // the route climbs
    const bot = nodes[st.from] ? py(nodes[st.from]) : H;
    const y0 = top - ROUTE_GAP*0.5, y1 = bot + ROUTE_GAP*0.5;
    ctx.save();
    ctx.globalAlpha = st.reached ? 1 : 0.42;
    const band = ctx.createLinearGradient(0, y0, 0, y1);
    band.addColorStop(0,    sec.hue + "00");
    band.addColorStop(0.5,  sec.hue + (st.reached ? "22" : "10"));
    band.addColorStop(1,    sec.hue + "00");
    ctx.fillStyle = band;
    ctx.fillRect(0, y0, W, y1 - y0);
    // A hairline at the boundary, so two neighbouring bands have a seam
    // rather than bleeding into one another.
    if(si > 0){
      ctx.strokeStyle = sec.hue + "3a";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(W, y1); ctx.stroke();
    }
    ctx.restore();
  });

  SECTORS.forEach((sec, si) => {
    const n = nodes[sec.at];
    if(!n) return;
    const st = sectorStats(si);
    const state = !st.reached ? "locked" : st.perfect ? "perfect" : st.cleared ? "cleared" : "open";
    // The sector's own colour carries the name; state only decides how bright
    // it is and what the line underneath says. Two jobs, two channels.
    const tint = state === "locked" ? "#8e96b8" : sec.hue;
    const note = { locked:"LOCKED",
                   open: st.done + " / " + st.total + " STOPS",
                   cleared:"SECTOR CLEARED",
                   perfect:"PERFECT  ★ " + st.stars + "/" + st.starMax }[state];
    ctx.save();
    ctx.globalAlpha = state === "locked" ? 0.30 : 0.92;
    /*
     * The caption belongs to the whole band, so it hangs at the band's MIDDLE
     * rather than off its first stop - and on whichever side the route is not
     * using there. Pinned to the first stop it collided with that stop's own
     * name (THE WARDEN'S REACH landed straight on "THE WARDEN"), and it read
     * as a label on one dot, which is exactly the thing being fixed.
     */
    const midNode = nodes[Math.round((st.from + st.to)/2)] || n;
    const my = py(midNode);
    // Side is decided by the stop the caption is level WITH, not by the
    // band's average: an average put SECTOR 4 straight on top of THE CONVOY,
    // which is the stop sitting at exactly that height.
    const away = midNode.x > 0.5 ? 1 : -1;
    const lx = away > 0 ? 24 : W - 24, ly = my;
    ctx.textAlign = away > 0 ? "left" : "right";

    // A rule running out to the frame edge: the ribbon that makes a stretch
    // read as a stretch rather than a caption on one stop.
    const grad = ctx.createLinearGradient(lx, 0, lx + away*190, 0);
    grad.addColorStop(0, tint);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = state === "perfect" ? 2.5 : 1.5;
    ctx.globalAlpha *= 0.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly + 6); ctx.lineTo(lx + away*190, ly + 6);
    ctx.stroke();
    ctx.globalAlpha = state === "locked" ? 0.30 : 0.92;

    // The number first, small and above: "SECTOR 4 · STOPS 8-10". A name is
    // flavour; a number is the thing a seven-year-old can actually hold on
    // to, and the range says out loud that a sector CONTAINS stops.
    ctx.fillStyle = tint;
    ctx.font = "bold 10px Rajdhani, Arial, sans-serif";
    ctx.letterSpacing = "1.5px";
    ctx.globalAlpha *= 0.8;
    ctx.fillText("SECTOR " + (si+1) + " · STOPS " + (st.from+1) + "-" + (st.to+1), lx, ly - 15);
    ctx.globalAlpha = state === "locked" ? 0.30 : 0.92;

    if(state === "perfect"){                 // a mastered stretch gets a glow
      ctx.save();
      ctx.shadowColor = "rgba(255,210,63,0.75)"; ctx.shadowBlur = 14;
      ctx.fillStyle = tint;
      ctx.font = "bold 15px Rajdhani, Arial, sans-serif";
      ctx.letterSpacing = "3px";
      ctx.fillText(sec.name, lx, ly);
      ctx.restore();
    }
    ctx.fillStyle = tint;
    ctx.font = "bold 15px Rajdhani, Arial, sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillText(sec.name, lx, ly);
    ctx.font = "bold 10px Rajdhani, Arial, sans-serif";
    ctx.letterSpacing = "1.5px";
    ctx.globalAlpha *= 0.85;
    ctx.fillText(note, lx, ly + 17);
    // ...and what the place actually IS, in words a child would use. The name
    // is the only part that was ever there, and on its own it explained
    // nothing: "DEEP RUN" is atmosphere, not information.
    ctx.font = "italic 11px Rajdhani, Arial, sans-serif";
    ctx.letterSpacing = "0px";
    ctx.fillStyle = state === "locked" ? "#8e96b8" : "#cfd8ff";
    ctx.globalAlpha *= 0.8;
    ctx.fillText(sec.sub, lx, ly + 31);
    ctx.restore();
  });

  const me = profile.callsign || profile.name;
  // Star hunt: everything already finished steps back so the stops that still
  // owe you a star are the only bright things on the route.
  const owes = {};
  if(starHunt) starDebts().forEach(d => { owes[d.mission.id] = d; });
  nodes.forEach((node, i) => {
    const unlocked = isMissionUnlocked(profile, i);
    const earned = P.starsForMission(profile, node.mission.id);
    const debt = owes[node.mission.id];
    if(starHunt){
      ctx.save();
      ctx.globalAlpha = debt ? 1 : 0.22;
    }

    /*
     * The gift stop draws itself: locked it is a PENCIL SKETCH of a stop -
     * dashed ring, graphite fill, the star bar it is waiting for written
     * underneath - and the moment the last star lands it becomes the most
     * painted thing on the map. A promise you can see from mission 10.
     */
    if(node.mission.gift){
      const x = px(node), y = py(node), R = 36;
      const rec = profile.missions[node.mission.id];
      const painted = !!(rec && rec.cleared);
      if(!unlocked){
        ctx.save();
        ctx.fillStyle = "rgba(22,26,40,0.55)";
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        ctx.setLineDash([6, 7]);
        ctx.strokeStyle = "rgba(165,178,215,0.75)";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
        // pencil hatching, so it reads as "drawn, not built"
        ctx.strokeStyle = "rgba(165,178,215,0.22)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, R-3, 0, Math.PI*2); ctx.clip();
        for(let h = -R; h <= R; h += 9){
          ctx.beginPath(); ctx.moveTo(x - R + h, y - R); ctx.lineTo(x + h, y + R); ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = "rgba(200,210,240,0.8)";
        ctx.font = "italic bold 22px Rajdhani, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(SF.missions.GIFT.id), x, y + 8);
        ctx.font = "italic bold 13px Rajdhani, Arial, sans-serif";
        ctx.fillText(SF.missions.giftName(), x, y + R + 20);
        // The requirement, in plain kid words, always visible.
        const have = P.totalStars(profile), want = P.maxStars();
        ctx.fillStyle = "rgba(255,210,63,0.85)";
        ctx.font = "bold 12px Rajdhani, Arial, sans-serif";
        ctx.fillText("★ " + have + " / " + want + " — EARN EVERY STAR", x, y + R + 37);
        ctx.restore();
      } else {
        // Painted (or ready to be): the disc wears the dawn itself.
        const pulse = 0.5 + Math.sin(t*3)*0.5;
        if(!painted){
          ctx.strokeStyle = "rgba(255,210,63," + (0.3 + pulse*0.5) + ")";
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x, y, R + 12 + pulse*7, 0, Math.PI*2); ctx.stroke();
        }
        const g = ctx.createRadialGradient(x-R*0.3, y-R*0.4, R*0.1, x, y, R);
        g.addColorStop(0, "#ffd23f");
        g.addColorStop(0.55, "#ff7a59");
        g.addColorStop(1, "#8b5cf6");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = painted ? "#ffd23f" : "rgba(255,255,255,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
        ctx.save();
        ctx.shadowColor = "rgba(4,6,16,0.95)"; ctx.shadowBlur = 6;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = "bold 24px Rajdhani, Arial, sans-serif";
        ctx.fillText("29", x, y + 9);
        ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
        ctx.fillText(SF.missions.giftName(), x, y + R + 20);
        ctx.restore();
        ctx.fillStyle = painted ? "rgba(150,255,205,0.9)" : "rgba(255,210,63,0.95)";
        ctx.font = "bold 12px Rajdhani, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(painted ? "✓ PAINTED" : "READY TO PAINT", x, y + R + 37);
      }
      if(starHunt) ctx.restore();        // the hunt's dimming, balanced
      return;                            // fully bespoke - skip the shared node kit
    }
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
      // Locked, and drawn rather than greyed: the same graphite the workshop
      // sketches Sky 29 in. A stop you cannot fly yet was a dead grey disc,
      // which is the one thing the road ahead should never be - it is the
      // part of the map a kid is supposed to want. Now it is a drawing of
      // the stop, waiting to be painted in, and the enemy in it is legible.
      else { g.addColorStop(0, "#242a3e"); g.addColorStop(1, "#12151f"); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
      if(!unlocked){
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, R-2, 0, Math.PI*2); ctx.clip();
        ctx.strokeStyle = "rgba(150,166,215,0.16)";
        ctx.lineWidth = 1.4;
        for(let h = -R*2; h <= R*2; h += 8){    // pencil hatching
          ctx.beginPath();
          ctx.moveTo(x - R + h, y - R); ctx.lineTo(x + h, y + R);
          ctx.stroke();
        }
        ctx.restore();
      }

      // The mission's own enemy, riding inside the disc. Clipped to the rim so
      // eighteen stops stay eighteen tidy circles, and kept faint so it reads
      // as the stop's character rather than competing with its number.
      const sprite = face.enemy && (unlocked ? enemySil(face.enemy)
                                             : enemySilPencil(face.enemy));
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
        // 0.2 was a ghost - the tease only works if you can see what it is.
        ctx.globalAlpha = unlocked ? 0.62 : 0.62;
        // Wide ships lose their wingtips to the rim at full width, and the
        // wingtips are exactly what tells a weaver from a grunt.
        const box = R*1.72;
        ctx.drawImage(sprite, x - box/2, y - box/2, box, box);
        ctx.restore();
      }
      if(!unlocked){                        // the dashed pencil rim, over it all
        ctx.save();
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = "rgba(170,186,235,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }

      // A locked stop already wears its pencil rim; a second faint ring over
      // the dashes only fills them back in.
      if(unlocked){
        ctx.lineWidth = 3;
        ctx.strokeStyle = earned === 3 ? "#ffd23f" : "rgba(255,255,255,0.55)";
        ctx.stroke();
      }

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

    const starY = y - R - (hull ? 14 : boss ? 26 : 10);
    if(unlocked){                                  // stars earned, on the rim
      // Drawn pips, not font glyphs: the text star rendered as a smudge over
      // the nebula and clashed with every other star the game draws.
      for(let sIdx=0; sIdx<3; sIdx++){
        drawStarPip(ctx, x + (sIdx-1)*16, starY, 6.5, sIdx < earned);
      }
    }
    /*
     * A boss stop says BOSS. Red spikes read as "danger" only if you already
     * know the convention, and an eight-year-old doesn't - a label costs
     * nothing and removes the guess entirely.
     */
    if(boss && unlocked){
      ctx.save();
      // The skull is drawn, not typed - a font ☠ wears a different face on
      // every device and sat off-baseline in all of them.
      const label = beaten ? "✓ DEFEATED" : "BOSS", padX = 9, h = 19;
      const skullW = beaten ? 0 : 13;
      ctx.font = "bold 12px Rajdhani, Arial, sans-serif";
      const w = ctx.measureText(label).width + padX*2 + skullW;
      // Discs wear the strap as a hat; hulls are tall enough that a hat
      // lands on the name of the stop above, so theirs hangs below instead.
      const bx = x - w/2, by = hull ? y + R + 8 : y - R - 20;
      const strap = beaten ? "#166a45" : "#c2123a";
      ctx.fillStyle = strap;
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
      if(!beaten) drawMiniSkull(ctx, bx + padX + 4, by + h/2, 11, strap);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + skullW/2, by + h/2 + 1);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
    // The name needs its own backing where labels crowd (stop names, sector
    // names and boss straps share a narrow column around mission 7).
    ctx.save();
    ctx.shadowColor = "rgba(4,6,16,0.9)";
    ctx.shadowBlur = 5;
    ctx.fillStyle = unlocked ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)";
    ctx.font = "bold " + (unlocked ? 13 : 11) + "px Rajdhani, Arial, sans-serif";
    // A locked boss keeps its name to itself - the silhouette is the tease.
    ctx.fillText(boss && !unlocked ? "? ? ? ? ?" : node.mission.name.toUpperCase(),
                 x, y + R + (hull && unlocked ? 44 : 20));
    ctx.restore();

    /*
     * The record chip used to ride here - the holder's initial on the stop's
     * rim. Cut on request: at map scale it read as noise, and the real
     * scoreboard (the Championship, and the briefing's record line) already
     * says who holds what, with room to say it properly.
     */
    /*
     * The hunt's whole point: the stop doesn't just stay bright, it SAYS what
     * it still owes. A gold tag under the name, naming the objective - which
     * is the difference between "you're missing something here" and "fly this
     * one and rescue the pilots".
     */
    if(debt){
      const label = debtLabel(debt).toUpperCase();
      ctx.save();
      ctx.font = "bold 11px Rajdhani, Arial, sans-serif";
      const padX = 8, h = 18, w = ctx.measureText(label).width + padX*2;
      const ty = y + R + (hull && unlocked ? 52 : 28);
      ctx.fillStyle = "rgba(255,210,63,0.92)";
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(x - w/2, ty, w, h, 9);
      else ctx.rect(x - w/2, ty, w, h);
      ctx.fill();
      ctx.fillStyle = "#2a1d00";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, x, ty + h/2 + 0.5);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
    if(starHunt) ctx.restore();
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
const hangar = { raf:0, t:0, compare:false, ctx:null, celebrate:0,
                 shows:[], show:null };   // queued purchase ceremonies
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
  /*
   * ONE ANSWER TO "WHAT NEXT".
   *
   * This strip said NEXT PART TO FIT, and the coach chip at the top of the
   * shelf said "you keep losing lives - try Extra Life". Two answers to the
   * same question, 107px apart, from different sources - the part ladder and
   * how you have actually been dying - so they could and did disagree. The
   * coach owns the recommendation now (see renderCoach); this line's job is
   * reduced to the one thing it knew that the coach did not: what the purchase
   * BOLTS ON, which is the part a child actually cares about.
   */
  if(next){
    const u = UPGRADE_BY_ID[next.up];
    $("hangarNext").innerHTML =
      `<span class="hn-label">NEXT PART TO FIT</span><b>${esc(next.name)}</b>`;
    $("hangarNext").onclick = () => { audio.play("uiClick"); jumpToUpgrade(u.id); };
    $("hangarNext").classList.add("tappable");
  } else {
    $("hangarNext").innerHTML =
      `<span class="hn-label">COMPLETE</span><b>Every part fitted.</b>`;
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
    // Drawn glyph, not emoji: the tab strip is chrome, and chrome renders
    // identically on every device (see icons.js).
    el.appendChild(SF.icons.el(t.id, t.color, 18));
    const label = document.createElement("span");
    label.textContent = t.name;
    el.appendChild(label);
    click(el, () => { armoryTab = t.id; renderArmory(); });
    tabs.appendChild(el);
  });
  // (The rail shows all seven at once - there is no longer an edge to fade.)

  const panel = $("armoryPanel");
  panel.innerHTML = "";
  renderCoach(panel);
  if(armoryTab === "parts") renderPartsTab(panel, levels, next);
  else if(armoryTab === "pilot") renderPilotTab(panel);
  else if(armoryTab === "paint") renderPaintTab(panel);
  else renderShelf(panel, armoryTab);

  startHangarLoop();
}

/*
 * "WHAT SHOULD I BUY?"
 *
 * Fourteen upgrade tracks is a wall to a seven-year-old, and the honest answer
 * to which one is not "the cheapest" - it is "the one that fixes how you keep
 * dying". profile.coach carries a decayed read of the last few flights, so this
 * can say something true and specific rather than generic advice: enemies kept
 * getting past you, or you kept getting hit, or you kept losing lives.
 *
 * One line, it names ONE thing, it says why, and tapping it goes there. It only
 * ever recommends something affordable - advice you cannot act on is just a
 * reminder that you are poor.
 */
function coachPick(){
  const co = profile.coach;
  const afford = id => {
    const u = UPGRADE_BY_ID[id];
    const c = u ? P.nextCost(profile, u) : null;
    return c !== null && profile.money >= c ? u : null;
  };
  const first = ids => { for(let i=0;i<ids.length;i++){ const u = afford(ids[i]); if(u) return u; } return null; };
  if(co && co.runs >= 1){
    const perRun = k => (co[k] || 0) / Math.max(1, co.runs);
    const lives = perRun("livesLost"), escaped = perRun("escaped"), hits = perRun("hits");
    // Ranked by how loudly the last few flights complained.
    if(lives >= 1.2){
      const u = first(["life", "shield", "armor"]);
      if(u) return { u, why: "You keep losing lives" };
    }
    if(escaped >= 6){
      const u = first(["spread", "rapid", "damage", "wingman"]);
      if(u) return { u, why: "Too many are slipping past you" };
    }
    if(hits >= 3){
      const u = first(["shield", "armor", "thrusters"]);
      if(u) return { u, why: "You're taking a lot of hits" };
    }
  }
  // Nothing to diagnose: point at the cheapest thing they can actually have.
  const buyable = UPGRADES.map(u => ({ u, cost: P.nextCost(profile, u) }))
    .filter(x => x.cost !== null && profile.money >= x.cost);
  if(!buyable.length) return null;
  const cheap = buyable.reduce((a, b) => b.cost < a.cost ? b : a).u;
  return { u: cheap, why: "Good next step" };
}

function renderCoach(panel){
  const pick = coachPick();
  if(!pick) return;
  const row = document.createElement("button");
  row.className = "coach-tip";
  row.style.setProperty("--cat", (CATEGORIES.find(c => c.id === pick.u.cat) || {}).color || "#ffd23f");
  /*
   * If the thing the coach recommends ALSO bolts a visible part onto the ship,
   * say so on the same line. That was the one piece of information the old
   * NEXT PART TO FIT strip carried that this does not, and it is the half a
   * seven-year-old is actually moved by: not "+18% fire rate" but "this puts
   * Twin Barrels on my ship".
   */
  const lvlNow = P.upgradeLevel(profile, pick.u.id);
  const fits = SF.shipart.PARTS.find(pt => pt.up === pick.u.id && pt.at === lvlNow + 1);
  row.innerHTML = `<span class="ct-why">${esc(pick.why)}</span>` +
                  `<span class="ct-buy">Try <b>${esc(pick.u.name)}</b>` +
                  (fits ? `<i class="ct-fits">fits ${esc(fits.name)}</i>` : "") + `</span>` +
                  `<span class="ct-cost">${money(P.nextCost(profile, pick.u))}</span>`;
  click(row, () => { audio.play("uiClick"); jumpToUpgrade(pick.u.id); });
  panel.appendChild(row);
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
      <div class="si-badge" data-glyph="${u.id}"></div>
      <div class="si-main">
        <div class="si-name">${esc(u.name)} <span class="si-lvl">${maxed ? "MAXED" : "Lv " + lvl + "/" + u.max}</span></div>
        <div class="si-pips">${pips}</div>
        <div class="si-desc">${esc(u.desc)}</div>
        <div class="si-effect">${lvl > 0 ? "Now: " + esc(u.effect(lvl)) : "Not owned yet"}${
          maxed ? "" : ' <span class="si-next">→ ' + esc(u.effect(lvl+1)) + "</span>"}</div>
        ${part ? `<div class="si-part">fits <b>${esc(part.name)}</b> to your ship</div>` : ""}
      </div>`;
    const btn = document.createElement("button");
    btn.innerHTML = maxed ? "★<br>MAX" : money(cost);
    // Only MAXED is truly inert. An unaffordable button stays tappable so the
    // tap can ANSWER (shake + deny blip) - disabled buttons swallow the click
    // and read as broken to a kid.
    btn.disabled = maxed;
    btn.classList.toggle("cant", !maxed && !affordable);
    click(btn, () => {
      if(!buyUpgrade(u.id)){
        // A tap that silently did nothing reads as a broken button. The row
        // shakes, the price flashes, and a soft deny blip says "not yet".
        audio.play("uiDeny");
        row.classList.remove("denied");
        void row.offsetWidth;              // restart the animation
        row.classList.add("denied");
      }
    });
    row.appendChild(btn);
    group.appendChild(row);
    const badge = row.querySelector(".si-badge[data-glyph]");
    if(badge) badge.appendChild(SF.icons.el(u.id, cat.color, 26));
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
  ctx.strokeStyle = "rgba(255,255,255,0.20)";   // visible even at 0% in daylight
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
            : `<i class="lock-slot"></i> beat Mission ` + t.unlockMission + "'s boss"}</u>`;
    fillGlyphs(card, null, "rgba(255,255,255,0.6)", 12);
    const tc = card.querySelector(".tc-ship").getContext("2d");
    if(tc) SF.shipart.drawShip(tc, 48, 50, 72,
      { color: profile.shipColor, levels: SF.shipart.levelsOf(profile),
        t: 0.8, idle: false, tune: t.id });
    click(card, () => {
      if(!open){
        queueToast({ glyph:"lock", name:"Beat Mission " + t.unlockMission + "'s boss to win " + t.name,
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
  /*
   * Real elapsed time, not a hard-coded 1/60. The ceremony ran off the frame
   * COUNT, so it played at double speed on a 120Hz iPad and dragged on a tired
   * one - the only animation in the game that didn't agree with the clock the
   * game loop uses. Clamped the same way the game loop clamps, so a backgrounded
   * tab doesn't return and fast-forward the whole show in one frame.
   */
  let last = 0;
  const step = (now) => {
    hangar.raf = 0;
    if(!screens["screen-armory"].classList.contains("active")){ last = 0; return; }
    const dt = last ? Math.min(0.05, (now - last)/1000) : 1/60;
    last = now;
    hangar.t += dt;
    drawHangar(dt);
    hangar.raf = requestAnimationFrame(step);
  };
  hangar.raf = requestAnimationFrame(step);
}

/*
 * THE GARAGE. The bay used to be a landing pad floating on panel-dark - fine,
 * but a room nobody lived in. This is the family's garage: a pegboard of
 * parts on the wall (owned ones hanging, missing ones chalk outlines), the
 * Style Shop as paint tins on a shelf, a concrete floor with a painted
 * service circle stencilled with the pilot's own callsign, the squadron's
 * bays either side, and a service arm that swings in and FITS what you buy.
 *
 * Drawn with translate/scale + arc everywhere - the test harness's canvas
 * build predates ellipse() and roundRect(), so neither may be used raw.
 */
function gRR(c, x, y, w, h, r){
  r = Math.min(r, w/2, h/2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y); c.arc(x + w - r, y + r, r, -Math.PI/2, 0);
  c.lineTo(x + w, y + h - r); c.arc(x + w - r, y + h - r, r, 0, Math.PI/2);
  c.lineTo(x + r, y + h); c.arc(x + r, y + h - r, r, Math.PI/2, Math.PI);
  c.lineTo(x, y + r); c.arc(x + r, y + r, r, Math.PI, Math.PI*1.5);
  c.closePath();
}
function gEllipse(c, x, y, rx, ry){
  c.save(); c.translate(x, y); c.scale(1, ry/Math.max(0.0001, rx));
  c.beginPath(); c.arc(0, 0, rx, 0, Math.PI*2);
  c.restore();
}
function gSeeded(i){ return ((Math.sin(i*127.1 + 311.7)*43758.5453) % 1 + 1) % 1; }

const garage = { cv:null, key:"", ship:null };
function garageBackdrop(W, H, compare){
  const A = SF.shipart;
  const levels = A.levelsOf(profile);
  const parts = A.partList(levels);
  const next = A.nextPart(levels);
  /*
   * The squadmates are out of the key because they are out of the room. While
   * their bays were drawn here, a brother repainting his ship correctly threw
   * this cache away; now it would be a repaint for nothing.
   */
  const key = [W, H, compare ? 1 : 0, profile.callsign || profile.name,
               profile.shipColor, parts.map(r => r.owned ? 1 : 0).join(""),
               next ? next.id : "-"].join("|");
  if(garage.key === key) return garage.cv;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  if(!c) return null;
  const TAU2 = Math.PI*2;
  const wallH = H*0.26;

  /* -- the wall -- */
  const wg = c.createLinearGradient(0, 0, 0, wallH);
  wg.addColorStop(0, "#151a29");
  wg.addColorStop(1, "#1b2133");
  c.fillStyle = wg; c.fillRect(0, 0, W, wallH);
  c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1;
  for(let x = 0; x < W; x += 24){
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, wallH - 16); c.stroke();
  }
  // hazard stripe on the skirting, grimy
  c.save();
  c.beginPath(); c.rect(0, wallH - 16, W, 9); c.clip();
  for(let x = -20; x < W + 20; x += 20){
    c.fillStyle = "#d8ab3c";
    c.beginPath();
    c.moveTo(x, wallH - 7); c.lineTo(x + 10, wallH - 16);
    c.lineTo(x + 20, wallH - 16); c.lineTo(x + 10, wallH - 7);
    c.closePath(); c.fill();
  }
  c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(0, wallH - 16, W, 9);
  c.restore();
  c.fillStyle = "#0b0e18"; c.fillRect(0, wallH - 7, W, 7);

  /*
   * The wall is bare. It carried a PARTS pegboard - eight hooks showing the
   * upgrade ladder, owned parts as glyphs and the rest as chalk outlines -
   * and on a phone it was a 150px strip of 16px icons: a cryptic restatement
   * of the line directly beneath the bay, which already says which part is
   * next and what buys it, in words. Two answers to one question, and the
   * worse one was taking the top third of the room.
   */

  /* -- the floor -- */
  const fg = c.createLinearGradient(0, wallH, 0, H);
  fg.addColorStop(0, "#262b3b");
  fg.addColorStop(1, "#181c2a");
  c.fillStyle = fg; c.fillRect(0, wallH, W, H - wallH);
  c.strokeStyle = "rgba(0,0,0,0.26)"; c.lineWidth = 2;
  for(let i = 0; i <= 4; i++){
    const xT = W*0.5 + (i - 2)*W*0.23, xB = W*0.5 + (i - 2)*W*0.31;
    c.beginPath(); c.moveTo(xT, wallH); c.lineTo(xB, H); c.stroke();
  }
  c.beginPath(); c.moveTo(0, H*0.72); c.lineTo(W, H*0.72); c.stroke();
  for(let i = 0; i < 46; i++){
    const x = gSeeded(i)*W, y = wallH + gSeeded(i + 60)*(H - wallH);
    const r = 6 + gSeeded(i + 120)*22;
    const gg = c.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, gSeeded(i + 180) < 0.6 ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.025)");
    gg.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = gg;
    c.beginPath(); c.arc(x, y, r, 0, TAU2); c.fill();
  }
  // an oil stain and a couple of scuffs: the room has been used
  const og = c.createRadialGradient(W*0.09, H*0.9, 2, W*0.09, H*0.9, 22);
  og.addColorStop(0, "rgba(8,10,16,0.5)"); og.addColorStop(1, "rgba(8,10,16,0)");
  c.fillStyle = og;
  gEllipse(c, W*0.09, H*0.9, 22, 12); c.fill();
  c.strokeStyle = "rgba(0,0,0,0.2)"; c.lineWidth = 4; c.lineCap = "round";
  for(let i = 0; i < 3; i++){
    c.beginPath();
    c.arc(W*(0.6 + gSeeded(i + 300)*0.3), wallH + 20 + gSeeded(i + 340)*(H - wallH)*0.6,
          30 + gSeeded(i + 380)*40, Math.PI*0.2*gSeeded(i + 400), Math.PI*(0.3 + 0.2*gSeeded(i + 440)));
    c.stroke();
  }

  /* -- painted service circles, chipped by use -- */
  const ring2 = (cx, cy, r, alpha) => {
    c.strokeStyle = "rgba(240,200,90," + alpha + ")";
    c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU2); c.stroke();
    c.strokeStyle = "rgba(240,200,90," + alpha*0.35 + ")";
    c.lineWidth = 8;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU2); c.stroke();
    c.strokeStyle = "#20253400".slice(0, 7);
    c.strokeStyle = "#202534"; c.lineWidth = 5;
    for(let i = 0; i < 8; i++){
      const a = gSeeded(i + 500 + cx)*TAU2;
      c.beginPath(); c.arc(cx, cy, r, a, a + 0.05 + gSeeded(i + 540 + cx)*0.05); c.stroke();
    }
  };
  const stencil = (cx, cy, txt, px2, alpha) => {
    c.save();
    c.translate(cx, cy); c.scale(1, 0.86);
    c.fillStyle = "rgba(226,232,240," + alpha + ")";
    c.font = "700 " + px2 + "px Rajdhani, Arial, sans-serif";
    c.textAlign = "center";
    c.letterSpacing = "5px";
    c.fillText(txt, 0, 0);
    c.letterSpacing = "0px";
    c.restore();
  };

  if(compare){
    const cy = H*0.58, r = Math.min(W*0.17, H*0.30);
    ring2(W*0.28, cy, r, 0.6);
    ring2(W*0.72, cy, r, 0.6);
    garage.ship = null;
  } else {
    // 0.57, not 0.60: on the shorter phone frame the bay ring's lower edge and
    // the BAY 01 stencil under it were landing on the frame's rounded border.
    const cx = W/2, cy = H*0.57;
    const r = Math.min(W*0.20, H*0.36);
    /*
     * ONE BAY. The room used to park a chalk outline or a sibling's ship
     * either side of yours, and on a phone they were 40px wide, unreadable,
     * and directly between a child and the thing they came here to change.
     * The garage exists to show you YOUR ship; anything else in it is
     * competing with the only object on the screen that matters.
     */
    ring2(cx, cy, r, 0.75);
    stencil(cx, cy + r*0.8, (profile.callsign || profile.name).toUpperCase(), Math.max(13, r*0.155), 0.6);
    stencil(cx, cy + r*0.94, "BAY 01", Math.max(8, r*0.085), 0.35);
    garage.ship = { x: cx, y: cy, r };
  }

  /*
   * The room is deliberately bare. It carried a tool chest with a mug and
   * paint tins, a stack of crates and a leaning family photo - nice to draw,
   * and all of it scenery a player can neither use nor tap. On a phone the
   * hangar is already the biggest thing between them and the shelf, so every
   * pixel it spends has to earn its place, and none of that did.
   */

  garage.cv = cv; garage.key = key;
  return cv;
}

/*
 * THE PURCHASE SHOW - fitting, rev, dial (the dial lives in renderShipSpecs).
 * Queued, never blocking: money and the part land the instant you buy; this
 * is the ceremony that plays over the bay afterwards. Buy five things fast
 * and five little shows run back to back.
 */
function queuePurchaseShow(show){
  hangar.shows.push(show);
  if(hangar.shows.length > 4) hangar.shows.shift();   // a spree stays a show, not a backlog
}
const REV_KIND = {
  spread:"guns", rapid:"guns", damage:"guns", pierce:"guns", homing:"guns",
  thrusters:"engines", magnet:"magnet", fortune:"coins",
  shield:"bubble", life:"bubble", armor:"bubble",
  wingman:"drone", bomb:"badge", overdrive:"badge",
};
function stepShow(dt){
  if(!hangar.show && hangar.shows.length) hangar.show = hangar.shows.shift();
  const sh = hangar.show;
  if(!sh) return;
  sh.t = (sh.t || 0) + dt;
  const fitLen = sh.part ? 1.5 : 0;
  if(sh.part && !sh.swapped && sh.t >= 1.0){
    sh.swapped = true;                       // the part visibly POPS on
    audio.play("armourClang");
  }
  if(sh.kind === "guns" && sh.t >= fitLen){
    // fire at the ACTUAL new rate - faster guns are something you see
    sh.gunT = (sh.gunT || 0) - dt;
    if(sh.gunT <= 0){
      sh.gunT = Math.max(0.07, sh.after.fireInterval);
      sh.bolts = sh.bolts || [];
      const g2 = garage.ship;
      if(g2){
        const S = sh.shipS || 100;
        [[-0.10, -0.33], [0.10, -0.33], [-0.26, -0.13], [0.26, -0.13]].forEach(([fx3, fy3]) => {
          sh.bolts.push({ x: g2.x + fx3*S, y: g2.y + fy3*S, age: 0 });
        });
        sh.muzzle = 0.09;
      }
    }
  }
  sh.muzzle = Math.max(0, (sh.muzzle || 0) - dt);
  (sh.bolts || []).forEach(b => { b.age += dt; b.y -= 340*dt; });
  if(sh.bolts) sh.bolts = sh.bolts.filter(b => b.age < 0.8);
  if(sh.t > fitLen + 2.0){ hangar.show = null; }
}

function drawShow(ctx, W, H, S){
  const sh = hangar.show, g2 = garage.ship;
  if(!sh || !g2) return;
  sh.shipS = S;
  const t2 = sh.t, fitLen = sh.part ? 1.5 : 0;
  const TAU2 = Math.PI*2;

  /* -- the fitting: the arm swings in with the part and bolts it on -- */
  if(sh.part && t2 < fitLen + 0.3){
    const reach = clamp(t2/0.5, 0, 1);
    const retreat = clamp((t2 - 1.2)/0.3, 0, 1);
    const k = reach - retreat;
    const parkX = W + 4, parkY = H*0.30;
    const tipX = parkX + (g2.x + S*0.34 - parkX)*k;
    const tipY = parkY + (g2.y - S*0.06 - parkY)*k;
    const elbX = (parkX + tipX)/2 + 22, elbY = (parkY + tipY)/2 - 34;
    ctx.lineCap = "round";
    const seg = (x1, y1, x2, y2, w1, w2) => {
      ctx.strokeStyle = "#0c101d"; ctx.lineWidth = w1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = "#3a415f"; ctx.lineWidth = w2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    seg(parkX, parkY, elbX, elbY, 12, 8);
    seg(elbX, elbY, tipX, tipY - 16, 9, 6);
    [[parkX, parkY], [elbX, elbY]].forEach(([jx, jy]) => {
      ctx.fillStyle = "#232a40";
      ctx.beginPath(); ctx.arc(jx, jy, 7, 0, TAU2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.6; ctx.stroke();
    });
    ctx.fillStyle = "#2c3350"; gRR(ctx, tipX - 8, tipY - 24, 16, 12, 3); ctx.fill();
    if(!sh.swapped){                        // still carrying the part
      ctx.fillStyle = "#ffd23f"; gRR(ctx, tipX - 5, tipY - 10, 10, 8, 2); ctx.fill();
    }
    // sparks while it works
    if(t2 > 0.55 && t2 < 1.3){
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for(let i = 0; i < 7; i++){
        const a = -Math.PI/2 + (gSeeded(i + Math.floor(t2*30)) - 0.5)*2.4;
        const d = 4 + gSeeded(i + 40 + Math.floor(t2*20))*16;
        ctx.fillStyle = i % 3 ? "rgba(255,214,90,0.95)" : "#ffffff";
        ctx.fillRect(tipX + Math.cos(a)*d, tipY - 4 + Math.sin(a)*d, 2, 2);
      }
      const sg2 = ctx.createRadialGradient(tipX, tipY - 4, 0, tipX, tipY - 4, 18);
      sg2.addColorStop(0, "rgba(255,230,150,0.55)");
      sg2.addColorStop(1, "rgba(255,230,150,0)");
      ctx.fillStyle = sg2;
      ctx.beginPath(); ctx.arc(tipX, tipY - 4, 18, 0, TAU2); ctx.fill();
      ctx.restore();
    }
    // the moment it pops on: one white kiss
    if(sh.swapped && t2 < 1.18){
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1 - (t2 - 1.0)/0.18;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(g2.x + S*0.2, g2.y - S*0.05, S*0.2, 0, TAU2); ctx.fill();
      ctx.restore();
    }
  }

  if(t2 < fitLen) return;
  const rt = t2 - fitLen, rk = clamp(rt/0.25, 0, 1);

  /* -- the rev: the ship shows off the thing you bought -- */
  if(sh.kind === "guns"){
    // the practice hologram it fires into
    const hx = g2.x, hy = Math.max(H*0.30, g2.y - S*0.82);
    ctx.save();
    ctx.globalAlpha = rk;
    ctx.strokeStyle = "rgba(76,201,240,0.7)";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    [S*0.16, S*0.10, S*0.045].forEach((rr, i) => {
      ctx.beginPath(); ctx.arc(hx, hy, rr, rt*(i % 2 ? -1.2 : 1.2), rt*(i % 2 ? -1.2 : 1.2) + TAU2); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = "lighter";
    const hg = ctx.createRadialGradient(hx, hy, 2, hx, hy, S*0.24);
    hg.addColorStop(0, "rgba(76,201,240,0.3)");
    hg.addColorStop(1, "rgba(76,201,240,0)");
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(hx, hy, S*0.24, 0, TAU2); ctx.fill();
    // tracers + muzzle stars
    (sh.bolts || []).forEach(b => {
      const bg = ctx.createLinearGradient(b.x, b.y + 8, b.x, b.y - 8);
      bg.addColorStop(0, "rgba(255,214,90,0)");
      bg.addColorStop(1, "rgba(255,255,255,0.95)");
      ctx.fillStyle = bg;
      gRR(ctx, b.x - 2, b.y - 8, 4, 16, 2); ctx.fill();
    });
    if(sh.muzzle > 0){
      [[-0.10, -0.33], [0.10, -0.33], [-0.26, -0.13], [0.26, -0.13]].forEach(([fx3, fy3]) => {
        ctx.fillStyle = "rgba(255,240,190,0.9)";
        for(let q = 0; q < 3; q++){
          gEllipse(ctx, g2.x + fx3*S, g2.y + fy3*S, 6, 2);
          ctx.save(); ctx.translate(g2.x + fx3*S, g2.y + fy3*S);
          ctx.rotate(q*TAU2/3 + 0.5);
          ctx.fillRect(-5, -1, 10, 2);
          ctx.restore();
        }
      });
    }
    ctx.restore();
  } else if(sh.kind === "engines"){
    // it strains against the floor: hot plume + speed streaks
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const pg2 = ctx.createLinearGradient(0, g2.y + S*0.3, 0, g2.y + S*0.85);
    pg2.addColorStop(0, "rgba(120,190,255,0.5)");
    pg2.addColorStop(1, "rgba(120,190,255,0)");
    ctx.fillStyle = pg2;
    ctx.beginPath();
    ctx.moveTo(g2.x - S*0.09, g2.y + S*0.3);
    ctx.lineTo(g2.x + S*0.09, g2.y + S*0.3);
    ctx.lineTo(g2.x + S*0.03, g2.y + S*(0.72 + Math.sin(rt*22)*0.08));
    ctx.lineTo(g2.x - S*0.03, g2.y + S*(0.72 + Math.sin(rt*22)*0.08));
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(160,200,255,0.4)"; ctx.lineWidth = 2; ctx.lineCap = "round";
    for(let i = 0; i < 6; i++){
      const sx3 = g2.x + (gSeeded(i + 60) - 0.5)*S*1.3;
      const sy3 = g2.y + S*0.5 - ((rt*260 + i*57) % (S*1.1));
      ctx.beginPath(); ctx.moveTo(sx3, sy3); ctx.lineTo(sx3, sy3 + 16); ctx.stroke();
    }
    ctx.restore();
  } else if(sh.kind === "bubble"){
    const pulse = Math.abs(Math.sin(rt*Math.PI*1.5));
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse*0.45;
    ctx.strokeStyle = "#3fc9ff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(g2.x, g2.y, S*0.56 + pulse*6, 0, TAU2); ctx.stroke();
    ctx.globalAlpha = 0.1 + pulse*0.14;
    ctx.fillStyle = "#3fc9ff";
    ctx.beginPath(); ctx.arc(g2.x, g2.y, S*0.56 + pulse*6, 0, TAU2); ctx.fill();
    ctx.restore();
  } else if(sh.kind === "magnet" || sh.kind === "coins"){
    const col = sh.kind === "coins" ? "255,210,63" : "120,220,255";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for(let i = 0; i < 10; i++){
      const u2 = ((rt*0.9 + i*0.1) % 1);
      const a = gSeeded(i + 800)*TAU2;
      const d = (1 - u2)*S*0.95;
      ctx.fillStyle = "rgba(" + col + "," + (0.25 + u2*0.7).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(g2.x + Math.cos(a + u2*1.8)*d, g2.y + Math.sin(a + u2*1.8)*d*0.7,
              sh.kind === "coins" ? 3 : 2, 0, TAU2);
      ctx.fill();
    }
    ctx.restore();
  } else if(sh.kind === "drone"){
    const u2 = clamp(rt/0.6, 0, 1);
    const dx2 = g2.x + (S*0.52)*u2, dy2 = g2.y + S*0.1 - Math.sin(rt*3)*5;
    SF.shipart.drawShip(ctx, dx2, dy2, S*0.2, {
      color: (P.squadmates(profile.name)[0] || {}).shipColor || profile.shipColor,
      levels: {}, t: hangar.t, idle: false });
  } else if(sh.kind === "badge"){
    const u2 = clamp(rt/1.2, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - u2*0.7;
    ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(g2.x, g2.y - S*0.5, S*(0.1 + u2*0.35), 0, TAU2); ctx.stroke();
    ctx.restore();
    const ic = SF.icons.el(sh.up, "#ffd23f", 22);
    ctx.drawImage(ic, g2.x - 11, g2.y - S*0.5 - 11 - u2*14, 22, 22);
  }
}

function drawHangar(dt){
  const ctx = hangar.ctx;
  if(!ctx || !profile) return;
  const A = SF.shipart;
  const cv = ctx.canvas;
  /*
   * The backing store follows the FRAME's shape.
   *
   * The canvas is a fixed 620x360 and the stage is `object-fit: contain`, so
   * the moment the stage got shorter on phones the room was letterboxed - the
   * wall and floor rendered as a band across the middle with dead bars either
   * side. Matching the backing height to the box's real aspect makes the room
   * fill its frame at any shape; every coordinate in here is already a fraction
   * of W or H, so the drawing follows on its own. `garage.key` carries H, so
   * the backdrop rebuilds itself the one frame this changes.
   */
  const box = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
  if(box && box.width > 4 && box.height > 4){
    const want = clamp(Math.round(cv.width * box.height / box.width), 180, 520);
    if(Math.abs(cv.height - want) > 2) cv.height = want;
  }
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  const backdrop = garageBackdrop(W, H, hangar.compare);
  if(backdrop) ctx.drawImage(backdrop, 0, 0);
  stepShow(dt || 1/60);

  const wallH = H*0.26;
  // The work light over the hero bay: a beam, its pool, and dust drifting in
  // it - the live things the cached room can't carry.
  const litX = hangar.compare ? W/2 : W/2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const beam = ctx.createLinearGradient(0, wallH - 8, 0, H*0.86);
  beam.addColorStop(0, "rgba(255,236,190,0.11)");
  beam.addColorStop(1, "rgba(255,236,190,0)");
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(litX - W*0.07, wallH - 8); ctx.lineTo(litX + W*0.07, wallH - 8);
  ctx.lineTo(litX + W*0.3, H*0.86); ctx.lineTo(litX - W*0.3, H*0.86);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,244,214,0.5)";
  for(let i = 0; i < 10; i++){
    const u2 = ((hangar.t*0.03 + i*0.1) % 1);
    const yy = wallH + u2*(H*0.8 - wallH);
    const xx = litX + (gSeeded(i + 20) - 0.5)*W*0.5*u2 + Math.sin(hangar.t*0.7 + i)*4;
    ctx.fillRect(xx, yy, 1.3, 1.3);
  }
  ctx.restore();
  ctx.fillStyle = "#0d1120"; gRR(ctx, litX - 18, wallH - 13, 36, 8, 3); ctx.fill();
  ctx.fillStyle = "rgba(255,236,190,0.9)"; gRR(ctx, litX - 13, wallH - 7, 26, 3, 1.5); ctx.fill();



  // Parked, not floating: a contact shadow directly under each hull.
  const padShadow = (sx, sy, r) => {
    ctx.save();
    ctx.translate(sx, sy); ctx.scale(1, 0.3);
    const sfx = ctx.createRadialGradient(0, 0, 4, 0, 0, r);
    sfx.addColorStop(0, "rgba(0,0,0,0.42)");
    sfx.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sfx;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  };

  const levels = A.levelsOf(profile);
  const next = A.nextPart(levels);

  if(hangar.compare){
    const cy = H*0.58;
    padShadow(W*0.28, cy + H*0.08, W*0.13);
    padShadow(W*0.72, cy + H*0.08, W*0.13);
    A.drawShip(ctx, W*0.28, cy, Math.min(W*0.27, H*0.54), {
      color: profile.shipColor, levels: {}, t: hangar.t });
    A.drawShip(ctx, W*0.72, cy, Math.min(W*0.27, H*0.54), {
      color: profile.shipColor, levels, t: hangar.t, tune: profile.tune,
      decal: profile.decal });
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W/2, H*0.14); ctx.lineTo(W/2, H*0.92); ctx.stroke();
  } else {
    const S = Math.min(W*0.34, H*0.54);
    const g2 = garage.ship || { x: W/2, y: H*0.60 };
    // The fitting swap: until the arm's spark moment the ship still wears its
    // OLD levels, so the part visibly ARRIVES rather than having always been.
    const sh = hangar.show;
    const wear = (sh && sh.part && !sh.swapped) ? sh.levelsBefore : levels;
    // engines rev: the ship strains forward against the floor
    const strain = sh && sh.kind === "engines" && sh.t >= (sh.part ? 1.5 : 0)
      ? Math.sin((sh.t)*18)*1.5 - 4 : 0;
    padShadow(g2.x, g2.y + S*0.14, S*0.55);
    A.drawShip(ctx, g2.x, g2.y + strain, S, {
      color: profile.shipColor, levels: wear, t: hangar.t, tune: profile.tune,
      decal: profile.decal,
      ghost: next ? next.id : null,
      mateColor: (P.squadmates(profile.name)[0] || {}).shipColor,
    });
    const bob = Math.sin(hangar.t*1.6)*S*0.018;
    SF.pilotart.paint(ctx, g2.x, g2.y + strain + bob - S*0.055, S*0.15, profile);

    drawShow(ctx, W, H, S);

    // Part-fitted celebration: a white flash and a gold ring rolling off the
    // hull for a beat after a purchase bolts something new on.
    const since = (performance.now() - hangar.celebrate)/1000;
    if(hangar.celebrate && since < 0.9){
      const k = since/0.9;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (1-k)*0.5;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(g2.x, g2.y, S*0.55*(0.6+k*0.2), 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1-k;
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 4*(1-k) + 1;
      ctx.beginPath(); ctx.arc(g2.x, g2.y, S*(0.4 + k*0.55), 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
}

/*
 * The garage answers taps: the ship jumps the shop to the next part on the
 * ladder. NOTHING else in the room takes one, so a stray finger never does
 * anything surprising.
 */
function jumpToUpgrade(id){
  const u = UPGRADE_BY_ID[id];
  if(!u) return;
  audio.play("uiClick");
  armoryTab = u.cat;
  renderArmory();
  requestAnimationFrame(() => {
    const badge = $("armoryPanel").querySelector('.si-badge[data-glyph="' + id + '"]');
    const row = badge && badge.closest(".shop-item");
    if(row){
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.remove("flash");
      void row.offsetWidth;
      row.classList.add("flash");
    }
  });
}
function initGarageTaps(){
  const cv = $("hangarCanvas");
  if(!cv) return;
  cv.addEventListener("click", ev => {
    if(hangar.compare) return;
    const rect = cv.getBoundingClientRect();
    const sx = rect.width ? cv.width/rect.width : 1;
    const sy = rect.height ? cv.height/rect.height : 1;
    const x = (ev.clientX - (rect.left || 0))*sx;
    const y = (ev.clientY - (rect.top || 0))*sy;
    // The ship is the only thing in the room that answers a tap now, and it
    // answers the only question the room poses: what goes on next.
    const g2 = garage.ship;
    if(g2 && Math.hypot(x - g2.x, y - g2.y) <= g2.r){
      const next = SF.shipart.nextPart(SF.shipart.levelsOf(profile));
      if(next) jumpToUpgrade(next.up);
    }
  });
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
  const changedRows = [];
  rows.forEach((r, i) => {
    const rowEl = el.children[i];
    const bar = rowEl.querySelector(".hs-bar i");
    const val = rowEl.querySelector(".hs-value");
    const pct = Math.max(3, Math.round(Math.min(1, r.value/r.max) * 100)) + "%";
    const changed = val.textContent !== "" && val.textContent !== r.show;
    const prevPct = parseFloat(bar.style.width) || 0;
    if(bar.style.width !== pct) requestAnimationFrame(() => { bar.style.width = pct; });
    val.textContent = r.show;
    if(changed){
      rowEl.classList.remove("bump");
      void rowEl.offsetWidth;               // restart the animation
      rowEl.classList.add("bump");
      changedRows.push({ rowEl, prevPct, newPct: parseFloat(pct) });
    }
  });
  /*
   * THE DIAL. A changed bar used to bump and that was all - honest, but easy
   * to miss under a thumb. Now the grown chunk itself is drawn in gold, from
   * where the bar WAS to where it IS, and every row that didn't move steps
   * back for two seconds, so the one that did is the only bright thing on
   * the panel. Losses (a tune trade) show the same chunk in red, shrinking.
   */
  if(changedRows.length){
    clearTimeout(hangar.dialTimer);
    Array.from(el.children).forEach(rowEl => {
      rowEl.classList.toggle("dim", !changedRows.some(c => c.rowEl === rowEl));
      rowEl.classList.remove("hot");
      const old = rowEl.querySelector(".hs-gain");
      if(old) old.remove();
    });
    changedRows.forEach(({ rowEl, prevPct, newPct }) => {
      rowEl.classList.add("hot");
      const track = rowEl.querySelector(".hs-bar");
      const gain = document.createElement("span");
      gain.className = "hs-gain" + (newPct < prevPct ? " loss" : "");
      const a2 = Math.min(prevPct, newPct), b2 = Math.max(prevPct, newPct);
      gain.style.left = a2 + "%";
      gain.style.width = Math.max(2, b2 - a2) + "%";
      track.appendChild(gain);
    });
    hangar.dialTimer = setTimeout(() => {
      Array.from(el.children).forEach(rowEl => {
        rowEl.classList.remove("dim", "hot");
        const g2 = rowEl.querySelector(".hs-gain");
        if(g2) g2.remove();
      });
    }, 2400);
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

  /*
   * Default to a tier they have actually BEATEN, not the hardest one the star
   * count has unlocked.
   *
   * The old rule took the last unlocked tier on the theory that "that's the one
   * they want". NIGHTMARE unlocks at 24 stars - eight three-starred missions -
   * so from about mission 9 onward every briefing a seven-year-old opened was
   * pre-set to 3.6x the enemies and 7.5x the armour, and the only way out was
   * noticing a row of cards and downgrading, every single time. They press the
   * big glowing LAUNCH button and lose, with nothing telling them why. (The
   * two-losses-and-we-offer-ROOKIE net further down was already treating this
   * symptom.)
   *
   * So: the best tier they have cleared THIS mission on, else the tier they
   * last flew, else PILOT. Never a tier they have not yet finished anything on.
   */
  const unlocked = DIFFICULTIES.filter(d => stars >= d.unlockStars);
  const rec = profile.missions[m.id];
  const clearedHere = rec && rec.stars
    ? DIFFICULTIES.filter(d => (rec.stars[d.id] || 0) > 0 && stars >= d.unlockStars) : [];
  const lastFlown = DIFFICULTIES.find(d => d.id === profile.lastDifficulty && stars >= d.unlockStars);
  briefTier = (clearedHere[clearedHere.length-1] || lastFlown ||
               unlocked[0] || DIFFICULTIES[1]).id;
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
      <span class="diff-name">${locked ? '<i class="lock-slot"></i>' : d.name}</span>
      <span class="diff-tag">${locked ? stars + "/" + d.unlockStars + " ★" : d.tag}</span>
      <span class="diff-stars">${locked ? "" :
        [0,1,2].map(i => `<i class="${i < earned ? "on" : ""}">★</i>`).join("")}</span>`;
    fillGlyphs(card, null, "rgba(255,255,255,0.65)", 16);
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
  // The detail line speaks the reader's language, not the tuning table's:
  // "205% as many enemies · 2.6x health" is for the balance sheet, and the
  // reader is seven. Pay keeps its number - the money is the hook.
  const crowd = d.density <= 0.8 ? "a thinner crowd"
              : d.density <= 1.2 ? "the normal crowd"
              : d.density <= 2.2 ? "twice the enemies"
              : d.density <= 3.0 ? "almost three times the enemies"
              : "a sky full of enemies";
  const armour = d.hpMult <= 0.9 ? "paper armour"
               : d.hpMult <= 1.2 ? "normal armour"
               : d.hpMult <= 3.0 ? "tougher armour"
               : d.hpMult <= 5.0 ? "much tougher armour"
               : "monster armour";
  const payLine = d.pay === 1 ? "normal pay"
                : d.pay < 1 ? "smaller pay"
                : `pays ${d.pay}× the money`;
  $("briefDiffDetail").innerHTML =
    `<b style="color:${d.color}">${d.name}</b> — ${esc(d.blurb)}` +
    `<span>${crowd} · ${armour} · ${payLine}</span>`;
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

function wackyUnlocked(p){
  const rec = p && p.missions && p.missions[3];
  return !!(rec && rec.cleared);
}

// Boss missions, in campaign order - the rush queue mirrors these. Derived,
// not listed: the hand-kept copy had drifted to pre-Act-3 mission numbers, so
// the menu was counting ordinary clears as bosses in the queue.
const RUSH_IDS = MISSIONS.filter(m => m.boss && ["marauder","jailer","sentinel","warden","phantom","leviathan","devourer"].includes(m.boss)).map(m => m.id);
function rushUnlocked(p){
  const rec = p && p.missions && p.missions[4];
  return !!(rec && rec.cleared);
}

function launch(index, difficultyId){
  /*
   * The unlock gate lives HERE, not only on the campaign map.
   *
   * `launch` used to call straight through to startMission, and the results
   * screen's NEXT MISSION button calls it with `missionIndex + 1`. So clearing
   * mission 28 and pressing NEXT walked a pilot into Sky 29 with any number of
   * stars at all, straight past the 84-star gate that is the whole reason
   * reaching it means anything. It would also have indexed off the end of
   * MISSIONS if `hasNext` were ever computed wrongly upstream.
   */
  if(typeof index === "number"){
    if(index < 0 || index >= MISSIONS.length || !isMissionUnlocked(profile, index)){
      renderMissions();
      show("screen-missions");
      if(MISSIONS[index]) queueToast({ glyph:"lock", label:"LOCKED",
        name: MISSIONS[index].name + " needs more stars — keep flying!" });
      return;
    }
  }
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
  if(cost === null || profile.money < cost) return false;
  const rankBefore = P.rankFor(profile).name;
  const levelsBefore = SF.shipart.levelsOf(profile);
  const partsBefore = SF.shipart.ownedCount(levelsBefore);
  // Captured around the purchase so the rev can DEMONSTRATE the difference -
  // guns fire at the actual new rate, not at a metaphor of it.
  const loadBefore = SF.game.buildLoadout(profile, SF.config.DIFFICULTY_BY_ID.pilot);
  profile.money -= cost;
  profile.upgrades[id] = P.upgradeLevel(profile, id) + 1;
  P.save(profile);
  const loadAfter = SF.game.buildLoadout(profile, SF.config.DIFFICULTY_BY_ID.pilot);
  const newLevel = P.upgradeLevel(profile, id);
  /*
   * Remember what was just bought, so the NEXT flight can point at it.
   *
   * The whole repair to this game's economy was making an upgrade change what
   * happens in the sky - but a change you cannot see is still a change you do
   * not believe in, and a seven-year-old who saved for three sessions deserves
   * to be told, in the air, that the thing they bought is the reason it went
   * better. Cleared at the end of that flight, so it names itself exactly once.
   */
  profile.freshGear = { id: id, level: newLevel };
  P.save(profile);
  const fitted = SF.shipart.PARTS.find(pt => pt.up === id && pt.at === newLevel) || null;
  queuePurchaseShow({
    up: id, kind: REV_KIND[id] || "badge", part: fitted,
    levelsBefore, before: loadBefore, after: loadAfter, t: 0,
  });
  audio.play("uiBuy");
  P.checkAchievements(profile).forEach(queueToast);
  renderArmory();
  const rankNow = P.rankFor(profile);
  if(rankNow.name !== rankBefore) queueToast({ insignia: rankNow.badge, color: profile.shipColor,
    name: "PROMOTED: " + rankNow.name, label:"RANK UP" });

  // A purchase that changes the *shape* of the ship deserves to be seen, and
  // the twentieth level is the story's chapter break.
  const partsNow = SF.shipart.ownedCount(SF.shipart.levelsOf(profile));
  if(partsNow > partsBefore){
    const part = SF.shipart.PARTS.filter(pt => (P.upgradeLevel(profile, pt.up) >= pt.at))[partsNow-1];
    queueToast({ glyph:"parts", name: "FITTED: " + (part ? part.name : "NEW PART"), label:"HANGAR" });
    // And the bay celebrates: white flash + gold ring rolling off the hull.
    hangar.celebrate = performance.now();
  }
  if(P.gearLevel(profile) >= 20) maybeStory("ace");
  else if(partsNow > 0 && partsBefore === 0) maybeStory("firstPart");
  return true;
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
    ? `<span>NEXT UP</span>${esc(next.name)} — ${esc(next.desc)} · <b>£${next.pay.toLocaleString("en-GB")}</b>`
    : `<span>COMPLETE</span>Every medal earned. Nothing left to win.`;

  drawMedalRing(owned.length / ACHIEVEMENTS.length);

  // Every medal names its bounty. Earned-but-unclaimed ones carry a COLLECT
  // button - pressing it is the ceremony, and the reason to keep coming back.
  // The medals themselves are drawn (SF.icons.medal): the emoji set rendered
  // as OS stickers, differently on every device, next to hand-drawn ships.
  $("achievementsList").innerHTML = ACHIEVEMENTS.map(a => {
    const has = owned.includes(a.id);
    const claimed = !!profile.medalsClaimed[a.id];
    return `<div class="medal${has ? " won" : ""}${has && !claimed ? " owed" : ""}">
      <div class="medal-disc"><i class="medal-slot" data-medal-id="${a.id}" data-locked="${has ? "" : "1"}"></i></div>
      <div class="medal-name">${esc(a.name)}</div>
      <div class="medal-desc">${esc(a.desc)}</div>
      ${has
        ? (claimed
            ? `<div class="medal-pay done">£${a.pay.toLocaleString("en-GB")} collected</div>`
            : `<button class="medal-claim" data-medal="${a.id}">COLLECT £${a.pay.toLocaleString("en-GB")}</button>`)
        : `<div class="medal-pay">worth £${a.pay.toLocaleString("en-GB")}</div>`}
    </div>`;
  }).join("");

  qa2($("achievementsList"), ".medal-slot").forEach(slot => {
    slot.appendChild(SF.icons.medal(slot.dataset.medalId, 52, !!slot.dataset.locked));
    slot.classList.remove("medal-slot");
  });
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
  // The Wacky Sky crown sits on top of the record board - the one record no
  // campaign stop owns, and the mode both brothers can grind forever.
  const wackyRows = P.listNames().map(P.load).filter(q => (q.endlessBest || 0) > 0)
    .sort((a,b) => b.endlessBest - a.endlessBest);
  const wackyRow = wackyRows.length ? `<div class="rb-row rb-wacky${wackyRows[0].name === profile.name ? " mine" : ""}">
      <span class="rb-num">★</span>
      <span class="rb-name">Wacky Sky</span>
      <span class="rb-holder">${esc(wackyRows[0].callsign || wackyRows[0].name)}</span>
      <span class="rb-score">${wackyRows[0].endlessBest.toLocaleString()}</span>
    </div>` : "";
  $("recordBoard").innerHTML = wackyRow + flown.map(m => {
    const best = P.familyBest(m.id);
    const mine = best.owner === profile.name;
    return `<div class="rb-row${mine ? " mine" : ""}">
      <span class="rb-num">${m.id}</span>
      <span class="rb-name">${esc(m.name)}</span>
      <span class="rb-holder">${esc(best.name)}</span>
      <!-- The tier it was set on. Without it the board reads as one race that
           the youngest can never win; with it, "9,400 on NIGHTMARE" is visibly
           a different race from the PILOT one he can go and take. -->
      <span class="rb-score">${best.score.toLocaleString()}${
        best.tier ? `<i class="rb-tier">${esc((SF.config.DIFFICULTY_BY_ID[best.tier] || {}).name || best.tier)}</i>` : ""}</span>
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
    renderPauseState();
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

/** The pause screen is a save point, not a wall: what you were doing, and
    how far you'd got before the iPad went down. */
function renderPauseState(){
  const run = SF.game.run;
  if(!run) return;
  $("pauseGoal").textContent = run.mission.goal || run.mission.subtitle || "";
  $("pauseObjectives").innerHTML = (run.objectiveDefs || []).map(def => {
    const met = def.test(run.stats);
    const prog = def.progress ? def.progress(run.stats) : "";
    return `<div class="${met ? "met" : ""}">${met ? "★" : "☆"} ${esc(def.label)}${
      prog && !met ? " — " + esc(prog) : ""}</div>`;
  }).join("");
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
  const odReady = p.overdrives > 0 && SF.game.now() >= p.overdriveUntil;
  odBtn.classList.toggle("empty", !odReady);
  $("overdriveCount").textContent = p.overdrives;
}

function hideResults(){ $("overlayResults").classList.add("hidden"); }

function showResults(result){
  const { completed, stars, run, objectives, unlocked, prevFamilyBest, prevSelfBest,
          endless, endlessNewBest, durationSec, rush, rushBeaten, rushTotal } = result;
  $("resultTitle").textContent = rush ? (completed ? "RUSH COMPLETE!" : "RUSH OVER")
    : endless ? "WHAT A FLIGHT!"
    : completed ? "MISSION COMPLETE" : "SHIP DOWN";
  $("resultTitle").style.color = rush ? (completed ? "#4ade80" : "#ffd23f")
    : endless ? "#ffd23f"
    : completed ? "#4ade80" : "#ff9d5c";
  // A win wears gold; a loss stays quiet. The same grey ledger for a
  // three-star sweep and a shoot-down was the results screen's real problem.
  $("overlayResults").classList.toggle("victory", !!(completed || (endless && endlessNewBest)));

  // Losing should read as "you nearly had it", not as a telling-off - and you
  // always keep the money you collected, so a failed run is never wasted.
  const sub = $("resultSubtitle");
  if(rush){
    sub.textContent = completed
      ? "ALL " + rushTotal + " bosses down, " + (profile.callsign || profile.name) + "!"
      : rushBeaten + " of " + rushTotal + " bosses down — go again?";
  } else if(endless){
    // A Wacky Sky run never fails - it just has a length and a score.
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
  // (wacky, rush) run at a fixed tier, so they never offer it.
  $("rookieBtn").classList.toggle("hidden",
    !(!endless && !rush && !run.mission.custom && !completed && failStreak && failStreak.n >= 2 && run.difficulty.id !== "rookie"));

  // Combat's over: a win keeps the calm menu theme the victory lap started;
  // a loss gets the ten-second defeat sting, which hands back to the menu.
  // A Wacky Sky ending is never a defeat, so it never gets the sting.
  audio.setMusic(completed || endless ? "menu" : "defeat");

  // Three stars rains confetti; any win gets a lighter shower. Pride
  // deserves paper, and a one-star scrape-through is still a win to a kid.
  const oldConf = $("overlayResults").querySelector(".confetti");
  if(oldConf) oldConf.remove();
  const bigWin = (completed && stars === 3) || (endless && endlessNewBest) || (rush && completed);
  if(bigWin || completed){
    const conf = document.createElement("div");
    conf.className = "confetti";
    const colors = ["#ffd23f","#ff5d73","#4ade80","#3fc9ff","#c084fc","#ffffff"];
    for(let i=0;i<(bigWin ? 54 : 20);i++){
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
  // worth it. The Wacky Sky has no stars: the score is the whole story.
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
    <div class="rl"><span>Score</span><b data-countup="${run.score}">0</b></div>
    <div class="rl"><span>Money collected</span><b class="money" data-countup="${run.money}" data-prefix="+£">+£0</b></div>
    ${run.completionBonus ? `<div class="rl"><span>Mission bonus (${stars} ★)</span><b class="money">included</b></div>` : ""}
    <div class="rl"><span>Enemies destroyed</span><b>${(endless || rush) ? s.kills
      : s.kills + "/" + Math.max(s.spawned, run.director.totalPlanned)}</b></div>
    <div class="rl"><span>Pilots rescued</span><b>${(endless || rush) ? s.rescues
      : s.rescues + "/" + s.rescuesTotal}</b></div>
    ${run.maxCombo > 1 ? `<div class="rl"><span>Best combo</span><b>x${run.maxCombo}</b></div>` : ""}
    ${freshGearLine(run)}
    ${crewLine()}
    <div class="rl"><span>Wallet</span><b class="money" data-countup="${profile.money}" data-prefix="£">£0</b></div>
    ${medalLines(unlocked)}
    ${endless ? wackyRecordLine() : rush ? rushRecordLine() : recordLine(run, prevFamilyBest)}`;

  renderResultComms(run, completed || (endless && endlessNewBest), stars, prevFamilyBest,
                    endless ? result.prevEndlessBest : prevSelfBest);

  const hasNext = completed && run.missionIndex + 1 < MISSIONS.length;
  $("nextBtn").classList.toggle("hidden", !hasNext);
  $("overlayResults").classList.remove("hidden");
  runCountUps($("resultLines"));
  renderMenu();
  holdToasts(1500);   // let the results card land before medals pop over it
  (unlocked || []).forEach(queueToast);
  // First time a campaign boss falls, its tune becomes yours - and the toast
  // says where to go fit it.
  if(result.firstClear && run.mission.boss){
    const wonTune = SF.config.TUNES.find(t => t.unlockMission === run.mission.id);
    if(wonTune) queueToast({ name: wonTune.name + " tune won! Fit it in MY SHIP",
      label:"TUNE UNLOCKED" });
  }
  if(result.vaultWon)
    queueToast({ glyph:"star", name:"SOLAR GOLD — the star's own paint. Yours alone.",
      label:"SECRET FOUND" });
  if(result.sky29Won)
    queueToast({ glyph:"star", name: SF.missions.giftName() + " — the dawn off Papa's last canvas. Wear it well.",
      label:"PAINT WON" });
  // The 84th star is a door opening, and the door is at the top of the map.
  if(result.allStarsNow)
    queueToast({ glyph:"star", name:"EVERY STAR IS HOME — " + SF.missions.GIFT.name + " is waiting at the top of the map.",
      label: SF.missions.giftName() + " UNLOCKED" });
  // The true curtain lives behind the sky now; the Devourer keeps its own.
  // Anchoring the old finale to its mission (not to campaignComplete) matters:
  // with Act 4 in the campaign, a fresh profile would otherwise get the
  // Devourer's curtain played over the workshop's ending.
  if(completed && P.campaignComplete(profile)) maybeStory("workshop");
  else if(completed && run.missionIndex === DEVOURER_END) maybeStory("campaign");
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

/** Who holds the Wacky Sky crown right now - shown after every wacky run. */
function wackyRecordLine(){
  const rows = P.listNames().map(P.load).filter(q => (q.endlessBest || 0) > 0)
    .sort((a,b) => b.endlessBest - a.endlessBest);
  if(!rows.length) return "";
  const top = rows[0];
  const mine = top.name === profile.name;
  return `<div class="rl record"><span>Wacky Sky crown</span><b>${mine ? "YOURS" :
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

/*
 * THE NEW PART, AND WHAT IT DID.
 *
 * One line, only on the first flight after a purchase. It names the upgrade,
 * repeats its own plain-English effect (the same string the shop shelf shows,
 * already written for a seven-year-old), and adds the one tally from this run
 * that the part is actually responsible for - so "3 damage per hit" arrives
 * attached to "47 enemies destroyed" rather than floating as a number.
 *
 * The tally is chosen per shelf, because "enemies destroyed" says nothing about
 * a Tractor Beam and "coins grabbed" says nothing about Hull Plating.
 */
function freshGearLine(run){
  const fg = run.freshGear;
  if(!fg) return "";
  const s = run.stats;
  let proof = "";
  if(fg.cat === "guns")
    proof = s.kills + (s.kills === 1 ? " enemy destroyed" : " enemies destroyed");
  else if(fg.id === "fortune")  proof = "£" + Math.round(run.money) + " banked";
  else if(fg.id === "magnet")   proof = (s.coins || 0) + " coins grabbed";
  else if(fg.id === "thrusters")proof = "a faster ship all flight";
  else if(fg.id === "wingman")  proof = "your drones flew with you";
  else if(fg.id === "life" || fg.id === "armor" || fg.id === "shield")
    proof = s.livesLost === 0 ? "and you never lost a life" : s.livesLost + " lives lost";
  else if(fg.id === "bomb")     proof = "a bomb in your pocket";
  else if(fg.id === "overdrive")proof = "overdrive ready when you needed it";
  return `<div class="rl rl-fresh"><span>NEW — ${esc(fg.name)}</span>` +
         `<b>${esc(fg.effect)}${proof ? " · " + esc(proof) : ""}</b></div>`;
}

/** Names the squadmates who flew as your wingmen this run. */
function crewLine(){
  const p = SF.game.world.player;
  if(!p || !p.drones || !p.crew.length) return "";
  const names = p.crew.slice(0, p.drones).map(c => esc(c.callsign)).join(" & ");
  return names ? `<div class="rl"><span>Flew with you</span><b>${names}</b></div>` : "";
}

/** Did this run take the household record for the mission, or how close was it? */
/*
 * The earned numbers ROLL in instead of appearing - a settled screen full of
 * final values reads like a receipt; a half-second climb reads like a payout.
 * Ease-out so the last coins land gently, and the exact final value is always
 * written at the end, whatever the frame rate did in between.
 */
function runCountUps(root){
  const els = Array.from(root.querySelectorAll("[data-countup]"));
  if(!els.length) return;
  const start = performance.now(), DUR = 550;
  const step = now => {
    const t = Math.min(1, (now - start) / DUR);
    const k = 1 - Math.pow(1 - t, 3);
    els.forEach(el => {
      const v = Math.round(Number(el.dataset.countup) * k);
      el.textContent = (el.dataset.prefix || "") + v.toLocaleString("en-GB");
    });
    if(t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/*
 * One or two medals get their own lines; a bumper haul collapses to a single
 * summary. A first great run once earned EIGHT medals and the double-height
 * rows shoved the actual results off the screen.
 */
function medalLines(unlocked){
  const list = unlocked || [];
  if(list.length > 2){
    const pay = list.reduce((a, m) => a + (m.pay || 0), 0);
    return `<div class="rl record"><span>Medals earned</span><b>${list.length} at once! — collect £${pay.toLocaleString("en-GB")} in MEDALS</b></div>`;
  }
  return list.map(a =>
    `<div class="rl record"><span>Medal earned</span><b>${a.icon} ${esc(a.name)} — collect £${(a.pay||0).toLocaleString("en-GB")} in MEDALS</b></div>`).join("");
}

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
let toastQueue = [], toastShowing = false, toastHoldUntil = 0;
/** Nothing may toast over a screen that is still settling - the medal pop
    used to land on top of the results title in the same instant. */
function holdToasts(ms){
  toastHoldUntil = Date.now() + ms;
  // A toast already mid-flight gets cut: whatever is landing (the results
  // card) owns the screen now, and a pop-over from three seconds ago
  // colliding with it is exactly the mess this exists to stop.
  if(toastShowing){
    toastShowing = false;
    $("achievementToast").classList.remove("show");
    $("achievementToast").classList.add("hidden");
  }
  setTimeout(() => { if(!toastShowing) nextToast(); }, ms + 30);
}
function queueToast(a){
  toastQueue.push(a);
  if(!toastShowing && Date.now() >= toastHoldUntil) nextToast();
}
function nextToast(){
  if(Date.now() < toastHoldUntil) return;
  const a = toastQueue.shift();
  if(!a){ toastShowing = false; return; }
  toastShowing = true;
  audio.play("achievement");
  const el = $("achievementToast");
  el.classList.remove("hidden");
  // The toast serves more than medals now - a `label` names the occasion
  // (default keeps the medal ceremony), and non-medal toasts drop the trophy.
  $("at-label").textContent = a.label || "MEDAL UNLOCKED";
  // The icon is drawn, never typed: a medal gets its own struck disc, a rank
  // promotion gets the pilot's actual insignia, chrome toasts get a glyph.
  // (The old path pasted a.icon into the text, which is how a kid's biggest
  // career moment once read "sixstar PROMOTED: FLIGHT LEADER".)
  const iconBox = $("at-icon");
  iconBox.textContent = "";
  let art = null;
  if(a.id && SF.icons.medal) art = SF.icons.medal(a.id, 34, false);
  else if(a.insignia) { art = document.createElement("span"); SF.insignia.mount(art, a.insignia, a.color || "#3399ff", 34); }
  else if(a.glyph) art = SF.icons.el(a.glyph, "#ffd23f", 26);
  if(art) iconBox.appendChild(art);
  iconBox.classList.toggle("hidden", !art);
  $("at-name").textContent = a.name;
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
  click($("cloudJoinBtn"), async () => {
    const entered = await ask("JOIN A SQUAD", { text:"Squad code from the other device?", placeholder:"ABCD-EFGH" });
    if(!entered) return;
    SF.cloud.join(entered)
      .then(() => { renderCloud(); renderProfiles(); })
      .catch(err => { paintCloudStatus({ state:"error", error: String(err.message || err) }); });
  });
  click($("cloudRestoreBtn"), async () => {
    const list = SF.cloud.backups();
    if(!list.length) return;
    const names = Object.keys(list[0].pilots).join(", ");
    if(!await confirmDlg("RESTORE BACKUP",
        "Put every pilot back to how they were " + ago(list[0].at) +
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
  pill("setCalm", SF.fx.calmEnabled());
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
const BUILD = "2026-08-10.4";
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
  paintMuteBtn();
});
click($("setSound"), () => { audio.setMuted(!audio.isMuted()); renderSettings(); });
click($("setMusicRow"), () => { audio.setMusicEnabled(!audio.musicEnabled()); renderSettings(); });
click($("setSfx"), () => { audio.setSfxEnabled(!audio.sfxEnabled()); renderSettings(); });
click($("setShake"), () => { SF.fx.setShakeEnabled(!SF.fx.shakeEnabled()); renderSettings(); });
click($("setCalm"), () => { SF.fx.setCalmEnabled(!SF.fx.calmEnabled()); renderSettings(); });
click($("setRumble"), () => {
  if(!SF.haptics.supported()) return;
  SF.haptics.setEnabled(!SF.haptics.isEnabled());
  // Turning it on should be felt at once: the tap that switched it on happened
  // while it was still off, so nothing has buzzed yet.
  if(SF.haptics.isEnabled()) SF.haptics.play("uiBuy");
  renderSettings();
});
click($("setReset"), async () => {
  if(!profile) return;
  const who = profile.name;
  if(!await confirmDlg("RESET " + who.toUpperCase() + "?",
      "Start " + who + " over from ZERO?\n\nStars, money, upgrades and medals all go" +
      " - on every synced device too. This cannot be undone.",
      { danger:true, okLabel:"RESET" })) return;
  if(!await confirmDlg("LAST CHANCE", "Really erase " + who + "'s whole career?",
      { danger:true, okLabel:"ERASE IT" })) return;
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

click($("dialogOk"), () => {
  const input = $("dialogInput");
  closeDialog(input.classList.contains("hidden") ? true : input.value);
});
click($("dialogCancel"), () => closeDialog(null));
$("dialogInput").addEventListener("keydown", e => {
  if(e.key === "Enter") closeDialog($("dialogInput").value);
  e.stopPropagation();   // typing a name must not steer the ship
});

click($("addProfileBtn"), async () => {
  const name = await ask("NEW PILOT", { text:"What's the pilot's name?", placeholder:"Name", okLabel:"JOIN UP" });
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
// The Wacky Sky launches straight in - no briefing, no tier choice. The
// launch banner IS the reveal: the roll is a surprise until the sky opens.
click($("wackyBtn"), () => {
  if(!wackyUnlocked(profile)){
    queueToast({ glyph:"lock", name:"Clear Mission 3 to open the Wacky Sky", label:"LOCKED" });
    return;
  }
  launch("wacky", "pilot");
});
click($("rushBtn"), () => {
  if(!rushUnlocked(profile)){
    queueToast({ glyph:"lock", name:"Beat the Mission 4 boss to open the Rush", label:"LOCKED" });
    return;
  }
  launch("rush", "pilot");
});
click($("starHuntBtn"), () => { starHunt = !starHunt; renderMissions(); });
click($("armoryBtn"), () => { renderArmory(); show("screen-armory"); });
click($("workshopBtn"), () => { SF.workshop.open(); show("screen-workshop"); });
click($("wsBackBtn"), () => { renderMenu(); show("screen-menu"); });
/** Launch a Drawing Board sky. Fixed at NORMAL so the family records are fair. */
function launchCustom(missionObj){
  launch(missionObj, "pilot");
}
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
/*
 * The old per-screen back links. They stay wired - the way back runs the same
 * handlers - but they are no longer the way OUT, because six exits in six
 * different places at the bottom of six different scrolls is what the kids
 * were getting lost in. CSS hides them; #backBtn is the door now.
 */
click($("missionsBackBtn"), () => { renderMenu(); show("screen-menu"); });
click($("briefBackBtn"), () => { renderMissions(); show("screen-missions"); });
click($("launchBtn"), () => launch(selectedMissionIndex, briefTier));
click($("armoryBackBtn"), () => { renderMenu(); show("screen-menu"); });
click($("achievementsBackBtn"), () => { renderMenu(); show("screen-menu"); });
click($("leaderboardBackBtn"), () => { renderMenu(); show("screen-menu"); });
// One door, always in the same place, on every screen that has one.
$("backBtn").addEventListener("click", () => navBack());
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
/*
 * Quitting forfeits the run's takings - `endMission` is never reached, so the
 * money collected is simply dropped. That is a fair rule and it was a SILENT
 * one: ninety seconds of chasing coins, gone, with nothing on screen to say it
 * would happen. It gets one confirmation, and the confirmation names the
 * number, because "£820" means something to a seven-year-old and "your
 * progress" does not.
 */
click($("quitBtn"), () => {
  const leave = () => {
    $("overlayPause").classList.add("hidden");
    SF.game.state = "idle";
    renderMissions();
    show("screen-missions");
  };
  const run = SF.game.run;
  const purse = run && !run.ended ? Math.round(run.money || 0) : 0;
  if(purse <= 0) return leave();
  confirmDlg("LEAVE THE MISSION?",
             "You'll lose the £" + purse + " you've collected so far.",
             { okLabel:"LEAVE", cancelLabel:"KEEP FLYING", danger:true })
    .then(yes => { if(yes) leave(); });
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
  paintMuteBtn();
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
SF.workshop.init();               // the Drawing Board wires its own controls
initGarageTaps();                 // the ship answers taps
paintMuteBtn();
// The chrome's drawn glyphs: ability buttons and the settings gears. Painted
// once at boot - they never change shape, only visibility.
qa(".sb-icon[data-glyph]").forEach(cv => SF.icons.paint(cv, cv.dataset.glyph, "#ffffff"));
// Button glyphs (pause, play, retry, undo, the boss skull, the rotate phone).
// These used to be typed characters - "II" for pause, ▶ ↻ ↩ ☠ 📱 - which sat
// off-baseline in Rajdhani and wore a different face on every platform.
// Painted in the button's own text colour so they always match their label.
qa(".btn-ico[data-glyph], .back-ico[data-glyph]").forEach(cv => {
  const host = cv.closest("button, span, div") || cv.parentElement;
  cv.style.width = (cv.width/2) + "px"; cv.style.height = (cv.height/2) + "px";
  SF.icons.paint(cv, cv.dataset.glyph, host ? getComputedStyle(host).color : "#ffffff");
});
["settingsBtnPicker", "settingsBtnMenu"].forEach(id => {
  const b = $(id);
  if(b) b.insertBefore(SF.icons.el("gear", "rgba(255,255,255,0.75)", 13), b.firstChild);
});

/*
 * Fullscreen, for the computer. The one genuinely Steam-like affordance the
 * game lacked on a desktop: it lived in a browser tab with no way in. Shown
 * only where the API exists and the app isn't already standalone - which
 * hides it on every iPhone and iPad, where Apple doesn't offer it.
 */
(function fullscreenSetup(){
  const btn = $("fullscreenBtn");
  if(!btn) return;
  const root = document.documentElement;
  const supported = !!(root.requestFullscreen && document.exitFullscreen) &&
                    !window.navigator.standalone &&
                    !window.matchMedia("(display-mode: standalone)").matches;
  if(!supported) return;
  btn.classList.remove("hidden");
  const glyph = SF.icons.el("expand", "rgba(255,255,255,0.75)", 13);
  btn.insertBefore(glyph, btn.firstChild);
  const paintState = () => {
    const on = !!document.fullscreenElement;
    SF.icons.paint(glyph, on ? "contract" : "expand", "rgba(255,255,255,0.75)");
    btn.lastChild.textContent = on ? "Exit Fullscreen" : "Fullscreen";
  };
  /*
   * Going fullscreen also takes the cursor (SF.input, POINTER LOCK). It has to
   * be asked for here rather than inside the input layer, because both calls
   * have to ride the same click: a browser will only hand over the pointer on
   * a fresh user gesture, and by the time fullscreen has settled on its own
   * that gesture has expired.
   */
  click(btn, () => {
    if(document.fullscreenElement){
      SF.input.unlockPointer();
      document.exitFullscreen().catch(() => {});
      return;
    }
    const r = root.requestFullscreen();
    if(r && r.then) r.then(() => SF.input.lockPointer()).catch(() => {});
    else SF.input.lockPointer();
  });
  document.addEventListener("fullscreenchange", () => {
    // Leaving fullscreen by any route hands the cursor back; keeping it would
    // strand the player with an invisible pointer in a windowed page.
    if(!document.fullscreenElement) SF.input.unlockPointer();
    paintState();
  });
  paintState();
})();
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
          getProfile: () => profile,
          sectorStats, SECTORS,         // the map's per-stretch scoreboard
          navBack, goHome,              // the way back, for the phone's own gesture
          _purchaseShows: () => hangar.shows.length + (hangar.show ? 1 : 0),
          // The Drawing Board's doors into the app: launch a drawn sky, and
          // borrow the game's own dialog instead of window.prompt/confirm.
          launchCustom,
          textDialog: opts => dialog(opts),
          confirmDialog: opts => dialog(opts).then(v => v !== null),
          // ...and the map's boss painter, so the board's preview can show the
          // monster you picked instead of writing its name on a chip.
          bossHullReady: mapHullReady,
          drawBossHull: drawMapHull };
})();
