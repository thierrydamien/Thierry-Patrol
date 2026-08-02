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

function create(defId, difficulty){
  const def = BOSSES[defId];
  const hp = Math.round(def.hp * difficulty.bossHp);
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
      hp: Math.round(wp.hp * difficulty.bossHp), maxHp: Math.round(wp.hp * difficulty.bossHp),
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
  callMinions: {
    telegraphKind: "hatch",
    fire(boss, world, ctxObj){
      const n = boss.phase.enrage ? 4 : 3;
      for(let i=0;i<n;i++){
        const x = clamp(boss.x + (i - (n-1)/2)*72, 45, VW-45);
        world.spawnEnemy(ctxObj.difficulty.smart >= 2 ? "swooper" : "grunt", x, boss.y + 10,
          { difficulty: ctxObj.difficulty, hoverY: rand(210, 330) });
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
  if(!boss.alive) return;

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

  // Telegraph -> fire
  if(boss.telegraph){
    boss.telegraph.timer -= dt;
    if(boss.telegraph.timer <= 0){
      const atk = ATTACKS[boss.telegraph.attack];
      atk.fire(boss, world, ctxObj);
      boss.telegraph = null;
      boss.attackTimer = rand(boss.phase.gap[0], boss.phase.gap[1]);
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

/** True if the sweeping beam is currently burning through this point. */
function beamHits(boss, x, y){
  if(!boss.beam || boss.beam.timer > 1.2) return false; // first 0.3s is warm-up
  return Math.abs(x - boss.beam.x) < boss.beam.width/2 && y > boss.y;
}

SF.bosses = { create, update, damage, beamHits, ATTACKS };
})();
