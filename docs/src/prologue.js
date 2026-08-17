/*
 * THE PROLOGUE - Mission 0, the only level on Earth.
 *
 * Every campaign before this one started in space with no word on why a
 * family was up there in home-built ships. This module is the why, played
 * rather than told: launch day over the farm, a flight check that turns
 * into the first raid, and the sky going out in the middle of the morning.
 *
 * It is also the tutorial, and the rule that shaped every beat is that THE
 * STORY DOES THE TEACHING. Nobody says "now try moving" - Papa's workshop
 * asks for a flight check, and the flight check is the movement tutorial.
 * The gunnery targets are balloons because a first shot should hit
 * something that cannot shoot back. The bomb is taught at the exact moment
 * a bomb is the answer, and the first rescue is a brother with a name, so
 * the game's dearest mechanic - flying into a drifting person - lands as
 * family before it lands as scoring.
 *
 * Same contract as backstage.js and sky29.js: a mission flag (`prologue`)
 * plus one module that owns the script. The waves stay engine-standard so
 * kills, stars, comms and the director all behave; this file owns the
 * rings, the eclipse, the thief silhouette, the ascent, and WHEN the
 * mission is allowed to end.
 *
 * Determinism note: everything here keys off fixed constants and the
 * script clock - no seeded draws, no Math.random in the sim path. The only
 * randomness is the baked starfield for the ascent, which is cosmetic and
 * drawn from Math.random at begin().
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, TAU } = SF.core;

/* The script clock's fixed marks, in seconds from mission start.
   The wave times in missions.js are the OTHER half of this timeline -
   balloons at 42/54/66, the lone scout at 82, the raid at 96/108. */
const RING_FIRST   = 4;      // first practice ring appears
const RING_EVERY   = 4;      // one ring at a time, this far apart
const RING_COUNT   = 8;      // eight offered, six needed - forgiving on purpose
const RINGS_END    = 40;     // unflown rings leave; gunnery begins
const SHADOW_AT    = 78;     // the light starts going wrong
const RAID_AT      = 94;     // comms: guns free
const BOMB_AT      = 108;    // the six-ship vee - and the bomb lesson
const THEFT_HOLD   = 16;     // how long the thief takes to cross the sky
const ASCENT_SECS  = 11;     // the climb out of the atmosphere

/* Ring stations, as fractions of the field. Spread wide enough that a kid
   has to actually steer, never so low they fight the player's thumb, and
   FIXED - a flight check is a course someone laid out, not weather.

   Every station lives INSIDE the ship's real envelope: the player is
   clamped to y in [PLAY_TOP=250, VH-34] (see entities.js), and the first
   draft parked three rings above that ceiling - a course with gates the
   aircraft cannot reach. The smoke suite pins the envelope now. */
const RING_SPOTS = [
  [0.30, 0.40], [0.68, 0.46], [0.46, 0.36], [0.78, 0.55],
  [0.22, 0.52], [0.58, 0.62], [0.36, 0.66], [0.72, 0.38],
];

let S = null;                // the whole script state; null = not running

function reset(){ S = null; }

function begin(run, world){
  S = {
    t: 0,
    run, world,
    vw: 0, vh: 0,            // learned from the first update/draw
    rings: [],               // { fx, fy, x, y, born, hit, gone }
    nextRing: 0,
    nudged: false, aced: false,
    gunsCalled: false, shadowCalled: false, raidCalled: false,
    bombCalled: false,
    podAt: 0,                // when Marc's chute went out (0 = not yet)
    rescuedCalled: false,
    theftAt: 0,              // when the thief entered (0 = not yet)
    theftLine2: false,
    ascentAt: 0,             // when the climb began (0 = not yet)
    done: false,
    veil: 0,                 // 0..1 eclipse darkness, eased every frame
    veilTarget: 0,
    // The ascent's stars: baked once, cosmetic, Math.random by design.
    stars: Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.6 + Math.random()*1.4, tw: Math.random()*TAU,
    })),
    whoName: rescueName(),
  };
  // Marc bails out on the script's say-so, not the director's: the engine
  // timing formula would drop him mid-flight-check.
  run.podTimes.length = 0;
}

/* The name on the parachute. Another pilot from THIS device's family if
   there is one - the rescue should be somebody at the table - with the
   lore brother as the fallback for a brand-new install. */
function rescueName(){
  try {
    const me = SF.game.profile && (SF.game.profile.callsign || SF.game.profile.name);
    const others = SF.profile.listNames().filter(n => n !== me);
    if(others.length) return others[0];
  } catch(e){}
  return "Marc";
}

function active(){ return !!S; }
function readyToEnd(){ return !S || S.done; }

/* ---------------------------------------------------------
   UPDATE - the script itself
   --------------------------------------------------------- */
function update(dt, run, world, simMs, VW, VH){
  if(!S) return;
  S.t += dt;
  S.vw = VW; S.vh = VH;
  const T = S.t;
  const say = (ev, vars) => SF.comms.say(ev, vars);
  const p = world.player;

  // The eclipse never snaps - the light drains, it doesn't switch.
  S.veil += (S.veilTarget - S.veil) * Math.min(1, dt*1.6);

  /* ---- the flight check ---- */
  if(S.nextRing < RING_COUNT && T >= RING_FIRST + S.nextRing*RING_EVERY && T < RINGS_END - 2){
    const [fx, fy] = RING_SPOTS[S.nextRing];
    S.rings.push({ fx, fy, born: T, hit: false, gone: false });
    S.nextRing++;
  }
  const hits = run.stats.ringsHit || 0;
  for(const r of S.rings){
    if(r.hit || r.gone || !p) continue;
    r.x = r.fx*VW; r.y = r.fy*VH + Math.sin((T - r.born)*1.4)*6;
    const dx = p.x - r.x, dy = p.y - r.y;
    if(dx*dx + dy*dy < 40*40){
      r.hit = true; r.hitAt = T;
      run.stats.ringsHit = hits + 1;
      SF.audio.play("star", false, r.x);
      SF.fx.ring(r.x, r.y, 52, "#ffd23f", 4, 0.5);
      SF.fx.text(r.x, r.y - 34, (run.stats.ringsHit) + "/6", "#ffd23f", 15, true);
    }
  }
  if(T >= RINGS_END){
    for(const r of S.rings) if(!r.hit && !r.gone){ r.gone = true; r.goneAt = T; }
  }
  if(!S.nudged && T > 24 && hits < 3){ S.nudged = true; say("prologueRingsNudge"); }
  if(!S.aced && hits >= 6){ S.aced = true; say("prologueRingsDone"); }

  /* ---- gunnery ---- */
  if(!S.gunsCalled && T >= RINGS_END + 1.2){ S.gunsCalled = true; say("prologueBalloons"); }

  /* ---- the sky goes wrong ---- */
  if(!S.shadowCalled && T >= SHADOW_AT){
    S.shadowCalled = true;
    S.veilTarget = 0.34;
    SF.audio.play("bossWake");
    say("prologueShadow");
  }
  if(!S.raidCalled && T >= RAID_AT){
    S.raidCalled = true;
    S.veilTarget = 0.44;
    say("prologueRaid");
  }
  if(!S.bombCalled && T >= BOMB_AT){
    S.bombCalled = true;
    /* The lesson only works if the button exists: a brand-new pilot owns no
       bombs, so the workshop hands one over - same grant the bomb pickup
       makes, so the button appears and shines the same way. */
    if(p && (p.bombs || 0) < 1){
      p.bombsMax = Math.max(p.bombsMax || 0, 1);
      p.bombs = 1;
    }
    say("prologueBomb");
  }

  /* ---- Marc's chute, once the raid is swept ---- */
  const swept = run.director && run.director.finishedSpawning && world.countEnemies() === 0;
  if(!S.podAt && swept && T > BOMB_AT + 3){
    S.podAt = T;
    world.spawnPickup("rescue", VW*0.5, -24);
    SF.fx.text(VW/2, VH*0.2, SF.i18n
      ? SF.i18n.t("{who}'S CHUTE — CATCH HIM!", { who: S.whoName.toUpperCase() })
      : S.whoName.toUpperCase() + "'S CHUTE — CATCH HIM!", "#ffd23f", 17, true);
    say("prologueRescue", { who: S.whoName });
  }
  if(S.podAt && !S.rescuedCalled && (run.stats.rescues || 0) > 0){
    S.rescuedCalled = true;
    say("prologueRescued", { who: S.whoName });
  }

  /* ---- the theft ---- */
  // Enter once the chute is resolved: caught (the good path) or missed and
  // gone (the story must not wait forever on a pickup off the bottom).
  if(S.podAt && !S.theftAt){
    const caught = (run.stats.rescues || 0) > 0;
    const given  = T - S.podAt > 14;
    if((caught && T - S.podAt > 2.5) || given){
      S.theftAt = T;
      S.veilTarget = 0.78;
      SF.audio.play("alarm");
      say("prologueTheft");
      if(SF.i18n) run.bannerText = SF.i18n.t("THE SKY GOES OUT");
      else run.bannerText = "THE SKY GOES OUT";
      run.bannerSub = "";
      run.bannerColor = "#9db4ff";
      run.bannerUntil = simMs + 2600;
    }
  }
  if(S.theftAt && !S.theftLine2 && T - S.theftAt > 9){
    S.theftLine2 = true;
    say("prologueTheft2");
  }

  /* ---- the ascent ---- */
  if(S.theftAt && !S.ascentAt && T - S.theftAt > THEFT_HOLD){
    S.ascentAt = T;
    say("prologueAscent");
    SF.audio.play("overdrive");
    SF.fx.push(1.10, ASCENT_SECS*0.7, 0.4, 0.3);
  }
  if(S.ascentAt && !S.done && T - S.ascentAt > ASCENT_SECS){
    S.done = true;           // game.js may now run AREA CLEAR -> results
  }
}

/* ---------------------------------------------------------
   DRAW - everything behind the ships
   --------------------------------------------------------- */
function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;
  S.vw = VW; S.vh = VH;
  const T = S.t;

  /* The eclipse: one veil, drawn over the sky and under everything alive.
     Blue-black rather than black - the light DRAINS, it doesn't turn off. */
  if(S.veil > 0.005){
    ctx.fillStyle = "rgba(7,10,26," + (S.veil * 0.9).toFixed(3) + ")";
    ctx.fillRect(0, 0, VW, VH);
  }

  /* The ascent: stars arriving through the last of the atmosphere, and
     speed streaks that say STRAIGHT UP without taking the controls. */
  if(S.ascentAt){
    const k = clamp((T - S.ascentAt) / ASCENT_SECS, 0, 1);
    // space floods down from the top of the frame
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, "rgba(4,5,18," + (0.85*k).toFixed(3) + ")");
    g.addColorStop(0.55, "rgba(6,8,24," + (0.55*k).toFixed(3) + ")");
    g.addColorStop(1, "rgba(10,14,34," + (0.25*k).toFixed(3) + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    // the stars fade in brightest-first, like real dusk
    const sa = clamp((k - 0.25) / 0.6, 0, 1);
    if(sa > 0){
      for(const st of S.stars){
        const tw = 0.6 + Math.sin(timeMs/700 + st.tw)*0.4;
        ctx.globalAlpha = sa * tw * (st.r > 1.4 ? 0.9 : 0.55);
        ctx.fillStyle = "#eef2ff";
        ctx.fillRect(st.x*VW, st.y*VH*0.9, st.r, st.r);
      }
      ctx.globalAlpha = 1;
    }
    // climb streaks
    const streaks = 14;
    ctx.strokeStyle = "rgba(210,225,255," + (0.16*Math.sin(Math.min(1,k*2)*Math.PI)).toFixed(3) + ")";
    ctx.lineWidth = 2;
    for(let i = 0; i < streaks; i++){
      const x = ((i*0.618 + 0.13) % 1) * VW;
      const len = 40 + (i%4)*22;
      const y = ((timeMs*0.9 + i*173) % (VH + 160)) - 80;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
    }
  }

  /* The thief: a mile of hull crossing the morning, dragging the family's
     stars behind it in cages. Pure silhouette - menace is stillness, and
     nothing sells "bigger than anything you will fight today" like a shape
     with no detail at all.

     A silhouette needs light BEHIND it to exist: the first cut drew black
     hull on eclipse-black ground and the whole beat was invisible. So the
     eclipse leaves one strip of morning behind the thief - the last of the
     daylight, exactly where the shape crosses - and the ship reads the way
     a storm front does, as the thing the light stops at. */
  if(S.theftAt && !S.ascentAt){
    const k = clamp((T - S.theftAt) / THEFT_HOLD, 0, 1.15);
    const y = VH * 0.24;
    // the dying band of daylight the silhouette crosses
    const inK = clamp((T - S.theftAt) / 1.4, 0, 1);           // the band arrives
    const glow = ctx.createLinearGradient(0, y - VH*0.15, 0, y + VH*0.16);
    glow.addColorStop(0, "rgba(240,177,104,0)");
    glow.addColorStop(0.45, "rgba(240,177,104," + (0.34*inK).toFixed(3) + ")");
    glow.addColorStop(0.55, "rgba(221,143,126," + (0.30*inK).toFixed(3) + ")");
    glow.addColorStop(1, "rgba(221,143,126,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, y - VH*0.15, VW, VH*0.31);

    const x = VW * (-0.45 + k * 1.8);          // right across, unhurried
    const L = VW * 0.72;                        // its length on screen
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(6,7,16,0.98)";
    // the long hull, nose left, keel towers below
    ctx.beginPath();
    ctx.moveTo(-L*0.5, 0);
    ctx.lineTo(-L*0.34, -L*0.05);
    ctx.lineTo( L*0.30, -L*0.055);
    ctx.lineTo( L*0.5,  -L*0.014);
    ctx.lineTo( L*0.44,  L*0.034);
    ctx.lineTo(-L*0.40,  L*0.04);
    ctx.closePath(); ctx.fill();
    for(let i = 0; i < 4; i++){
      const tx = -L*0.28 + i*L*0.17;
      ctx.fillRect(tx, -L*0.095, L*0.032, L*0.055);
    }
    // three cages on cables, each with a caught star guttering inside -
    // the same gold as the score stars, because they ARE the stars.
    for(let i = 0; i < 3; i++){
      const cx = -L*0.30 + i*L*0.25;
      const cy = L*0.13 + Math.sin(timeMs/600 + i*2.1)*4;
      ctx.strokeStyle = "rgba(6,7,16,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, L*0.04); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.strokeRect(cx - 13, cy, 26, 22);
      const flick = 0.55 + Math.sin(timeMs/130 + i*1.7)*0.45;
      // the glow first, then the star, so the cage bars read against it
      const halo = ctx.createRadialGradient(cx, cy + 11, 0, cx, cy + 11, 26);
      halo.addColorStop(0, "rgba(255,210,63," + (0.5*flick).toFixed(3) + ")");
      halo.addColorStop(1, "rgba(255,210,63,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(cx - 26, cy - 15, 52, 52);
      ctx.fillStyle = "rgba(255,224,120," + (0.9*flick).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(cx, cy + 11, 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* The practice rings, over the veil and under the ships. */
  for(const r of S.rings){
    if(r.hit && T - (r.hitAt || 0) > 0.6) continue;
    let x = r.fx*VW, y = r.fy*VH + Math.sin((T - r.born)*1.4)*6, a = 1, rad = 34;
    const age = T - r.born;
    if(age < 0.5){ a = age/0.5; rad = 34 + (1 - a)*20; }          // arrive
    if(r.hit){ const k = (T - r.hitAt)/0.6; a = 1 - k; rad = 34 + k*26; }
    if(r.gone){ const k = clamp((T - r.goneAt)/0.8, 0, 1); y -= k*k*VH*0.6; a = 1 - k; }
    if(a <= 0) continue;
    const pulse = 1 + Math.sin(timeMs/300 + r.born)*0.05;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(x, y, rad*pulse, 0, TAU); ctx.stroke();
    ctx.globalAlpha = a*0.35;
    ctx.strokeStyle = "#fff3c4";
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(x, y, rad*pulse, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

SF.prologue = { reset, begin, active, readyToEnd, update, drawSky,
                _s: () => S,     // the smoke suite steers the flight check
                _spots: RING_SPOTS };
})();
