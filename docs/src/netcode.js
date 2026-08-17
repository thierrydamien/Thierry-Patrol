/*
 * Two devices, one sky.
 *
 * Same-device co-op is two seats in one World. This is the other half of the
 * ask - "either on same device or on 2 different devices" - and it is a
 * different problem: two browsers, two clocks, two copies of the game, and
 * one shared reality that has to be the same on both screens.
 *
 * ---------------------------------------------------------------------------
 * HOST-AUTHORITATIVE, not lockstep.
 *
 * The tempting design is deterministic lockstep: both devices run the whole
 * simulation from the same seed and only trade the two sticks. It is beautiful
 * and it is the wrong choice here. It needs the two machines to agree on every
 * float forever - one Math.sin that rounds differently on an iPad and a
 * MacBook and the two skies quietly drift apart with nothing on screen to say
 * so. A desync a child cannot see is worse than a stutter they can.
 *
 * So one device owns reality. The HOST runs the game exactly as it always has,
 * both ships and all. The GUEST sends its stick and draws what it is told. If
 * a packet is lost the guest is briefly stale and then correct again, which is
 * a failure mode you can live with.
 *
 * ---------------------------------------------------------------------------
 * THE GUEST DOES NOT HAVE A SPECIAL RENDERER.
 *
 * Snapshots are applied INTO the guest's own World - spawning into the same
 * pools, through the same spawnEnemy - so every field the painter reads is
 * really there and the whole renderer works untouched. The guest is not
 * simulating; it is being puppeted. That is what keeps this ~600 lines instead
 * of a second copy of the game.
 *
 * ---------------------------------------------------------------------------
 * FINDING EACH OTHER.
 *
 * WebRTC needs somewhere to swap two blobs before it can talk peer-to-peer.
 * That is the Squad Sync worker's /room endpoint: four characters a child
 * reads off one screen and types into the other, a two-minute expiry, and a
 * key prefix that can never collide with a save. Once the two peers are
 * talking, nothing else goes through the server - the game is on the home
 * network, at home-network latency.
 */
(function(){
"use strict";
const SF = window.SF;

const ENDPOINT = "https://thierry-patrol.wgsync.workers.dev";
/*
 * No I, O, 0 or 1. Every one of those is a different character on a screen and
 * the same character to a seven-year-old reading one out loud to their
 * brother, and a mistyped code is a failure with nothing to debug.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const POLL_MS = 1200;             // how often we ask whether the other side answered
const HANDSHAKE_MS = 90000;       // how long a child gets to type a code
const ICE_WAIT_MS = 4000;         // ...then send whatever candidates we have
const SNAP_HZ = 20;               // snapshots per second, host -> guest
const INPUT_HZ = 30;              // sticks per second, guest -> host
const STALE_MS = 3000;            // no traffic for this long: the link is gone

const state = {
  role: null,                     // "host" | "guest" | null
  phase: "idle",                  // idle | opening | waiting | joining | live | failed | closed
  code: null,
  error: null,
  pc: null,
  chan: null,
  lastRx: 0,
  ping: 0,
  // Host: the guest's most recent stick. Guest: the most recent snapshot.
  guestInput: { dragging:false, dragX:0, dragY:0, seq:0 },
  snap: null,
  snapAt: 0,
  mate: null,                     // the other device's pilot, as a profile-ish object
  onPhase: null,
};

function now(){ return Date.now(); }
function live(){ return state.phase === "live"; }
function supported(){
  return typeof window.RTCPeerConnection === "function";
}

/* ---------------------------------------------------------
   THE RENDEZVOUS
   --------------------------------------------------------- */
function makeCode(){
  let s = "";
  // Math.random on purpose: a room code is not part of the simulation and
  // must never draw from the seeded stream that decides where ships appear.
  for(let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random()*ALPHABET.length)];
  return s;
}

async function put(code, slot, text){
  const r = await fetch(ENDPOINT + "/room?code=" + code + "&slot=" + slot,
                        { method:"PUT", body: text });
  if(!r.ok) throw new Error(r.status === 404 ? "no-room-endpoint" : "put-" + r.status);
}
async function get(code, slot){
  const r = await fetch(ENDPOINT + "/room?code=" + code + "&slot=" + slot);
  if(!r.ok) throw new Error(r.status === 404 ? "no-room-endpoint" : "get-" + r.status);
  const j = await r.json();
  return j && j.data ? j.data : null;
}
/** Ask until it is there or the child has run out of patience. */
async function poll(code, slot, untilMs){
  while(now() < untilMs){
    if(state.phase === "closed") return null;
    const got = await get(code, slot);
    if(got) return got;
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  return null;
}

/*
 * Non-trickle ICE: gather candidates, then send ONE blob. Trickling is faster
 * on paper and would mean a stream of tiny writes through a key-value store
 * that was never meant to be a message bus. Capped, because a network with no
 * STUN reachable will otherwise sit in "gathering" until it times out, and the
 * candidates we already have are usually the ones that were going to work.
 */
function iceReady(pc){
  return new Promise(resolve => {
    if(pc.iceGatheringState === "complete") return resolve();
    let done = false;
    const finish = () => { if(!done){ done = true; resolve(); } };
    const t = setTimeout(finish, ICE_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if(pc.iceGatheringState === "complete"){ clearTimeout(t); finish(); }
    });
  });
}

function newPeer(){
  /*
   * A public STUN server is what lets two devices on different networks find
   * a route. Two tablets on the same home Wi-Fi usually do not need it - they
   * find each other on host candidates - so a family with no reachable STUN
   * still gets the case they actually asked for.
   */
  const pc = new window.RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  pc.addEventListener("connectionstatechange", () => {
    if(pc.connectionState === "failed" || pc.connectionState === "disconnected")
      fail("lost");
  });
  return pc;
}

function wire(chan){
  state.chan = chan;
  chan.binaryType = "arraybuffer";
  chan.addEventListener("open", () => setPhase("live"));
  chan.addEventListener("close", () => { if(live()) fail("lost"); });
  chan.addEventListener("message", ev => {
    state.lastRx = now();
    let m;
    try { m = JSON.parse(ev.data); } catch(e){ return; }
    receive(m);
  });
}

function setPhase(p){
  if(state.phase === p) return;
  state.phase = p;
  if(p === "live"){ state.lastRx = now(); state.error = null; }
  if(state.onPhase) { try { state.onPhase(p); } catch(e){} }
}
function fail(why){
  if(state.phase === "closed") return;
  state.error = why;
  setPhase("failed");
  teardown();
}
function teardown(){
  try { if(state.chan) state.chan.close(); } catch(e){}
  try { if(state.pc) state.pc.close(); } catch(e){}
  state.chan = null; state.pc = null;
}
function close(){
  const was = state.phase;
  setPhase("closed");
  teardown();
  state.role = null; state.code = null; state.snap = null; state.mate = null;
  if(was !== "closed") setPhase("idle");
}

/**
 * Open a room. Resolves with the four-character code IMMEDIATELY, so the code
 * can be on screen while the handshake is still happening behind it - a child
 * should never watch a spinner before being told what to type.
 */
async function host(me){
  if(!supported()) throw new Error("unsupported");
  close();
  state.role = "host";
  state.code = makeCode();
  setPhase("opening");
  const code = state.code;

  const pc = state.pc = newPeer();
  wire(pc.createDataChannel("sky", { ordered:false, maxRetransmits:0 }));

  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await iceReady(pc);
      if(state.phase === "closed") return;
      await put(code, "offer", JSON.stringify({ sdp: pc.localDescription, who: card(me) }));
      setPhase("waiting");
      const raw = await poll(code, "answer", now() + HANDSHAKE_MS);
      if(!raw){ return fail("nobody-came"); }
      const ans = JSON.parse(raw);
      state.mate = ans.who || null;
      await pc.setRemoteDescription(ans.sdp);
    } catch(e){ fail(e && e.message || "handshake"); }
  })();

  return code;
}

/** Join a room somebody read out to you. Resolves when the link is live. */
async function join(code, me){
  if(!supported()) throw new Error("unsupported");
  close();
  state.role = "guest";
  state.code = (code || "").toUpperCase().trim();
  setPhase("joining");

  const pc = state.pc = newPeer();
  pc.addEventListener("datachannel", ev => wire(ev.channel));
  try {
    const raw = await poll(state.code, "offer", now() + 12000);
    if(!raw){ fail("no-such-room"); return false; }
    const off = JSON.parse(raw);
    state.mate = off.who || null;
    await pc.setRemoteDescription(off.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await iceReady(pc);
    if(state.phase === "closed") return false;
    await put(state.code, "answer", JSON.stringify({ sdp: pc.localDescription, who: card(me) }));
    return true;
  } catch(e){ fail(e && e.message || "handshake"); return false; }
}

/**
 * The little of a pilot the other device needs. Enough to BUILD their ship
 * (upgrades, hull, tune) and enough to DRAW it (colour, decal, badge) - but
 * not their save. Their money and medals stay on their own device, which is
 * the whole point: what they earn up here is sent home at the end of the
 * mission and banked there, by them.
 */
function card(p){
  if(!p) return null;
  // ...plus how far along the campaign they are, as one number. Two players
  // progress together, so the other device's map has to know what this pilot
  // can already fly - but it has no business seeing their save to find out.
  let reach = 0;
  if(SF.missions){
    const M = SF.missions.MISSIONS;
    for(let i = 0; i < M.length; i++)
      if(SF.missions.isMissionUnlocked(p, i)) reach = i;
  }
  return { name: p.name, callsign: p.callsign || p.name, shipColor: p.shipColor,
           hull: p.hull, tune: p.tune, decal: p.decal, badge: p.badge,
           upgrades: Object.assign({}, p.upgrades), reach,
           levels: SF.shipart ? SF.shipart.levelsOf(p) : {} };
}

/**
 * ...and back the other way: a card is not a save, so anything that wants to
 * treat it like a pilot gets a blank one wearing the card's gear. Used for
 * the ship the OTHER device is flying, which this device must build and draw
 * but must never bank anything into.
 */
function asPilot(c){
  if(!c) return null;
  const p = SF.profile.blank(c.name || "PILOT");
  p.callsign = c.callsign || p.callsign;
  p.shipColor = c.shipColor || p.shipColor;
  p.hull = c.hull; p.tune = c.tune; p.decal = c.decal; p.badge = c.badge;
  p.upgrades = Object.assign({}, c.upgrades || {});
  p.remote = true;                 // never saved: see endMission
  return p;
}

function send(obj){
  const c = state.chan;
  if(!c || c.readyState !== "open") return false;
  try { c.send(JSON.stringify(obj)); return true; }
  catch(e){ return false; }
}

/* ---------------------------------------------------------
   THE WIRE
   ---------------------------------------------------------
 * Rounded integers, positional arrays, short keys. Not premature: a busy sky
 * is a couple of hundred moving things and this goes out twenty times a
 * second, so the difference between {"x":123.456} and 123 is the difference
 * between a comfortable link and a stuttering one on the far side of a house.
 */
const R = n => Math.round(n) || 0;

let snapAcc = 0, inputAcc = 0, inputSeq = 0;

function packEnemies(pool){
  const out = [];
  const items = pool.items;
  for(let i = 0; i < items.length; i++){
    const e = items[i];
    if(!e.alive) continue;
    out.push([e.netId || (e.netId = ++netSeq), e.typeId, R(e.x), R(e.y),
              R(e.hp), e.elite ? 1 : 0, R((e.angle || 0)*100), R((e.flash || 0)*100)]);
  }
  return out;
}
function packBullets(pool){
  const out = [];
  const items = pool.items;
  for(let i = 0; i < items.length; i++){
    const b = items[i];
    if(!b.alive) continue;
    out.push([R(b.x), R(b.y), R(b.vx), R(b.vy), R(b.r), b.tier || 0, b.kind || 0]);
  }
  return out;
}
function packPickups(pool){
  const out = [];
  const items = pool.items;
  for(let i = 0; i < items.length; i++){
    const it = items[i];
    if(!it.alive) continue;
    out.push([it.kind, R(it.x), R(it.y), R(it.value)]);
  }
  return out;
}
function packShip(p){
  if(!p) return null;
  return [R(p.x), R(p.y), R((p.bank || 0)*100), p.alive ? 1 : 0, p.lives | 0,
          p.shield | 0, R((p.invuln || 0)*100), R(p.purse || 0)];
}

let netSeq = 0;

/**
 * The host's picture of the world, once every 50ms. Called from the game loop
 * with the real dt, so a slow device sends fewer and larger-stepped snapshots
 * rather than falling behind forever.
 */
function sendSnapshot(dt, world, run){
  if(!live() || state.role !== "host") return;
  snapAcc += dt;
  if(snapAcc < 1/SNAP_HZ) return;
  snapAcc = 0;
  const boss = world.boss;
  send({
    t: "S",
    vw: SF.entityConst.VW,
    p: (world.players || []).map(packShip),
    e: packEnemies(world.enemies),
    b: packBullets(world.bullets),
    eb: packBullets(world.enemyBullets),
    k: packPickups(world.pickups),
    B: boss && boss.alive
       ? [R(boss.x), R(boss.y), R(boss.hp), R(boss.maxHp), boss.typeId || boss.id || ""]
       : null,
    r: run ? {
      score: run.score, money: R(run.money), combo: run.combo,
      prog: R(run.progress*1000), boss: run.bossActive ? 1 : 0,
      bt: run.bannerText || "", bs: run.bannerSub || "",
      bc: run.bannerColor || "", bu: R(run.bannerUntil - SF.game.now()),
      ended: run.ended ? 1 : 0,
    } : null,
  });
}

/** The guest's stick, thirty times a second. */
function sendInput(dt){
  if(!live() || state.role !== "guest") return;
  inputAcc += dt;
  if(inputAcc < 1/INPUT_HZ) return;
  inputAcc = 0;
  const s = SF.input.state;              // on the guest's own device they are seat one
  send({ t:"I", q: ++inputSeq, d: s.dragging ? 1 : 0, x: R(s.dragX), y: R(s.dragY),
         u: s.up ? 1:0, dn: s.down ? 1:0, l: s.left ? 1:0, rr: s.right ? 1:0 });
}

function receive(m){
  if(!m || !m.t) return;
  if(m.t === "I" && state.role === "host"){
    // Out-of-order delivery is expected on an unreliable channel: an older
    // stick position must never overwrite a newer one.
    if(m.q <= state.guestInput.seq) return;
    state.guestInput = { seq:m.q, dragging:!!m.d, dragX:m.x, dragY:m.y,
                         up:!!m.u, down:!!m.dn, left:!!m.l, right:!!m.rr };
    return;
  }
  if(m.t === "S" && state.role === "guest"){
    state.snap = m; state.snapAt = now();
    return;
  }
  if(m.t === "C"){
    if(state.onControl) { try { state.onControl(m); } catch(e){} }
    return;
  }
}

/**
 * Hand the host's guest-stick to the input layer, so seat two on the host is
 * driven by a child in another room exactly as if they were on the sofa.
 */
function applyGuestInput(){
  if(state.role !== "host") return;
  const g = state.guestInput, s2 = SF.input.state2;
  if(!s2) return;
  s2.dragging = g.dragging; s2.dragX = g.dragX; s2.dragY = g.dragY;
  s2.up = !!g.up; s2.down = !!g.down; s2.left = !!g.left; s2.right = !!g.right;
}

/* ---------------------------------------------------------
   BEING PUPPETED
   ---------------------------------------------------------
 * The guest's World is filled in from the snapshot rather than simulated.
 * Enemies are matched by the id the host gave them, so one that is still there
 * MOVES rather than being destroyed and rebuilt - which is what lets the
 * painter's per-enemy state (flash, wobble, baked sprite) survive between
 * snapshots instead of flickering.
 */
function applySnapshot(world){
  const s = state.snap;
  if(!s || state.role !== "guest") return false;

  const seen = Object.create(null);
  for(let i = 0; i < s.e.length; i++) seen[s.e[i][0]] = s.e[i];

  const items = world.enemies.items;
  for(let i = 0; i < items.length; i++){
    const e = items[i];
    if(!e.alive) continue;
    const row = seen[e.netId];
    if(!row){ e.alive = false; continue; }
    e.x = row[2]; e.y = row[3]; e.hp = row[4];
    e.angle = row[6]/100; e.flash = row[7]/100;
    delete seen[e.netId];
  }
  for(const id in seen){
    const row = seen[id];
    let e;
    try {
      e = world.spawnEnemy(row[1], row[2], row[3],
        { difficulty: SF.config.DIFFICULTY_BY_ID.pilot, elite: !!row[5], uncounted: true });
    } catch(err){ continue; }
    if(!e) continue;
    e.netId = +id; e.hp = row[4]; e.angle = row[6]/100; e.entering = false;
  }

  const fillBullets = (pool, rows) => {
    pool.killAll();
    for(let i = 0; i < rows.length; i++){
      const r = rows[i], b = pool.spawn();
      b.x = r[0]; b.y = r[1]; b.vx = r[2]; b.vy = r[3];
      b.r = r[4]; b.tier = r[5]; b.kind = r[6];
      b.life = 0; b.pierce = 0; b.owner = null;
    }
  };
  fillBullets(world.bullets, s.b);
  fillBullets(world.enemyBullets, s.eb);

  world.pickups.killAll();
  for(let i = 0; i < s.k.length; i++){
    const r = s.k[i];
    const it = world.spawnPickup(r[0], r[1], r[2], { value: r[3] });
    it.vx = 0; it.vy = 0;
  }

  // The two ships. Seat two on the wire is THIS device's pilot, so on the
  // guest's screen the ships keep the same identities they have on the host's.
  const ps = world.players || [];
  for(let i = 0; i < ps.length && i < s.p.length; i++){
    const row = s.p[i], p = ps[i];
    if(!row) continue;
    p.x = row[0]; p.y = row[1]; p.bank = row[2]/100;
    p.alive = !!row[3]; p.lives = row[4]; p.shield = row[5];
    p.invuln = row[6]/100; p.purse = row[7];
  }

  const run = SF.game.run;
  if(run && s.r){
    run.score = s.r.score; run.money = s.r.money; run.combo = s.r.combo;
    run.progress = s.r.prog/1000; run.bossActive = !!s.r.boss;
    run.bannerText = s.r.bt; run.bannerSub = s.r.bs;
    run.bannerColor = s.r.bc; run.bannerUntil = SF.game.now() + s.r.bu;
    if(s.r.ended) run.ended = true;
  }
  return true;
}

/** Has the other device gone quiet? */
function stale(){ return live() && now() - state.lastRx > STALE_MS; }

SF.netcode = {
  supported, host, join, close, send, asPilot,
  role: () => state.role,
  phase: () => state.phase,
  error: () => state.error,
  code: () => state.code,
  mate: () => state.mate,
  live, stale,
  sendSnapshot, sendInput, applyGuestInput, applySnapshot,
  onPhase: fn => { state.onPhase = fn; },
  onControl: fn => { state.onControl = fn; },
  _state: state,
};
})();
