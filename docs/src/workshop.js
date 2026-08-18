/*
 * THE DRAWING BOARD - the workshop, handed over.
 *
 * The finale's story is that the family beat the place where skies get made;
 * this is the payoff as a MODE: draw a sky (name, palette, one house rule,
 * up to six waves, a boss), test-fly it, and pin it to the family board. A
 * saved sky lives on the author's profile, so Squad Sync carries it to every
 * device the family plays on - a brother finds YOUR sky on HIS menu, with
 * your name on it and a best-score chip to steal.
 *
 * Design rules, kid-first:
 *  - Everything is a TAP. Types and formations cycle, counts step, the dice
 *    rerolls a whole wave. No dropdowns, no typing except the name.
 *  - Every flight is on NORMAL (pilot) so the family records are fair.
 *  - A drawn sky is data, not code: toMission() turns it into the same shape
 *    the campaign missions use, and game.startMission takes it as an object.
 *  - The campaign never hears about these flights (see endMission's custom
 *    branch): money is real, records live in workshopBest, stars go nowhere.
 */
(function(){
"use strict";
const SF = window.SF;

/* ---------------- the vocabulary the board offers ---------------- */

// Artful, self-sufficient types only: no rocks (scenery), no rival (a duel
// script), no serpent/part (their levels' own machinery drives them).
const TYPES = ["grunt","weaver","striker","swooper","kamikaze","turret","brute",
               "carrier","shielder","splitter","thief","sniper","interceptor",
               "bomber","mine","hive","mender"];

const FORMS = ["vee","wall","arc","pincer","scatter","column","twinColumns",
               "tripleColumns","sides","line"];

/* One house rule per sky - each is a mission flag game.js already honours.
 * THE FORGERY's forge death and the Devourer's finale need their own levels'
 * machinery, so those two stay off the menu. */
const RULES = [
  { id:"none",     name:"NO RULE",    hint:"a clean sky" },
  { id:"wells",    name:"GRAVITY",    hint:"wells bend every shot" },
  { id:"beat",     name:"THE BEAT",   hint:"they fire on the conductor's count" },
  { id:"blackout", name:"LIGHTS OUT", hint:"only what glows is visible" },
  { id:"storm",    name:"ION STORM",  hint:"the wind shoves everyone" },
  { id:"foundry",  name:"THE BELTS",  hint:"stop the parts or fight what they build" },
  { id:"serpent",  name:"THE SERPENT",hint:"it eats your coins - hit the tail" },
];

/*
 * THE SILLY BITS - the Wacky Sky's table, handed over with everything else.
 *
 * The Wacky Sky rolls two or three of these and the pull is "what did we get
 * THIS time?". On the board the pull is the opposite and better: a kid gets to
 * DECIDE. Every entry already obeys wacky.js's two rules - visible within
 * seconds, and never harder than the campaign - so there is no cap on how many
 * can go on one sky. Picking all of them is a perfectly good joke to build.
 *
 * Nothing here is declared twice: the list, the colours, the blurbs and the
 * pairs that cannot share a sky all come from wacky.js, and the physics lives
 * where it already lived (spawnEnemy, updatePickups, the kill callback), keyed
 * off mission.mods exactly as the Wacky Sky's own roll is.
 */
function modList(){ return (SF.wacky && SF.wacky.MODIFIERS) || []; }

const BOSSES = [
  { id:"",          name:"NO BOSS" },
  { id:"sentinel",  name:"SENTINEL" },
  { id:"marauder",  name:"MARAUDER" },
  { id:"jailer",    name:"JAILER" },
  { id:"warden",    name:"WARDEN" },
  { id:"phantom",   name:"PHANTOM" },
  { id:"leviathan", name:"LEVIATHAN" },
];

const MAX_WAVES = 6, MIN_WAVES = 1, MAX_SAVED = 8;

/* ---------------- the sky being drawn ---------------- */

let draft = null;
let els = null;      // resolved once at init
let modHint = null;  // the silly bit whose blurb is currently showing

function freshDraft(){
  const me = SF.ui.getProfile();
  const call = (me && (me.callsign || me.name)) || "PILOT";
  return {
    name: call + "'S SKY",
    sky: 10,                      // The Deep - a pretty default
    rule: "none",
    mods: [],                     // silly bits, off until somebody taps one
    boss: "",
    waves: [
      { type:"grunt",  n:8, form:"vee" },
      { type:"weaver", n:6, form:"twinColumns" },
      { type:"swooper",n:7, form:"arc" },
    ],
  };
}

/* Generated skies only: photo entries return null from build() and the board
 * promises a palette chip for everything it offers. */
function skyChoices(){
  return SF.skygen.SKIES.map((s, i) => ({ i, s })).filter(x => !x.s.photo);
}

function rand(n){ return Math.floor(Math.random()*n); }

function rollWave(){
  return { type: TYPES[rand(TYPES.length)],
           n: 4 + rand(8),
           form: FORMS[rand(FORMS.length)] };
}

/* ---------------- draft -> mission object ---------------- */

function toMission(saved){
  const d = saved || draft;
  const waves = d.waves.map((w, i) => ({ t: 2 + i*9, type: w.type, n: w.n, form: w.form }));
  const hasCarrier = d.waves.some(w => w.type === "carrier");
  const m = {
    id: d.id || "draft",
    custom: true,
    name: d.name.toUpperCase(),
    subtitle: "drawn by " + (d.authorCall || d.author ||
      ((SF.ui.getProfile() && (SF.ui.getProfile().callsign || SF.ui.getProfile().name)) || "us")),
    brief: "A sky from the family's own drawing board. Fly it well - somebody made this for you.",
    goal: "Fly the family's sky!",
    skyIndex: d.sky,
    face: d.waves[0] ? d.waves[0].type : "grunt",
    waves,
    /*
     * The stars have to be winnable on the sky that was actually drawn.
     * Every custom sky used to get "Destroy 80%", including one built out of
     * mines - and a mine is a hazard, so it counts toward neither `spawned` nor
     * `totalPlanned`. The reading sat at 0% for the whole flight and the star
     * could never light, with nothing on screen to say why. A seven-year-old
     * had authored a level whose own objectives were impossible.
     */
    objectives: (() => {
      const counted = d.waves.reduce((n, w) => {
        const t = SF.enemyData.ENEMY_TYPES[w.type];
        return n + (t && t.hazard ? 0 : w.n);
      }, 0);
      const list = ["complete"];
      if(counted >= 3) list.push("kill80");
      if(hasCarrier) list.push("rescueAll");
      // A sky with nothing to shoot still deserves three stars to chase.
      while(list.length < 3) list.push(list.indexOf("coinRush") < 0 ? "coinRush" : "noDamage");
      return list.slice(0, 3);
    })(),
  };
  if(d.boss) m.boss = d.boss;
  if(d.rule && d.rule !== "none") m[d.rule] = true;
  /*
   * The silly bits ride out in the same two fields the Wacky Sky uses, so
   * every hook downstream - the giant enemies in spawnEnemy, the bouncing
   * coins in updatePickups, the confetti in the kill callback, the reveal
   * card the launch banner plays - works on a drawn sky without knowing the
   * Drawing Board exists. `modList` is what the reveal reads out.
   */
  const picked = (d.mods || []).map(id => SF.wacky.MOD_BY_ID[id]).filter(Boolean);
  if(picked.length){
    m.mods = {};
    picked.forEach(x => { m.mods[x.id] = true; });
    m.modList = picked;
    // The goal line is what a child reads on the launch banner. Two names is
    // a promise; six is a wall of text, so past that it counts them instead.
    m.goal = picked.length <= 2
      ? picked.map(x => x.name).join(" + ") + "!"
      : picked[0].name + " + " + (picked.length - 1) + " more silly things!";
  }
  return m;
}

/* ---------------- save / list / records ---------------- */

function saveDraft(){
  const P = SF.profile, me = SF.ui.getProfile();
  const skies = me.workshopSkies = me.workshopSkies || [];
  const entry = {
    id: "ws" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: draft.name, sky: draft.sky, rule: draft.rule, boss: draft.boss,
    mods: (draft.mods || []).slice(),
    waves: draft.waves.map(w => ({ type:w.type, n:w.n, form:w.form })),
    author: me.name, authorCall: me.callsign || me.name,
    created: Date.now(),
  };
  skies.unshift(entry);
  if(skies.length > MAX_SAVED) skies.length = MAX_SAVED;
  P.save(me);
  return entry;
}

/** Every pilot's saved skies, newest first, with the family's best on each. */
function familySkies(){
  const P = SF.profile;
  const rows = [];
  P.listNames().forEach(n => {
    const p = P.load(n);
    (p.workshopSkies || []).forEach(sk => rows.push(sk));
  });
  rows.sort((a, b) => (b.created || 0) - (a.created || 0));
  return rows;
}

function bestFor(skyId){
  const P = SF.profile;
  let best = null;
  P.listNames().forEach(n => {
    const p = P.load(n);
    const rec = p.workshopBest && p.workshopBest[skyId];
    if(rec && (!best || rec.score > best.score))
      best = { score: rec.score, name: p.callsign || p.name, owner: p.name, color: p.shipColor };
  });
  return best;
}

function removeSky(skyId){
  const P = SF.profile, me = SF.ui.getProfile();
  me.workshopSkies = (me.workshopSkies || []).filter(s => s.id !== skyId);
  P.save(me);
}

/* ---------------- rendering ---------------- */

function chip(label, active, onTap, dotColor){
  const b = document.createElement("button");
  b.className = "ws-chip" + (active ? " active" : "");
  if(dotColor){
    // A palette is more than one colour, so the swatch shows the whole ramp
    // rather than the first cloud: you pick a sky by how it LOOKS.
    const dot = document.createElement("span");
    dot.className = "ws-dot";
    dot.style.background = Array.isArray(dotColor) && dotColor.length > 1
      ? "linear-gradient(135deg," + dotColor.join(",") + ")"
      : (Array.isArray(dotColor) ? dotColor[0] : dotColor);
    b.appendChild(dot);
  }
  b.appendChild(document.createTextNode(label));
  b.addEventListener("click", () => { SF.audio.play("uiClick"); onTap(); });
  return b;
}

function waveRow(w, idx){
  const row = document.createElement("div");
  row.className = "ws-wave";

  const sprite = document.createElement("canvas");
  sprite.width = 76; sprite.height = 76;
  sprite.className = "ws-sprite";
  paintSprite(sprite, w.type);

  const type = document.createElement("button");
  type.className = "ws-cycle ws-type";
  type.textContent = w.type.toUpperCase();
  type.addEventListener("click", () => {
    SF.audio.play("uiClick");
    w.type = TYPES[(TYPES.indexOf(w.type) + 1) % TYPES.length];
    render();
  });

  const count = document.createElement("div");
  count.className = "ws-count";
  const minus = document.createElement("button"); minus.textContent = "−";
  const num = document.createElement("b"); num.textContent = "×" + w.n;
  const plus = document.createElement("button"); plus.textContent = "+";
  minus.addEventListener("click", () => { SF.audio.play("uiClick"); w.n = Math.max(1, w.n - 1); render(); });
  plus.addEventListener("click", () => { SF.audio.play("uiClick"); w.n = Math.min(14, w.n + 1); render(); });
  count.appendChild(minus); count.appendChild(num); count.appendChild(plus);

  const form = document.createElement("button");
  form.className = "ws-cycle ws-form";
  form.textContent = w.form.toUpperCase();
  form.addEventListener("click", () => {
    SF.audio.play("uiClick");
    w.form = FORMS[(FORMS.indexOf(w.form) + 1) % FORMS.length];
    render();
  });

  const dice = document.createElement("button");
  dice.className = "ws-mini";
  dice.textContent = "🎲";
  dice.setAttribute("aria-label", "surprise me");
  dice.addEventListener("click", () => {
    SF.audio.play("uiClick");
    draft.waves[idx] = rollWave();
    render();
  });

  const del = document.createElement("button");
  del.className = "ws-mini ws-del";
  del.textContent = "✕";
  del.setAttribute("aria-label", "remove wave");
  del.disabled = draft.waves.length <= MIN_WAVES;
  del.addEventListener("click", () => {
    SF.audio.play("uiClick");
    draft.waves.splice(idx, 1);
    render();
  });

  row.appendChild(sprite); row.appendChild(type); row.appendChild(count);
  row.appendChild(form); row.appendChild(dice); row.appendChild(del);
  return row;
}

function paintSprite(cv, type){
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  // Mines are drawn bespoke in play (no SHAPES entry), so the board draws its
  // own: the same red spiked ball the sky throws at you.
  if(!SF.enemyArt.has(type)){
    const cx = cv.width/2, cy = cv.height/2, r = cv.width*0.22;
    ctx.strokeStyle = "#ff5d73"; ctx.lineWidth = 4; ctx.lineCap = "round";
    for(let k = 0; k < 8; k++){
      const a = k/8*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
      ctx.lineTo(cx + Math.cos(a)*r*1.7, cy + Math.sin(a)*r*1.7);
      ctx.stroke();
    }
    ctx.fillStyle = "#a11530";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#ff8296";
    ctx.beginPath(); ctx.arc(cx, cy, r*0.4, 0, Math.PI*2); ctx.fill();
    return;
  }
  try {
    const tint = SF.enemyData.ENEMY_TYPES[type] && SF.enemyData.ENEMY_TYPES[type].tint;
    const spr = SF.enemyArt.spriteFor(type, tint);
    if(spr) ctx.drawImage(spr, 0, 0, cv.width, cv.height);
  } catch(e){ /* a missing sprite is a blank chip, not a crash */ }
}

/* ---------------- the preview: the board draws itself ----------------
 *
 * A seven-year-old cannot read "WEAVER x6 TWINCOLUMNS" and see a level. So
 * the sky gets drawn: the real generated backdrop, the real enemy sprites in
 * the real formation shapes (straight out of the game's own FORMATIONS
 * table), the real boss hull, and a badge for the house rule. It reads bottom
 * to top - your ship, then the waves in the order they arrive, then whatever
 * is waiting at the end. Everything on it is a thing that will actually be
 * there, which is the whole point: change a chip, watch the sky change.
 */
let preview = { raf: 0, t: 0, sky: null, skyKey: "" };

function previewSky(W, H){
  const key = draft.sky + "@" + W + "x" + H;
  if(preview.skyKey === key) return preview.sky;
  preview.skyKey = key;
  preview.sky = null;
  try { preview.sky = SF.skygen.build(draft.sky, W, H, 1, true); } catch(e){ /* fall back below */ }
  return preview.sky;
}

/** Formation slots mapped into a band: real shapes, preview-sized. */
function bandSlots(w, W, top, h){
  const F = SF.enemyData.FORMATIONS;
  const fn = F[w.form] || F.line;
  const VW = 480;                                   // the shapes' native field
  let slots;
  try { slots = fn(Math.min(w.n, 14), VW); } catch(e){ slots = []; }
  if(!slots.length) return [];
  const ys = slots.map(s => s.y);
  const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  const span = Math.max(1, y1 - y0);
  return slots.map(s => ({
    x: 10 + (s.x/VW)*(W - 20),
    // Formations build upward from the top edge, so the first arrivals have
    // the LARGEST y. Flipping keeps "who gets there first" at the bottom.
    y: top + h - ((s.y - y0)/span)*(h - 6) - 3,
  }));
}

function drawRuleBadge(ctx, W, H, rule, t){
  if(rule === "none") return;
  ctx.save();
  if(rule === "wells"){                              // two swirls, bending space
    [[W*0.26, H*0.42], [W*0.74, H*0.62]].forEach(([x, y], i) => {
      const r = Math.min(W, H)*0.11;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, "rgba(167,139,250,0.55)");
      g.addColorStop(1, "rgba(167,139,250,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "rgba(196,181,253,0.6)"; ctx.lineWidth = 1.5;
      for(let k=0;k<3;k++){
        ctx.beginPath();
        ctx.arc(x, y, r*(0.3 + k*0.26), t*1.2 + i + k, t*1.2 + i + k + 2.1);
        ctx.stroke();
      }
    });
  } else if(rule === "storm"){                       // wind, shoving everyone
    ctx.strokeStyle = "rgba(125,211,252,0.5)"; ctx.lineWidth = 2; ctx.lineCap = "round";
    for(let i=0;i<14;i++){
      const y = ((i*61 + t*90) % (H + 40)) - 20, len = 26 + (i%4)*16;
      ctx.beginPath(); ctx.moveTo(-10 + (i*53)%W, y); ctx.lineTo(-10 + (i*53)%W + len, y + 9); ctx.stroke();
    }
  } else if(rule === "blackout"){                    // only what glows is there
    const g = ctx.createRadialGradient(W/2, H*0.72, Math.min(W,H)*0.08, W/2, H*0.72, Math.max(W,H)*0.62);
    g.addColorStop(0, "rgba(2,3,10,0)");
    g.addColorStop(1, "rgba(2,3,10,0.86)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if(rule === "beat"){                        // the conductor's count
    const pulse = (t*1.6) % 1;
    ctx.strokeStyle = "rgba(255,210,63," + (0.6*(1-pulse)).toFixed(2) + ")";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W/2, H*0.5, 20 + pulse*Math.min(W,H)*0.42, 0, Math.PI*2); ctx.stroke();
  } else if(rule === "foundry"){                     // belts, feeding the forge
    ctx.fillStyle = "rgba(148,163,184,0.20)";
    ctx.fillRect(0, H*0.30, W, 14);
    ctx.fillStyle = "rgba(226,232,240,0.35)";
    for(let i=0;i<12;i++) ctx.fillRect(((i*46 + t*40) % (W + 40)) - 20, H*0.30 + 3, 16, 8);
  } else if(rule === "serpent"){                     // it eats your coins
    ctx.strokeStyle = "rgba(74,222,128,0.55)"; ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath();
    for(let i=0;i<=24;i++){
      const u = i/24;
      ctx.lineTo(W*0.1 + u*W*0.8, H*0.45 + Math.sin(u*7 + t*2)*H*0.10);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPreview(){
  const cv = els.preview;
  if(!cv) return;
  const box = cv.getBoundingClientRect();
  const W = Math.max(200, Math.round(box.width)), H = Math.max(150, Math.round(box.height));
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; preview.skyKey = ""; }
  const ctx = cv.getContext("2d");
  if(!ctx) return;
  const t = preview.t;

  const sky = previewSky(W, H);
  if(sky) ctx.drawImage(sky, 0, 0, W, H);
  else {                                             // a photo sky, or no canvas
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#101736"); g.addColorStop(1, "#05060f");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  const bossOn = !!draft.boss && SF.ui.bossHullReady(draft.boss);
  const bossH = bossOn ? H*0.24 : 0;
  const shipH = 46;
  const waveTop = bossH, waveArea = H - bossH - shipH;
  const n = Math.max(1, draft.waves.length);
  const bandH = waveArea / n;

  drawRuleBadge(ctx, W, H, draft.rule, t);

  if(bossOn){
    ctx.save();
    ctx.translate(W/2, bossH*0.52);
    // Sized to the band, not to the width: an oversized hull spilled into the
    // top wave and made the picture unreadable at exactly the wrong moment.
    try { SF.ui.drawBossHull(ctx, draft.boss, Math.min(W*0.40, bossH*0.95), 0, t*1000); }
    catch(e){ /* an unpaintable hull just leaves the band empty */ }
    ctx.restore();
    ctx.fillStyle = "rgba(255,93,115,0.95)";      // out of the hull's way
    ctx.font = "bold 11px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("LAST: " + draft.boss.toUpperCase(), W - 8, 20);
  }

  // Waves, latest at the top - so the bottom of the picture is what hits you
  // first and the eye travels up through the fight in order.
  draft.waves.forEach((w, i) => {
    const band = n - 1 - i;                          // wave 0 lives lowest
    const top = waveTop + band*bandH;
    const slots = bandSlots(w, W, top, bandH);
    const S = Math.max(13, Math.min(30, bandH*0.62, W/Math.max(6, w.n)));
    let spr = null;
    try {
      const tint = SF.enemyData.ENEMY_TYPES[w.type] && SF.enemyData.ENEMY_TYPES[w.type].tint;
      spr = SF.enemyArt.has(w.type) ? SF.enemyArt.spriteFor(w.type, tint) : null;
    } catch(e){ spr = null; }
    slots.forEach((s, k) => {
      const y = s.y + Math.sin(t*1.8 + k*0.5 + i)*2;
      if(spr) ctx.drawImage(spr, s.x - S/2, y - S/2, S, S);
      else {                                         // the mine, drawn bespoke
        ctx.fillStyle = "#a11530";
        ctx.beginPath(); ctx.arc(s.x, y, S*0.34, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = "#ff5d73"; ctx.lineWidth = 2;
        for(let q=0;q<6;q++){
          const a = q/6*Math.PI*2;
          ctx.beginPath();
          ctx.moveTo(s.x + Math.cos(a)*S*0.34, y + Math.sin(a)*S*0.34);
          ctx.lineTo(s.x + Math.cos(a)*S*0.52, y + Math.sin(a)*S*0.52);
          ctx.stroke();
        }
      }
    });
    // Which wave this is, and how many - on a plate, so it stays readable
    // over a bright nebula as well as over a black one.
    const tag = (i+1) + " · " + w.type.toUpperCase() + " ×" + w.n;
    ctx.font = "bold 10px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "left";
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = "rgba(4,6,16,0.55)";
    ctx.fillRect(4, top + bandH - 15, tw + 10, 14);
    ctx.fillStyle = "rgba(226,232,240,0.8)";
    ctx.fillText(tag, 9, top + bandH - 4);
  });

  // ...and you, at the bottom, where you always are.
  const me = SF.ui.getProfile();
  try {
    SF.shipart.drawShip(ctx, W/2, H - shipH*0.55, 30,
      { color: (me && me.shipColor) || "#4cc9f0", levels: (me && me.upgrades) || {},
        t: t, idle:false, tune: me && me.tune, decal: me && me.decal });
  } catch(e){ /* the preview is never worth a crash */ }
}

function startPreview(){
  if(preview.raf) return;
  const step = () => {
    preview.raf = 0;
    const scr = document.getElementById("screen-workshop");
    if(!scr || !scr.classList.contains("active")) return;
    preview.t += 1/60;
    drawPreview();
    preview.raf = requestAnimationFrame(step);
  };
  preview.raf = requestAnimationFrame(step);
}

function render(){
  if(!draft) draft = freshDraft();
  els.name.textContent = draft.name;

  els.skyRow.innerHTML = "";
  skyChoices().forEach(({ i, s }) => {
    els.skyRow.appendChild(chip(s.name.toUpperCase(), draft.sky === i,
      () => { draft.sky = i; render(); }, s.clouds.slice(0, 3)));
  });

  els.ruleRow.innerHTML = "";
  RULES.forEach(r => {
    els.ruleRow.appendChild(chip(r.name, draft.rule === r.id,
      () => { draft.rule = r.id; els.hint.textContent = r.hint; render(); }));
  });
  const rule = RULES.find(r => r.id === draft.rule);
  els.hint.textContent = rule ? rule.hint : "";

  if(!Array.isArray(draft.mods)) draft.mods = [];
  els.modRow.innerHTML = "";
  modList().forEach(mo => {
    const on = draft.mods.indexOf(mo.id) >= 0;
    els.modRow.appendChild(chip(mo.name, on, () => {
      if(on){
        draft.mods = draft.mods.filter(x => x !== mo.id);
      } else {
        // Switch off anything that cannot share a sky with this, so the board
        // can never build a ship that is tiny and enormous at once.
        const clash = SF.wacky.clashesWith(mo.id);
        draft.mods = draft.mods.filter(x => clash.indexOf(x) < 0).concat([mo.id]);
      }
      modHint = mo;
      render();
    }, mo.color));
  });
  // One line of plain English about the last thing they touched: the names are
  // shouty on purpose, and BOUNCY COINS does not explain itself to a six-year-old.
  els.modHint.textContent = modHint ? modHint.blurb
    : draft.mods.length ? draft.mods.length + " picked — tap one to read it"
    : "tap as many as you like — they all stack";

  els.waves.innerHTML = "";
  draft.waves.forEach((w, i) => els.waves.appendChild(waveRow(w, i)));
  const add = document.createElement("button");
  add.className = "ghost-btn ws-add";
  add.textContent = "+ ADD WAVE";
  add.disabled = draft.waves.length >= MAX_WAVES;
  add.addEventListener("click", () => {
    SF.audio.play("uiClick");
    draft.waves.push(rollWave());
    render();
  });
  els.waves.appendChild(add);

  els.bossRow.innerHTML = "";
  BOSSES.forEach(b => {
    els.bossRow.appendChild(chip(b.name, draft.boss === b.id,
      () => { draft.boss = b.id; render(); }));
  });

  renderFamily();
  preview.skyKey = "";                  // the palette may have just changed
  drawPreview();
  startPreview();
}

function renderFamily(){
  const rows = familySkies();
  els.family.innerHTML = "";
  if(!rows.length){
    const empty = document.createElement("p");
    empty.className = "ws-empty";
    empty.textContent = "Nothing on the board yet. Draw one and SAVE it - everyone in the squadron will see it here.";
    els.family.appendChild(empty);
    return;
  }
  const me = SF.ui.getProfile();
  rows.forEach(sk => {
    const card = document.createElement("div");
    card.className = "ws-sky-card";
    const best = bestFor(sk.id);
    const bits = [sk.waves.length + " waves"];
    if(sk.boss) bits.push(sk.boss.toUpperCase());
    const rl = RULES.find(r => r.id === sk.rule);
    if(rl && rl.id !== "none") bits.push(rl.name);
    card.innerHTML =
      `<div class="ws-sky-meta"><b>${esc(sk.name)}</b>` +
      `<span>by ${esc(sk.authorCall || sk.author)} · ${bits.join(" · ")}</span>` +
      (best ? `<span class="ws-best">★ best ${best.score.toLocaleString()} — ${esc(best.name)}</span>`
            : `<span class="ws-best ws-unflown">no record yet — be first</span>`) +
      `</div>`;
    const fly = document.createElement("button");
    fly.className = "main-btn ws-fly";
    fly.textContent = "FLY IT";
    fly.addEventListener("click", () => {
      SF.audio.play("uiClick");
      SF.ui.launchCustom(toMission(sk));
    });
    card.appendChild(fly);
    if(sk.author === me.name){
      const del = document.createElement("button");
      del.className = "ws-mini ws-del";
      del.textContent = "✕";
      del.setAttribute("aria-label", "delete this sky");
      del.addEventListener("click", async () => {
        const ok = await SF.ui.confirmDialog({
          title:"TEAR IT UP?", text:'"' + sk.name + '" comes off the family board. Records go with it.',
          okLabel:"TEAR IT UP", cancelLabel:"KEEP IT", danger:true });
        if(ok){ removeSky(sk.id); render(); }
      });
      card.appendChild(del);
    }
    els.family.appendChild(card);
  });
}

function esc(s){
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

/* ---------------- wiring ---------------- */

function open(){
  if(!draft) draft = freshDraft();
  render();
}

function init(){
  els = {
    name:    document.getElementById("wsName"),
    hint:    document.getElementById("wsHint"),
    skyRow:  document.getElementById("wsSkyRow"),
    ruleRow: document.getElementById("wsRuleRow"),
    modRow:  document.getElementById("wsModRow"),
    modHint: document.getElementById("wsModHint"),
    waves:   document.getElementById("wsWaves"),
    bossRow: document.getElementById("wsBossRow"),
    family:  document.getElementById("wsFamily"),
    preview: document.getElementById("wsPreview"),
  };
  document.getElementById("wsRenameBtn").addEventListener("click", async () => {
    SF.audio.play("uiClick");
    const name = await SF.ui.textDialog({
      title:"NAME YOUR SKY", input:true, value:draft.name,
      placeholder:"MARC'S MEGA SKY", okLabel:"NAME IT" });
    if(name && name.trim()){
      draft.name = name.trim().toUpperCase().slice(0, 22);
      render();
    }
  });
  document.getElementById("wsLaunchBtn").addEventListener("click", () => {
    SF.audio.play("uiClick");
    SF.ui.launchCustom(toMission());
  });
  document.getElementById("wsSaveBtn").addEventListener("click", () => {
    SF.audio.play("uiClick");
    saveDraft();
    SF.ui.queueToast({ glyph:"star", name:'"' + draft.name + '" is on the family board. Squad Sync will carry it to everyone.', label:"SKY SAVED" });
    draft = freshDraft();
    modHint = null;
    render();
  });
}

SF.workshop = { init, open, toMission, familySkies, bestFor,
                TYPES, FORMS, RULES, BOSSES, modList, _draft: () => draft };
})();
