/*
 * THE DEATH REWIND - "oh, THAT'S what got me."
 *
 * A seven-year-old's account of dying is "that's not fair". Usually it was
 * perfectly fair and they simply never saw it: the shot came from outside
 * where they were looking, or the rock they had been dodging for a second
 * finally clipped a wingtip. Not knowing is what makes a child put the
 * tablet down. So when the last life goes, the game rewinds the tape and
 * shows them - slowly, with the thing that did it ringed and named.
 *
 * The replay is the REAL thing, not a diagram: a ring buffer of the last
 * ~1.6 seconds is played back through the game's own renderers, so it is
 * the same ships, the same bolts, and the same hull with the kid's own
 * paint on it. A stand-in player object carries the cosmetics that never
 * change during a life (colour, parts, tune, paint) and takes its position
 * from the tape.
 *
 * Three beats: a fast reverse scrub (the tape visibly running back), the
 * replay easing from half speed down to a crawl, then a held freeze on
 * the impact. One tap skips the lot - a replay you cannot escape stops
 * being a kindness the second time you see it.
 *
 * Cost discipline: the buffer is allocated once per mission and written IN
 * PLACE. Nothing here allocates inside the update loop, because this runs
 * in a game that has to hold 60fps on a phone.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp } = SF.core;
const audio = SF.audio;

const HZ = 24;                 // tape speed: plenty for 0.3x playback
const WINDOW = 1.6;            // seconds of history kept
const FRAMES = Math.round(WINDOW * HZ);
/*
 * Per-frame caps. A frame that overflows simply records the first N - a
 * replay missing the 41st simultaneous enemy is not a replay anyone can
 * tell is wrong, whereas a growing buffer on a phone is a real problem.
 */
const MAX_E = 40, MAX_EB = 72, MAX_B = 48;

/*
 * Beat 0 is the death itself. The rewind used to seize the screen on the
 * frame the last life went, which meant the ship's own destruction - the
 * one moment the whole mission has been building to - was drawn for
 * exactly no frames: "when you die your plane should explode or something
 * like this". It always did explode; nobody was ever allowed to see it.
 * So the tape waits, and this beat simply lets the live scene play: the
 * wreck, the rings, the debris, over a world already frozen by the ending.
 */
const DEATH = 1.25;
const SCRUB = 0.45;            // beat 1: the tape running backwards
const HOLD  = 0.95;            // beat 3: frozen on the impact
/*
 * Beat 2 eases between these speeds, and they are HALF what they first
 * shipped at. The first cut ran 0.90 -> 0.30, which put 1.6 seconds of
 * action on screen in 2.4 - technically slow motion, and still too quick
 * to read: "the replay is too [quick] to actually understand what
 * happened". At 0.45 -> 0.15 the same 1.6 seconds takes 4.8, which is the
 * difference between watching it and following it. It is skippable, so
 * the cost of being generous here is a tap.
 */
const FAST = 0.45, SLOW = 0.15;

let tape = null;               // the ring buffer, built on the first mission
let head = 0, filled = 0, due = 0;
let show = null;               // the playback state, non-null while running
let kill = null;               // { x, y, r, label } - what did it
let doneCb = null;
let stand = null;              // the stand-in player

/* ---------------------------------------------------------
   THE TAPE
   --------------------------------------------------------- */
function build(){
  tape = new Array(FRAMES);
  for(let i = 0; i < FRAMES; i++){
    const f = { used:false, px:0, py:0, pbank:0, pvx:0, pvy:0, pshield:0, precoil:0,
                bossOn:false, bx:0, by:0, en:0, ebn:0, bn:0,
                enemies: new Array(MAX_E), ebullets: new Array(MAX_EB), bullets: new Array(MAX_B) };
    for(let n = 0; n < MAX_E; n++)
      f.enemies[n] = { alive:false, x:0, y:0, size:0, r:0, spawnAnim:1, typeId:"grunt", type:null,
                       elite:false, flash:0, hp:1, maxHp:1, spin:0, fuse:0, state:0, charge:0,
                       shielded:false, loot:0, carriesRescue:false, hazard:false, healTarget:null };
    // vx/vy ride along because the bolt renderer trails a tail down them, and
    // "which way was it going" is the whole point of watching the replay.
    for(let n = 0; n < MAX_EB; n++) f.ebullets[n] = { alive:false, x:0, y:0, vx:0, vy:1, r:4, kind:"bolt" };
    for(let n = 0; n < MAX_B;  n++) f.bullets[n]  = { alive:false, x:0, y:0, vx:0, vy:1, tier:0, fromDrone:false };
    tape[i] = f;
  }
}

/** Called at mission start: a fresh tape, nothing part-recorded from last time. */
function arm(){
  if(!tape) build();
  for(let i = 0; i < FRAMES; i++) tape[i].used = false;
  head = 0; filled = 0; due = 0;
  show = null; kill = null; doneCb = null;
}

/**
 * Writes one frame of the world onto the tape. Called every update; only
 * commits every 1/HZ seconds, so the sample rate is independent of framerate.
 */
function record(dt, world){
  if(!tape || !world || !world.player) return;
  due -= dt;
  if(due > 0) return;
  due += 1/HZ;
  if(due < 0) due = 1/HZ;                  // a long stall never floods the tape

  const f = tape[head];
  head = (head + 1) % FRAMES;
  if(filled < FRAMES) filled++;
  f.used = true;

  const p = world.player;
  f.px = p.x; f.py = p.y; f.pbank = p.bank || 0;
  f.pvx = p.vx || 0; f.pvy = p.vy || 0;
  f.pshield = p.shield || 0; f.precoil = p.recoil || 0;

  const boss = world.boss;
  f.bossOn = !!(boss && boss.alive);
  if(f.bossOn){ f.bx = boss.x; f.by = boss.y; }

  let n = 0;
  const es = world.enemies.items;
  for(let i = 0; i < es.length && n < MAX_E; i++){
    const e = es[i];
    if(!e.alive) continue;
    const d = f.enemies[n++];
    d.alive = true; d.x = e.x; d.y = e.y; d.size = e.size; d.r = e.r;
    d.spawnAnim = e.spawnAnim; d.typeId = e.typeId; d.type = e.type; d.elite = e.elite;
    d.flash = e.flash || 0; d.hp = e.hp; d.maxHp = e.maxHp;
    d.spin = e.spin || 0; d.fuse = e.fuse || 0;
    d.state = e.state || 0; d.charge = e.charge || 0;
    d.shielded = !!e.shielded; d.loot = e.loot || 0;
    d.carriesRescue = !!e.carriesRescue; d.hazard = !!e.hazard;
  }
  for(let i = n; i < f.en; i++) f.enemies[i].alive = false;
  f.en = n;

  n = 0;
  const ebs = world.enemyBullets.items;
  for(let i = 0; i < ebs.length && n < MAX_EB; i++){
    const b = ebs[i];
    if(!b.alive) continue;
    const d = f.ebullets[n++];
    d.alive = true; d.x = b.x; d.y = b.y; d.r = b.r; d.kind = b.kind;
    d.vx = b.vx; d.vy = b.vy;
  }
  for(let i = n; i < f.ebn; i++) f.ebullets[i].alive = false;
  f.ebn = n;

  n = 0;
  const bs = world.bullets.items;
  for(let i = 0; i < bs.length && n < MAX_B; i++){
    const b = bs[i];
    if(!b.alive) continue;
    const d = f.bullets[n++];
    d.alive = true; d.x = b.x; d.y = b.y; d.vx = b.vx; d.vy = b.vy;
    d.tier = b.tier; d.fromDrone = !!b.fromDrone;
  }
  for(let i = n; i < f.bn; i++) f.bullets[i].alive = false;
  f.bn = n;
}

/** Oldest-first frame `i` of what was recorded (0 .. filled-1). */
function frameAt(i){
  return tape[(head - filled + i + FRAMES*2) % FRAMES];
}

/* ---------------------------------------------------------
   WHAT KILLED THEM
   --------------------------------------------------------- */
/*
 * The collision layer knows the source as a word and the object that did
 * it; both matter. The word decides the phrasing, the object gives the
 * ring somewhere to sit and a name to print.
 */
function capture(source, ent, world){
  const boss = world && world.boss;
  if(source === "bullet" && ent){
    kill = { x: ent.x, y: ent.y, r: Math.max(14, ent.r*2.2), label: "ENEMY FIRE" };
  } else if(source === "collision" && ent){
    const nm = ent.hazard ? "ASTEROID"
                          : ((ent.type && ent.type.name) || "ENEMY").toUpperCase();
    kill = { x: ent.x, y: ent.y, r: Math.max(22, (ent.r || 20)*1.5), label: nm };
  } else if(source === "beam" && boss){
    kill = { x: boss.x, y: boss.y + boss.r, r: 46, label: "THE BEAM" };
  } else if(boss){
    kill = { x: boss.x, y: boss.y, r: (boss.r || 60)*0.9, label: (boss.name || "THE BOSS").toUpperCase() };
  } else {
    kill = null;
  }
}

/* ---------------------------------------------------------
   PLAYBACK
   --------------------------------------------------------- */
function canPlay(){ return !!tape && filled >= 6; }

/** Starts the rewind. Returns false if there is not enough tape to bother. */
function begin(player){
  if(!canPlay()) return false;
  // Cosmetics can't change during a life, so they are copied once and the
  // tape only has to carry motion.
  stand = { alive:true, invuln:0, overdriveUntil:0, recoil:0, trail:[],
            drones: player ? player.drones : 0, crew: (player && player.crew) || [],
            color: player ? player.color : "#f5a623",
            levels: (player && player.levels) || {},
            tune: player && player.tune, decal: player && player.decal,
            x:0, y:0, bank:0, vx:0, vy:0, shield:0 };
  show = { beat: "death", t: 0, u: 1, total: 0 };
  listen(true);
  /*
   * Same grammar as the boss arrival: while a replay is on, the pause and
   * mute buttons go with the HUD - there is nothing here to pause. Its OWN
   * class, not `cinema`: endMission clears cinema on the very next call, so
   * borrowing it left both buttons sitting live over the replay.
   */
  document.body.classList.add("rewinding");
  return true;
}

function active(){ return !!show; }
/** The UI parks the results screen behind this. */
function onEnd(cb){ doneCb = cb; }

function finish(){
  if(!show) return;
  show = null;
  listen(false);
  document.body.classList.remove("rewinding");
  const cb = doneCb;
  doneCb = null;
  if(cb) cb();
}

/*
 * A tap, a click or any key gets you out - but not the key you were already
 * holding when you died. On a keyboard you fly by holding a direction, and
 * the browser repeats that keydown many times a second, so an unguarded
 * listener skipped the replay before its first frame had drawn: exactly the
 * player who most needed to see it never would. Hence both guards - repeats
 * are ignored, and nothing counts for the first fraction of a second.
 */
const ARM_AFTER = 0.35;
let listening = false;
function skip(e){
  if(!show || show.total < ARM_AFTER) return;
  if(e && e.repeat) return;
  finish();
}
function listen(on){
  if(on === listening) return;
  listening = on;
  if(on){
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skip, true);
  } else {
    window.removeEventListener("pointerdown", skip, true);
    window.removeEventListener("keydown", skip, true);
  }
}

/** Playback speed at position u: fast at first, a crawl into the impact. */
function speedAt(u){ return FAST - (FAST - SLOW) * Math.pow(clamp(u, 0, 1), 2.5); }

function update(dt){
  if(!show) return;
  show.t += dt;
  show.total += dt;
  if(show.beat === "death"){
    // Nothing to drive: the live scene is still being drawn (see draw()),
    // and fx is still ticking, so the wreck burns on its own.
    if(show.t >= DEATH){ show.beat = "scrub"; show.t = 0; show.u = 1; audio.play("rewind"); }
  } else if(show.beat === "scrub"){
    show.u = 1 - clamp(show.t / SCRUB, 0, 1);
    if(show.t >= SCRUB){ show.beat = "play"; show.t = 0; show.u = 0; }
  } else if(show.beat === "play"){
    show.u += dt * speedAt(show.u) / WINDOW;
    if(show.u >= 1){
      show.u = 1; show.beat = "hold"; show.t = 0;
      audio.play("playerHit");
      if(SF.fx) SF.fx.shake(10);
    }
  } else if(show.t >= HOLD){
    finish();
  }
}

/* ---------------------------------------------------------
   DRAWING
   The replay runs through the game's own renderers, so a fake
   world is dressed with the tape's contents and handed over.
   --------------------------------------------------------- */
const fake = { enemies:{ items:null }, enemyBullets:{ items:null }, bullets:{ items:null },
               pickups:{ items:[] }, player:null, boss:null, haulers:[] };

function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function dress(f){
  fake.enemies.items = f.enemies;
  fake.enemyBullets.items = f.ebullets;
  fake.bullets.items = f.bullets;
  stand.x = f.px; stand.y = f.py; stand.bank = f.pbank;
  stand.vx = f.pvx; stand.vy = f.pvy;
  stand.shield = f.pshield; stand.recoil = f.precoil;
  fake.player = stand;
}

/*
 * A short engine wake built from where the ship just was - the tape IS the
 * trail. The four slots are reused rather than rebuilt, so a long replay
 * doesn't quietly mint garbage every frame.
 */
const WAKE = [{ x:0, y:0, life:0.055 }, { x:0, y:0, life:0.110 },
              { x:0, y:0, life:0.165 }, { x:0, y:0, life:0.220 }];
function wake(idx){
  let n = 0;
  for(let k = 1; k <= WAKE.length; k++){
    const j = idx - k;
    if(j < 0) break;
    const f = frameAt(j);
    WAKE[n].x = f.px; WAKE[n].y = f.py;
    n++;
  }
  stand.trail = n === WAKE.length ? WAKE : WAKE.slice(0, n);
}

/**
 * Draws the replay over the background. Returns true when it owns the
 * frame, so the caller knows to skip the live world, the HUD and the radio.
 */
function draw(ctx, timeMs, VW, VH){
  if(!show || !filled) return false;
  // The death beat draws nothing of its own: handing the frame back lets the
  // caller paint the live wreck, its particles and the HUD, exactly as the
  // game did before any of this existed.
  if(show.beat === "death") return false;

  const idx = clamp(Math.round(show.u * (filled - 1)), 0, filled - 1);
  const f = frameAt(idx);
  dress(f);
  wake(idx);

  // Zoom toward the impact as the tape slows: the room narrows to the one
  // thing they need to see. Weighted to the player, who is the subject.
  const held = show.beat === "hold";
  const k = held ? 1 : (show.beat === "play" ? easeOutCubic(show.u) : 0);
  const zoom = 1 + 0.42*k;
  const last = frameAt(filled - 1);
  const tx = kill ? last.px*0.65 + kill.x*0.35 : last.px;
  const ty = kill ? last.py*0.65 + kill.y*0.35 : last.py;
  const halfW = VW/(2*zoom), halfH = VH/(2*zoom);
  const cx = clamp(tx, halfW, VW - halfW), cy = clamp(ty, halfH, VH - halfH);

  ctx.save();
  ctx.translate(VW/2, VH/2);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);
  // The tape running backwards: a hard horizontal tear, the one piece of
  // language everybody already reads as "rewinding".
  if(show.beat === "scrub") ctx.translate(Math.sin(show.t*90)*3, 0);

  const R = SF.render;
  R.drawHaulers(ctx, SF.game.world, timeMs);   // they hold station: frozen is honest
  R.drawEnemies(ctx, fake, timeMs);
  drawBossFrame(ctx, f, timeMs);
  R.drawBullets(ctx, fake);
  R.drawPlayer(ctx, stand, timeMs);
  if(kill) drawRing(ctx, timeMs, held);
  ctx.restore();

  if(show.beat === "scrub") drawTear(ctx, VW, VH, timeMs);
  drawFurniture(ctx, VW, VH, timeMs);
  return true;
}

/*
 * The scrub beat's tape damage. The 3px wobble alone read as a glitch, not
 * a rewind, so the frame gets the rest of the VHS grammar: slices of the
 * finished frame copied back onto themselves a few pixels sideways (real
 * displacement, the canvas is its own source - nothing allocated), a
 * hairline of glare on each tear, and a faint scanline field. Band
 * positions jump every ~55ms rather than glide: tape tears, it doesn't
 * wave. drawFurniture reuses the same clock so the REWIND tag jumps with
 * the tear.
 */
const TEAR_STEP = 55;
let scanPat = null, scanTried = false;
function drawTear(ctx, VW, VH, timeMs){
  const cv = ctx.canvas;
  const px = cv.width / VW;                    // user space -> device pixels
  const step = Math.floor(timeMs/TEAR_STEP);
  ctx.save();
  for(let i = 0; i < 3; i++){
    const y = (Math.sin(i*39.7 + step*17.23)*0.5 + 0.5) * (VH - 44);
    const h = 5 + i*7;
    const dx = Math.sin(i*11.3 + step*7.77) * (16 - i*4);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(cv, 0, y*px, cv.width, h*px, dx, y, VW, h);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#9fd8ff";
    ctx.fillRect(0, y, VW, 1.5);
  }
  if(!scanTried){
    scanTried = true;
    const c = document.createElement("canvas"); c.width = 2; c.height = 3;
    const g = c.getContext("2d");
    if(g){ g.fillStyle = "#080a14"; g.fillRect(0, 2, 2, 1); }
    scanPat = ctx.createPattern(c, "repeat") || null;
  }
  if(scanPat){
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = scanPat;
    ctx.fillRect(0, 0, VW, VH);
  }
  ctx.restore();
}

/*
 * The boss is drawn by its live object - it carries a phase machine, weak
 * points and damage state that no snapshot is going to reproduce - with
 * only its position wound back, then put straight again.
 */
function drawBossFrame(ctx, f, timeMs){
  const boss = SF.game.world && SF.game.world.boss;
  if(!boss || !f.bossOn) return;
  const bx = boss.x, by = boss.y;
  boss.x = f.bx; boss.y = f.by;
  SF.render.drawBoss(ctx, boss, timeMs);
  boss.x = bx; boss.y = by;
}

/** The ring on the culprit: closes in during the replay, pulses on the hold. */
function drawRing(ctx, timeMs, held){
  const grow = held ? 1 : clamp(show.beat === "play" ? show.u : 0, 0, 1);
  const pulse = held ? 1 + Math.sin(timeMs/90)*0.06 : 1;
  const r = kill.r * (2.6 - 1.6*grow) * pulse;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.65*grow;
  ctx.strokeStyle = "#ff2d55";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -timeMs/40;
  ctx.beginPath(); ctx.arc(kill.x, kill.y, r, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  if(held){
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(kill.x + s*r*1.35, kill.y); ctx.lineTo(kill.x + s*r*1.05, kill.y);
      ctx.moveTo(kill.x, kill.y + s*r*1.35); ctx.lineTo(kill.x, kill.y + s*r*1.05);
      ctx.stroke();
    });
  }
  ctx.restore();
}

/** Letterbox, the word REWIND, the culprit's name, and the way out. */
// Only 600/700 are loaded on the page; heavier weights would fake-bold.
const FONT = "px Rajdhani, 'Avenir Next Condensed', system-ui, sans-serif";
/** Captions sit over live frames that can go bright: the same dark stroke
    fx.js puts under its floating text goes under every fill here. */
function caption(ctx, str, x, y){
  ctx.strokeText(str, x, y);
  ctx.fillText(str, x, y);
}
function drawFurniture(ctx, VW, VH, timeMs){
  const bar = VH*0.055;
  ctx.save();
  ctx.fillStyle = "rgba(4,7,16,0.92)";
  ctx.fillRect(0, 0, VW, bar);
  ctx.fillRect(0, VH - bar, VW, bar);

  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(6,8,18,0.75)";

  const scrub = show.beat === "scrub";
  ctx.fillStyle = "#ff2d55";
  ctx.font = "700 20" + FONT;
  const blink = scrub ? (Math.sin(timeMs/70) > -0.4) : true;
  if(blink){
    // The tag rides the tear: same clock as drawTear's bands.
    const step = Math.floor(timeMs/TEAR_STEP);
    const jx = scrub ? Math.sin(step*7.77)*2.5 : 0;
    const jy = scrub ? Math.sin(step*13.1)*1.2 : 0;
    caption(ctx, scrub ? "◀◀ REWIND" : "WHAT HAPPENED", VW/2 + jx, bar*0.72 + jy);
  }

  if(show.beat === "hold" && kill){
    const a = clamp(show.t/0.22, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 26" + FONT;
    caption(ctx, kill.label, VW/2, VH*0.5 - 10);
    ctx.fillStyle = "#ff8fa3";
    ctx.font = "600 15" + FONT;
    caption(ctx, "THIS IS WHAT GOT YOU", VW/2, VH*0.5 + 14);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "600 13" + FONT;
  ctx.letterSpacing = "2px";     // spaced like a UI element where supported
  caption(ctx, "TAP TO SKIP", VW/2, VH - bar*0.35);
  ctx.textAlign = "left";
  ctx.restore();
}

SF.rewind = { arm, record, capture, begin, active, update, draw, onEnd, skip, finish,
              canPlay, WINDOW, HZ, FRAMES, speedAt, _tape: () => tape, _kill: () => kill,
              _show: () => show };
})();
