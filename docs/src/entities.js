/*
 * The World: the player plus every pooled entity in a run, and the update
 * rules for each of them.
 *
 * Deliberately data-oriented rather than a deep class hierarchy - entities are
 * flat records living in pools, and behaviour comes from the archetype data
 * (see data/enemies.js). Adding an enemy type never means subclassing
 * anything, and the update loops stay allocation-free.
 */
(function(){
"use strict";
const SF = window.SF;
const { Pool, SpatialGrid, clamp, damp, rand, randInt, chance, len, TAU } = SF.core;
const { BEHAVIOURS, ENEMY_TYPES, ELITE } = SF.enemyData;
const { spreadPattern, fireRateMult } = SF.config;
const fx = SF.fx;
const audio = SF.audio;

/*
 * Playfield coordinate system.
 *
 * The height is fixed at 800; the width adapts to the device aspect within
 * 440-640 and is decided once, at load. On the target device - an iPad - that
 * lands at ~560-600, i.e. 3:4-ish: the playfield fills the glass, the 4:5
 * background art is no longer squashed, and the ship has thirteen ship-widths
 * of room to dodge in instead of the eight it had at the old phone-shaped
 * 390x620. Phones still get a sensibly proportioned field rather than a
 * letterboxed band, and landscape uses the full 640.
 *
 * Every other number in the game derives from these two, so this is the only
 * place the field size is stated. Nothing else may hard-code a coordinate:
 * formations, boss patrol limits, spawn margins and the HUD are all expressed
 * relative to VW/VH.
 */
function pickFieldWidth(){
  const w = (window.innerWidth || 820), h = (window.innerHeight || 1100);
  // Match the device's own aspect so nothing is letterboxed, but stay inside a
  // range the game is tuned for: never so narrow that formations collapse into
  // a single lane, never so wide that the edges are unreachable.
  return Math.round(Math.max(440, Math.min(640, 800 * (w / h))));
}

const VH = 800;
const VW = pickFieldWidth();
// The ship's ceiling has to sit *below* where bosses park (their entryY is
// ~150 and they're ~130 across), otherwise bullets spawn above the boss and
// sail past it without ever colliding - which made boss fights unwinnable from
// the top of the screen. It also keeps the ship clear of the HUD strip, and
// still leaves it two thirds of the field to fly in.
const PLAY_TOP = 250;
const PLAY_BOTTOM = VH - 34;

/* Weapon look/feel scales with Plasma Rounds so power is visible, not just numeric. */
const BULLET_TIERS = [
  { color:"#ffd23f", w:6,  h:17, glow:0 },
  { color:"#ffe27a", w:7,  h:19, glow:4 },
  { color:"#ffa94d", w:8,  h:22, glow:6 },
  { color:"#4dd2ff", w:9,  h:24, glow:8 },
  { color:"#7c9bff", w:11, h:27, glow:10 },
  { color:"#ff7ce5", w:12, h:31, glow:14 },
];

const REFERENCE_DPS = 45;
function hpPowerScale(diff, dps){
  const track = diff ? (diff.hpTrack || 0) : 0;
  if(track <= 0 || !dps) return 1;
  return 1 + track * (Math.max(dps, REFERENCE_DPS)/REFERENCE_DPS - 1);
}

class World {
  constructor(){
    this.bullets      = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,r:3,dmg:1,pierce:0,homing:0,tier:0,age:0,fromDrone:false }), 320);
    this.enemyBullets = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,r:4,kind:"bolt",age:0 }), 400);
    this.enemies      = new Pool(() => ({ alive:false }), 140);
    this.pickups      = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,kind:"coin",value:0,life:0,angle:0,data:null }), 160);
    this.grid         = new SpatialGrid(VW, VH, 60);
    this.player       = null;
    this.boss         = null;
    this.haulers      = [];
  }

  reset(){
    this.bullets.killAll();
    this.enemyBullets.killAll();
    this.enemies.killAll();
    this.pickups.killAll();
    this.boss = null;
    this.haulers = [];     // the Convoy's escort targets
    this.silent = false;   // set per mission by startMission (noGuns runs)
    this.silentClock = 0; this.lastSilentShot = -99;
  }

  /* ---------------- THE HAULER (the Convoy) ----------------
   * ONE ship, for the whole mission. The first cut sent three across in
   * sequence and it read as scenery drifting past - nothing to bond with,
   * and by the time you understood what it was, it had gone. A single ship
   * that flies WITH you the whole way, wears its damage where you can see
   * it, and only goes home at the end is something you can actually feel
   * protective of - which is the entire point of the level.
   *
   * It rises to station, holds there taking fire, and leaves only when the
   * sky is clear (`release`).
   */
  spawnHauler(x, hp){
    /*
     * Station height is the whole feel of the level, and the first attempt
     * got it wrong twice over. VH*0.30 is 240 - ABOVE the player's own
     * ceiling at PLAY_TOP (250) - so you could never fly alongside the ship
     * you were escorting: you hit an invisible wall just underneath it. It
     * has to sit well inside the band the player can actually reach, so you
     * can get above it, beside it, and between it and whatever is coming.
     */
    const h = { x, y: VH + 90, stationY: PLAY_TOP + 110, r: 38,
                laneX: x, hp, maxHp: hp, sway: rand(0, 6.28),
                alive: true, hitFlash: 0, released: false, safe: false, warned: 0 };
    this.haulers.push(h);
    return h;
  }
  /** The sky is clear: the hauler opens up and runs for home. */
  releaseHaulers(){ this.haulers.forEach(h => { if(h.alive) h.released = true; }); }
  /** What the convoy-hunters aim at, or null when there is nothing to guard. */
  escortTarget(){
    for(let i = 0; i < this.haulers.length; i++)
      if(this.haulers[i].alive && this.haulers[i].y > 0) return this.haulers[i];
    return null;
  }
  updateHaulers(dt, hooks){
    for(let i = 0; i < this.haulers.length; i++){
      const h = this.haulers[i];
      if(!h.alive) continue;
      h.sway += dt;
      h.hitFlash = Math.max(0, h.hitFlash - dt*4);
      if(h.released){
        h.fly = (h.fly || 0) + dt;
        h.y -= (120 + h.fly*260)*dt;                  // throttle open, climbing
      } else {
        /*
         * Arrive briskly and never stop moving. The first cut decelerated to
         * a 20px/s crawl over the last stretch and then froze exactly on its
         * mark, which read as the ship hitting something. Now it eases in on
         * a spring with a floor under its speed, and once on station it keeps
         * a slow weave across its lane - a ship under way, not a parked prop.
         */
        // Periods deliberately short (~5s vertical, ~9s lateral): a slow sine
        // spends most of its time near the extremes, where it is flat, and a
        // ship that holds still for two seconds looks parked again.
        const targetY = h.stationY + Math.sin(h.sway*1.26)*12;
        const dy = targetY - h.y;
        h.y += Math.sign(dy) * Math.min(Math.abs(dy), Math.max(34, Math.abs(dy)*2.2) * dt);
        const targetX = h.laneX + Math.sin(h.sway*0.70)*72;
        h.x += (targetX - h.x) * Math.min(1, dt*1.6);
      }
      if(h.hp <= 0){
        h.alive = false;
        if(hooks && hooks.onHaulerDown) hooks.onHaulerDown(h);
      } else if(h.y < -90){
        h.alive = false;
        h.safe = true;
        if(hooks && hooks.onHaulerSafe) hooks.onHaulerSafe(h);
      } else if(hooks && hooks.onHaulerHurt && h.hp/h.maxHp <= 0.35 && h.warned < 1){
        h.warned = 1;
        hooks.onHaulerHurt(h);
      }
    }
  }

  /* ---------------- PLAYER ---------------- */
  createPlayer(loadout){
    const p = {
      x: VW/2, y: VH - 120, vx: 0, vy: 0,
      targetX: VW/2, targetY: VH - 120,
      r: 11, bank: 0,
      alive: true,
      lives: loadout.lives, maxLives: loadout.lives,
      shield: loadout.shieldMax, shieldMax: loadout.shieldMax,
      invuln: 1.4, invulnTime: loadout.invulnTime,
      accel: 4300 * loadout.speedMult,
      maxSpeed: 430 * loadout.speedMult,
      fireInterval: loadout.fireInterval, cooldown: 0,
      spreadLvl: loadout.spreadLvl, damage: loadout.damage, pierce: loadout.pierce,
      homingLvl: loadout.homingLvl, magnetRange: loadout.magnetRange,
      moneyMult: loadout.moneyMult, drones: loadout.drones, dps: loadout.dps || 0,
      crew: loadout.crew || [],
      trailFx: loadout.trail || null,   // Style Shop trail (`trail` is the engine afterimage)
      decal: loadout.decal || null,
      bombs: loadout.bombs, bombsMax: loadout.bombs,
      overdrives: loadout.overdrives, overdrivesMax: loadout.overdrives,
      overdriveTime: loadout.overdriveTime, overdriveUntil: 0,
      tempRapidUntil: 0, tempSpreadUntil: 0, tempScoreUntil: 0, tempHomingUntil: 0,
      color: loadout.color,
      tune: loadout.tune,
      levels: loadout.levels || {},
      recoil: 0,
      trail: [],
    };
    this.player = p;
    return p;
  }

  updatePlayer(dt, timeMs){
    const p = this.player;
    if(!p || !p.alive) return;

    // Launch: the ship rockets up from below the screen to its station,
    // throttle pinned, guns cold, input ignored - then the mission is yours.
    const run = SF.game && SF.game.run;
    if(run && run.introFly > 0){
      run.introFly -= dt;
      const home = PLAY_BOTTOM - 86;
      p.vy = -520; p.vx = 0;
      p.y += (home - p.y) * Math.min(1, dt*4.5);
      if(run.introFly <= 0){ p.y = home; p.vy = 0; }
      p.trail.push({ x: p.x, y: p.y + 15, life: 0 });
      for(let i = p.trail.length-1; i >= 0; i--){
        p.trail[i].life += dt;
        if(p.trail[i].life > 0.3) p.trail.splice(i, 1);
      }
      p.bank = 0;
      if(p.invuln > 0) p.invuln -= dt;
      return;
    }

    // Fly-off: the mirror of the launch. When the victory lap ends, autopilot
    // takes the stick - throttle pinned, climbing off the top of the screen -
    // so a won mission EXITS instead of cutting to a menu. No clamps here:
    // leaving the screen is the whole point.
    if(run && (run.phase === "outro" || run.phase === "gone")){
      p.vy = Math.max(p.vy - 2400*dt, -1150);
      p.vx = damp(p.vx, 0, 6, dt);
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.bank = damp(p.bank, 0, 10, dt);
      p.recoil = 0;
      // Double trail = engines wide open.
      p.trail.push({ x: p.x - 5, y: p.y + 15, life: 0 });
      p.trail.push({ x: p.x + 5, y: p.y + 15, life: 0 });
      for(let i = p.trail.length-1; i >= 0; i--){
        p.trail[i].life += dt;
        if(p.trail[i].life > 0.3) p.trail.splice(i, 1);
      }
      return;
    }

    const input = SF.input.state;

    // Acceleration-based movement: the ship has weight and carries a little
    // momentum, which reads far better than teleporting to the finger.
    let ax = 0, ay = 0;
    if(input.left) ax -= 1;
    if(input.right) ax += 1;
    if(input.up) ay -= 1;
    if(input.down) ay += 1;
    if(ax || ay){
      const l = Math.hypot(ax, ay);
      p.vx += (ax/l) * p.accel * dt;
      p.vy += (ay/l) * p.accel * dt;
    }
    if(input.dragging){
      // Touch: steer toward the finger with a spring, capped at the same top speed.
      const dx = input.dragX - p.x, dy = input.dragY - p.y;
      p.vx = damp(p.vx, clamp(dx * 12, -p.maxSpeed, p.maxSpeed), 26, dt);
      p.vy = damp(p.vy, clamp(dy * 12, -p.maxSpeed, p.maxSpeed), 26, dt);
    } else if(!ax && !ay){
      p.vx = damp(p.vx, 0, 16, dt);
      p.vy = damp(p.vy, 0, 16, dt);
    }
    const sp = Math.hypot(p.vx, p.vy);
    if(sp > p.maxSpeed){ p.vx = p.vx/sp*p.maxSpeed; p.vy = p.vy/sp*p.maxSpeed; }

    p.x += p.vx*dt; p.y += p.vy*dt;
    if(p.x < 24){ p.x = 24; p.vx = 0; }
    if(p.x > VW-24){ p.x = VW-24; p.vx = 0; }
    if(p.y < PLAY_TOP){ p.y = PLAY_TOP; p.vy = 0; }
    if(p.y > PLAY_BOTTOM){ p.y = PLAY_BOTTOM; p.vy = 0; }

    // Bank into the turn - pure cosmetics, huge for feel.
    p.bank = damp(p.bank, clamp(p.vx / p.maxSpeed, -1, 1) * 0.38, 12, dt);
    p.recoil = damp(p.recoil, 0, 18, dt);

    if(p.invuln > 0) p.invuln -= dt;

    // Engine trail
    p.trail.push({ x: p.x, y: p.y + 15, life: 0 });
    for(let i = p.trail.length-1; i >= 0; i--){
      p.trail[i].life += dt;
      if(p.trail[i].life > 0.3) p.trail.splice(i, 1);
    }

    // Guns are automatic - except on a silent-running mission, where the
    // whole point is that they never speak.
    if(run && run.mission && run.mission.noGuns) return;
    if(run && (run.phase === "finaleIntro" || run.phase === "bossIntro"))
      return;                                        // guns cold through the cutscene
    p.cooldown -= dt;
    if(p.cooldown <= 0){
      this.fireWeapons(timeMs);
      let interval = p.fireInterval;
      if(timeMs < p.tempRapidUntil) interval *= 0.55;
      if(timeMs < p.overdriveUntil) interval *= 0.5;
      p.cooldown = interval;
    }
  }

  fireWeapons(timeMs){
    const p = this.player;
    const overdrive = timeMs < p.overdriveUntil;
    const spreadLvl = timeMs < p.tempSpreadUntil ? Math.max(p.spreadLvl, 3) : p.spreadLvl;
    const homing = timeMs < p.tempHomingUntil ? 3 : p.homingLvl;
    const dmg = Math.round(p.damage * (overdrive ? 1.5 : 1));
    const tier = clamp(Math.min(5, p.damage - 1 + (overdrive ? 1 : 0)), 0, 5);
    const pattern = spreadPattern(spreadLvl);

    for(let i=0;i<pattern.length;i++){
      const vx = pattern[i];
      const b = this.bullets.spawn();
      b.x = p.x + vx*0.02; b.y = p.y - 18; b.vx = vx; b.vy = -660;
      b.r = 5 + tier*0.5; b.dmg = dmg; b.pierce = p.pierce; b.homing = homing;
      b.tier = tier; b.age = 0; b.fromDrone = false; b.hitBoss = false; b.hitWeak = false;
    }
    fx.muzzle(p.x, p.y - 22, BULLET_TIERS[tier].color, 1.0 + tier*0.2);
    p.recoil = 2.5 + tier*0.4;

    for(let i=0;i<p.drones;i++){
      const side = i === 0 ? -1 : 1;
      const b = this.bullets.spawn();
      b.x = p.x + side*52; b.y = p.y + 2; b.vx = 0; b.vy = -640;
      b.r = 4.5; b.dmg = Math.max(1, Math.round(dmg*0.6)); b.pierce = p.pierce;
      b.homing = homing; b.tier = Math.max(0, tier-1); b.age = 0; b.fromDrone = true; b.hitBoss = false; b.hitWeak = false;
      fx.muzzle(p.x + side*52, p.y - 4, "#9fe4ff", 0.75);
    }
    audio.play(overdrive ? "shootHeavy" : "shoot", Math.min(1, tier/5));
  }

  /* ---------------- BULLETS ---------------- */
  updateBullets(dt){
    const items = this.bullets.items;
    for(let i=0;i<items.length;i++){
      const b = items[i];
      if(!b.alive) continue;
      b.age += dt;
      if(b.homing > 0){
        const target = this.nearestTarget(b.x, b.y);
        if(target){
          const desired = clamp((target.x - b.x)*3, -90*b.homing, 90*b.homing);
          b.vx += clamp(desired - b.vx, -220*b.homing*dt, 220*b.homing*dt);
        }
      }
      b.x += b.vx*dt; b.y += b.vy*dt;
      if(b.y < -30 || b.x < -30 || b.x > VW+30) b.alive = false;
    }

    const ebs = this.enemyBullets.items;
    for(let i=0;i<ebs.length;i++){
      const b = ebs[i];
      if(!b.alive) continue;
      b.age += dt;
      b.x += b.vx*dt; b.y += b.vy*dt;
      if(b.y > VH+30 || b.y < -60 || b.x < -40 || b.x > VW+40) b.alive = false;
    }
  }

  nearestTarget(x, y){
    let best = null, bestD = Infinity;
    const items = this.enemies.items;
    for(let i=0;i<items.length;i++){
      const e = items[i];
      if(!e.alive) continue;
      const d = (e.x-x)*(e.x-x) + (e.y-y)*(e.y-y);
      if(d < bestD){ bestD = d; best = e; }
    }
    if(this.boss && this.boss.alive){
      const d = (this.boss.x-x)*(this.boss.x-x) + (this.boss.y-y)*(this.boss.y-y);
      if(d < bestD){ best = this.boss; }
    }
    return best;
  }

  spawnEnemyBullet(x, y, vx, vy, kind, r){
    // Silent running: with the player's guns dead, the fleet barely shoots.
    // Playtest calibration in two steps: full fire was undodgeable, full
    // silence was flat - so the whole fleet shares ONE shot every couple of
    // seconds. A single spaced-out bolt is a thing you dodge; a volley was a
    // wall. The throttle sits here so every firing path obeys it.
    if(this.silent){
      if(this.silentClock - this.lastSilentShot < 2.2) return null;
      this.lastSilentShot = this.silentClock;
    }
    const b = this.enemyBullets.spawn();
    b.x=x; b.y=y; b.vx=vx; b.vy=vy; b.r=r||4; b.kind=kind||"bolt"; b.age=0;
    return b;
  }

  /* ---------------- ENEMIES ---------------- */
  /*
   * How much enemy health follows the player's firepower, per tier.
   *
   * REFERENCE_DPS is roughly a modestly-upgraded ship; below it nothing
   * scales, so a beginner never meets inflated enemies. Above it, `hpTrack`
   * decides how much of that extra firepower the tier claws back: none on
   * ROOKIE and PILOT (upgrades should feel enormous there), most of it on
   * NIGHTMARE (which should stay a fight however good your guns are).
   */
  spawnEnemy(typeId, x, y, opts){
    const type = ENEMY_TYPES[typeId];
    const o = opts || {};
    const diff = o.difficulty;
    const e = this.enemies.spawn();
    const elite = !!o.elite;

    e.typeId = typeId; e.type = type; e.elite = elite;
    e.x = x; e.y = y;
    /*
     * Rocks are terrain, and terrain that evaporates isn't terrain. So a
     * `toughSeconds` type is sized from the player's firepower - the same
     * trick the bosses use - and stays roughly N seconds of concentrated fire
     * however kitted out you are.
     *
     * The mechanics carriers (Guardians, Menders, Hives, Minelayers...) use
     * the same floor with small values: measured, they died in 1-3 seconds to
     * a *randomly sweeping bot*, which means a player who aims deleted them
     * before their mechanic ever came on stage. Popcorn (grunts, weavers,
     * swoopers, kamikazes) deliberately has no floor: melting the little
     * ones is the reward for upgrading, and the game keeps that.
     */
    const dps = this.player ? this.player.dps : 0;
    const scaled = Math.max(1, Math.round(type.hp * (diff ? diff.hpMult : 1) * hpPowerScale(diff, dps)));
    // The floor scales across tiers like boss fights do (bossHp: 0.8-1.5),
    // NOT with hpMult (0.8-7.5): hard tiers already track firepower through
    // hpPowerScale, and stacking hpMult on top turned every Mender into a
    // bullet sponge exactly where the game is already at its hardest.
    const floor = type.toughSeconds && dps > 0
      ? Math.round(type.toughSeconds * dps * 0.5 * (diff ? (diff.bossHp || 1) : 1)) : 0;
    // Elites multiply the scaled path only. The floor is a role guarantee -
    // "long enough to do its thing" - not a number an elite should 3.5x.
    e.hp = Math.round(Math.max(scaled * (elite ? ELITE.hpMult : 1), floor, type.hp));
    e.maxHp = e.hp;
    e.r = type.r * (elite ? ELITE.sizeMult : 1);
    e.size = type.size * (elite ? ELITE.sizeMult : 1);
    e.speed = type.speed * (diff ? diff.speed : 1) * (elite ? ELITE.speedMult : 1);
    e.vx = 0; e.vy = e.speed;
    e.score = Math.round(type.score * (elite ? ELITE.scoreMult : 1));
    e.money = Math.round(type.money * (elite ? ELITE.moneyMult : 1));
    e.behaviour = type.behaviour;
    e.state = 0; e.stateTimer = 0; e.phase = rand(0, TAU); e.locked = false; e.speedMul = 1;
    // Convoy-hunters: on an escort mission most of the wing goes for the
    // hauler rather than the pilot, so the threat is visible and the job is
    // real. Some still come for you - a level where nothing chases you is a
    // level where standing still works.
    e.huntsEscort = !!o.huntsEscort;
    e.anchorX = x; e.weaveWidth = rand(62, 118); e.weaveSpeed = rand(1.3, 2.0);
    e.hoverY = o.hoverY != null ? o.hoverY : rand(170, 340);
    e.hoverTime = rand(3.5, 6);
    e.flash = 0; e.hitTint = 0;
    e.carriesRescue = !!type.carriesRescue;
    e.escaped = false;
    e.fromBoss = false;   // set by the boss for summoned adds
    e.hazard = !!type.hazard;
    // Whether this enemy is part of the mission's planned opposition. Rocks,
    // boss adds, laid mines and hive drones are all real threats but none of
    // them were "planned", so counting them would quietly break the kill
    // objectives - either inflating the total or making 90% unreachable.
    e.counted = !type.hazard && !o.uncounted;
    e.shielded = false;   // recomputed every frame from live Guardians
    e.loot = 0; e.stolen = 0; e.fleeing = false; e.patience = 0;
    e.spin = 0; e.spinRate = rand(-1.6, 1.6);
    e.charge = 0; e.chargeTime = type.chargeTime || 2;
    e.dropTimer = 0; e.fuse = 0; e.healTarget = null;
    if(o.vx != null) e.vx = o.vx;
    if(o.vy != null) e.vy = o.vy;
    e.life = 0;
    // First shot at just over half a normal roll. With a full roll, most of
    // the fleet died without ever firing - measured 24% of grunts, 13% of
    // weavers, 0% of swoopers got a shot off. A silent enemy is scenery.
    e.fireTimer = type.fire ? rand(type.fire.every[0], type.fire.every[1]) * 0.55 * (diff ? diff.fireRate : 1) : Infinity;
    e.spawnAnim = 0;
    return e;
  }

  updateEnemies(dt, ctxObj){
    if(this.silent) this.silentClock += dt;   // paces the shared-shot throttle
    const items = this.enemies.items;
    this.applyGuardianShields();
    for(let i=0;i<items.length;i++){
      const e = items[i];
      if(!e.alive) continue;
      e.spawnAnim = Math.min(1, e.spawnAnim + dt*5);
      if(e.flash > 0) e.flash -= dt*5;
      e.life += dt;

      // Safety leash: whatever an archetype's behaviour is, after 28 seconds
      // on the field it gives up and dives away. A mission only ends when the
      // field is clear, so nothing is allowed to linger indefinitely.
      if(e.life > 28){
        e.y += Math.max(e.speed, 130) * 1.4 * dt;
      } else {
        (BEHAVIOURS[e.behaviour] || BEHAVIOURS.dive)(e, dt, ctxObj);
      }

      // Shooting
      const fire = e.type.fire;
      if(fire && e.y > 10 && e.y < VH - 60){
        e.fireTimer -= dt;
        if(e.fireTimer <= 0){
          this.enemyShoot(e, fire, ctxObj);
          e.fireTimer = rand(fire.every[0], fire.every[1]) * ctxObj.difficulty.fireRate;
        }
      }

      // A fleeing thief leaves through the top with your money; everything
      // else leaves through the bottom or the sides.
      if(e.y > VH + 40 || e.y < -120 || e.x < -80 || e.x > VW + 80){
        e.alive = false;
        e.escaped = true;
        if(ctxObj.onEscape) ctxObj.onEscape(e);
      }
    }
  }

  /*
   * Guardians make everything around them untouchable. Recomputed from
   * scratch each frame rather than tracked as state, so a Guardian dying
   * instantly drops the bubble on everyone it was covering - no bookkeeping,
   * no stale flags, and it is O(guardians x enemies) with at most a couple of
   * guardians alive.
   */
  applyGuardianShields(){
    const items = this.enemies.items;
    let guards = null;
    for(let i=0;i<items.length;i++){
      const e = items[i];
      if(e.alive) e.shielded = false;
      if(e.alive && e.type.shieldRadius){ (guards = guards || []).push(e); }
    }
    if(!guards) return;
    for(let g=0; g<guards.length; g++){
      const gd = guards[g], rad = gd.type.shieldRadius, rr = rad*rad;
      for(let i=0;i<items.length;i++){
        const e = items[i];
        if(!e.alive || e === gd || e.type.shieldRadius) continue;
        const dx = e.x-gd.x, dy = e.y-gd.y;
        if(dx*dx + dy*dy < rr) e.shielded = true;
      }
    }
  }

  enemyShoot(e, fire, ctxObj){
    const p = this.player;
    const aimed = chance(ctxObj.difficulty.aimed);
    const speed = fire.speed;
    // A convoy-hunter shoots at the CONVOY. Without this the escort mission
    // was scenery: the haulers only ever took splash and the odd collision,
    // so "protect them" was a promise the enemies never tested.
    const esc = e.huntsEscort ? this.escortTarget() : null;
    if(fire.pattern === "spread3" && !esc){
      [-0.35, 0, 0.35].forEach(a => {
        this.spawnEnemyBullet(e.x, e.y + e.r, Math.sin(a)*speed, Math.cos(a)*speed, "bolt", 4.5);
      });
    } else if(esc || fire.pattern === "aimed" || aimed){
      const tx = esc ? esc.x : (p ? p.x : VW/2);
      const ty = esc ? esc.y : (p ? p.y : VH);
      const dx = tx - e.x, dy = esc ? (ty - e.y) : Math.max(50, ty - e.y);
      const l = Math.max(1, Math.hypot(dx, dy));
      this.spawnEnemyBullet(e.x, e.y + e.r*(dy < 0 ? -1 : 1),
                            dx/l*speed, dy/l*speed, esc ? "aimed" : "aimed", 4);
    } else {
      this.spawnEnemyBullet(e.x, e.y + e.r, 0, speed, "bolt", 4);
    }
    audio.play("hitArmour");
  }

  /* ---------------- PICKUPS ---------------- */
  spawnPickup(kind, x, y, data){
    const p = this.pickups.spawn();
    p.kind = kind; p.x = x; p.y = y; p.life = 0; p.angle = rand(0, TAU);
    p.vx = rand(-30, 30);
    p.vy = kind === "rescue" ? 42 : kind === "supply" ? 44 : rand(40, 80);
    p.value = (data && data.value) || 0;
    p.data = data || null;
    return p;
  }

  /** Coins burst out of a kill and are worth flying for - the reason Tractor Beam exists. */
  dropCoins(x, y, amount){
    let left = amount;
    let guard = 0;
    while(left > 0 && guard++ < 6){
      const chunk = left > 12 ? Math.ceil(left/2) : left;
      const c = this.spawnPickup("coin", x + rand(-11,11), y + rand(-11,11), { value: chunk });
      c.vx = rand(-95, 95); c.vy = rand(-75, 25);
      left -= chunk;
    }
  }

  updatePickups(dt, onCollect){
    const p = this.player;
    const items = this.pickups.items;
    for(let i=0;i<items.length;i++){
      const it = items[i];
      if(!it.alive) continue;
      it.life += dt;
      it.angle += dt*2.4;
      it.vy += 95*dt;                        // fall, gently - coins are worth chasing
      it.vy = Math.min(it.vy, it.kind === "rescue" ? 55 : it.kind === "supply" ? 58 : 86);
      it.vx *= Math.pow(0.96, dt*60);

      if(p && p.alive){
        const dx = p.x - it.x, dy = p.y - it.y;
        const d = Math.hypot(dx, dy);
        const range = p.magnetRange + (it.kind === "coin" ? 20 : 0);
        if(d < range && d > 0.01){       // tractor beam
          const pull = (1 - d/range) * 900 * dt;
          it.vx += dx/d * pull; it.vy += dy/d * pull;
        }
        if(d < p.r + 20){
          it.alive = false;
          onCollect(it);
          continue;
        }
      }
      it.x += it.vx*dt; it.y += it.vy*dt;
      if(it.y > VH + 30){
        it.alive = false;
        if(it.kind === "rescue" && onCollect) onCollect(it, true); // lost
      }
    }
  }

  countEnemies(){ return this.enemies.countAlive(); }
}

SF.World = World;
SF.entityConst = { VW, VH, PLAY_TOP, PLAY_BOTTOM, BULLET_TIERS };
})();
