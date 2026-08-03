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

class World {
  constructor(){
    this.bullets      = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,r:3,dmg:1,pierce:0,homing:0,tier:0,age:0,fromDrone:false }), 320);
    this.enemyBullets = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,r:4,kind:"bolt",age:0 }), 400);
    this.enemies      = new Pool(() => ({ alive:false }), 140);
    this.pickups      = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,kind:"coin",value:0,life:0,angle:0,data:null }), 160);
    this.grid         = new SpatialGrid(VW, VH, 60);
    this.player       = null;
    this.boss         = null;
  }

  reset(){
    this.bullets.killAll();
    this.enemyBullets.killAll();
    this.enemies.killAll();
    this.pickups.killAll();
    this.boss = null;
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
      moneyMult: loadout.moneyMult, drones: loadout.drones,
      crew: loadout.crew || [],
      bombs: loadout.bombs, bombsMax: loadout.bombs,
      overdrives: loadout.overdrives, overdrivesMax: loadout.overdrives,
      overdriveTime: loadout.overdriveTime, overdriveUntil: 0,
      tempRapidUntil: 0, tempSpreadUntil: 0, tempScoreUntil: 0, tempHomingUntil: 0,
      color: loadout.color,
      recoil: 0,
      trail: [],
    };
    this.player = p;
    return p;
  }

  updatePlayer(dt, timeMs){
    const p = this.player;
    if(!p || !p.alive) return;
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

    // Guns are automatic.
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
      b.tier = tier; b.age = 0; b.fromDrone = false;
    }
    fx.muzzle(p.x, p.y - 22, BULLET_TIERS[tier].color, 1.0 + tier*0.2);
    p.recoil = 2.5 + tier*0.4;

    for(let i=0;i<p.drones;i++){
      const side = i === 0 ? -1 : 1;
      const b = this.bullets.spawn();
      b.x = p.x + side*52; b.y = p.y + 2; b.vx = 0; b.vy = -640;
      b.r = 4.5; b.dmg = Math.max(1, Math.round(dmg*0.6)); b.pierce = p.pierce;
      b.homing = homing; b.tier = Math.max(0, tier-1); b.age = 0; b.fromDrone = true;
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
    const b = this.enemyBullets.spawn();
    b.x=x; b.y=y; b.vx=vx; b.vy=vy; b.r=r||4; b.kind=kind||"bolt"; b.age=0;
    return b;
  }

  /* ---------------- ENEMIES ---------------- */
  spawnEnemy(typeId, x, y, opts){
    const type = ENEMY_TYPES[typeId];
    const o = opts || {};
    const diff = o.difficulty;
    const e = this.enemies.spawn();
    const elite = !!o.elite;

    e.typeId = typeId; e.type = type; e.elite = elite;
    e.x = x; e.y = y;
    e.hp = Math.max(1, Math.round(type.hp * (diff ? diff.hpMult : 1) * (elite ? ELITE.hpMult : 1)));
    e.maxHp = e.hp;
    e.r = type.r * (elite ? ELITE.sizeMult : 1);
    e.size = type.size * (elite ? ELITE.sizeMult : 1);
    e.speed = type.speed * (diff ? diff.speed : 1) * (elite ? ELITE.speedMult : 1);
    e.vx = 0; e.vy = e.speed;
    e.score = Math.round(type.score * (elite ? ELITE.scoreMult : 1));
    e.money = Math.round(type.money * (elite ? ELITE.moneyMult : 1));
    e.behaviour = type.behaviour;
    e.state = 0; e.stateTimer = 0; e.phase = rand(0, TAU); e.locked = false; e.speedMul = 1;
    e.anchorX = x; e.weaveWidth = rand(62, 118); e.weaveSpeed = rand(1.3, 2.0);
    e.hoverY = o.hoverY != null ? o.hoverY : rand(170, 340);
    e.hoverTime = rand(3.5, 6);
    e.flash = 0; e.hitTint = 0;
    e.carriesRescue = !!type.carriesRescue;
    e.escaped = false;
    e.fromBoss = false;   // set by the boss for summoned adds
    e.life = 0;
    e.fireTimer = type.fire ? rand(type.fire.every[0], type.fire.every[1]) * (diff ? diff.fireRate : 1) : Infinity;
    e.spawnAnim = 0;
    return e;
  }

  updateEnemies(dt, ctxObj){
    const items = this.enemies.items;
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

      if(e.y > VH + 40 || e.x < -80 || e.x > VW + 80){
        e.alive = false;
        e.escaped = true;
        if(ctxObj.onEscape) ctxObj.onEscape(e);
      }
    }
  }

  enemyShoot(e, fire, ctxObj){
    const p = this.player;
    const aimed = chance(ctxObj.difficulty.aimed);
    const speed = fire.speed;
    if(fire.pattern === "spread3"){
      [-0.35, 0, 0.35].forEach(a => {
        this.spawnEnemyBullet(e.x, e.y + e.r, Math.sin(a)*speed, Math.cos(a)*speed, "bolt", 4.5);
      });
    } else if(fire.pattern === "aimed" || aimed){
      const dx = (p ? p.x : VW/2) - e.x, dy = Math.max(50, (p ? p.y : VH) - e.y);
      const l = Math.hypot(dx, dy);
      this.spawnEnemyBullet(e.x, e.y + e.r, dx/l*speed, dy/l*speed, "aimed", 4);
    } else {
      this.spawnEnemyBullet(e.x, e.y + e.r, 0, speed, "bolt", 4);
    }
    audio.play("hitArmour");
  }

  /* ---------------- PICKUPS ---------------- */
  spawnPickup(kind, x, y, data){
    const p = this.pickups.spawn();
    p.kind = kind; p.x = x; p.y = y; p.life = 0; p.angle = rand(0, TAU);
    p.vx = rand(-30, 30); p.vy = kind === "rescue" ? 42 : rand(40, 80);
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
      it.vy = Math.min(it.vy, it.kind === "rescue" ? 55 : 86);
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
