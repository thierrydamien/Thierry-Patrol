/*
 * Core utilities shared by every system: maths, deterministic RNG, the object
 * pool that keeps the hot loop allocation-free, and a uniform-grid broadphase
 * for collisions.
 *
 * Everything hangs off the single global `SF` namespace. No build step: the
 * files are plain scripts loaded in dependency order by index.html, which
 * keeps the game a drop-in static site (GitHub Pages) and keeps the smoke
 * test able to load the same sources the browser does.
 */
(function(){
"use strict";
const SF = window.SF = window.SF || {};

/* ---------------------------------------------------------
   MATHS
   --------------------------------------------------------- */
const TAU = Math.PI * 2;
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t){ return a + (b - a) * t; }
/** Frame-rate independent smoothing: the fraction of the way to close per second. */
function damp(current, target, rate, dt){ return lerp(current, target, 1 - Math.exp(-rate * dt)); }
function dist2(ax, ay, bx, by){ const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; }
function len(x, y){ return Math.sqrt(x*x + y*y); }
/*
 * THE SIMULATION STREAM.
 *
 * Every gameplay draw - spawn positions, elite picks, aim coin-flips, boss
 * cadence - goes through these four helpers, and they used to read
 * Math.random directly. That made the stream global property: anything that
 * drew a number moved every draw after it. The design notes record FOUR
 * separate incidents of a test perturbing the stream and breaking an
 * assertion hundreds of lines away, and the Daily Patrol's same-sky-for-
 * everyone promise quietly broke on it (the script was seeded; the sim
 * wasn't).
 *
 * Now the source is swappable: `seedSim(n)` points the helpers at a
 * deterministic mulberry32, and startMission reseeds per run. Two rules keep
 * it honest:
 *  - SIMULATION code draws from these helpers, nothing else.
 *  - COSMETIC code (particle colours, screen shake jitter, comms line
 *    choice, confetti CSS) uses Math.random directly, so decoration can
 *    never perturb gameplay. When adding a random draw, that is the choice
 *    being made.
 */
let simRandom = Math.random;
function seedSim(seed){ simRandom = mulberry32(seed >>> 0); }
function rand(a, b){ return a + simRandom() * (b - a); }
function randInt(a, b){ return Math.floor(a + simRandom() * (b - a + 1)); }
function pick(arr){ return arr[Math.floor(simRandom() * arr.length)]; }
function chance(p){ return simRandom() < p; }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

/** Deterministic RNG. The Wacky Sky draws each flight script from one seed. */
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------
   OBJECT POOL
   Bullets, particles and enemies churn hundreds of times a
   second. Rather than allocating (and making the GC stutter
   mid-dodge) every list reuses dead slots forever.
   --------------------------------------------------------- */
class Pool {
  /**
   * @param {function} factory makes one blank object
   * @param {number} cap hard ceiling; spawning past it recycles the oldest
   */
  constructor(factory, cap){
    this.factory = factory;
    this.cap = cap || 1024;
    this.items = [];
    this.cursor = 0; // round-robin start point, so we don't rescan from 0 each time
    this.onSteal = null; // called with a live object about to be recycled at the cap
  }
  /** Returns a dead slot (or a fresh object), marked alive. Caller initialises it. */
  spawn(){
    const n = this.items.length;
    for(let k = 0; k < n; k++){
      const i = (this.cursor + k) % n;
      const o = this.items[i];
      if(!o.alive){
        this.cursor = (i + 1) % n;
        o.alive = true;
        return o;
      }
    }
    if(n >= this.cap){
      /*
       * At the ceiling: steal the oldest slot rather than growing without
       * bound. The victim is a LIVE object, so whoever owns the pool has to be
       * told - silently overwriting a live enemy is how one gets counted as
       * spawned and then never killed and never escaped, which puts the kill
       * objectives permanently out of reach. `onSteal` is the one door out.
       */
      const o = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % n;
      if(o.alive && this.onSteal) this.onSteal(o);
      o.alive = true;
      return o;
    }
    const o = this.factory();
    o.alive = true;
    this.items.push(o);
    return o;
  }
  killAll(){ for(let i = 0; i < this.items.length; i++) this.items[i].alive = false; }
  countAlive(){
    let c = 0;
    for(let i = 0; i < this.items.length; i++) if(this.items[i].alive) c++;
    return c;
  }
}

/* ---------------------------------------------------------
   BROADPHASE
   Bullets-vs-enemies is the only O(n*m) pair that grows, so
   enemies go into a uniform grid once per frame and each
   bullet only tests the cell it is standing in.
   --------------------------------------------------------- */
class SpatialGrid {
  constructor(width, height, cell){
    this.cell = cell;
    this.cols = Math.ceil(width / cell) + 2;
    this.rows = Math.ceil(height / cell) + 2;
    this.buckets = new Array(this.cols * this.rows);
    for(let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }
  clear(){
    for(let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
  }
  _index(x, y){
    const cx = clamp(Math.floor(x / this.cell) + 1, 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cell) + 1, 0, this.rows - 1);
    return cy * this.cols + cx;
  }
  insert(obj){
    this.buckets[this._index(obj.x, obj.y)].push(obj);
  }
  /** Calls fn for every object in the 3x3 cells around (x,y). */
  query(x, y, fn){
    const cx = clamp(Math.floor(x / this.cell) + 1, 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cell) + 1, 0, this.rows - 1);
    for(let j = -1; j <= 1; j++){
      const row = cy + j;
      if(row < 0 || row >= this.rows) continue;
      for(let i = -1; i <= 1; i++){
        const col = cx + i;
        if(col < 0 || col >= this.cols) continue;
        const bucket = this.buckets[row * this.cols + col];
        for(let k = 0; k < bucket.length; k++){
          if(fn(bucket[k])) return; // fn returns true to stop early
        }
      }
    }
  }
}

SF.core = { TAU, clamp, lerp, damp, dist2, len, rand, randInt, pick, chance, seedSim, easeOutCubic, mulberry32, Pool, SpatialGrid };
})();
