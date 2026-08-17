/*
 * BEHIND THE SKY - mission 40, the bonus level the war leaves behind.
 *
 * The campaign used to end here: three boss acts stacked on mission 39,
 * with the Welded Titan in front. The family asked for the ending to be a
 * homecoming instead - so the Titan stayed at 39 as the war's last fight
 * (see homecoming.js), the Mirror Pilot moved to the Glass Sea where a
 * mirror boss belongs (mirrorduel.js), and everything META - the paint
 * stutters, the fake endings, the tear to blueprint, THE ROYAL BRUSH -
 * lives here now, one level up, unlocked the moment 39 falls.
 *
 * The level is a celebration with a fight in the middle. It flies over
 * Papa's unfinished canvas (sky29.js owns the pencil veil and paints it as
 * you play), and when the last parade wave falls the workshop plays its
 * pranks: AREA CLEAR!, snatched away - then the sky itself tears off to
 * blueprint and the workshop's living brush fights by DRAWING: it sketches
 * squadrons that ink into the real thing, sweeps eraser bands through your
 * fire, and letters G A M E  O V E R down the screen like falling scenery.
 *
 * The brush also hands the player the game's last secret: from the tear
 * onward the ship trails PAINT (their own colour - the Style Shop made
 * flesh), and any sketch the trail touches is painted onto YOUR side
 * before it can ink. Painted allies fight for you. The final lesson of a
 * game about a family drawing together: the brush isn't the weapon,
 * whose hand it's in is.
 *
 * When the brush's star goes up, sky29.js takes the stage back: the last
 * stroke sweeps the blueprint away and the squadron lines up for a photo.
 *
 * Same rules as finale.js: simulation time only, and the module owns its
 * own theatre - game.js only asks three things (reset, update, and "may
 * the mission end yet?") plus three draw hooks at fixed depths.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, lerp, rand, randInt, chance, pick } = SF.core;
const TAU = Math.PI*2;
const T = s => (SF.i18n ? SF.i18n.t(s) : s);

let S = null;          // the whole theatre state; null when inactive
const VW = () => (SF.game && SF.game.VW) || 600;
/** The pilot's own paint - the colour the whole act is about. */
function pcolOf(){ return (SF.game.profile && SF.game.profile.shipColor) || "#3399ff"; }

function reset(){ S = null; }

function begin(){
  S = {
    stage: "travel",        // travel -> fakeClear -> tear -> brush -> nova -> done
    t: 0,                   // seconds in current stage
    stutter: 0,             // >0: the sky is losing its paint right now
    nextStutter: 7,
    fakeStep: 0,
    // the brush act
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

/* The waves may end, but the pranks, the tear and the brush come first.
 * sky29.js waits for this too: its last stroke only sweeps once the
 * workshop has nothing left to say. */
function readyToClear(){ return !S || S.stage === "done"; }

/* ------------------------------------------------------------------ */
/*  UPDATE                                                             */
/* ------------------------------------------------------------------ */
function update(dt, run, world, simMs){
  if(!S || run.ended) return;
  const fx = SF.fx, audio = SF.audio;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;

  // --- the travel weirdness: paint stutters, coins falling up ----------
  if(S.stage === "travel"){
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
      run.bannerText = T("AREA CLEAR!");
      run.bannerSub = T("grab the last coins — then head home");
      run.bannerColor = "#4ade80";
      run.bannerUntil = simMs + 2600;
      audio.play("victory");
    }
    if(S.fakeStep === 1 && S.t > 2.6){
      S.fakeStep = 2;
      S.stutter = 0.8;
      run.bannerText = T("no.");
      run.bannerSub = T("the workshop isn't done with you");
      run.bannerColor = "#ff5d73";
      run.bannerUntil = simMs + 2200;
      fx.shake(14);
      audio.play("alarm");
      SF.comms.say("backstageNo");
    }
    if(S.fakeStep === 2 && S.t > 4.6){
      // No titan waits here any more - the war ended a mission ago. The
      // prank goes straight for the reveal: the sky itself comes off.
      S.fakeStep = 3;
      S.stage = "tear"; S.t = 0;
      fx.shake(26); fx.hitStop(160);
      fx.flash(0.8, "255,255,255");
      audio.play("bossExplode");
      run.bannerText = T("THE SKY TEARS");
      run.bannerSub = T("this is where skies come from");
      run.bannerColor = "#e2e8f0";
      run.bannerUntil = simMs + 3000;
      SF.comms.say("backstageStart");
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
      run.bannerText = T("THE ROYAL BRUSH");
      run.bannerSub = T("paint faster than it does");
      run.bannerColor = "#c9b458";
      run.bannerUntil = simMs + 3600;
      audio.play("bossWake");
      audio.setMusic("boss");
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

    /*
     * THE BRUSH FLICKS PAINT, CONSTANTLY.
     *
     * It had no gun at all. Its whole repertoire was sketches, an eraser and
     * the GAME OVER letters, on gaps of five to thirteen seconds - so for
     * most of the last fight in the campaign there was nothing on screen to
     * dodge, and the finale played easier than the levels leading to it.
     *
     * Flicks are aimed but spread, and slow enough to read: this is a boss a
     * seven-year-old has to be able to finish. The rhythm tightens with the
     * tier, so ROOKIE gets a lick of paint and NIGHTMARE gets a hosing.
     */
    const smart = (run.difficulty && run.difficulty.smart) || 0;
    B.spray = (B.spray || 0) - dt;
    if(B.spray <= 0 && B.y >= B.holdY - 1 && p && p.alive){
      B.spray = Math.max(0.55, 1.75 - smart*0.26);
      const n = 3 + Math.min(2, Math.floor(smart/2));
      const dx = p.x - B.x, dy = p.y - B.y;
      const l = Math.max(1, Math.hypot(dx, dy));
      const base = Math.atan2(dy, dx);
      const sp = 210 + smart*22;
      for(let i = 0; i < n; i++){
        const a = base + (i - (n-1)/2) * 0.20;
        world.spawnEnemyBullet(B.x, B.y + B.r*0.6,
                               Math.cos(a)*sp, Math.sin(a)*sp, "paint", 6);
      }
      SF.fx.spark(B.x, B.y + B.r*0.6, Math.cos(base)*60, Math.sin(base)*60,
                  pcolOf(), 0.3, 3);
      SF.audio.play("enemyShoot");
    }

    // Attack conductor.
    B.nextAttack -= dt;
    if(!B.attack && B.nextAttack <= 0 && B.y >= B.holdY - 1){
      B.cycle++;
      B.attack = ["sketch", "splatter", "eraser", "sketch", "letters", "splatter"][B.cycle % 6];
      B.attackT = 0;
      if(B.attack === "sketch"){
        // It DRAWS a squadron: ghosts first, the real thing after.
        const n = 4 + Math.min(3, Math.floor(B.cycle/2));
        const types = ["grunt","weaver","striker","swooper","interceptor"];
        for(let i = 0; i < n; i++){
          S.sketches.push({
            x: 60 + (W - 120) * (i + 0.5)/n + rand(-16, 16),
            /*
             * INSIDE THE BAND THE SHIP CAN ACTUALLY FLY IN.
             *
             * These used to spawn at rand(150, 330). PLAY_TOP is 250 - the
             * ship's hard ceiling - and the paint radius is 46, so anything
             * above y=204 was physically impossible to touch. About a third
             * of every batch could not be painted no matter how well you
             * flew, which is most of why the star reads as broken: you chase
             * a ghost, you fly straight at it, and nothing happens.
             *
             * Kept off the ceiling too: at exactly 250 you have to pin the
             * ship against the roof, which is the worst place to be during a
             * boss fight.
             */
            y: rand(300, 470),
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
        if(!S.taughtPaint || (run.stats.painted === 0 && !S.taughtTwice)){
          if(S.taughtPaint) S.taughtTwice = true;
          S.taughtPaint = true;
          run.bannerText = T("FLY THROUGH THE SKETCHES");
          run.bannerSub = T("your paint turns them onto OUR side");
          run.bannerColor = pcolOf();
          run.bannerUntil = simMs + 4200;
          SF.comms.say("paintSketch");
        }
        B.nextAttack = Math.max(3.2, 5.2 - smart*0.4);
      } else if(B.attack === "splatter"){
        const smart2 = (run.difficulty && run.difficulty.smart) || 0;
        const n = 12 + smart2*2;
        for(let i = 0; i < n; i++){
          const a = Math.PI*0.18 + (i/(n-1)) * Math.PI*0.64;   // a downward fan
          const sp = 170 + smart2*18;
          world.spawnEnemyBullet(B.x, B.y + B.r*0.6,
                                 Math.cos(a)*sp, Math.sin(a)*sp, "paint", 7);
        }
        SF.fx.ring(B.x, B.y + B.r*0.6, 54, pcolOf(), 4, 0.35);
        SF.audio.play("gust");
        B.nextAttack = Math.max(2.6, 4.4 - smart*0.35);
      } else if(B.attack === "eraser"){
        S.erasers.push({
          y: p ? clamp(p.y + rand(-40, 40), H*0.35, H*0.8) : H*0.6,
          x: -70, w: 74, h: 46, warn: 1.0, speed: 300,
        });
        audio.play("alarm");
        B.nextAttack = Math.max(2.8, 4.2 - smart*0.35);
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
        run.bannerText = T("IT'S WRITING SOMETHING");
        run.bannerSub = T("don't let it finish the sentence!");
        run.bannerColor = "#e2e8f0";
        run.bannerUntil = simMs + 2400;
        audio.play("alarm");
        B.nextAttack = Math.max(6.0, 9.5 - smart*0.8);
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
                    T("PAINTED!") + "  " + run.stats.painted + "/6", "#4ade80", 17, true);
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
        fx.text(B.x, B.y + 60, T("IT'S TIRED — HIT THE CORE!"), "#ffd23f", 16, true);
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
          fx.text(B.x, B.y + 60, T("SENTENCE BROKEN!"), "#4ade80", 18, true);
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
      run.bannerText = T("MISSION COMPLETE?");
      run.bannerSub = T("that's not your handwriting...");
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
        run2.bannerText = T("THE WORKSHOP IS YOURS");
        run2.bannerSub = T("one stroke left on the canvas");
        run2.bannerColor = "#ffd23f";
        run2.bannerUntil = simMs + 3600;
        world.dropCoins(B ? B.x : W/2, Math.min(B ? B.y : 200, 300),
          Math.round(1200 * run2.difficulty.pay * (world.player ? world.player.moneyMult : 1)));
        run2.score += Math.round(5000 * run2.difficulty.pay);
      }
      SF.game.profile && SF.game.profile.bossesDefeated++;
      // The stage goes dark and sky29.js takes over: the last stroke sweeps
      // the blueprint away, the photo lands, and the normal ending follows.
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

  ctx.save();
  /*
   * THE HANDOFF. Once the brush is beaten, sky29's last stroke sweeps the
   * canvas top to bottom - so from "done" onward the blueprint only exists
   * BELOW the stroke's front, exactly like the pencil veil it lives under.
   * One clip, and both layers leave the stage under the same brush.
   */
  if(S.stage === "done" && SF.sky29 && SF.sky29.active()){
    const sk = SF.sky29._state();
    if(sk && (sk.phase === "photo" || sk.phase === "done")){ ctx.restore(); return; }
    if(sk && sk.phase === "stroke"){
      ctx.beginPath();
      ctx.rect(0, Math.max(0, sk.strokeY), VWpx, VHpx);
      ctx.clip();
    }
  }

  // The unpainted ground: graphite, a drawing grid, pencil notes.
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
  if((S.stage === "brush") && S.brush)
    bar(T("THE ROYAL BRUSH"), S.brush.hp, S.brush.maxHp, "#c9b458");
}

/* _state is for the test harness only: the fights are timed and aimed, and a
 * headless run needs to read them to drive a competent player. */
/*
 * How far through the act we are, 0..1 - for the mission bar in the HUD.
 *
 * Once the workshop takes the stage, waves stop being the story - so each
 * stage owns a slice, and the brush (the one real fight left in here) fills
 * its slice from the thing you are actually shooting.
 */
const PROGRESS_AT = { fakeClear:0.04, tear:0.12, brush:0.16, nova:0.96, done:1 };
function progress01(){
  if(!S) return 0;
  const base = PROGRESS_AT[S.stage] != null ? PROGRESS_AT[S.stage] : 0;
  if(S.stage === "brush" && S.brush && S.brush.maxHp)
    return base + (PROGRESS_AT.nova - base) * (1 - S.brush.hp/S.brush.maxHp);
  return base;
}

SF.backstage = { _state: () => S,
                 reset, begin, active, stage, readyToClear, update,
                 progress01,
                 drawSky, drawActors, drawOver };
})();
