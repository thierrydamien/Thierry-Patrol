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

/* Pair keys for the tether, from a counter that only ever goes up - see
   tetherPair. It is deliberately module-wide and never reset: a key must not
   be reachable twice in one session, or a recycled pool slot could inherit a
   live cable from a ship that died minutes ago. */
let tetherSeq = 0;

/** Do these two still agree they are joined, and is the joint still theirs? */
function tetherLive(e){
  const m = e.mate;
  return !!(e.tetherKey && m && m.alive && m.mate === e && m.tetherKey === e.tetherKey);
}

/*
 * THE SHAPE OF THE CABLE, in one place.
 *
 * It sags: a straight segment reads as geometry, as something a renderer drew,
 * and a hanging curve reads as a physical object between two moving points.
 * The slack grows with the span and then stops, so a wire across the whole
 * field droops like a heavy one instead of folding in half.
 *
 * The collision pass and the painter BOTH come here, and that is the point. A
 * wall that hurts where it is not drawn is the worst bug this mechanic could
 * have, and the only way two copies of a curve stay identical is by not
 * existing. Fills and returns `out` with the quadratic's three points.
 */
const TETHER_R = 5;                       // the cable's own half-width
function tetherCurve(e, out){
  const m = e.mate;
  const L = Math.hypot(m.x - e.x, m.y - e.y) || 1;
  const sag = Math.min(26, L*0.09) * 2;   // a quadratic dips half its control offset
  out.x0 = e.x;  out.y0 = e.y;
  out.cx = (e.x + m.x)/2; out.cy = (e.y + m.y)/2 + sag;
  out.x1 = m.x;  out.y1 = m.y;
  return out;
}
/** A point on that curve, 0 at one ship and 1 at the other. */
function tetherAt(c, u, out){
  const v = 1 - u;
  out.x = v*v*c.x0 + 2*v*u*c.cx + u*u*c.x1;
  out.y = v*v*c.y0 + 2*v*u*c.cy + u*u*c.y1;
  return out;
}

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
  /*
   * Match the field to the box it will actually be drawn in, measured - not
   * to a guess at the shape of the screen.
   *
   * This has now been wrong twice in the same way. It started as
   * `800 * innerWidth/innerHeight` with a 440 floor: a 0.55 field on a 0.46
   * phone, fitted by width, with a fat black band above and below. Dropping
   * the floor to 400 helped and still left bars, because the arithmetic was
   * never the problem - the INPUT was. The field does not land in the screen.
   * It lands in the screen minus the status bar and minus the home indicator,
   * and on a modern iPhone that is ~93px of difference, which is the whole
   * discrepancy.
   *
   * So the insets are measured rather than assumed: a hidden probe sized to
   * `env(safe-area-inset-*)` reports what the system is really reserving on
   * THIS device, whatever it turns out to be. Match that box and the field
   * fills it exactly, on every phone, with no number in here to keep guessing.
   */
  const doc = document.documentElement;
  const vw = doc.clientWidth  || window.innerWidth  || 820;
  const vh = doc.clientHeight || window.innerHeight || 1100;

  const inset = side => {
    try {
      /*
       * Read --sa-<side>, not env() directly. The stylesheet defines those
       * from env() in one place, so CSS and this agree by construction - and
       * a browser that does not implement env() (or a test standing in for a
       * device) can set the variable and have both follow it together.
       */
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;top:0;left:0;width:1px;visibility:hidden;" +
                            "pointer-events:none;height:var(--sa-" + side + ",0px)";
      document.body.appendChild(probe);
      const px = probe.getBoundingClientRect().height;
      probe.remove();
      // A sane inset is tens of pixels. Anything else means the variable did
      // not resolve, and zero is the safe answer.
      return px > 0 && px < vh/3 ? px : 0;
    } catch(e){ return 0; }
  };

  /*
   * Which way is this screen REALLY facing?
   *
   * A portrait window reads its short edge as the field width, as ever. A
   * landscape window used to be modelled as a phone waiting to be rotated -
   * short edge as width, long edge as height - which is right for a phone
   * (the rotate nag then makes the player turn it) and wrong for everything
   * else: a desktop window and a landscape iPad never rotate. Measured, that
   * model gave a 1920x1040 monitor a 433-wide phone field using 29% of the
   * screen, which is exactly the "optimised for a phone" complaint.
   *
   * In a landscape window the HEIGHT is the binding edge and width is
   * abundant, so the field takes the widest shape the game is tuned for -
   * the 640 ceiling every formation, boss arena and difficulty pass was
   * validated against. Wider than that is a gameplay retune, not a sizing
   * fix. A landscape window always has room for it: a 640x800 field at full
   * height needs width = 0.8 x height, and landscape means width > height.
   *
   * Phones still end up portrait-shaped: the sub-500px rotate nag blocks
   * play until the phone is turned, and the field is re-measured at mission
   * launch - after the rotation - so the sideways number never flies.
   */
  const portrait = vh >= vw;
  const w = portrait ? vw : vw - inset("left") - inset("right");
  const h = (portrait ? vh : vh) - inset("top") - inset("bottom");

  /*
   * The clamp is now only a safety net for something pathological, not the
   * shape-defining decision it used to be: a 390x844 iPhone asks for ~411 and
   * an iPad for 600, both comfortably inside it. Measured, nothing breaks down
   * to 370 - formations stay readable and every boss weak point stays
   * reachable - so 380 is a floor with room to spare rather than a guess.
   */
  return Math.round(Math.max(380, Math.min(640, 800 * (w / Math.max(1, h)))));
}

const VH = 800;
/*
 * NOT a constant, and this is the fourth thing to go wrong with the playfield.
 *
 * Measuring is right, but measuring ONCE at script load is only right if the
 * insets are already known by then - and in an iOS home-screen app they are
 * not. Safari lays a TAB out inside a viewport that already has its insets, so
 * a browser gets the right answer; a standalone launch runs the scripts while
 * the splash is still up and `env(safe-area-inset-*)` still reads 0. The field
 * is then sized for a screen with no status bar and no home indicator, comes
 * out ~30px too narrow, and stays pillarboxed for the whole session - which is
 * exactly the "full screen in the browser but not as an app" report.
 *
 * So the measurement is repeatable, and `refreshField()` runs it again at a
 * point where the answer can be trusted. Mid-mission it cannot be: every
 * entity on the field holds coordinates in the old space. The only safe moment
 * is while a world is being built, so `startMission()` calls it before reset().
 */
let VW = pickFieldWidth();
const fieldSubs = [];

/**
 * Re-measures the field. Returns the current width, and notifies subscribers
 * only when it actually moved.
 */
function refreshField(){
  const w = pickFieldWidth();
  if(w === VW) return VW;
  VW = w;
  SF.entityConst.VW = w;
  for(let i = 0; i < fieldSubs.length; i++){
    try { fieldSubs[i](w); } catch(e){ /* one bad listener must not strand the rest */ }
  }
  return w;
}
/*
 * Every module that took `VW` out of `SF.entityConst` at load holds its own
 * copy of the number, so each has to be told. That is the price of destructured
 * constants, and it is worth paying: the alternative is a property lookup in
 * every hot loop in the game.
 */
function onFieldChange(fn){ fieldSubs.push(fn); }
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
/*
 * How hard a tier's armour chases your firepower.
 *
 * This used to track LINEARLY and without a ceiling, which meant a hard tier
 * cancelled an upgrade the moment you bought it: HP rose by exactly the share
 * of the damage you had just added. Combined with the toughSeconds floor below
 * it produced a game where a 100x spread in firepower bought a ~1x change in
 * how long anything took to kill. Measured on PILOT before this change: a
 * turret died in 0.51s with 750 pounds of guns and 0.50s with 441,000.
 *
 * Tracking is now capped at TRACK_CEIL. Past that point every further upgrade
 * is felt in full - which is the entire promise of the shop.
 */
const TRACK_CEIL = 2.0;
/*
 * Is this something the enemy's OWN support mechanics should look after?
 *
 * Guardians shield and Menders heal. Both used to consider anything alive in
 * range, and the field carries three things that are not fleet: rocks (terrain,
 * `hazard`), laid mines (also `hazard`), and the Foundry's belt parts - which
 * are the player's objective, not the enemy's ships. Healing a Boulder undid
 * the work of breaking it; shielding a belt part made the Foundry unwinnable
 * for as long as the Guardian lived.
 *
 * Exported on SF.entityConst so the smoke suite can pin it.
 */
function protectable(e){
  return !!e && !e.hazard && e.typeId !== "part";
}

function hpPowerScale(diff, dps){
  const track = diff ? (diff.hpTrack || 0) : 0;
  if(track <= 0 || !dps) return 1;
  return Math.min(TRACK_CEIL, 1 + track * (Math.max(dps, REFERENCE_DPS)/REFERENCE_DPS - 1));
}

class World {
  constructor(){
    this.bullets      = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,r:3,dmg:1,pierce:0,homing:0,tier:0,age:0,fromDrone:false }), 320);
    this.enemyBullets = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,r:4,kind:"bolt",age:0 }), 400);
    /*
     * 320, not 140. At the ceiling Pool.spawn steals the oldest LIVE slot and
     * overwrites it - no kill, no escape, no callback of any kind - so an
     * enemy could be counted as spawned and then simply cease to exist, which
     * is exactly the accounting hole that made "destroy 80%" unreachable.
     * Counting the planned script inside any 28-second window (28s is the hard
     * ceiling on an enemy's life, from the leash) the old cap was reachable:
     * mission 10 plans 144 on VETERAN and 187 on NIGHTMARE, and the desktop
     * width top-up adds a further 20% on top of that. An enemy record is a
     * handful of fields; the cap was never sized against this data.
     */
    this.enemies      = new Pool(() => ({ alive:false }), 320);
    // If the ceiling is ever hit anyway, the loser leaves through the same
    // door everything else leaves by, so the books stay honest.
    this.enemies.onSteal = (e) => { e.escaped = true; if(this.onEnemyStolen) this.onEnemyStolen(e); };
    this.onEnemyStolen = null;
    this.pickups      = new Pool(() => ({ alive:false, x:0,y:0,vx:0,vy:0,kind:"coin",value:0,life:0,angle:0,data:null }), 160);
    this.grid         = new SpatialGrid(VW, VH, 60);
    this.gridWidth    = VW;   // so a field change can be noticed in reset()
    this.player       = null;
    this.boss         = null;
    this.haulers      = [];
  }

  reset(){
    // The World is built once at load, so a field measured later would leave
    // the broadphase sized to the old width - anything in the new right-hand
    // strip would land in no bucket and collide with nothing.
    if(this.gridWidth !== VW){
      this.grid = new SpatialGrid(VW, VH, 60);
      this.gridWidth = VW;
    }
    this.bullets.killAll();
    this.enemyBullets.killAll();
    this.enemies.killAll();
    this.pickups.killAll();
    this.boss = null;
    this.haulers = [];     // the Convoy's escort targets
    this.silent = false;   // set per mission by startMission (noGuns runs)
    this.silentClock = 0; this.lastSilentShot = -99;
    this.tethered = false; // set per mission: pairs fly joined by a live cable
  }

  /* ---------------- THE ANCHOR (the tether) ----------------
   *
   * Pairs of ships fly joined by a taut cable, and the cable is what hurts.
   * The point is that it puts LINES in a sky that has only ever had points: a
   * child stops reading the field as a list of targets and starts reading the
   * GAPS between them. Shoot either end and the cable snaps, so there are
   * always two answers - go round it, or cut it - and both are flying.
   *
   * The link has to survive the enemy pool, which recycles dead slots into new
   * ships. Holding a bare reference to a partner means that the moment its
   * slot is reused, a live cable reattaches itself to a completely unrelated
   * enemy somewhere else on the screen. So every pair gets a KEY, drawn from a
   * counter that only goes up, and a link is only believed if both ends still
   * agree about it AND both still carry the key. A recycled slot has a
   * different key (or none), so the cable reads as cut rather than as moved.
   *
   * One end of each pair is the LEAD: it owns the collision test and the
   * drawing, so a cable is considered once per pair rather than once per ship.
   */
  tetherPair(a, b){
    const key = ++tetherSeq;
    a.tetherKey = b.tetherKey = key;
    a.mate = b; b.mate = a;
    a.tetherLead = true; b.tetherLead = false;
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
      // The airframe's own hitbox: the Anvil is a bigger thing to hit, and
      // that single number is most of what the choice between hulls means.
      r: loadout.hitR || 11, bank: 0,
      hull: loadout.hull || "dart",
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
      // Pointer (finger or hovering cursor): steer toward it with a spring,
      // capped at the same top speed.
      let dx = input.dragX - p.x;
      const dy = input.dragY - p.y;
      /*
       * THE RING, and this is the line the level lives or dies on.
       *
       * input.dragX is recomputed from the RAW pointer position on every move
       * event, so translating it from outside does not survive the next touch.
       * The instant the ship crosses the seam, dx becomes nearly -VW and this
       * spring hauls it straight back across the whole screen at top speed -
       * the wrap undone in one frame, on the control these children actually
       * use. The fix is to say what is true on this level: the finger names a
       * point on a CYLINDER, so the spring takes the short way round.
       */
      if(this.wrap){
        if(dx >  VW/2) dx -= VW;
        else if(dx < -VW/2) dx += VW;
      }
      p.vx = damp(p.vx, clamp(dx * 12, -p.maxSpeed, p.maxSpeed), 26, dt);
      p.vy = damp(p.vy, clamp(dy * 12, -p.maxSpeed, p.maxSpeed), 26, dt);
    } else if(!ax && !ay){
      p.vx = damp(p.vx, 0, 16, dt);
      p.vy = damp(p.vy, 0, 16, dt);
    }
    const sp = Math.hypot(p.vx, p.vy);
    if(sp > p.maxSpeed){ p.vx = p.vx/sp*p.maxSpeed; p.vy = p.vy/sp*p.maxSpeed; }

    p.x += p.vx*dt; p.y += p.vy*dt;
    /*
     * The Ring REPLACES the side walls rather than testing against them. The
     * clamp sets vx = 0 at the wall, so any "touching the edge and still
     * moving outward?" guard reduces to "touching the edge" and would wrap on
     * the lightest brush. Here there is no wall to brush.
     */
    if(this.wrap){
      if(p.x < 0 || p.x > VW){
        const out = p.x < 0 ? 0 : VW;
        p.x = p.x < 0 ? p.x + VW : p.x - VW;
        this.wrapped++;
        // Both ends flash, so the crossing reads as one continuous move
        // rather than the ship blinking out and a new one blinking in.
        fx.ring(out, p.y, 26, "#7fe9d0", 3, 0.22);
        fx.ring(p.x, p.y, 26, "#7fe9d0", 3, 0.22);
      }
    } else {
      if(p.x < 24){ p.x = 24; p.vx = 0; }
      if(p.x > VW-24){ p.x = VW-24; p.vx = 0; }
    }
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
    /*
     * The fight is won: the guns go quiet. Firing into an empty sky through
     * the boss celebration and the whole victory lap read as a ship that
     * hadn't noticed it had won - and the shot loop drowned the music at
     * exactly the moment the win is supposed to land.
     *
     * `finishTimer` covers the beat right after a boss dies, which is also
     * why Boss Rush still works: that timer runs out before the next boss
     * spawns, so the guns come straight back for the following round.
     */
    if(run && (run.ended || run.finishTimer > 0 ||
               run.phase === "clearing" || run.phase === "lap" ||
               run.phase === "outro"    || run.phase === "gone"))
      return;
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
    // Every round born in this call, so the Glass Sea reflects the exact
    // volley rather than guessing at it from the pool.
    const volley = this.mirror ? [] : null;

    for(let i=0;i<pattern.length;i++){
      const vx = pattern[i];
      const b = this.bullets.spawn();
      b.x = p.x + vx*0.02; b.y = p.y - 18; b.vx = vx; b.vy = -660;
      b.r = 5 + tier*0.5; b.dmg = dmg; b.pierce = p.pierce; b.homing = homing;
      b.tier = tier; b.age = 0; b.fromDrone = false; b.hitBoss = false; b.hitWeak = false;
      b.fromMirror = false;
      if(volley) volley.push(b);
    }
    fx.muzzle(p.x, p.y - 22, BULLET_TIERS[tier].color, 1.0 + tier*0.2);
    p.recoil = 2.5 + tier*0.4;

    for(let i=0;i<p.drones;i++){
      const side = i === 0 ? -1 : 1;
      const b = this.bullets.spawn();
      b.x = p.x + side*52; b.y = p.y + 2; b.vx = 0; b.vy = -640;
      b.r = 4.5; b.dmg = Math.max(1, Math.round(dmg*0.6)); b.pierce = p.pierce;
      b.homing = homing; b.tier = Math.max(0, tier-1); b.age = 0; b.fromDrone = true; b.hitBoss = false; b.hitWeak = false;
      b.fromMirror = false;
      if(volley) volley.push(b);
      fx.muzzle(p.x + side*52, p.y - 4, "#9fe4ff", 0.75);
    }
    /*
     * THE GLASS SEA. A second ship on the far side of the sky fires whatever
     * you fire. This is the only place a player round is born - the drone loop
     * above is inside this same function - so reflecting here catches
     * everything, drone bolts included, which simply looks better than a
     * reflection that copies half of you.
     *
     * The twin is a GUN, not a ship: nothing can hit it and it can hit
     * nothing back, so it needs no collision work at all, and a seven-year-old
     * who ignores it entirely still finishes the level. Its rounds are weaker
     * than yours, so it assists rather than replaces.
     *
     * b.fromMirror must be cleared on the normal path above too: the pool
     * hands back recycled objects, and a slot that stayed flagged would credit
     * phantom kills to the level's own star.
     */
    if(volley){
      for(let i = 0; i < volley.length; i++){
        const s = volley[i];
        const b = this.bullets.spawn();
        b.x = VW - s.x; b.y = s.y; b.vx = -s.vx; b.vy = s.vy;
        b.r = s.r; b.dmg = Math.max(1, Math.round(s.dmg*0.6)); b.pierce = s.pierce;
        b.homing = s.homing; b.tier = s.tier; b.age = 0;
        b.fromDrone = s.fromDrone; b.hitBoss = false; b.hitWeak = false;
        b.fromMirror = true;
      }
      fx.muzzle(VW - p.x, p.y - 22, "#dff3ff", 0.8);
    }
    audio.play(overdrive ? "shootHeavy" : "shoot", Math.min(1, tier/5), p.x);
  }

  /* ---------------- BULLETS ---------------- */
  updateBullets(dt){
    const items = this.bullets.items;
    for(let i=0;i<items.length;i++){
      const b = items[i];
      if(!b.alive) continue;
      b.age += dt;
      if(b.homing > 0){
        // Only what the round can still reach: it flies up, so "ahead" is above.
        const target = this.nearestTarget(b.x, b.y, b.y + 12);
        if(target){
          const desired = clamp((target.x - b.x)*3, -90*b.homing, 90*b.homing);
          b.vx += clamp(desired - b.vx, -220*b.homing*dt, 220*b.homing*dt);
        }
      }
      b.x += b.vx*dt; b.y += b.vy*dt;
      // All four sides, as enemy bullets already were. A player bullet only
      // ever flies up, until a Seeker bends one hard or a gravity well takes
      // hold of it - and then, with no bottom test, it occupied a pool slot
      // for the rest of the mission.
      if(this.wrap){
        if(b.x < -8) b.x += VW + 16; else if(b.x > VW + 8) b.x -= VW + 16;
      }
      if(b.y < -30 || b.y > VH+40 ||
         (!this.wrap && (b.x < -30 || b.x > VW+30))) b.alive = false;
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

  /*
   * The nearest thing worth steering at - AHEAD of the round, not behind it.
   *
   * Seeker Rounds bend a bullet's `vx` toward this target, and a player round
   * only ever flies up. Picking the nearest enemy by raw distance meant a ship
   * the bullet had already passed could win, and then the round spent its whole
   * tracking budget sliding sideways toward something it could never reach -
   * missing the enemy in front of it that it would otherwise have hit. A
   * £4,420 upgrade quietly made some shots worse.
   *
   * `aheadOfY`, when given, keeps the choice in front of the bullet.
   */
  nearestTarget(x, y, aheadOfY){
    let best = null, bestD = Infinity;
    const items = this.enemies.items;
    const limit = aheadOfY == null ? Infinity : aheadOfY;
    for(let i=0;i<items.length;i++){
      const e = items[i];
      if(!e.alive) continue;
      if(e.y > limit) continue;                 // already behind the round
      const d = (e.x-x)*(e.x-x) + (e.y-y)*(e.y-y);
      if(d < bestD){ bestD = d; best = e; }
    }
    if(this.boss && this.boss.alive && this.boss.y <= limit){
      const d = (this.boss.x-x)*(this.boss.x-x) + (this.boss.y-y)*(this.boss.y-y);
      if(d < bestD){ bestD = d; best = this.boss; }
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
    // BUBBLE SHOTS: their fire drifts in at just over a third speed and wobbles
    // on the way. Strictly easier - which is the Wacky Sky's whole contract -
    // and readable in the first second, because a bubble does not look like a
    // bolt. The radius is left alone: a fatter bubble would take the gift back.
    if(this.mods.bubbles){
      b.vx = vx*0.38 + (Math.random() - 0.5)*22;
      b.vy = vy*0.38;
      b.kind = "bubble";
    }
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
    /*
     * The floor scales across tiers like boss fights do (bossHp: 0.8-1.5),
     * NOT with hpMult (0.8-7.5): hard tiers already track firepower through
     * hpPowerScale, and stacking hpMult on top turned every Mender into a
     * bullet sponge exactly where the game is already at its hardest.
     *
     * It is DAMPED above the reference loadout. A floor that rises in step
     * with your guns is a 100% tax on every gun you buy, and that is what it
     * was: fifteen of the twenty-four archetypes carry a toughSeconds, and for
     * all fifteen the time-to-kill was pinned flat from about 3,000 pounds of
     * shopping onward. Plasma Rounds level 5 - 143,280 pounds - moved a turret
     * from 0.50s to 0.50s.
     *
     * Below REFERENCE_DPS the old linear rule is kept exactly, so a new pilot's
     * first missions are untouched; above it the floor grows with the square
     * root, so a maxed ship kills a Mender about 2.7x faster than a reference
     * one while the Mender still lives long enough to fire its beam. The role
     * guarantee survives; the tax does not.
     */
    const k = dps / REFERENCE_DPS;
    const floor = type.toughSeconds && dps > 0
      ? Math.round(type.toughSeconds * 0.5 * REFERENCE_DPS * Math.min(k, Math.sqrt(k))
                   * (diff ? (diff.bossHp || 1) : 1)) : 0;
    /*
     * Elites multiply whatever the hull ends up being, floor included. They
     * used to multiply the scaled path ONLY, so the moment the floor overtook
     * `scaled * 3.5` - about 3,300 pounds of gear - an elite had exactly the
     * same health as the ordinary ship beside it while still paying 4x money
     * and 4x score. Fourteen of twenty-four archetypes were in that state by
     * 18,000 pounds: the scary one in the wave was free money.
     */
    e.hp = Math.round(Math.max(scaled, floor, type.hp) * (elite ? ELITE.hpMult : 1));
    e.maxHp = e.hp;
    e.r = type.r * (elite ? ELITE.sizeMult : 1);
    e.size = type.size * (elite ? ELITE.sizeMult : 1);
    e.speed = type.speed * (diff ? diff.speed : 1) * (elite ? ELITE.speedMult : 1);
    /*
     * The Wacky Sky's roll, applied exactly where elites already scale these
     * numbers.
     *
     * GIANT, third cut. 1.55x looked like a tuning change; 2.1x was still
     * "not really noticeable" to the customer, whose brief is now explicit:
     * "better too crazy than too simple". So the ART goes to cartoon scale -
     * popcorn TRIPLES - while the HITBOX grows far less. The split is what
     * keeps the mode's oldest contract (easier and funnier, never harder):
     * at 3x collision radii a 13-grunt wall formation would physically seal
     * the field, because formations spread across VW no matter how fat their
     * members get. Drawn enormous, collided fair - the oldest cartoon trick
     * there is. Hull still only +25%, so they melt like popcorn should.
     *
     * SLEEPY is 0.35x - syrup, not a quiet day. Movement only: their shots
     * stay honest so dodging still means something.
     */
    if(this.mods.giant){
      const art = e.r <= 16 ? 3.0 : e.r <= 26 ? 2.2 : 1.4;
      const hit = e.r <= 16 ? 1.6 : e.r <= 26 ? 1.4 : 1.15;
      e.size *= art; e.r *= hit;
      e.hp = Math.round(e.hp * 1.25); e.maxHp = e.hp;
    }
    if(this.mods.sleepy) e.speed *= 0.35;
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
    e.bounty = !!o.bounty;            // wanted: drawn with a ring, pays five times
    e.grazed = false;                 // near-miss credit, claimed once per ship
    // Who counts as "coming at you" for a near miss. A grunt drifting past is
    // not a dodge; something that picked you and committed is.
    e.diver = type.behaviour === "kamikaze" || type.behaviour === "swoop" ||
              type.behaviour === "intercept";
    e.anchorX = x; e.weaveWidth = rand(62, 118); e.weaveSpeed = rand(1.3, 2.0);
    e.hoverY = o.hoverY != null ? o.hoverY : rand(170, 340);
    e.hoverTime = rand(3.5, 6);
    e.flash = 0; e.hitTint = 0;
    e.carriesRescue = !!type.carriesRescue;
    e.escaped = false;
    // Has it ever actually been in the field? Staged back ranks start well
    // above it, and nothing can "escape off the top" before it arrives.
    e.entered = y > -40;
    e.fromBoss = false;   // set by the boss for summoned adds
    e.hazard = !!type.hazard;
    /*
     * Scripted actors are exempt from the 28-second leash below. The leash
     * exists so an ordinary ship cannot loiter forever and deadlock a mission
     * that only ends when the field is clear - it was never meant for a set
     * piece that has its own scripted exit. It was reaching them anyway: the
     * Tithe Serpent arrives at t=14 and was therefore dragged out of its own
     * mission by t=42 whatever the script said, which on the harder tiers made
     * its star - a star on the road to the 84 that open Sky 29 - very likely
     * unobtainable. Its designed departure (run.serpent.fleeAt, in game.js)
     * never got the chance to fire.
     */
    e.noLeash = !!type.noLeash;
    // Whether this enemy is part of the mission's planned opposition. Rocks,
    // boss adds, laid mines and hive drones are all real threats but none of
    // them were "planned", so counting them would quietly break the kill
    // objectives - either inflating the total or making the kill ratio unreachable.
    e.counted = !type.hazard && !o.uncounted;
    e.shielded = false;   // recomputed every frame from live Guardians
    e.loot = 0; e.stolen = 0; e.fleeing = false; e.patience = 0;
    /*
     * EVERY FIELD A BEHAVIOUR OR A MISSION WRITES, CLEARED ON REUSE.
     *
     * These slots are pooled, so an object handed out here carries whatever the
     * last occupant left on it. Eighteen fields were written elsewhere and reset
     * nowhere, and each one is a bug waiting for the right recycle: a slot that
     * died at `chainDepth` 3 could never chain again, so CHAIN REACTION quietly
     * decayed over a long Wacky Sky; a slot left `armoured` would be bulletproof
     * for the rest of the mission; a recycled serpent ring kept `headRef`
     * pointing at a corpse and `trailPts` holding 720 stale points.
     *
     * Listed explicitly rather than rebuilt from scratch, because the pool
     * exists precisely to avoid reallocating - and grouped here so the next
     * person to author a behaviour field has an obvious place to add it.
     */
    e.chainDepth = 0;
    /*
     * This hard-set false, which made the static `type.armoured` flag DEAD:
     * a pooled enemy always came back unarmoured however its archetype was
     * written, so the Tithe Serpent's own type flags were decorative. One
     * word, and the data means what it says.
     */
    e.armoured = !!type.armoured; e.weak = false;
    e.pushable = !!type.pushable;   // a Sky Ox steers; nothing else does
    e.attached = false; e.holdAngle = 0;   // the Limpet's grip
    e.headRef = null; e.segIndex = 0; e.trailPts = null;
    e.hungry = false; e.huntX = null; e.huntY = null;
    e.beltDir = 0; e.beltSpeed = 0; e.beltY = 0;
    e.lockX = 0; e.lockY = 0;
    e.dodgeCool = 0; e.dodgeDir = 0; e.dodgeTimer = 0; e.tell = 0;
    e.arming = false; e.noSplit = false;
    // The Anchor's cable. Exactly the bug this block exists for: a ship that
    // died on the end of one would otherwise hand its link to whatever plain
    // grunt inherited the slot, and a live cable would stretch away to a ship
    // that was never tied to anything.
    e.tetherKey = 0; e.mate = null; e.tetherLead = false;
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

      /*
       * The snap. Shoot one end and the cable lets go - and it has to be SEEN
       * letting go, because "the thing that was hurting me is gone" is the
       * whole reward for choosing to cut rather than to dodge. Detected here
       * rather than in the kill handler so it also covers an end that left the
       * field, was eaten by a boss, or lost its slot to the pool.
       *
       * It fires from the SURVIVOR, not from the lead: the lead is as likely
       * to be the end that just died, and a dead ship is not updated. Exactly
       * one end notices, which is exactly one flourish. (If both go on the
       * same frame nobody notices, and nobody should - there are already two
       * explosions there.)
       */
      if(e.mate && !tetherLive(e)){
        fx.sparks(e.x, e.y, 5, "#a5f3fc", 190);
        fx.ring(e.x, e.y, 26, "#67e8f9", 2, 0.28);
        e.mate = null; e.tetherKey = 0; e.tetherLead = false;
      }

      // Safety leash: whatever an archetype's behaviour is, after 28 seconds
      // on the field it gives up and dives away. A mission only ends when the
      // field is clear, so nothing is allowed to linger indefinitely.
      if(e.life > 28 && !e.noLeash){
        e.y += Math.max(e.speed, 130) * 1.4 * dt;
      } else {
        (BEHAVIOURS[e.behaviour] || BEHAVIOURS.dive)(e, dt, ctxObj);
      }

      // Shooting
      const fire = e.type.fire;
      if(fire && e.y > 10 && e.y < VH - 60){
        e.fireTimer -= dt;
        if(e.fireTimer <= 0){
          // The Chorus: a ready gun holds its shot for the beat. The gate
          // says when the song allows it - game.js owns the metronome.
          if(ctxObj.beatGate && !ctxObj.beatGate(e)){
            e.fireTimer = 0.05;
          } else {
            this.enemyShoot(e, fire, ctxObj);
            e.fireTimer = rand(fire.every[0], fire.every[1]) * ctxObj.difficulty.fireRate;
          }
        }
      }

      /*
       * A fleeing thief leaves through the top with your money; everything
       * else leaves through the bottom or the sides.
       *
       * The top test only applies once a ship has ACTUALLY BEEN in the field.
       * Formations stage their back ranks far above it - a twelve-strong
       * column starts at y=-766, and eight of twelve slots in a vee, a
       * twinColumns or a sides begin past -120 - so without this guard the
       * back of every deep wave was marked "escaped" on its first tick,
       * before it had flown in at all. It counted as spawned, it counted
       * against the kill percentage, and it could never be shot: destroy
       * everything on screen on a dense tier and the star still read ~70%.
       */
      if(e.y > -40) e.entered = true;
      if(e.y > VH + 40 || (e.entered && e.y < -120) || e.x < -80 || e.x > VW + 80){
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
        /*
         * A Guardian shields its FLEET. It used to shield anything alive
         * nearby, which meant rocks, laid mines and the Foundry's belt parts
         * came up bubbled: player rounds splashed off a boulder while the
         * radio shouted "kill the Guardian first!", and on the Foundry a
         * shielded part rode the belt to the assembler untouchable - the
         * mission's own objective, blocked by a mechanic aimed at ships.
         */
        if(!e.alive || e === gd || e.type.shieldRadius) continue;
        if(!protectable(e)) continue;
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
    // The shot comes from where the shooter is. This is the one that makes a
    // pincer readable with your eyes shut.
    audio.play("hitArmour", null, e.x);
  }

  /* ---------------- PICKUPS ---------------- */
  spawnPickup(kind, x, y, data){
    const p = this.pickups.spawn();
    p.kind = kind; p.x = x; p.y = y; p.life = 0; p.angle = rand(0, TAU);
    p.vx = rand(-30, 30);
    p.vy = kind === "rescue" ? 42 : kind === "supply" ? 44 : rand(40, 80);
    p.value = (data && data.value) || 0;
    p.data = data || null;
    p.bounces = 3;   // BOUNCY COINS' budget; inert unless that mod is rolled
    p.floatFor = 0;  // a dropped crate hovers; the pool must not carry that over
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
      /*
       * A dropped crate HOVERS before it sinks. That pause is the whole
       * mercy of the Lifeline: being hit costs you the trip back, not the
       * delivery.
       */
      if(it.floatFor > 0){ it.floatFor -= dt; it.vy = 0; it.vx *= 0.9; }
      else it.vy += 95*dt;                   // fall, gently - coins are worth chasing
      it.vy = Math.min(it.vy, it.kind === "rescue" ? 55 : it.kind === "supply" ? 58 : 86);
      /*
       * BOUNCY COINS. Walls reflect, and the floor gives back three bounces
       * before letting the coin leave - each softer than the last, so the sky
       * fills with lazy popcorn instead of a perpetual-motion machine (the
       * pickup pool caps at 160, and pickups that never exit would eat it).
       * Rescue pods and supply crates are exempt: a *rescue* boinging off the
       * floor reads wrong even in the silly mode. Everywhere else the sideways
       * drift decays like it always has.
       */
      const bouncy = this.mods.bouncy && it.kind !== "rescue" && it.kind !== "supply";
      if(bouncy){
        if(it.x < 14 && it.vx < 0){ it.x = 14; it.vx = -it.vx; }
        else if(it.x > VW - 14 && it.vx > 0){ it.x = VW - 14; it.vx = -it.vx; }
        if(it.y > VH - 16 && it.vy > 0 && it.bounces > 0){
          it.bounces--;
          it.y = VH - 16;
          it.vy = -it.vy * 0.72;
          it.vx += rand(-40, 40);   // each bounce wanders - that's the comedy
        }
      } else {
        it.vx *= Math.pow(0.96, dt*60);
      }

      /*
       * THE GLASS SEA's twin reaches as well as shoots. It has no collision
       * of its own - it is a drawn gun, not a ship - so its reach is modelled
       * here: the same magnet and the same pickup radius, mirrored across the
       * field. Without this the reflection could kill a hauler on the far
       * side and then watch the pilot it freed fall past.
       */
      if(this.mirror && p && p.alive){
        const mx = VW - p.x;
        const dxm = mx - it.x, dym = p.y - it.y;
        const dm = Math.hypot(dxm, dym);
        const rangeM = p.magnetRange + (it.kind === "coin" ? 20 : 0);
        if(dm < rangeM && dm > 0.01){
          const pull = (1 - dm/rangeM) * 900 * dt;
          it.vx += dxm/dm * pull; it.vy += dym/dm * pull;
        }
        if(dm < p.r + 20){
          it.alive = false;
          onCollect(it);
          continue;
        }
      }
      if(p && p.alive){
        const dx = p.x - it.x, dy = p.y - it.y;
        const d = Math.hypot(dx, dy);
        // SUPER MAGNET: the tractor beam is the whole sky, and it does not
        // weaken with distance - coins streak in from the corners the moment
        // they exist. Loud, free money, and the reason it can't share a sky
        // with BOUNCY COINS (see wacky.js CONFLICTS).
        const vac = this.mods.vacuum;
        const range = vac ? 4000 : p.magnetRange + (it.kind === "coin" ? 20 : 0);
        if(d < range && d > 0.01){       // tractor beam
          const pull = (vac ? 1500 : (1 - d/range) * 900) * dt;
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
// The collision pass and the painter both need to ask "is this cable real?"
// and "where exactly does it hang?", and both answers must come from the one
// place that knows what a stale link looks like.
SF.tether = { live: tetherLive, curve: tetherCurve, at: tetherAt, R: TETHER_R };
SF.entityConst = { VW, VH, PLAY_TOP, PLAY_BOTTOM, BULLET_TIERS, protectable };
SF.field = { refresh: refreshField, onChange: onFieldChange, measure: pickFieldWidth };
})();
