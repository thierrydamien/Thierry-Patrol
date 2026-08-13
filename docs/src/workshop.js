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

function freshDraft(){
  const me = SF.ui.getProfile();
  const call = (me && (me.callsign || me.name)) || "PILOT";
  return {
    name: call + "'S SKY",
    sky: 9,                       // The Deep - a pretty default
    rule: "none",
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
    objectives: hasCarrier ? ["complete","kill80","rescueAll"] : ["complete","kill80"],
  };
  if(d.boss) m.boss = d.boss;
  if(d.rule && d.rule !== "none") m[d.rule] = true;
  return m;
}

/* ---------------- save / list / records ---------------- */

function saveDraft(){
  const P = SF.profile, me = SF.ui.getProfile();
  const skies = me.workshopSkies = me.workshopSkies || [];
  const entry = {
    id: "ws" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: draft.name, sky: draft.sky, rule: draft.rule, boss: draft.boss,
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
    const dot = document.createElement("span");
    dot.className = "ws-dot";
    dot.style.background = dotColor;
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

function render(){
  if(!draft) draft = freshDraft();
  els.name.textContent = draft.name;

  els.skyRow.innerHTML = "";
  skyChoices().forEach(({ i, s }) => {
    els.skyRow.appendChild(chip(s.name.toUpperCase(), draft.sky === i,
      () => { draft.sky = i; render(); }, s.clouds[0]));
  });

  els.ruleRow.innerHTML = "";
  RULES.forEach(r => {
    els.ruleRow.appendChild(chip(r.name, draft.rule === r.id,
      () => { draft.rule = r.id; els.hint.textContent = r.hint; render(); }));
  });
  const rule = RULES.find(r => r.id === draft.rule);
  els.hint.textContent = rule ? rule.hint : "";

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
    waves:   document.getElementById("wsWaves"),
    bossRow: document.getElementById("wsBossRow"),
    family:  document.getElementById("wsFamily"),
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
    render();
  });
}

SF.workshop = { init, open, toMission, familySkies, bestFor,
                TYPES, FORMS, RULES, BOSSES, _draft: () => draft };
})();
