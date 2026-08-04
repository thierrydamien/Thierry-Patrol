/*
 * BossController: multi-phase encounters.
 *
 * Design rules borrowed from good arcade shooters:
 *  - Phases are health-driven, and each phase changes what the boss *does*,
 *    not just how much damage it soaks.
 *  - Every attack is telegraphed. The player should always be able to say
 *    "that's the beam, get out of the column" before it fires.
 *  - Weak points are destructible sub-targets. Blowing one off permanently
 *    disables the attack it powers, so a hard fight gets easier the better
 *    you aim - skill compounds instead of just HP dropping.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, rand, randInt, pick, TAU } = SF.core;
const { BOSSES } = SF.missions;
const { VW, VH } = SF.entityConst;
const fx = SF.fx;
const audio = SF.audio;

/*
 * A boss is sized in *seconds of fight*, not in hit points.
 *
 * `def.fightSeconds` is how long the encounter should last for the ship that
 * turns up; the pool is derived from the loadout's real single-target DPS.
 * ACCURACY is the share of that DPS that actually lands on a patrolling boss
 * while you are also dodging it. It is *measured*, not guessed: instrumented
 * bot runs land 18-33% depending on how wide the spread is, so 0.32 puts a
 * competent run at the target and a scrappy one somewhat over it. Because the
 * pool is derived from dps, the fight length is independent of firepower -
 * changing this number moves every boss fight at once.
 */
const ACCURACY = 0.32;
function bossHpFor(def, difficulty, dps){
  const target = def.fightSeconds || 30;
  // The dps floor only guards against a divide-by-nothing loadout; it is
  // deliberately low, because scaling *down* for a weak ship is the whole
  // point - a stock ship should get a boss it can actually chew through.
  const scaled = target * Math.max(5, dps) * ACCURACY;
  return Math.round(clamp(scaled, def.hp*0.15, def.hp*20) * difficulty.bossHp);
}

function create(defId, difficulty, dps){
  const def = BOSSES[defId];
  const hp = bossHpFor(def, difficulty, dps || 0);
  // Weak points stay a fixed share of the hull, so "shoot the guns off" is
  // worth the same detour whatever you fly in with.
  const wpScale = hp / Math.round(def.hp * difficulty.bossHp);
  const boss = {
    alive: true, def, name: def.name, tint: def.tint,
    x: VW/2, y: -150, targetY: def.entryY,
    vx: 78, size: def.size, r: def.size*0.42,
    hp, maxHp: hp,
    entering: true,
    phaseIndex: 0, phase: def.phases[0],
    attackTimer: 1.4, telegraph: null, currentAttack: null,
    burst: null, beam: null,
    disabled: {},
    flash: 0, wobble: 0, smokeTimer: 0, deathTimer: 0,
    weakPoints: def.weakPoints.map(wp => ({
      id: wp.id, ox: wp.x, oy: wp.y, r: wp.r,
      hp: Math.round(wp.hp * difficulty.bossHp * wpScale),
      maxHp: Math.round(wp.hp * difficulty.bossHp * wpScale),
      disables: wp.disables, destroyed: false, flash: 0,
    })),
    // Pre-rolled damage spots so scorching and chunks appear in stable places.
    wounds: Array.from({length:12}, () => {
      const a = rand(0, TAU), rad = rand(16, 44);
      return { x: Math.cos(a)*rad, y: Math.sin(a)*rad*0.8, r: rand(9, 21) };
    }),
  };
  return boss;
}

/* ---------------------------------------------------------
   ATTACKS
   Each returns immediately after firing; multi-shot attacks
   leave a `burst` for the update loop to drip out.
   --------------------------------------------------------- */
const ATTACKS = {
  spreadVolley: {
    telegraphKind: "muzzle",
    fire(boss, world){
      const n = boss.phase.enrage ? 9 : 6;
      const spread = 1.15;   // fans wider now there's width to cover
      for(let i=0;i<n;i++){
        const a = -spread/2 + (spread/(n-1))*i;
        world.spawnEnemyBullet(boss.x, boss.y + boss.r*0.6,
          Math.sin(a)*280, Math.cos(a)*280, "bolt", 6);
      }
    },
  },
  aimedBurst: {
    telegraphKind: "lock",
    fire(boss, world){
      boss.burst = { attack:"aimedBurst", left: boss.phase.enrage ? 6 : 4, timer: 0, gap: 0.12 };
    },
    burstShot(boss, world){
      const p = world.player;
      const dx = (p ? p.x : VW/2) - boss.x, dy = Math.max(60, (p ? p.y : VH) - boss.y);
      const l = Math.hypot(dx, dy);
      world.spawnEnemyBullet(boss.x, boss.y + boss.r*0.5, dx/l*340, dy/l*340, "aimed", 5.5);
    },
  },
  ringBurst: {
    telegraphKind: "charge",
    fire(boss, world){
      const n = boss.phase.enrage ? 24 : 16;
      for(let i=0;i<n;i++){
        const a = (TAU/n)*i + rand(-0.05, 0.05);
        world.spawnEnemyBullet(boss.x, boss.y, Math.cos(a)*245, Math.sin(a)*245, "orb", 6);
      }
      fx.ring(boss.x, boss.y, 130, boss.tint, 3, 0.4);
    },
  },
  sweepBeam: {
    telegraphKind: "beam",
    fire(boss, world){
      // A wide column that sweeps across the playfield - the "get out of the
      // way" attack. Telegraphed for the whole wind-up before it can hurt you.
      const fromLeft = boss.x < VW/2;
      boss.beam = { x: boss.x, dir: fromLeft ? 1 : -1, timer: 1.7, width: 48 };
    },
  },
  /*
   * Two rotating arms of fire. Where ringBurst is one instant of "get out of
   * every direction at once", this is a sustained pattern you read and walk
   * through - the gap between the arms is always there, it just moves. The
   * first genuinely new thing to dodge since the Sentinel.
   */
  spiralArms: {
    telegraphKind: "charge",
    fire(boss, world){
      boss.burst = { attack:"spiralArms", left: boss.phase.enrage ? 22 : 15,
                     timer: 0, gap: 0.085, angle: rand(0, TAU) };
    },
    burstShot(boss, world){
      const arms = boss.phase.enrage ? 3 : 2;
      for(let i=0;i<arms;i++){
        const a = boss.burst.angle + (TAU/arms)*i;
        world.spawnEnemyBullet(boss.x, boss.y, Math.cos(a)*215, Math.sin(a)*215, "orb", 6);
      }
      boss.burst.angle += 0.42;                  // how tightly the arms wind
    },
  },
  /*
   * Seeds the field with mines instead of shooting at you. They sit there, so
   * the arena itself gets smaller as the fight goes on and the boss never has
   * to touch you to make the fight harder.
   */
  mineField: {
    telegraphKind: "hatch",
    fire(boss, world, ctxObj){
      const n = boss.phase.enrage ? 5 : 3;
      for(let i=0;i<n;i++){
        const m = world.spawnEnemy("mine",
          clamp(boss.x + rand(-150, 150), 45, VW-45), boss.y + rand(0, 40),
          { difficulty: ctxObj.difficulty, hoverY: rand(240, 460) });
        m.fromBoss = true;                       // never counts toward the roster
      }
    },
  },
  /*
   * The Jailer's signature: a tractor beam that DRAGS the ship toward the
   * hull. Nothing else in the game touches the player's stick - fighting the
   * pull is a genuinely new input feel, and the danger is the collision, not
   * a bullet. Escapable by design: the pull is ~a third of player thrust.
   */
  tractorPull: {
    telegraphKind: "beam",
    fire(boss, world){
      boss.pull = { timer: 1.5 };
      audio.play("tractor");
    },
  },
  /*
   * The Phantom's signature: vanish, reappear over YOUR column, arrive
   * shooting. The telegraph is the warning; the white ring marks where it
   * lands, and three aimed bolts follow - so the read is "ring appears,
   * sidestep NOW".
   */
  blink: {
    telegraphKind: "charge",
    fire(boss, world){
      const p = world.player;
      fx.ring(boss.x, boss.y, 90, boss.tint, 3, 0.35);
      fx.sparks(boss.x, boss.y, 14, boss.tint, 220);
      boss.x = clamp((p ? p.x : VW/2) + rand(-70, 70), 78, VW-78);
      fx.ring(boss.x, boss.y, 90, "#ffffff", 3, 0.4);
      boss.burst = { attack:"blink", left: boss.phase.enrage ? 5 : 3, timer: 0.1, gap: 0.11 };
    },
    burstShot(boss, world){
      const p = world.player;
      const dx = (p ? p.x : VW/2) - boss.x, dy = Math.max(60, (p ? p.y : VH) - boss.y);
      const l = Math.hypot(dx, dy);
      world.spawnEnemyBullet(boss.x, boss.y + boss.r*0.4, dx/l*360, dy/l*360, "aimed", 5.5);
    },
  },
  /* =========================================================
     THE DEVOURER'S ARSENAL
     Five attacks that use the whole screen instead of shooting
     across it. Each one paints where it will land during a long
     warning, then burns for a short beat - so the answer is
     always "move THERE", never "guess". They run off state on
     the boss (lanes/claw/nova/lance) that both the updater and
     the renderer read, and land damage through beamHits().
     ========================================================= */

  /* Columns of fire. Three of five lanes light up, then burn. The most
     readable attack in the game: stand in an unlit column. */
  laneBeams: {
    telegraphKind: "beam",
    fire(boss){
      const LANES = 5, xs = [];
      const pool = Array.from({length: LANES}, (_, i) => (i + 0.5) * (VW/LANES));
      const take = boss.phase.enrage ? 3 : 2;
      for(let i = 0; i < take; i++) xs.push(pool.splice(randInt(0, pool.length-1), 1)[0]);
      boss.lanes = { xs, w: VW/LANES*0.72, t: 0, warn: 0.95, burn: 0.95 };
      audio.play("devourerCharge");
    },
  },

  /* A claw arm reaches down out of the hull and sweeps across a band of the
     screen. You can be above it or below it - just not in it. */
  clawSweep: {
    telegraphKind: "hatch",
    fire(boss, world){
      const p = world.player;
      const side = (p && p.x > VW/2) ? 1 : -1;
      boss.claw = {
        y: clamp((p ? p.y : VH*0.6) + rand(-40, 40), VH*0.34, VH*0.86),
        x: side > 0 ? VW + 90 : -90, dir: -side,
        t: 0, warn: 0.85, sweep: 2.0, r: 46,
      };
      audio.play("clawGroan");
    },
  },

  /* Both hangar bays open and pour ships out. Twice what any other boss
     summons, because it is the size of a moon. */
  hangarLaunch: {
    telegraphKind: "hatch",
    fire(boss, world, ctxObj){
      const n = boss.phase.enrage ? 8 : 6;
      for(let i = 0; i < n; i++){
        const side = i % 2 ? 1 : -1;
        const type = ctxObj.difficulty.smart >= 2 || i % 3 === 0 ? "swooper" : "interceptor";
        const m = world.spawnEnemy(type,
          clamp(boss.x + side*(90 + (i>>1)*26), 45, VW-45), boss.y + 40,
          { difficulty: ctxObj.difficulty, hoverY: rand(200, 340) });
        m.fromBoss = true;
      }
      fx.ring(boss.x - 96, boss.y + 40, 70, "#ffb03d", 3, 0.4);
      fx.ring(boss.x + 96, boss.y + 40, 70, "#ffb03d", 3, 0.4);
      audio.play("hangarOpen");
    },
  },

  /* The signature. The whole sky ignites EXCEPT one circle - fly into the
     ring and nothing can touch you. Kids read this instantly. */
  novaSafeZone: {
    telegraphKind: "charge",
    fire(boss, world){
      const p = world.player;
      // The safe ring is placed away from where the player is loitering, but
      // always inside the field and always reachable in the warning window.
      const px = p ? p.x : VW/2;
      const cx = clamp(px < VW/2 ? rand(VW*0.55, VW*0.85) : rand(VW*0.15, VW*0.45), 90, VW-90);
      boss.nova = { cx, cy: rand(VH*0.52, VH*0.78), r: 96,
                    t: 0, warn: 1.45, burn: 1.0 };
      audio.play("devourerCharge");
    },
  },

  /* It turns the star's fire on half the sky. Pick a side and commit. */
  starLance: {
    telegraphKind: "charge",
    fire(boss, world){
      const p = world.player;
      // Fires at the half the player is NOT in more often than not, so it
      // asks for a move rather than punishing where they already stand.
      const playerLeft = (p ? p.x : VW/2) < VW/2;
      const side = rand(0, 1) < 0.72 ? (playerLeft ? -1 : 1) : (playerLeft ? 1 : -1);
      boss.lance = { side, t: 0, warn: 1.6, burn: 1.15 };
      audio.play("lanceCharge");
    },
  },

  callMinions: {
    telegraphKind: "hatch",
    fire(boss, world, ctxObj){
      const n = boss.phase.enrage ? 4 : 3;
      for(let i=0;i<n;i++){
        const x = clamp(boss.x + (i - (n-1)/2)*72, 45, VW-45);
        const minion = world.spawnEnemy(ctxObj.difficulty.smart >= 2 ? "swooper" : "grunt", x, boss.y + 10,
          { difficulty: ctxObj.difficulty, hoverY: rand(210, 330) });
        // Summoned adds are not part of the mission roster: counting them would
        // let a long boss fight inflate (or dilute) the kill objectives.
        minion.fromBoss = true;
      }
    },
  },
};

/** Pick the next attack this phase, skipping anything its weak point disabled. */
function chooseAttack(boss){
  const options = boss.phase.attacks.filter(a => !boss.disabled[a]);
  if(!options.length) return "aimedBurst"; // always has a fallback
  return pick(options);
}

function update(boss, dt, world, ctxObj, timeMs){
  // A dying boss is !alive (bullets pass through the wreck) but still very
  // much on screen - the death sequence below is the whole point.
  if(!boss.alive && !boss.dying) return;

  if(boss.flash > 0) boss.flash -= dt*6;
  boss.weakPoints.forEach(wp => { if(wp.flash > 0) wp.flash -= dt*6; });

  const hurt = 1 - boss.hp/boss.maxHp;
  boss.wobble = hurt > 0.75 ? 3.5 : (hurt > 0.5 ? 1.6 : 0);

  // Smoke and fire from the wounds as it degrades.
  if(hurt > 0.3){
    boss.smokeTimer -= dt;
    if(boss.smokeTimer <= 0){
      const w = pick(boss.wounds);
      fx.smoke(boss.x + w.x, boss.y + w.y, 1, hurt > 0.6 ? "#ff8a3d" : "#6b6b78");
      boss.smokeTimer = hurt > 0.6 ? 0.05 : 0.13;
    }
  }

  if(boss.entering){
    boss.y += 190*dt;
    if(boss.y >= boss.targetY){ boss.y = boss.targetY; boss.entering = false; }
    return;
  }

  /*
   * The death sequence. A boss that blinks out the frame its HP hits zero
   * throws away the best moment in the game. Instead the hulk goes dark and
   * lists, and a drumroll of detonations marches across the hull - starting
   * slow, accelerating to a blur - until game.js is told to fire the final
   * blast. No attacks, no aiming, no phases: it is already dead, it just
   * doesn't know it yet.
   */
  if(boss.dying){
    // The finale's death is choreographed by finale.js - the fight engine
    // must not also run its own drumroll on top of it.
    if(boss.finaleDeath) return;
    boss.deathT += dt;
    boss.y += 24*dt;                                  // engines dead, sinking
    boss.x += Math.sin(boss.deathT*9) * 30 * dt;      // shuddering
    boss.wobble = 6;
    boss.deathFx -= dt;
    if(boss.deathFx <= 0){
      const f = Math.min(1, boss.deathT / boss.deathDur);
      const a = rand(0, Math.PI*2), d = rand(0, boss.size*0.55);
      fx.explosion(boss.x + Math.cos(a)*d, boss.y + Math.sin(a)*d*0.6,
                   24 + f*34, f > 0.6 ? "#ffffff" : "#ff8a3d", f > 0.5);
      fx.shake(4 + f*9);
      boss.flash = 1;
      audio.play("enemyExplode", f > 0.5);
      boss.deathFx = 0.24 - f*0.17;                   // the accelerating drumroll
    }
    if(boss.deathT >= boss.deathDur && ctxObj && ctxObj.onBossDead){
      ctxObj.onBossDead(boss);
    }
    return;
  }

  // Phase transitions
  const frac = boss.hp / boss.maxHp;
  const next = boss.def.phases[boss.phaseIndex + 1];
  if(next && frac <= next.at){
    boss.phaseIndex++;
    boss.phase = next;
    boss.attackTimer = 0.9;
    boss.telegraph = null;
    boss.burst = null;
    audio.play("bossPhase");
    fx.ring(boss.x, boss.y, 210, "#ffffff", 4, 0.6);
    fx.shake(14);
    fx.text(boss.x, boss.y - 54, next.enrage ? "ENRAGED!" : "PHASE " + (boss.phaseIndex+1), "#ff5d73", 18, true);
  }

  // Patrol
  boss.x += boss.vx * (boss.phase.speed/70) * dt;
  if(boss.x < 78){ boss.x = 78; boss.vx = Math.abs(boss.vx); }
  if(boss.x > VW-78){ boss.x = VW-78; boss.vx = -Math.abs(boss.vx); }

  // Multi-shot bursts
  if(boss.burst){
    boss.burst.timer -= dt;
    if(boss.burst.timer <= 0){
      ATTACKS[boss.burst.attack].burstShot(boss, world);
      boss.burst.left--;
      boss.burst.timer = boss.burst.gap;
      if(boss.burst.left <= 0) boss.burst = null;
    }
  }

  // Sweeping beam
  if(boss.beam){
    boss.beam.timer -= dt;
    boss.beam.x += boss.beam.dir * 190 * dt;
    if(boss.beam.x < 45 || boss.beam.x > VW-45) boss.beam.dir *= -1;
    if(boss.beam.timer <= 0) boss.beam = null;
  }

  updateArena(boss, dt, world);

  // Tractor beam: drags the player toward the hull while it holds.
  if(boss.pull){
    boss.pull.timer -= dt;
    const p = world.player;
    if(p && p.alive && boss.pull.timer > 0){
      const dx = boss.x - p.x, dy = boss.y - p.y;
      const l = Math.max(60, Math.hypot(dx, dy));
      p.vx += dx/l * 380 * dt;
      p.vy += dy/l * 380 * dt;
    }
    if(boss.pull.timer <= 0) boss.pull = null;
  }

  // Cloak: the Phantom fades out between actions and lights up to act, so
  // "where is it?" is the fight's question but every attack stays readable.
  if(boss.def.cloak){
    const lit = !!(boss.telegraph || boss.burst || boss.beam || boss.flash > 0.2);
    const target = lit ? 1 : 0.32;
    if(boss.cloakA === undefined) boss.cloakA = 1;   // arrives visible...
    boss.cloakA += (target - boss.cloakA) * Math.min(1, dt*4);  // ...then fades
  }

  // Telegraph -> fire
  if(boss.telegraph){
    boss.telegraph.timer -= dt;
    if(boss.telegraph.timer <= 0){
      const atk = ATTACKS[boss.telegraph.attack];
      atk.fire(boss, world, ctxObj);
      boss.telegraph = null;
      // `hurry` is the Boss Rush stage multiplier: later queue stages attack
      // faster, which is what "harder" means without touching readability.
      boss.attackTimer = rand(boss.phase.gap[0], boss.phase.gap[1]) / (boss.hurry || 1);
    }
    return;
  }

  boss.attackTimer -= dt;
  if(boss.attackTimer <= 0){
    const attack = chooseAttack(boss);
    boss.telegraph = { attack, timer: boss.phase.telegraph, max: boss.phase.telegraph,
                       kind: ATTACKS[attack].telegraphKind };
    audio.play("telegraph");
  }
}

/**
 * Applies damage. Bullets that land on a live weak point hurt it (and the boss
 * harder), which is what makes aiming matter.
 * Returns { killed, weakPointDestroyed }.
 */
function damage(boss, amount, x, y){
  let onWeak = null;
  for(let i=0;i<boss.weakPoints.length;i++){
    const wp = boss.weakPoints[i];
    if(wp.destroyed) continue;
    const wx = boss.x + wp.ox, wy = boss.y + wp.oy;
    if((x-wx)*(x-wx) + (y-wy)*(y-wy) < wp.r*wp.r){ onWeak = wp; break; }
  }

  let weakPointDestroyed = null;
  if(onWeak){
    onWeak.hp -= amount;
    onWeak.flash = 1;
    boss.hp -= amount * 2;                     // double damage for precision
    fx.sparks(x, y, 5, "#ffd23f", 200);
    audio.play("bossHit");
    if(onWeak.hp <= 0){
      onWeak.destroyed = true;
      if(onWeak.disables) boss.disabled[onWeak.disables] = true;
      weakPointDestroyed = onWeak;
      fx.explosion(boss.x + onWeak.ox, boss.y + onWeak.oy, 52, "#ffb03d", true);
      fx.shake(12);
      fx.hitStop(70);
      audio.play("enemyExplode", true);
    }
  } else {
    boss.hp -= amount;
    boss.flash = 1;
    fx.sparks(x, y, 3, boss.hp/boss.maxHp < 0.5 ? "#ffb03d" : "#ff5d73", 150);
    audio.play("bossHit");
  }

  const killed = boss.hp <= 0;
  if(killed) boss.alive = false;
  return { killed, weakPointDestroyed };
}

/*
 * The Devourer's arena attacks, ticked. Each is a two-stage clock: `warn`
 * paints the danger and cannot hurt you, then `burn` is live. Keeping the
 * clocks here (rather than in the renderer) means pause, hit-stop and the
 * results screen all behave, and the draw code stays a pure read.
 */
function updateArena(boss, dt, world){
  if(boss.lanes){
    boss.lanes.t += dt;
    if(boss.lanes.t > boss.lanes.warn + boss.lanes.burn) boss.lanes = null;
    else if(boss.lanes.t > boss.lanes.warn && !boss.lanes.hit){
      boss.lanes.hit = true;
      fx.shake(10);
      audio.play("laneFire");
    }
  }
  if(boss.claw){
    const c = boss.claw;
    c.t += dt;
    if(c.t > c.warn){
      c.x += c.dir * (VW + 180) / c.sweep * dt;
      if(!c.roared){ c.roared = true; fx.shake(8); audio.play("clawSlam"); }
    }
    if(c.t > c.warn + c.sweep + 0.2) boss.claw = null;
  }
  if(boss.nova){
    boss.nova.t += dt;
    if(boss.nova.t > boss.nova.warn && !boss.nova.hit){
      boss.nova.hit = true;
      fx.shake(16);
      fx.flash(0.5, "255,220,160");
      audio.play("novaBurn");
    }
    if(boss.nova.t > boss.nova.warn + boss.nova.burn) boss.nova = null;
  }
  if(boss.lance){
    boss.lance.t += dt;
    if(boss.lance.t > boss.lance.warn && !boss.lance.hit){
      boss.lance.hit = true;
      fx.shake(22);
      fx.flash(0.6, "255,120,60");
      audio.play("lanceFire");
    }
    if(boss.lance.t > boss.lance.warn + boss.lance.burn) boss.lance = null;
  }
}

/** True while an arena attack is live (past its warning) - used by the HUD. */
function arenaLive(boss){
  return !!(boss && ((boss.lanes && boss.lanes.t > boss.lanes.warn) ||
                     (boss.nova  && boss.nova.t  > boss.nova.warn) ||
                     (boss.lance && boss.lance.t > boss.lance.warn)));
}

/**
 * True if any boss area attack is currently burning through this point: the
 * sweeping beam, and all of the Devourer's arena attacks. One hook, so the
 * collision layer never needs to know what a Devourer is.
 */
function beamHits(boss, x, y){
  if(boss.beam && boss.beam.timer <= 1.2 &&                 // first 0.3s warms up
     Math.abs(x - boss.beam.x) < boss.beam.width/2 && y > boss.y) return true;

  const L = boss.lanes;
  if(L && L.t > L.warn && L.xs.some(lx => Math.abs(x - lx) < L.w/2)) return true;

  const c = boss.claw;
  if(c && c.t > c.warn){
    const dx = x - c.x, dy = y - c.y;
    if(dx*dx + dy*dy < c.r*c.r) return true;
  }

  const n = boss.nova;
  if(n && n.t > n.warn){
    const dx = x - n.cx, dy = y - n.cy;
    if(dx*dx + dy*dy > n.r*n.r) return true;                // safe INSIDE the ring
  }

  const la = boss.lance;
  if(la && la.t > la.warn){
    if(la.side < 0 ? x < VW/2 : x > VW/2) return true;
  }
  return false;
}

SF.bosses = {
  bossHpFor, create, update, damage, beamHits, arenaLive, ATTACKS };
})();
