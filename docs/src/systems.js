/*
 * The two systems that drive a mission: the wave director (what spawns, when,
 * and in what shape) and collision resolution.
 *
 * Both are pure logic over the World - they own no rendering and no DOM.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, rand, randInt, chance } = SF.core;
const { FORMATIONS, ENEMY_TYPES } = SF.enemyData;
const { VW, VH } = SF.entityConst;
const fx = SF.fx;
const audio = SF.audio;

/* =========================================================
   WAVE DIRECTOR
   Reads a mission's wave script and spawns formations on
   schedule. Knows nothing about scoring or UI.
   ========================================================= */
class WaveDirector {
  constructor(mission, difficulty, world){
    this.mission = mission;
    this.difficulty = difficulty;
    this.world = world;
    this.time = 0;
    this.nextWave = 0;
    this.pending = [];       // enemies staged by a formation's per-slot delay
    this.spawnedCount = 0;
    this.density = difficulty.density || 1;
    // Asteroids and other scenery are spawned like waves but are not the
    // opposition, so "destroy 90% of enemies" doesn't count them.
    this.totalPlanned = mission.waves.reduce((n,w) =>
      n + (ENEMY_TYPES[w.type].hazard ? 0 : this.waveSize(w)), 0);
    this.rescuesPlanned = mission.waves.reduce((n,w) =>
      n + (ENEMY_TYPES[w.type].carriesRescue ? w.n : 0), 0);
  }

  get finishedSpawning(){
    return this.nextWave >= this.mission.waves.length && this.pending.length === 0;
  }

  update(dt){
    this.time += dt;

    // Start any wave whose time has come.
    while(this.nextWave < this.mission.waves.length &&
          this.time >= this.mission.waves[this.nextWave].t){
      this.queueWave(this.mission.waves[this.nextWave]);
      this.nextWave++;
    }

    // Release staged formation members.
    for(let i = this.pending.length - 1; i >= 0; i--){
      const s = this.pending[i];
      s.delay -= dt;
      if(s.delay <= 0){
        const spawned = this.world.spawnEnemy(s.type, s.x, s.y, {
          difficulty: this.difficulty, elite: s.elite, hoverY: s.hoverY,
          // Two in three go for the convoy; the rest still hunt the player,
          // so parking next to the hauler is never a free win.
          huntsEscort: !!this.mission.convoy && chance(0.66),
        });
        if(spawned.counted) this.spawnedCount++;
        this.pending.splice(i, 1);
      }
    }
  }

  /** How many of this wave actually fly, after the tier's density. */
  waveSize(wave){
    return Math.max(1, Math.round(wave.n * this.density));
  }

  /*
   * A dense wave is split into two salvos a few seconds apart rather than one
   * enormous formation: the same pressure, but the shapes stay readable and a
   * "wall" of thirty doesn't collapse into a solid bar.
   */
  queueWave(wave){
    const total = this.waveSize(wave);
    const split = total > wave.n * 1.35 && total > 6;
    const first = split ? Math.ceil(total*0.55) : total;
    this.queueSalvo(wave, first, 0);
    if(split) this.queueSalvo(wave, total - first, 2.6);
  }

  queueSalvo(wave, count, extraDelay){
    const form = FORMATIONS[wave.form] || FORMATIONS.line;
    const slots = form(count, VW);
    const eliteCount = Math.round((wave.elite || 0) * (count / Math.max(1, wave.n)));
    // Elites are spread through the wave rather than clumped at the front.
    const eliteIdx = new Set();
    while(eliteIdx.size < Math.min(eliteCount, slots.length)){
      eliteIdx.add(randInt(0, slots.length-1));
    }
    slots.forEach((s, i) => {
      this.pending.push({
        type: wave.type, x: clamp(s.x, 34, VW-34), y: s.y,
        delay: s.delay + extraDelay, elite: eliteIdx.has(i),
        hoverY: 155 + (i % 4) * 52 + rand(-14, 14),   // four hover bands in the taller field
      });
    });
  }
}

/* =========================================================
   COLLISIONS
   Enemies go into a uniform grid once per frame; bullets only
   test their own neighbourhood. Player-vs-world is a handful
   of circle checks and stays brute force.
   ========================================================= */
/*
 * Swept hit test: the closest point on the segment the bullet actually
 * travelled this frame, against a circle.
 *
 * Testing only the bullet's END position - which is what this did - misses
 * anything it stepped clean over. Player rounds fly at 660px/s, so at a
 * steady 60fps a step is 11px and a Grunt (r13 + bullet r5 = 18px of overlap
 * to catch) is safe. But the frame budget is not a promise: on a tired iPad
 * mid-explosion the step doubles to 22px, past the tab-switch clamp it is
 * 33px, and the round teleports from just-in-front-of to just-behind the
 * enemy without ever registering. That is exactly the report - "the missiles
 * go through it" - and it got worse the busier the screen, which is when it
 * is least forgivable. Sweeping the path costs one dot product and cannot
 * miss at any framerate.
 */
function sweep(b, px, py, cx, cy, rr){
  const sx = b.x - px, sy = b.y - py;
  const len2 = sx*sx + sy*sy;
  let t = 0;
  if(len2 > 0.0001){
    t = ((cx - px)*sx + (cy - py)*sy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const hx = px + sx*t, hy = py + sy*t;
  const dx = cx - hx, dy = cy - hy;
  if(dx*dx + dy*dy > rr*rr) return null;
  HIT.x = hx; HIT.y = hy;
  return HIT;
}
const HIT = { x:0, y:0 };   // one scratch object; the hot loop stays allocation-free

function resolve(world, ctxObj, dt){
  const grid = world.grid;
  grid.clear();
  const enemies = world.enemies.items;
  for(let i=0;i<enemies.length;i++){
    const e = enemies[i];
    if(e.alive) grid.insert(e);
  }

  /* --- player bullets vs enemies and boss --- */
  const bullets = world.bullets.items;
  for(let i=0;i<bullets.length;i++){
    const b = bullets[i];
    if(!b.alive) continue;
    let pierceLeft = b.pierce;
    const px = b.x - b.vx*dt, py = b.y - b.vy*dt;   // where it was a frame ago

    grid.query(b.x, b.y, (e) => {
      if(!e.alive || !b.alive) return false;
      const at = sweep(b, px, py, e.x, e.y, b.r + e.r);
      if(!at) return false;
      const hx = at.x, hy = at.y;

      // Inside a Guardian's bubble nothing gets through - the shot splashes
      // off and the player is told, loudly, to shoot the Guardian instead.
      if(e.shielded){
        fx.sparks(hx, hy, 5, "#22d3ee", 150);
        fx.ring(hx, hy, 16, "#22d3ee", 2, 0.2);
        audio.play("hitArmour");
        b.x = hx; b.y = hy; b.alive = false;
        return true;
      }

      e.hp -= b.dmg;
      e.flash = 1;
      /*
       * Landing a hit has to be unmissable from the sofa. Sparks spray back
       * along the shot, a hard white ring pops at the contact point, and the
       * enemy is shoved a little - the shot has weight, and a seven-year-old
       * can tell a hit from a near miss without reading a number.
       */
      fx.impact(hx, hy, b.vx, b.vy, "#ffe9a8", 6);
      fx.ring(hx, hy, 13, "#ffffff", 2.5, 0.14);
      const bs = Math.sqrt(b.vx*b.vx + b.vy*b.vy) || 1;   // direction, not speed
      const kick = Math.min(9, 2 + b.dmg*0.9) / Math.max(1, e.r/13);
      e.x += (b.vx/bs) * kick; e.y += (b.vy/bs) * kick;

      if(e.hp > 0){
        fx.damageNumber(e.x, e.y - e.r, b.dmg, false);
        audio.play("hitArmour");
        /*
         * A round that only WOUNDS is always absorbed, however much Piercing
         * Rounds you own. The old rule spent a pierce charge on any contact,
         * so an upgraded shot sailed straight on through a wounded enemy and
         * read - correctly - as a miss: "the missiles go through it, it
         * should hit the enemy and stop so you know it has hit them".
         * Piercing now means what it looks like: your rounds punch clean
         * through anything they DESTROY and carry on to the next target.
         * Every shot that fails to kill stops dead, right on the hull.
         */
        b.x = hx; b.y = hy; b.alive = false;
        return true;
      }

      ctxObj.onEnemyKilled(e, b);
      if(pierceLeft > 0){ pierceLeft--; return false; }
      b.x = hx; b.y = hy; b.alive = false;
      return true;
    });

    if(!b.alive) continue;
    const boss = world.boss;
    if(boss && boss.alive && !boss.entering){
      /*
       * Weak points are their own hitboxes - and until now they were not.
       * A bullet was consumed on the boss's BODY circle, so a part outside
       * that circle (the Sentinel's wingtip pods) or deep inside it (its
       * command tower) could never be struck by an aimed shot: measured,
       * EVERY weak point on EVERY boss was unhittable head-on, and only ever
       * clipped by luck from angled spread rounds. An armoured Sky Sentinel
       * was therefore unkillable.
       *
       * So: parts are tested first and on their own, and while any part still
       * stands the hull is POROUS - a round chips it once and keeps flying to
       * look for a seam. Strip every part and the body goes solid again.
       */
      if(!b.hitWeak){
        for(let k = 0; k < boss.weakPoints.length; k++){
          const wp = boss.weakPoints[k];
          if(wp.destroyed) continue;
          const wx = boss.x + wp.ox, wy = boss.y + wp.oy;
          // Swept, like the enemy test: a weak point is small (r17-26) and a
          // dropped frame is enough to step a round straight over one.
          if(sweep(b, px, py, wx, wy, b.r + wp.r)){
            b.hitWeak = true;
            ctxObj.onBossHit(boss, b);
            if(pierceLeft <= 0) b.alive = false;
            break;
          }
        }
      }
      if(b.alive && !b.hitBoss){
        if(sweep(b, px, py, boss.x, boss.y, b.r + boss.r)){
          b.hitBoss = true;
          ctxObj.onBossHit(boss, b);
          const partsLeft = boss.weakPoints.some(w => !w.destroyed);
          if(pierceLeft <= 0 && !partsLeft) b.alive = false;
        }
      }
    }
  }

  /* --- everything that can hurt the CONVOY ---
     Before the player block, because haulers must keep taking fire while the
     player is respawning - the convoy doesn't get a breather when you do. */
  for(let k = 0; k < world.haulers.length; k++){
    const h = world.haulers[k];
    if(!h.alive) continue;
    const ebs2 = world.enemyBullets.items;
    for(let i = 0; i < ebs2.length; i++){
      const b = ebs2[i];
      if(!b.alive) continue;
      const rr = b.r + h.r;
      if((b.x-h.x)*(b.x-h.x) + (b.y-h.y)*(b.y-h.y) < rr*rr){
        b.alive = false;
        h.hp -= 3; h.hitFlash = 1;
        fx.sparks(b.x, b.y, 6, "#7cc4ff", 160);
      }
    }
    for(let i = 0; i < enemies.length; i++){
      const e = enemies[i];
      if(!e.alive || e.hazard) continue;
      const rr = e.r + h.r;
      if((e.x-h.x)*(e.x-h.x) + (e.y-h.y)*(e.y-h.y) < rr*rr){
        // A rammer trades itself for a chunk of hauler - loud, so the player
        // learns that kamikazes are the convoy's real enemy.
        e.hp = 0;
        ctxObj.onEnemyKilled(e, null, true);
        h.hp -= 8; h.hitFlash = 1;
        fx.explosion(e.x, e.y, 40, "#ff8a3d", false);
        fx.shake(6);
      }
    }
  }

  /* --- everything that can hurt the player --- */
  const p = world.player;
  if(!p || !p.alive) return;
  const invulnerable = p.invuln > 0 || ctxObj.godMode;

  if(!invulnerable){
    for(let i=0;i<enemies.length;i++){
      const e = enemies[i];
      if(!e.alive) continue;
      const rr = e.r + p.r;
      if((e.x-p.x)*(e.x-p.x) + (e.y-p.y)*(e.y-p.y) < rr*rr){
        // Ramming an enemy destroys it too - a fair trade, and it stops the
        // "invisible wall" feeling of bouncing off a sprite. A rock is not a
        // fair trade: it costs you a life and is still there afterwards, which
        // is what makes a boulder something you actually have to fly around.
        if(!e.hazard){
          e.hp = 0;
          ctxObj.onEnemyKilled(e, null, true);
        } else {
          fx.sparks(p.x, p.y, 12, "#cbd5e1", 200);
          fx.shake(10);
        }
        ctxObj.onPlayerHit("collision");
        break;
      }
    }
  }

  const ebs = world.enemyBullets.items;
  for(let i=0;i<ebs.length;i++){
    const b = ebs[i];
    if(!b.alive) continue;
    const rr = b.r + p.r;
    if((b.x-p.x)*(b.x-p.x) + (b.y-p.y)*(b.y-p.y) < rr*rr){
      b.alive = false;
      if(!invulnerable) ctxObj.onPlayerHit("bullet");
      break;
    }
  }

  const boss = world.boss;
  if(boss && boss.alive && !invulnerable){
    const rr = boss.r + p.r;
    if((boss.x-p.x)*(boss.x-p.x) + (boss.y-p.y)*(boss.y-p.y) < rr*rr){
      ctxObj.onPlayerHit("boss");
    } else if(SF.bosses.beamHits(boss, p.x, p.y)){
      ctxObj.onPlayerHit("beam");
    }
  }
}

SF.systems = { WaveDirector, resolve };
})();
