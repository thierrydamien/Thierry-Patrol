/*
 * BEHIND THE SKY - the Act 4 finale, and the fight the whole game is for.
 *
 * Mission 28 flies through the crack the Devourer left and comes out where
 * the game is MADE: the workshop. Out here the sky loses its paint in
 * stutters, coins forget which way is down, and the boss is THE FORGERY -
 * which is not one fight but three, each one built from something the
 * player already loves:
 *
 *   act 1  THE WELDED TITAN   every boss they beat, bolted back together
 *                             (bossart's composite hull; the standard
 *                             controller runs it with a remix attack pool)
 *   act 2  THE MIRROR PILOT   the titan cracks open and the player's OWN
 *                             ship crawls out - their hull, their paint,
 *                             their actual purchased loadout, fired back
 *   act 3  THE ROYAL BRUSH    the sky itself tears away to blueprint and
 *                             the workshop's living brush fights by
 *                             DRAWING: it sketches squadrons that ink into
 *                             the real thing, sweeps eraser bands through
 *                             your fire, and letters G A M E  O V E R down
 *                             the screen like falling scenery
 *
 * The brush also hands the player the game's last secret: from the tear
 * onward the ship trails PAINT (their own colour - the Style Shop made
 * flesh), and any sketch the trail touches is painted onto YOUR side
 * before it can ink. Painted allies fight for you. The final lesson of a
 * game about a family drawing together: the brush isn't the weapon,
 * whose hand it's in is.
 *
 * Same rules as finale.js: simulation time only, and the module owns its
 * own theatre - game.js only asks three things (reset, update, and "may
 * the boss spawn yet?") plus three draw hooks at fixed depths.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, lerp, rand, randInt, chance, pick } = SF.core;
const TAU = Math.PI*2;

let S = null;          // the whole finale state; null when inactive
const VW = () => (SF.game && SF.game.VW) || 600;
/** The pilot's own paint - the colour the whole act is about. */
function pcolOf(){ return (SF.game.profile && SF.game.profile.shipColor) || "#3399ff"; }

function reset(){ S = null; }

function begin(){
  S = {
    stage: "travel",        // travel -> fakeClear -> titan -> shed -> mirror
                            // -> tear -> brush -> nova -> done
    t: 0,                   // seconds in current stage
    stutter: 0,             // >0: the sky is losing its paint right now
    nextStutter: 7,
    fakeStep: 0,
    // act 2
    mirror: null,
    // act 3
    brush: null,
    sketches: [],
    allies: [],
    letters: [],
    erasers: [],
    paletteIdx: -1,         // which act's sky the brush is repainting with
    paintTrail: [],
    taughtPaint: false,     // the paint rule is explained once, on the first volley
    fakeCard: 0,            // the second fake ending (a sketched results card)
    novaT: 0,
  };
}

function active(){ return !!S; }
function stage(){ return S ? S.stage : ""; }

/** The welded titan just blew apart: act two begins. */
function titanDown(){
  if(!S) return;
  S.stage = "shed";
  S.t = 0;
  // The duel is one-on-one: whatever the titan called in goes with it.
  const w = SF.game.world;
  if(w){
    const en = w.enemies.items;
    for(let i = 0; i < en.length; i++)
      if(en[i].alive) SF.fx.explosion(en[i].x, en[i].y, 26, "#e8c14a", false);
    w.enemies.killAll();
    w.enemyBullets.killAll();
  }
}

/* The waves may end, but the boss must wait for the first fake ending. */
function readyForBoss(){
  return !S || S.stage === "titan" || S.fakeStep >= 3;
}

/* ------------------------------------------------------------------ */
/*  UPDATE                                                             */
/* ------------------------------------------------------------------ */
function update(dt, run, world, simMs){
  if(!S || run.ended) return;
  const fx = SF.fx, audio = SF.audio;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;

  // --- the travel weirdness: paint stutters, coins falling up ----------
  if(S.stage === "travel" || S.stage === "titan"){
    S.nextStutter -= dt;
    if(S.nextStutter <= 0){
      S.stutter = 0.45;
      S.nextStutter = rand(7, 12);
      audio.play("telegraph");
    }
  }
  if(S.stutter > 0){
    S.stutter -= dt;
    // Loose coins forget which way is down while the paint is off.
    const pk = world.pickups.items;
    for(let i = 0; i < pk.length; i++)
      if(pk[i].alive) pk[i].y -= 90 * dt;
  }

  // --- the first fake ending: AREA CLEAR!, snatched -------------------
  if(S.stage === "travel" && run.director && run.director.finishedSpawning &&
     world.countEnemies() === 0 && !run.bossSpawned){
    S.stage = "fakeClear"; S.t = 0; S.fakeStep = 0;
  }
  if(S.stage === "fakeClear"){
    if(S.fakeStep === 0 && S.t > 0.6){
      S.fakeStep = 1;
      run.bannerText = "AREA CLEAR!";
      run.bannerSub = "grab the last coins — then head home";
      run.bannerColor = "#4ade80";
      run.bannerUntil = simMs + 2600;
      audio.play("victory");
    }
    if(S.fakeStep === 1 && S.t > 2.6){
      S.fakeStep = 2;
      S.stutter = 0.8;
      run.bannerText = "no.";
      run.bannerSub = "the workshop isn't done with you";
      run.bannerColor = "#ff5d73";
      run.bannerUntil = simMs + 2200;
      fx.shake(14);
      audio.play("alarm");
      SF.comms.say("backstageNo");
    }
    if(S.fakeStep === 2 && S.t > 4.6){
      S.fakeStep = 3;                    // readyForBoss() now says yes
      S.stage = "titan"; S.t = 0;
    }
  }

  // --- act 2: THE MIRROR PILOT ----------------------------------------
  if(S.stage === "shed"){
    if(S.t > 1.4){
      const p = world.player;
      const lv = id => SF.profile.upgradeLevel(SF.game.profile, id);
      const dps = p ? p.dps : 60;
      /*
       * SIZING A DUEL AGAINST A SHIP-SIZED BOSS.
       *
       * The old bar was dps * 16 with a 27px hit radius, and measured, that
       * is a fight nobody finishes. Two reasons, both invisible on paper.
       * A real boss is a 300px hull with a ~126px hitbox, so a fanned spread
       * lands nearly all of it; this thing is the size of your own ship, so
       * most of the fan flies past and only ~11 of a 65-dps loadout ever
       * arrives. And the bar ignored difficulty.bossHp, so ROOKIE faced the
       * same wall as NIGHTMARE.
       *
       * So: a hitbox that matches its role rather than its sprite, and a
       * pool derived from what actually lands. Measured at ~22s on PILOT.
       */
      const diff = (SF.game.run && SF.game.run.difficulty) || { bossHp: 1 };
      const pool = Math.round(dps * 3.2 * (diff.bossHp || 1));
      S.mirror = {
        x: W/2, y: -60, r: 34,
        hp: pool, maxHp: pool,
        holdY: 190, vx: 0,
        fireTimer: 1.2, dodgeCool: 0, tell: 0, dodgeDir: 0,
        spread: lv("spread"), rapid: lv("rapid"),
        bombs: 2, nextBombAt: 0.66,
        // The duel breathes: it mirrors and shoots, then it OPENS - drifts to
        // the middle, holds still, stops firing - and that is your turn.
        mode: "mirror", modeT: 3.2, taught: false,
        flash: 0, t: 0,
      };
      S.stage = "mirror"; S.t = 0;
      run.bannerText = "THE MIRROR PILOT";
      run.bannerSub = "it bought everything you bought";
      run.bannerColor = "#e8c14a";
      run.bannerUntil = simMs + 3400;
      audio.play("bossWake");
      SF.comms.say("mirrorSeen");
    }
  }
  if(S.stage === "mirror" && S.mirror){
    const m = S.mirror, p = world.player;
    m.t += dt;
    m.flash = Math.max(0, m.flash - dt*4);
    /*
     * THE FIGHT'S RHYTHM.
     *
     * Mirroring your lane is the whole idea of this boss, and on its own it
     * made the duel unwinnable: your guns fire straight up from your x, and
     * it sits at W - x, so the ONLY place you are lined up with it is dead
     * centre - which is also the only place its volley lands on you. Safe and
     * able-to-shoot were mutually exclusive, so a good player could dodge
     * forever and never take its health down.
     *
     * So it breathes. It mirrors and shoots for a few seconds, then OPENS:
     * drifts to the middle, holds, stops firing, stops dodging, and cannot be
     * bumped into. Dodge its turn, take yours. The reflection still reads -
     * it is your ship, flying your loadout - it just no longer stands where
     * you cannot reach it forever.
     */
    if(m.y >= m.holdY){
      m.modeT -= dt;
      if(m.modeT <= 0){
        if(m.mode === "mirror"){
          m.mode = "open"; m.modeT = 3.0;
          m.dodgeDir = 0; m.dodgeUsed = 0;
          audio.play("telegraph");
          if(!m.taught){                 // teach the window the first time
            m.taught = true;
            run.bannerText = "IT'S WIDE OPEN";
            run.bannerSub = "when it stops, SHOOT IT";
            run.bannerColor = "#4ade80";
            run.bannerUntil = simMs + 2600;
          }
        } else {
          m.mode = "mirror"; m.modeT = 3.2;
          m.fireTimer = Math.max(m.fireTimer, 0.7);   // room to slide away
        }
      }
    }
    // Arrive, then hold a mirrored lane: your x, reflected. Except when it is
    // open, where it comes to the middle and waits - a target you can reach
    // from anywhere rather than one that is always exactly opposite you.
    if(m.y < m.holdY) m.y += 130 * dt;
    else if(m.mode === "open"){
      m.x = lerp(m.x, W/2, Math.min(1, dt*1.6));
      m.y = m.holdY + Math.sin(m.t*1.3)*10;
    }
    else if(p){
      const lane = W - p.x;
      m.x = lerp(m.x, lane, Math.min(1, dt*2.2));
      m.y = m.holdY + Math.sin(m.t*1.3)*22;
    }
    // It shoots YOUR guns back: your spread pattern, your fire rate.
    m.fireTimer -= dt;
    if(m.fireTimer <= 0 && m.y > 40 && m.mode === "mirror"){
      const angles = SF.config.spreadPattern(m.spread);
      for(let i = 0; i < angles.length; i++){
        const a = Math.PI/2 + angles[i]/600;      // down, fanned like yours
        world.spawnEnemyBullet(m.x, m.y + 24,
          Math.cos(a)*330, Math.sin(a)*330, "aimed", 4.5);
      }
      m.fireTimer = 0.62 * SF.config.fireRateMult(m.rapid) * 2.4;
      audio.play("shoot", true);
    }
    // It dodges like the rival - on a cooldown, with a tell.
    m.dodgeCool = Math.max(0, m.dodgeCool - dt);
    m.tell = Math.max(0, m.tell - dt);
    if(!m.dodgeDir && m.dodgeCool <= 0 && m.mode === "mirror"){
      const bs = world.bullets.items;
      for(let i = 0; i < bs.length; i++){
        const b = bs[i];
        if(!b.alive || b.vy >= 0) continue;
        if(Math.abs(b.x - m.x) < m.r + 26 && b.y > m.y && b.y - m.y < 170){
          m.dodgeDir = b.x < m.x ? 1 : -1;
          if(m.x < 90) m.dodgeDir = 1;
          if(m.x > W - 90) m.dodgeDir = -1;
          m.tell = 0.14;
          break;
        }
      }
    }
    if(m.dodgeDir && m.tell <= 0){
      m.x = clamp(m.x + m.dodgeDir * 460 * dt, 40, W - 40);
      m.dodgeUsed = (m.dodgeUsed || 0) + 460 * dt;
      if(m.dodgeUsed > 120){ m.dodgeDir = 0; m.dodgeUsed = 0; m.dodgeCool = 1.5; }
    }
    // Your bullets vs it.
    const bs = world.bullets.items;
    for(let i = 0; i < bs.length; i++){
      const b = bs[i];
      if(!b.alive) continue;
      const dx = b.x - m.x, dy = b.y - m.y;
      if(dx*dx + dy*dy < (m.r + 5)*(m.r + 5)){
        b.alive = false;
        /*
         * An open guard is worth double. Shrinking the pool instead would
         * have made the bar flicker away in a handful of volleys; this keeps
         * the duel long enough to feel like one while paying out hard for
         * the thing the fight is teaching - wait, then hit.
         */
        const mult = m.mode === "open" ? 2 : 1;
        /*
         * `b.dmg`, NOT `b.damage`. Player bullets carry `dmg` (see the pool
         * factory in entities.js); nothing anywhere sets `damage`. So this
         * read was always undefined and the `|| 1` fallback fired on every
         * single hit - the whole backstage fight ignored Plasma Rounds and
         * took one point per bullet whether you flew in stock or maxed.
         * Measured: at a maxed loadout the mirror needed ~137s instead of the
         * ~19s its pool is sized for. The pool is derived from `dps`, which
         * already includes the damage level, so reading the right field is
         * the entire fix - no re-tune follows it.
         */
        const hit = (b.dmg || 1) * mult;
        m.hp -= hit;
        m.flash = 1;
        fx.spark(b.x, b.y, 0, -60, mult > 1 ? "#4ade80" : "#e8c14a", 0.3, 2);
        if(SF.game.run) SF.game.run.stats.damageDealt =
          (SF.game.run.stats.damageDealt || 0) + hit;
      }
    }
    // At each third of health it plays YOUR panic button: a bomb that
    // clears YOUR bullets off the screen.
    if(m.bombs > 0 && m.hp <= m.maxHp * m.nextBombAt){
      m.bombs--; m.nextBombAt -= 0.33;
      for(let i = 0; i < bs.length; i++)
        if(bs[i].alive){ fx.spark(bs[i].x, bs[i].y, 0, 40, "#e8c14a", 0.25, 2); bs[i].alive = false; }
      fx.ring(m.x, m.y, 180, "#e8c14a", 6, 0.6);
      fx.shake(10);
      audio.play("bomb");
      SF.comms.say("mirrorBomb");
    }
    // Ram guard: standing under it hurts (gently - it is still a duel). Not
    // while it is open, though: the window is the one moment the fight tells
    // you to come and get it, and punishing that teaches the wrong lesson.
    if(m.mode === "mirror" && p && p.alive &&
       Math.hypot(p.x - m.x, p.y - m.y) < m.r + 16)
      SF.game.hurtPlayer && SF.game.hurtPlayer("mirror");
    if(m.hp <= 0){
      S.stage = "tear"; S.t = 0;
      fx.explosion(m.x, m.y, 150, "#e8c14a", true);
      fx.shake(26); fx.hitStop(160);
      fx.flash(0.8, "255,255,255");
      audio.play("bossExplode");
      run.bannerText = "THE SKY TEARS";
      run.bannerSub = "this is where skies come from";
      run.bannerColor = "#e2e8f0";
      run.bannerUntil = simMs + 3000;
    }
  }

  // --- the tear: 1.6 seconds of falling paint --------------------------
  if(S.stage === "tear"){
    if(S.t < 1.2 && chance(0.7))
      SF.fx.debris(rand(0, W), rand(0, H*0.5), 3, pick(["#7c3aed","#f59e0b","#22d3ee","#f43f5e"]));
    if(S.t > 1.6){
      S.stage = "brush"; S.t = 0;
      const p = world.player;
      const dps = p ? p.dps : 60;
      S.brush = {
        x: W/2, y: -120, r: 30, size: 210,
        hp: Math.round(dps * 26), maxHp: Math.round(dps * 26),
        holdY: 150, t: 0, flash: 0,
        attack: null, attackT: 0, nextAttack: 2.2,
        tired: 0,                 // >0: core exposed, takes player bullets
        cycle: 0,
      };
      run.bannerText = "THE ROYAL BRUSH";
      run.bannerSub = "paint faster than it does";
      run.bannerColor = "#c9b458";
      run.bannerUntil = simMs + 3600;
      audio.play("bossWake");
      SF.comms.say("brushSeen");
    }
  }

  // --- act 3: THE ROYAL BRUSH ------------------------------------------
  if(S.stage === "brush" && S.brush){
    const B = S.brush, p = world.player;
    B.t += dt;
    B.flash = Math.max(0, B.flash - dt*4);
    B.tired = Math.max(0, B.tired - dt);
    if(B.y < B.holdY) B.y += 110 * dt;
    else B.x = W/2 + Math.sin(B.t*0.5) * W*0.26;

    // The paint trail: the ship writes with its own colour now.
    if(p && p.alive){
      S.paintTrail.push({ x: p.x, y: p.y, t: 2.2 });
    }
    for(let i = S.paintTrail.length - 1; i >= 0; i--){
      S.paintTrail[i].t -= dt;
      if(S.paintTrail[i].t <= 0) S.paintTrail.splice(i, 1);
    }

    // Attack conductor.
    B.nextAttack -= dt;
    if(!B.attack && B.nextAttack <= 0 && B.y >= B.holdY - 1){
      B.cycle++;
      B.attack = ["sketch", "eraser", "sketch", "letters"][B.cycle % 4];
      B.attackT = 0;
      if(B.attack === "sketch"){
        // It DRAWS a squadron: ghosts first, the real thing after.
        const n = 4 + Math.min(3, Math.floor(B.cycle/2));
        const types = ["grunt","weaver","striker","swooper","interceptor"];
        for(let i = 0; i < n; i++){
          S.sketches.push({
            x: 60 + (W - 120) * (i + 0.5)/n + rand(-16, 16),
            y: rand(150, 330),
            type: pick(types),
            /*
             * INK is the window you have to fly through a ghost before it
             * becomes a real enemy, and at 2.4s it was not a window at all.
             * Measured: a bot flying at full speed straight at the nearest
             * sketch, ignoring the erasers, the letters and the boss, painted
             * SIX of thirty over a minute - which is exactly the star's
             * target. A seven-year-old who also has to dodge was never going
             * to close the loop, so the rule could not teach itself.
             */
            ink: 4.5, painted: false,
          });
        }
        audio.play("telegraph");
        // The first squadron it draws is the lesson. Said once, plainly, with
        // the ghosts on screen in front of you.
        if(!S.taughtPaint){
          S.taughtPaint = true;
          run.bannerText = "FLY THROUGH THE SKETCHES";
          run.bannerSub = "your paint turns them onto OUR side";
          run.bannerColor = pcolOf();
          run.bannerUntil = simMs + 4200;
          SF.comms.say("paintSketch");
        }
        B.nextAttack = 6.5;
      } else if(B.attack === "eraser"){
        S.erasers.push({
          y: p ? clamp(p.y + rand(-40, 40), H*0.35, H*0.8) : H*0.6,
          x: -70, w: 74, h: 46, warn: 1.0, speed: 300,
        });
        audio.play("alarm");
        B.nextAttack = 5.0;
      } else if(B.attack === "letters"){
        const word = "GAME OVER";
        /*
         * A letter is a TIMING obstacle - shoot the word down before it
         * finishes the sentence - so it is sized in hits, not in health. At a
         * flat 4 it took four bullets from a stock ship and, once the `b.dmg`
         * read above was fixed, less than one from a maxed one: the whole
         * attack evaporated before it could be read. Scaling at 0.6 of the
         * damage level keeps it an obstacle at every loadout while still
         * paying the upgrade - maxed guns roughly halve the work.
         */
        const letterHp = Math.round(4 * (1 + SF.profile.upgradeLevel(SF.game.profile, "damage") * 0.6));
        let k = 0;
        for(let i = 0; i < word.length; i++){
          if(word[i] === " ") continue;
          S.letters.push({
            ch: word[i],
            x: 50 + (W - 100) * (i + 0.5)/word.length,
            y: -40 - k*26, vy: 34,
            hp: letterHp, r: 24, wob: rand(0, TAU),
          });
          k++;
        }
        run.bannerText = "IT'S WRITING SOMETHING";
        run.bannerSub = "don't let it finish the sentence!";
        run.bannerColor = "#e2e8f0";
        run.bannerUntil = simMs + 2400;
        audio.play("alarm");
        B.nextAttack = 13;
      }
      if(B.attack !== "letters") B.attack = null;   // instant setups
      else B.attack = null;
    }

    // Sketches: ink in unless painted first.
    for(let i = S.sketches.length - 1; i >= 0; i--){
      const sk = S.sketches[i];
      sk.ink -= dt;
      // The trail paints it to your side.
      if(!sk.painted){
        // A brush, not a needle. At 30px you had to cross the ghost almost
        // dead centre; the drawn box is 52px across, so grazing it now counts
        // - which is what "flying through it" looks like to a child.
        for(let k = 0; k < S.paintTrail.length; k++){
          const tp = S.paintTrail[k];
          const dx = tp.x - sk.x, dy = tp.y - sk.y;
          if(dx*dx + dy*dy < 46*46){
            sk.painted = true;
            run.stats.painted++;
            S.allies.push({ x: sk.x, y: sk.y, type: sk.type, t: 12, zap: 1.2 });
            // Splashed in YOUR paint, and counted out loud: a star you can't
            // see the progress of is a star nobody chases.
            fx.ring(sk.x, sk.y, 44, pcolOf(), 5, 0.42);
            fx.ring(sk.x, sk.y, 24, "#ffffff", 3, 0.3);
            for(let q = 0; q < 8; q++){
              const a = q/8*TAU;
              fx.spark(sk.x, sk.y, Math.cos(a)*130, Math.sin(a)*130, pcolOf(), 0.4, 3);
            }
            fx.text(sk.x, sk.y - 26,
                    "PAINTED!  " + run.stats.painted + "/6", "#4ade80", 17, true);
            audio.play("rescue");
            S.sketches.splice(i, 1);
            break;
          }
        }
        if(sk.painted) continue;
      }
      if(sk.ink <= 0){
        // Inked: it becomes real, and angry.
        world.spawnEnemy(sk.type, sk.x, sk.y, { difficulty: run.difficulty });
        fx.spark(sk.x, sk.y, 0, -30, "#e2e8f0", 0.4, 3);
        S.sketches.splice(i, 1);
      }
    }

    // Allies: painted sketches fight for you - each zap chips the brush.
    for(let i = S.allies.length - 1; i >= 0; i--){
      const al = S.allies[i];
      al.t -= dt;
      al.zap -= dt;
      al.y += Math.sin(al.t*2)*10*dt;
      if(al.zap <= 0){
        al.zap = 1.2;
        al.beam = 0.16;               // drawn by drawActors
        B.hp -= Math.round(B.maxHp * 0.012);
        B.flash = 0.6;
        fx.spark(B.x + rand(-30, 30), B.y + rand(-10, 30), 0, 60, "#4ade80", 0.3, 3);
      }
      if(al.beam) al.beam -= dt;
      if(al.t <= 0){
        fx.spark(al.x, al.y, 0, -80, "#4ade80", 0.4, 2);
        S.allies.splice(i, 1);
      }
    }

    // Erasers: warn, then sweep. They rub out your bullets - and you.
    for(let i = S.erasers.length - 1; i >= 0; i--){
      const er = S.erasers[i];
      if(er.warn > 0){ er.warn -= dt; continue; }
      er.x += er.speed * dt;
      const bs = world.bullets.items;
      for(let k = 0; k < bs.length; k++){
        const b = bs[k];
        if(b.alive && Math.abs(b.y - er.y) < er.h/2 + 6 &&
           Math.abs(b.x - er.x) < er.w/2 + 6){
          b.alive = false;
          fx.spark(b.x, b.y, rand(-30,30), rand(-20,20), "#f1e4c8", 0.35, 2);
        }
      }
      if(p && p.alive && Math.abs(p.y - er.y) < er.h/2 + 12 &&
         Math.abs(p.x - er.x) < er.w/2 + 12)
        SF.game.hurtPlayer && SF.game.hurtPlayer("eraser");
      if(er.x > W + 80){
        S.erasers.splice(i, 1);
        // Rubbing you out is tiring: the core glows, and your guns matter.
        B.tired = 3.5;
        fx.text(B.x, B.y + 60, "IT'S TIRED — HIT THE CORE!", "#ffd23f", 16, true);
      }
    }

    // Letters: they fall; you break them; the floor breaks you.
    for(let i = S.letters.length - 1; i >= 0; i--){
      const L = S.letters[i];
      L.y += L.vy * dt;
      L.wob += dt*2;
      const bs = world.bullets.items;
      for(let k = 0; k < bs.length; k++){
        const b = bs[k];
        if(!b.alive) continue;
        const dx = b.x - L.x, dy = b.y - L.y;
        if(dx*dx + dy*dy < (L.r + 4)*(L.r + 4)){
          b.alive = false;
          L.hp -= b.dmg || 1;
          fx.spark(b.x, b.y, 0, -40, "#e2e8f0", 0.3, 2);
        }
      }
      // The paint trail dissolves letters too - flying THROUGH the word.
      for(let k = 0; k < S.paintTrail.length; k += 3){
        const tp = S.paintTrail[k];
        const dx = tp.x - L.x, dy = tp.y - L.y;
        if(dx*dx + dy*dy < (L.r + 6)*(L.r + 6)) L.hp -= dt * 6;
      }
      if(L.hp <= 0){
        fx.debris(L.x, L.y, 8, "#e2e8f0");
        fx.spark(L.x, L.y, 0, -60, "#ffd23f", 0.4, 3);
        audio.play("armourClang");
        S.letters.splice(i, 1);
        if(!S.letters.length){
          B.tired = 4.5;
          B.hp -= Math.round(B.maxHp * 0.06);
          B.flash = 1;
          fx.text(B.x, B.y + 60, "SENTENCE BROKEN!", "#4ade80", 18, true);
          audio.play("victory");
        }
        continue;
      }
      if(p && p.alive && L.y > p.y - 26){
        SF.game.hurtPlayer && SF.game.hurtPlayer("letter");
        fx.debris(L.x, L.y, 6, "#e2e8f0");
        S.letters.splice(i, 1);
      } else if(L.y > H + 40){
        S.letters.splice(i, 1);
      }
    }

    // Your bullets vs the brush: only lands while it is tired.
    if(B.tired > 0){
      const bs = world.bullets.items;
      for(let i = 0; i < bs.length; i++){
        const b = bs[i];
        if(!b.alive) continue;
        const dx = b.x - B.x, dy = b.y - B.y;
        if(dx*dx + dy*dy < (B.r + 8)*(B.r + 8)){
          b.alive = false;
          B.hp -= b.dmg || 1;
          B.flash = 1;
          fx.spark(b.x, b.y, 0, -70, "#c9b458", 0.3, 3);
        }
      }
    }

    // The second fake ending: at a third health it sketches a RESULTS CARD
    // - and then tears its own forgery apart.
    if(!S.fakeCard && B.hp <= B.maxHp * 0.35){
      S.fakeCard = 3.2;
      run.bannerText = "MISSION COMPLETE?";
      run.bannerSub = "that's not your handwriting...";
      run.bannerColor = "#e2e8f0";
      run.bannerUntil = simMs + 2600;
      audio.play("telegraph");
    }
    if(S.fakeCard > 0){
      S.fakeCard -= dt;
      if(S.fakeCard <= 0){
        fx.shake(12);
        fx.debris(W/2, H*0.4, 16, "#e2e8f0");
        audio.play("alarm");
      }
    }

    // The sky repaint cycle: it flips through every act's palette.
    if(Math.floor(B.t / 9) !== S.paletteIdx){
      S.paletteIdx = Math.floor(B.t / 9);
    }

    if(B.hp <= 0){
      S.stage = "nova"; S.t = 0; S.novaT = 0;
      S.sketches.length = 0; S.erasers.length = 0; S.letters.length = 0;
      const en = world.enemies.items;      // no sketch outlives its painter
      for(let i = 0; i < en.length; i++)
        if(en[i].alive) fx.explosion(en[i].x, en[i].y, 26, "#ffd23f", false);
      world.enemies.killAll();
      world.enemyBullets.killAll();
      fx.hitStop(220);
      fx.shake(34);
      fx.flash(1.0, "255,240,180");
      audio.play("bossExplode");
    }
  }

  // --- the nova: the brush's core is a gold star, and it goes up --------
  if(S.stage === "nova"){
    S.novaT += dt;
    const B = S.brush;
    if(S.novaT < 3.4){
      if(chance(0.5))
        SF.fx.firework(rand(60, W - 60), rand(H*0.15, H*0.6),
          ["#ffd23f","#ff5d73","#4ade80","#3fc9ff","#c084fc","#ffffff"]);
      if(chance(0.4) && B)
        SF.fx.ring(B.x, B.y, rand(60, 200), "#ffd23f", 4, 0.5);
    } else if(!S.doneSaid){
      S.doneSaid = true;
      const run2 = SF.game.run;
      if(run2){
        run2.bannerText = "YOU PAINTED THE SKY";
        run2.bannerSub = "the workshop is yours, " +
          ((SF.game.profile && (SF.game.profile.callsign || SF.game.profile.name)) || "pilot");
        run2.bannerColor = "#ffd23f";
        run2.bannerUntil = simMs + 4200;
        world.dropCoins(B ? B.x : W/2, Math.min(B ? B.y : 200, 300),
          Math.round(1200 * run2.difficulty.pay * (world.player ? world.player.moneyMult : 1)));
        run2.score += Math.round(5000 * run2.difficulty.pay);
        // Hand the mission back to the normal ending machinery.
        run2.bossCleared = true;
        run2.bossActive = false;
        run2.finishTimer = 1.6;
      }
      SF.game.profile && SF.game.profile.bossesDefeated++;
      S.stage = "done";
      SF.comms.say("brushDown");
    }
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - three depths                                                */
/* ------------------------------------------------------------------ */

/* Right after the sky: blueprint flashes, the torn-away workshop void. */
function drawSky(ctx, timeMs, VWpx, VHpx){
  if(!S) return;
  const torn = S.stage === "tear" || S.stage === "brush" ||
               S.stage === "nova" || S.stage === "done";
  const k = torn ? 1 : (S.stutter > 0 ? Math.min(1, S.stutter / 0.2) : 0);
  if(k <= 0) return;

  // The unpainted ground: graphite, a drawing grid, pencil notes.
  ctx.save();
  ctx.globalAlpha = k;
  ctx.fillStyle = "#12141d";
  ctx.fillRect(0, 0, VWpx, VHpx);
  ctx.strokeStyle = "rgba(110,160,220,0.13)";
  ctx.lineWidth = 1;
  const g = 48, off = torn ? (timeMs/90) % g : 0;
  for(let x = -g + (off % g); x < VWpx + g; x += g){
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VHpx); ctx.stroke();
  }
  for(let y = -g + (off % g); y < VHpx + g; y += g){
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VWpx, y); ctx.stroke();
  }
  // Unpainted props: dashed circles where planets would go.
  ctx.setLineDash([7, 8]);
  ctx.strokeStyle = "rgba(110,160,220,0.20)";
  ctx.lineWidth = 1.5;
  [[0.2, 0.24, 90], [0.82, 0.62, 130], [0.6, 0.12, 46]].forEach(([px, py, r]) => {
    ctx.beginPath(); ctx.arc(px*VWpx, py*VHpx, r, 0, TAU); ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.font = "12px Rajdhani, Arial, sans-serif";
  ctx.fillStyle = "rgba(150,180,225,0.35)";
  ctx.fillText("sky 29 — for the boys", VWpx*0.16, VHpx*0.24 - 100);
  ctx.fillText("planet here?", VWpx*0.74, VHpx*0.62 - 140);

  // The brush repaints acts over the blueprint while it fights.
  if((S.stage === "brush" || S.stage === "nova") && S.paletteIdx >= 0){
    const PALS = [
      ["#7c3aed","#4c1d95"], ["#0891b2","#164e63"], ["#c2410c","#7c2d12"],
      ["#9d174d","#4a044e"], ["#155e75","#0b1c3c"], ["#c026d3","#4a0450"],
    ];
    const pal = PALS[S.paletteIdx % PALS.length];
    const wash = ctx.createLinearGradient(0, 0, 0, VHpx);
    wash.addColorStop(0, pal[0] + "33");
    wash.addColorStop(1, pal[1] + "22");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, VWpx, VHpx);
  }
  ctx.restore();
}

/* At boss depth: the mirror pilot, the brush, sketches, letters, erasers. */
function drawActors(ctx, timeMs){
  if(!S) return;
  const fxnow = timeMs;

  /*
   * Sketches: dashed blueprint ghosts filling in as their ink runs out.
   *
   * They used to be a dashed box that quietly darkened, which told a child
   * nothing about the two things that matter: that this is a thing to fly
   * INTO, and that there is a clock on it. Now the box carries a draining
   * ring - the ink timer, made of time you can see - and it wears the
   * pilot's own paint colour on the near edge, so it reads as claimable
   * rather than as scenery.
   */
  const pc = pcolOf();
  for(let i = 0; i < S.sketches.length; i++){
    const sk = S.sketches[i];
    const spr = SF.enemyArt.spriteFor(sk.type, "#9db8e8", false);
    const k = clamp(1 - sk.ink/4.5, 0, 1);          // 0 fresh -> 1 about to ink
    ctx.save();
    ctx.translate(sk.x, sk.y);

    // The claim ring: a full circle of your paint that drains as it inks.
    ctx.strokeStyle = k > 0.78 ? "rgba(255,93,115,0.95)" : pc;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, 34, -Math.PI/2, -Math.PI/2 + (1-k)*TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke();

    // A soft target pad, so the middle of it reads as somewhere to BE.
    const pad = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
    pad.addColorStop(0, "rgba(255,255,255,0.16)");
    pad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = pad;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.fill();

    ctx.globalAlpha = 0.35 + k*0.5;
    if(spr) ctx.drawImage(spr, -24, -24, 48, 48);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = k > 0.78 ? "rgba(255,93,115,0.9)" : "rgba(130,170,230,0.8)";
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -fxnow/60;
    ctx.strokeRect(-26, -26, 52, 52);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Allies: painted in the player's colour, zapping upward.
  const pcol = pcolOf();
  for(let i = 0; i < S.allies.length; i++){
    const al = S.allies[i];
    const spr = SF.enemyArt.spriteFor(al.type, pcol, false);
    ctx.save();
    ctx.translate(al.x, al.y);
    ctx.rotate(Math.PI);                       // painted, it flies YOUR way up
    if(spr) ctx.drawImage(spr, -22, -22, 44, 44);
    ctx.restore();
    if(al.beam > 0 && S.brush){
      ctx.strokeStyle = "rgba(74,222,128,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(al.x, al.y - 20);
      ctx.lineTo(S.brush.x + rand(-14, 14), S.brush.y + 30);
      ctx.stroke();
    }
  }

  /*
   * Erasers. This was a cream rectangle with a flat blue band across the top,
   * which - correctly - read as a FLAG rather than as a school rubber, and a
   * flag sweeping the screen explains nothing about why it hurts.
   *
   * What makes a rubber a rubber: rounded corners, the blue end being a
   * separate harder block with a seam, a worn leading edge that is dirty from
   * use, and crumbs coming off the end that is doing the rubbing. It also
   * travels flat-on now, so the working face leads.
   */
  for(let i = 0; i < S.erasers.length; i++){
    const er = S.erasers[i];
    if(er.warn > 0){
      // The warning is the smear it is ABOUT to leave, brightening as it comes.
      const k = 1 - clamp(er.warn, 0, 1);
      ctx.save();
      const g = ctx.createLinearGradient(0, er.y - er.h/2, 0, er.y + er.h/2);
      g.addColorStop(0, "rgba(241,228,200,0)");
      g.addColorStop(0.5, "rgba(241,228,200," + (0.10 + k*0.12).toFixed(3) + ")");
      g.addColorStop(1, "rgba(241,228,200,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, er.y - er.h/2, VW(), er.h);
      ctx.strokeStyle = "rgba(241,228,200," + (0.25 + Math.sin(fxnow/70)*0.15).toFixed(3) + ")";
      ctx.lineWidth = 2; ctx.setLineDash([9, 9]); ctx.lineDashOffset = -fxnow/40;
      ctx.beginPath(); ctx.moveTo(0, er.y); ctx.lineTo(VW(), er.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      continue;
    }
    const w = er.w, h = er.h, r = h*0.22;
    ctx.save();
    ctx.translate(er.x, er.y);
    ctx.rotate(-0.06);
    // The smear it leaves behind - the reason it is dangerous, made visible.
    const sm = ctx.createLinearGradient(-w/2, 0, -w/2 - 120, 0);
    sm.addColorStop(0, "rgba(241,228,200,0.22)");
    sm.addColorStop(1, "rgba(241,228,200,0)");
    ctx.fillStyle = sm;
    ctx.fillRect(-w/2 - 120, -h*0.36, 120, h*0.72);

    const body = () => {
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(-w/2, -h/2, w, h, r);
      else ctx.rect(-w/2, -h/2, w, h);
    };
    body();
    const grad = ctx.createLinearGradient(0, -h/2, 0, h/2);
    grad.addColorStop(0, "#fdf6e4");
    grad.addColorStop(0.55, "#f1e4c8");
    grad.addColorStop(1, "#cbb894");
    ctx.fillStyle = grad; ctx.fill();

    // The blue end: a separate, harder block, clipped to the body so it keeps
    // the rounded corner - and on the TRAILING side, because the pale rubber
    // is the end doing the work.
    ctx.save();
    body(); ctx.clip();
    const blue = ctx.createLinearGradient(0, -h/2, 0, h/2);
    blue.addColorStop(0, "#63b6ef");
    blue.addColorStop(1, "#2c7fbc");
    ctx.fillStyle = blue;
    ctx.fillRect(w*0.16, -h/2, w*0.34, h);
    ctx.strokeStyle = "rgba(20,24,36,0.35)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(w*0.16, -h/2); ctx.lineTo(w*0.16, h/2); ctx.stroke();
    // Worn and grubby at the leading edge: this one has been used.
    const dirt = ctx.createLinearGradient(-w/2, 0, -w/2 + w*0.3, 0);
    dirt.addColorStop(0, "rgba(90,84,74,0.45)");
    dirt.addColorStop(1, "rgba(90,84,74,0)");
    ctx.fillStyle = dirt;
    ctx.fillRect(-w/2, -h/2, w*0.3, h);
    ctx.restore();

    body();
    ctx.strokeStyle = "rgba(20,24,36,0.75)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    // Crumbs, off the working end, drifting back the way it came.
    for(let q = 0; q < 5; q++){
      const u = ((fxnow/1000*1.6 + q*0.2 + i*0.11) % 1);
      ctx.fillStyle = "rgba(226,214,186," + (0.7*(1-u)).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(er.x - er.w*0.5 - u*46, er.y + Math.sin(q*2.1 + u*5)*er.h*0.5,
              Math.max(0.8, 2.6*(1-u)), 0, TAU);
      ctx.fill();
    }
  }

  // Letters: giant drawn glyphs with a wobble, cracking as they take fire.
  for(let i = 0; i < S.letters.length; i++){
    const L = S.letters[i];
    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.rotate(Math.sin(L.wob)*0.08);
    ctx.font = "700 46px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(6,8,18,0.8)";
    ctx.lineWidth = 6;
    ctx.strokeText(L.ch, 0, 0);
    ctx.fillStyle = L.hp <= 2 ? "#ffb3be" : "#e2e8f0";
    ctx.fillText(L.ch, 0, 0);
    ctx.restore();
  }

  // THE MIRROR PILOT: your ship, upside down, in the workshop's gold.
  if(S.stage === "mirror" && S.mirror){
    const m = S.mirror;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(Math.PI);
    SF.shipart.drawShip(ctx, 0, 0, 62, {
      color: "#3a3324",
      levels: SF.shipart.levelsOf(SF.game.profile),
      t: m.t, idle: false,
      tune: SF.game.profile && SF.game.profile.tune,
    });
    ctx.restore();
    if(m.flash > 0){
      ctx.globalAlpha = Math.min(0.5, m.flash*0.5);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(m.x, m.y, 34, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Its tell, so a dodge is always something you watched it decide.
    if(m.tell > 0){
      ctx.strokeStyle = "rgba(232,193,74,0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 30, 0, TAU);
      ctx.stroke();
    }
    /*
     * The open window, said in green - the game's own colour for "this is
     * good for you". Guns cold, a target ring, and a countdown arc that runs
     * out, so a seven-year-old can see the turn coming and see it ending.
     */
    if(m.mode === "open"){
      const k = clamp(m.modeT / 3.0, 0, 1);
      const pulse = 0.55 + Math.sin(m.t*9)*0.45;
      ctx.save();
      ctx.strokeStyle = "rgba(74,222,128," + (0.45 + pulse*0.45).toFixed(2) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y, 40 + pulse*5, 0, TAU); ctx.stroke();
      // the turn running out
      ctx.strokeStyle = "rgba(74,222,128,0.95)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(m.x, m.y, 52, -Math.PI/2, -Math.PI/2 + TAU*k);
      ctx.stroke();
      ctx.fillStyle = "rgba(74,222,128,0.95)";
      ctx.font = "bold 13px Rajdhani, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("OPEN!", m.x, m.y - 62);
      ctx.restore();
    }
  }

  // THE ROYAL BRUSH: a workshop brush the size of a boss, held nib-down.
  if((S.stage === "brush" || S.stage === "nova") && S.brush){
    const B = S.brush;
    ctx.save();
    ctx.translate(B.x, B.y);
    const lean = Math.sin(B.t*0.5) * 0.10;
    ctx.rotate(lean);
    const Sz = B.size;
    // handle
    const grad = ctx.createLinearGradient(0, -Sz*0.9, 0, -Sz*0.2);
    grad.addColorStop(0, "#8a5a2a");
    grad.addColorStop(1, "#5e3a18");
    ctx.fillStyle = grad;
    ctx.fillRect(-Sz*0.07, -Sz*0.95, Sz*0.14, Sz*0.62);
    ctx.strokeStyle = "rgba(10,12,20,0.85)";
    ctx.lineWidth = 3;
    ctx.strokeRect(-Sz*0.07, -Sz*0.95, Sz*0.14, Sz*0.62);
    // ferrule
    ctx.fillStyle = "#c9b458";
    ctx.fillRect(-Sz*0.10, -Sz*0.34, Sz*0.20, Sz*0.14);
    ctx.strokeRect(-Sz*0.10, -Sz*0.34, Sz*0.20, Sz*0.14);
    // bristles, swelling to the nib
    ctx.fillStyle = "#2c3244";
    ctx.beginPath();
    ctx.moveTo(-Sz*0.10, -Sz*0.20);
    ctx.quadraticCurveTo(-Sz*0.16, Sz*0.02, 0, Sz*0.13);
    ctx.quadraticCurveTo(Sz*0.16, Sz*0.02, Sz*0.10, -Sz*0.20);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // the nib: wet with whatever it paints next
    const nib = ctx.createRadialGradient(0, Sz*0.10, 0, 0, Sz*0.10, Sz*0.12);
    nib.addColorStop(0, "#ffd23f");
    nib.addColorStop(1, "rgba(255,210,63,0)");
    ctx.fillStyle = nib;
    ctx.beginPath(); ctx.arc(0, Sz*0.10, Sz*0.12, 0, TAU); ctx.fill();
    // the core: the workshop's gold star, exposed when it is tired
    if(B.tired > 0){
      const tw = 0.6 + Math.sin(timeMs/120)*0.4;
      ctx.fillStyle = "rgba(255,235,150," + (0.5 + tw*0.4).toFixed(2) + ")";
      ctx.save();
      ctx.translate(0, -Sz*0.27);
      ctx.beginPath();
      for(let i = 0; i < 5; i++){
        const a = -Math.PI/2 + i*TAU/5, b = a + TAU/10;
        ctx.lineTo(Math.cos(a)*16, Math.sin(a)*16);
        ctx.lineTo(Math.cos(b)*7, Math.sin(b)*7);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if(B.flash > 0){
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.4, B.flash*0.4);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(0, 0, Sz*0.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /*
   * The paint trail: the ship writes in its own colour. It was one 10px line
   * at half alpha, which on a blueprint full of dashed pencil read as another
   * bit of drawing rather than as YOUR brush - and the whole act turns on
   * noticing that your ship is now the thing making marks. So: a wide wet
   * stroke, a brighter core down the middle of it, and a loaded head at the
   * nose that says the paint is coming from the ship.
   */
  if(S.paintTrail.length > 2){
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const stroke = w => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(S.paintTrail[0].x, S.paintTrail[0].y);
      for(let i = 1; i < S.paintTrail.length; i++)
        ctx.lineTo(S.paintTrail[i].x, S.paintTrail[i].y);
      ctx.stroke();
    };
    ctx.globalAlpha = 0.30; ctx.strokeStyle = pcol; stroke(22);   // the wet edge
    ctx.globalAlpha = 0.72; ctx.strokeStyle = pcol; stroke(13);   // the body
    ctx.globalAlpha = 0.55; ctx.strokeStyle = "#ffffff"; stroke(3.5);  // the core
    ctx.restore();
    // The loaded head, at the nose: this is where the paint is coming from.
    const head = S.paintTrail[S.paintTrail.length - 1];
    if(head){
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(head.x, head.y, 1, head.x, head.y, 26);
      g.addColorStop(0, pcol);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.5 + Math.sin(fxnow/140)*0.12;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(head.x, head.y, 26, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

/* Above the scene, below the HUD: the hostile HUD and boss bars. */
function drawOver(ctx, timeMs){
  if(!S) return;
  const W = VW();

  // The mirror pilot gets a hostile bar - upside down, in your colours.
  const bar = (label, hp, maxHp, col) => {
    const w = W*0.62, x = (W - w)/2, y = 96;
    ctx.fillStyle = "rgba(4,8,18,0.72)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x, y, w, 10, 5);
    else ctx.rect(x, y, w, 10);
    ctx.fill(); ctx.stroke();
    const k = clamp(hp/maxHp, 0, 1);
    const g = ctx.createLinearGradient(0, y, 0, y + 10);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.35, col);
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x + 1.5, y + 1.5, Math.max(3, (w - 3)*k), 7, 3.5);
    else ctx.rect(x + 1.5, y + 1.5, Math.max(3, (w - 3)*k), 7);
    ctx.fill();
    ctx.font = "700 13px Rajdhani, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(6,8,18,0.75)";
    ctx.lineWidth = 3;
    ctx.strokeText(label, W/2, y - 6);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, W/2, y - 6);
  };
  if(S.stage === "mirror" && S.mirror)
    bar("THE MIRROR PILOT", S.mirror.hp, S.mirror.maxHp, "#e8c14a");
  if((S.stage === "brush") && S.brush)
    bar("THE ROYAL BRUSH", S.brush.hp, S.brush.maxHp, "#c9b458");
}

/* _state is for the test harness only: the fights are timed and aimed, and a
 * headless run needs to read them to drive a competent player. */
SF.backstage = { _state: () => S,
                 reset, begin, active, stage, readyForBoss, titanDown, update,
                 drawSky, drawActors, drawOver };
})();
