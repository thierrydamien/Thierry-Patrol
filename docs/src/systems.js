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
let { VW, VH } = SF.entityConst;
SF.field.onChange(w => { VW = w; });
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
    // The Anchor: `tetherTag` hands every pair in the mission its own number,
    // and `waiting` holds the first end of each until the second arrives.
    this.tetherTag = 1;
    this.waiting = {};
    this.density = difficulty.density || 1;
    // Asteroids and other scenery are spawned like waves but are not the
    // opposition, so "destroy 80% of enemies" doesn't count them.
    this.totalPlanned = mission.waves.reduce((n,w) =>
      n + (ENEMY_TYPES[w.type].hazard ? 0 : this.waveSize(w)), 0);
    // waveSize, not the raw `w.n`: a tier with density above 1 flies MORE
    // haulers than the script asks for, and counting the script's number gave
    // "rescue every stranded pilot 4 / 2" - a total you could beat.
    this.rescuesPlanned = mission.waves.reduce((n,w) =>
      n + (ENEMY_TYPES[w.type].carriesRescue ? this.waveSize(w) : 0), 0);
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
          bounty: s.bounty,
          // Two in three go for the convoy; the rest still hunt the player,
          // so parking next to the hauler is never a free win.
          huntsEscort: !!this.mission.convoy && chance(0.66),
        });
        // Tie the knot once the other end exists. `waiting` holds the first of
        // a pair by its tag; the second one to arrive finds it and ties. If
        // the first died in the fraction of a second between the two - shot at
        // the top of the screen, or stolen from the pool by a wave far bigger
        // than the ceiling - the tag simply never matches and the second flies
        // alone, which is a loose ship rather than a cable to nowhere.
        if(s.pair){
          const first = this.waiting[s.pair];
          if(first && first.alive && !first.mate) this.world.tetherPair(first, spawned);
          else this.waiting[s.pair] = spawned;
        }
        if(spawned.counted) this.spawnedCount++;
        this.pending.splice(i, 1);
      }
    }
  }

  /**
   * How many of this wave actually fly, after the tier's density and the
   * field's width.
   *
   * The width term answers "I don't want the extra space to just be empty":
   * wave counts were tuned on the 600-wide tablet field, so a field wider
   * than that tops the count up in proportion - a 640 desktop field flies
   * ~7% more ships, which keeps enemies-per-area level instead of thinning
   * as the sky grows. Clamped at 1 below the reference so phones fly the
   * exact tuned data, and at 1.2 so a future wider ceiling cannot silently
   * double the traffic.
   */
  waveSize(wave){
    const widthTopUp = clamp(VW / 600, 1, 1.2);
    return Math.max(1, Math.round(wave.n * this.density * widthTopUp));
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
    /*
     * BOUNTY (mission flag): one ship in the salvo is wanted, and pays for
     * it. It is the whole lesson of "aim at THAT one, not at the crowd" made
     * into money - which is why it goes on the level that teaches leading a
     * moving target rather than being a generic reward.
     */
    const bountyIdx = this.mission.bounty && slots.length
      ? randInt(0, slots.length - 1) : -1;
    /*
     * THE ANCHOR (wave flag): adjacent slots fly out joined by a cable.
     *
     * Pairing by SLOT is what makes the shape do the work, and it is why this
     * belongs here rather than in the world. In a `line` two neighbours are
     * side by side, so the cable is a short fence you go over or under; in
     * `twinColumns` they are on opposite edges, so the same flag draws a wire
     * clean across the field. The formation is the level design.
     *
     * The two ends do not arrive together - every formation staggers its slots
     * by a fraction of a second - so the pair is agreed HERE as a shared tag
     * and tied together at the far end, when the second one actually exists.
     * A salvo with an odd count leaves its last ship untied, which is fine:
     * one loose ship in a fence reads as a gap, and gaps are the lesson.
     */
    const pairs = wave.tether ? slots.length >> 1 : 0;
    slots.forEach((s, i) => {
      this.pending.push({
        type: wave.type, x: clamp(s.x, 34, VW-34), y: s.y,
        delay: s.delay + extraDelay, elite: eliteIdx.has(i),
        bounty: i === bountyIdx && !eliteIdx.has(i),   // never double-decorated
        hoverY: 155 + (i % 4) * 52 + rand(-14, 14),   // four hover bands in the taller field
        pair: (i >> 1) < pairs ? this.tetherTag + (i >> 1) : 0,
      });
    });
    if(pairs) this.tetherTag += pairs;
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
// The tether's curve, walked as this many straight pieces. Same reason as HIT:
// reused, never allocated, because this runs per cable per frame.
const TETHER_STEPS = 6;
const TCURVE = { x0:0, y0:0, cx:0, cy:0, x1:0, y1:0 };
const TA = { x:0, y:0 }, TB = { x:0, y:0 };

/*
 * Is this round threading the hull toward a part it has not reached yet?
 *
 * Cast the bullet's heading forward and ask whether it passes within striking
 * distance of any surviving weak point still AHEAD of it. That is the only
 * reason a shot is ever allowed through a boss's body: a part buried inside
 * the hull circle has to stay reachable. A round that is merely somewhere
 * over the boss is not threading anything and stops on the plating.
 */
function threadsToWeakPoint(b, boss){
  const bs = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
  if(bs < 0.001) return false;
  const ux = b.vx/bs, uy = b.vy/bs;
  for(let k = 0; k < boss.weakPoints.length; k++){
    const wp = boss.weakPoints[k];
    if(wp.destroyed) continue;
    const dx = (boss.x + wp.ox) - b.x, dy = (boss.y + wp.oy) - b.y;
    if(dx*ux + dy*uy <= 0) continue;                  // behind it; already past
    if(Math.abs(dx*uy - dy*ux) <= b.r + wp.r) return true;
  }
  return false;
}

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
    /*
     * The pierce budget lives ON THE BULLET, not on this frame.
     *
     * It used to be a local reset every tick, so a round with "blasts through
     * 1 enemy" spent one charge per FRAME and then got another - and since a
     * bullet rarely meets more than one enemy in the 11px it covers in a tick,
     * it effectively never ran out. Piercing Rounds level 1 was unlimited
     * penetration all the way up the screen, which is not what the shelf sells
     * and not what the price was set against.
     */
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

      /*
       * ARMOUR PLATE - and until now, a promise the game did not keep.
       *
       * The Tithe Serpent marks its rings `armoured` except the glowing tail
       * one, and marks the head armoured until every ring is gone. game.js
       * recomputed those flags every frame, the renderer drew the lantern on
       * the weak ring, the banner said "hit the glowing ring!" and then "the
       * head is soft - finish it!" - and NOTHING read the flags. Bullets went
       * straight through the armour into the head, so the entire mechanic the
       * level teaches, and the level is named for, was decoration. You could
       * shoot the head from the first second and skip the fight.
       *
       * Reads e.armoured, which game.js owns, rather than the static type flag:
       * the whole point is that a ring's armour comes and goes with its place
       * in the tail. (spawnEnemy clears it on reuse - without that, a recycled
       * slot would be permanently bulletproof.)
       */
      if(e.armoured){
        /*
         * THE STAMPEDE. Nothing gets through a Sky Ox - but the round still
         * SHOVES, and that recoil ring is how a seven-year-old learns the
         * whole level in two seconds without a word being said. Divided by
         * radius, so a big animal takes real work to steer.
         */
        if(e.pushable){
          const bs = Math.hypot(b.vx, b.vy) || 1;
          e.vx += (b.vx/bs) * 120 / (e.r/13);
          fx.ring(hx, hy, 18, "#e7d8c9", 2, 0.2);
        } else {
          fx.sparks(hx, hy, 5, "#9ff0d8", 150);
          fx.ring(hx, hy, 14, "#2fbf9a", 2, 0.18);
        }
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
      if(b.pierce > 0){ b.pierce--; return false; }
      b.x = hx; b.y = hy; b.alive = false;
      return true;
    });

    if(!b.alive) continue;
    const boss = world.boss;
    if(boss && boss.alive && !boss.entering){
      /*
       * Weak points are their own hitboxes, tested first and on their own.
       * Before that they were not: a bullet was consumed on the boss's BODY
       * circle, so a part outside that circle (the Sentinel's wingtip pods)
       * or deep inside it (its command tower, 30px above centre inside a
       * 63px body) could never be struck by an aimed shot. Measured, EVERY
       * weak point on EVERY boss was unhittable head-on, and only ever
       * clipped by luck from angled spread rounds. An armoured Sky Sentinel
       * was unkillable.
       */
      if(!b.hitWeak){
        for(let k = 0; k < boss.weakPoints.length; k++){
          const wp = boss.weakPoints[k];
          if(wp.destroyed) continue;
          const wx = boss.x + wp.ox, wy = boss.y + wp.oy;
          // Swept, like the enemy test: a weak point is small (r17-26) and a
          // dropped frame is enough to step a round straight over one.
          const at = sweep(b, px, py, wx, wy, b.r + wp.r);
          if(at){
            b.hitWeak = true;
            /*
             * Park the round ON the part before scoring it. damage() locates
             * which part was struck from the bullet's own coordinates, so a
             * round left at the end of its step - which sweeping can put well
             * past the part - would be scored as a HULL hit: the shot
             * vanishes and the part takes nothing.
             */
            b.x = at.x; b.y = at.y;
            const res = ctxObj.onBossHit(boss, b);
            // One rule for the whole game: through what you destroy, and
            // nothing else. Blow a part off and a piercing round carries on.
            if(res && res.weakPointDestroyed && b.pierce > 0) b.pierce--;
            else b.alive = false;
            break;
          }
        }
      }
      if(b.alive && !b.hitBoss){
        const at = sweep(b, px, py, boss.x, boss.y, b.r + boss.r);
        if(at){
          /*
           * THE HULL IS SOLID. It used to be porous while any part survived -
           * a round chipped it once and kept flying to "look for a seam" -
           * which was belt-and-braces from before parts had their own
           * hitboxes. It also meant that on every boss with a plate still
           * bolted on, which is most of a boss fight, your shots visibly
           * streamed straight through the thing you were shooting: "it still
           * looks like the missiles are going through the boss. They should
           * hit the boss and stop."
           *
           * The one case porosity really covered is a part BURIED in the body
           * circle - the Sentinel's core sits 30px above centre inside a 63px
           * hull, so a solid body would swallow every round aimed at it and
           * make an armoured boss unkillable all over again. So instead of
           * letting everything through, only a round actually lined up on a
           * surviving part threads the hull: it is about to hit that part and
           * will visibly burst on it a frame or two later. Everything else -
           * which is the overwhelming majority, and every round in the
           * screenshot - stops dead on the plating where it struck.
           *
           * Damage is unchanged by this. A non-threading round always did
           * exactly one hull hit and then flew off screen doing nothing more;
           * now it does exactly one hull hit and stops. Same dps, honest
           * picture.
           */
          const threading = threadsToWeakPoint(b, boss);
          if(!threading){ b.x = at.x; b.y = at.y; }
          b.hitBoss = true;
          ctxObj.onBossHit(boss, b);
          if(!threading) b.alive = false;
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

  /*
   * Rocks stopping their bullets is about the SKY, not about any one pilot,
   * so it runs once and above the per-seat pass below. (It used to sit inside
   * the player block and was therefore skipped while you were respawning -
   * bullets sailed through boulders for those two seconds. Running it here
   * fixes that by construction.)
   */
  const ebs = world.enemyBullets.items;
  /*
   * COVER (mission flag): rocks stop their bullets. Everywhere else a boulder
   * is only an obstacle - here it is also a wall you can put between you and
   * a gun, which turns "they shoot back" from a dodging drill into a reason
   * to read the field. Rocks are few (never more than a handful alive), so
   * the inner loop is cheap; it only runs on the levels that ask for it.
   */
  if(world.cover){
    for(let i=0;i<ebs.length;i++){
      const b = ebs[i];
      if(!b.alive) continue;
      for(let k=0;k<enemies.length;k++){
        const r = enemies[k];
        if(!r.alive || !r.hazard) continue;
        const rr2 = b.r + r.r;
        if((b.x-r.x)*(b.x-r.x) + (b.y-r.y)*(b.y-r.y) < rr2*rr2){
          b.alive = false;
          fx.sparks(b.x, b.y, 4, "#cbd5e1", 130);
          break;
        }
      }
    }
  }
  /* --- everything that can hurt a pilot, once per seat ---
   *
   * Co-op puts two ships in the same sky and each has to be hit on its own
   * terms: its own invulnerability after a respawn, its own contact with a
   * rammer, its own bullet. `livePlayers` is a list of one in solo, so this
   * loop is exactly the old code path with an extra iteration that never
   * happens. Everything below reads `p` - the seat being tested - and hands
   * that seat to onPlayerHit, so the life comes off the right pilot.
   */
  const seats = world.livePlayers();
  for(let s = 0; s < seats.length; s++){
    const p = seats[s];
    const invulnerable = p.invuln > 0 || ctxObj.godMode;

    if(!invulnerable){
      for(let i=0;i<enemies.length;i++){
        const e = enemies[i];
        if(!e.alive) continue;
        /*
         * A Limpet that has hold of you is not a collision. It is riding the
         * hull by design, and it must never cost a life - a clinger that kills
         * is just a Kamikaze in a hat, and it would kill EVERY frame it stayed
         * on. This one line skips both the near-miss test and the ram branch,
         * which is exactly right: the ride is not a dodge either.
         */
        if(e.attached) continue;
        const rr = e.r + p.r;
        const d2 = (e.x-p.x)*(e.x-p.x) + (e.y-p.y)*(e.y-p.y);
        /*
         * NEAR MISS (mission flag): a diver that goes past your wingtip without
         * touching you pays for it. The lesson of the kamikaze level is "let
         * them come, THEN swerve", and nothing teaches that like being paid for
         * cutting it fine. Claimed once per ship, and only for things that
         * actually dive - a grunt drifting past is not a dodge.
         */
        if(ctxObj.onGraze && !e.grazed && e.diver && d2 < (rr+22)*(rr+22) && d2 >= rr*rr){
          e.grazed = true;
          ctxObj.onGraze(e);
        }
        if(d2 < rr*rr){
          // Ramming an enemy destroys it too - a fair trade, and it stops the
          // "invisible wall" feeling of bouncing off a sprite. A rock is not a
          // fair trade: it costs you a life and is still there afterwards, which
          // is what makes a boulder something you actually have to fly around.
          /*
           * SOFT targets pop and cost nothing. The prologue's practice
           * balloons are the only thing that sets this: a seven-year-old on
           * their very first flight WILL steer into one, and the flight
           * check must never answer that with damage. The pop still counts
           * as a kill, so ramming balloons is playing, not cheating.
           */
          if(e.type && e.type.soft){
            e.hp = 0;
            ctxObj.onEnemyKilled(e, null, true);
            break;
          }
          if(!e.hazard){
            e.hp = 0;
            ctxObj.onEnemyKilled(e, null, true);
          } else {
            fx.sparks(p.x, p.y, 12, "#cbd5e1", 200);
            fx.shake(10);
          }
          ctxObj.onPlayerHit("collision", e, p);
          break;
        }
      }
    }

    /*
     * THE ANCHOR (mission flag): the cable between a pair is solid.
     *
     * Its own pass, gated on the world flag, so no other level in the campaign
     * pays a single distance test for a mechanic it does not use - the same deal
     * `cover` gets below. Only the LEAD of each pair is walked, so a cable is
     * considered once rather than once per end.
     *
     * Touching it costs a life and leaves both ships flying. That is deliberate
     * and it is the difference between this and ramming: a ship you fly into
     * dies with you, which makes ramming a trade a child will happily keep
     * making. A cable is not a trade. It is a wall with a ship at each end, and
     * the only two ways past it are round it or through one of the ends.
     */
    if(world.tethered && !invulnerable && p.alive){
      const rr = p.r + SF.tether.R;
      for(let i=0;i<enemies.length;i++){
        const e = enemies[i];
        if(!e.alive || !e.tetherLead || !SF.tether.live(e)) continue;
        // The drawn cable hangs, so the measured one has to hang identically:
        // the curve is walked as TETHER_STEPS straight pieces, which tracks the
        // painted quadratic to well under a pixel at the spans this game flies.
        const c = SF.tether.curve(e, TCURVE);
        SF.tether.at(c, 0, TA);
        let hit = false;
        for(let k = 1; k <= TETHER_STEPS && !hit; k++){
          SF.tether.at(c, k/TETHER_STEPS, TB);
          const sx = TB.x - TA.x, sy = TB.y - TA.y;
          const len2 = sx*sx + sy*sy;
          let u = 0;
          if(len2 > 0.0001){
            u = ((p.x - TA.x)*sx + (p.y - TA.y)*sy) / len2;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
          }
          const dx = p.x - (TA.x + sx*u), dy = p.y - (TA.y + sy*u);
          hit = dx*dx + dy*dy < rr*rr;
          TA.x = TB.x; TA.y = TB.y;
        }
        if(hit){
          fx.sparks(p.x, p.y, 14, "#a5f3fc", 220);
          fx.shake(10);
          ctxObj.onPlayerHit("tether", e, p);
          break;
        }
      }
    }

    /*
     * SWEPT, like the player's own rounds are.
     *
     * This tested only where the bullet ENDED the frame - the exact mistake the
     * comment on sweep() above was written about, fixed in the player-to-enemy
     * direction and never applied coming back the other way. Their aimed shots
     * fly at 300px/s, and difficulty.speed multiplies that: 540px/s on NIGHTMARE.
     * The frame clamp floors dt at 20fps, so a step there is 27px against 18px of
     * bullet-plus-ship overlap - the round teleports from in-front-of to behind
     * the ship without ever registering.
     *
     * It fails in the player's FAVOUR, which is why nobody reported it, and that
     * is precisely what makes it worth fixing: it means a tired iPad quietly
     * plays an easier game than a fresh one, and "take no damage at all" is a
     * star you are likelier to win on the slower device.
     */
    for(let i=0;i<ebs.length;i++){
      const b = ebs[i];
      if(!b.alive) continue;
      const bpx = b.x - (b.vx || 0)*dt, bpy = b.y - (b.vy || 0)*dt;
      if(sweep(b, bpx, bpy, p.x, p.y, b.r + p.r)){
        b.alive = false;
        if(!invulnerable) ctxObj.onPlayerHit("bullet", b, p);
        break;
      }
    }

    const boss = world.boss;
    if(boss && boss.alive && !invulnerable){
      const rr = boss.r + p.r;
      if((boss.x-p.x)*(boss.x-p.x) + (boss.y-p.y)*(boss.y-p.y) < rr*rr){
        ctxObj.onPlayerHit("boss", boss, p);
      } else if(SF.bosses.beamHits(boss, p.x, p.y)){
        ctxObj.onPlayerHit("beam", boss, p);
      }
    }
  }
}

SF.systems = { WaveDirector, resolve };
})();
