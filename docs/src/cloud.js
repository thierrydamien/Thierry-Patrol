/*
 * Squad Sync - progress that follows the pilots between devices.
 *
 * Everything else in this game is offline and always will be: the whole point
 * of a static site is that it keeps working. So sync is strictly additive.
 * With no ENDPOINT configured, every function here is a no-op and the game
 * behaves exactly as it did before - localStorage, one device, no network.
 *
 * The backend is a Cloudflare Worker over KV (see ../../worker/). It stores one
 * blob per squad code and knows nothing about the game: no accounts, no
 * schema, no migrations to keep in step with `profile.js`.
 *
 * CONFLICTS
 * Two devices, same pilot, both played. Every save is stamped (`savedAt`), and
 * the newer record wins per pilot - not per squad, so Marc finishing a mission
 * on the iPad never rolls back what Charles just did on the laptop. Before
 * every push we pull and merge, which shrinks the losable window to the length
 * of one request.
 */
(function(){
"use strict";
const SF = window.SF;

/* Set this to the Worker's URL after deploying it - see worker/README.md.
   Empty means "no cloud", which is a perfectly good state for this game. */
const ENDPOINT = "https://thierry-patrol.wgsync.workers.dev";

const CODE_KEY = "patrol_squad_code";
/* Unambiguous alphabet: no O/0, no I/1, no 5/S. Kids read these aloud and
   type them on an iPad keyboard. */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
const PUSH_DELAY = 4000;   // batch a burst of purchases into one request

/*
 * The household's squad. There is one, and this is it.
 *
 * Sync originally minted a random code per device, which meant a new iPad
 * synced to nothing until somebody typed eight characters into it, losing the
 * code lost the cloud copy - there is no account to recover it from - and, in
 * practice, every device ended up on a private squad of one holding a
 * different save. For a game exactly one family plays that is a failure mode
 * bought with no benefit.
 *
 * Every device now defaults here, so a browser that has never seen the game
 * pulls the family's progress on first load and there is nothing to write
 * down. From then on, progress made anywhere reaches everywhere.
 *
 * The trade, stated plainly: this repo is public, so the key to these saves is
 * public too. Anyone who found it could read or overwrite a callsign, a ship
 * colour and some scores. `join()` still exists, so setting a private code on
 * every device takes that away again.
 */
const DEFAULT_CODE = "D6JJ-GEZQ";

/* Local safety net, independent of the network: a rolling set of snapshots of
   every pilot on this device, so a bad sync or an accidental reset is
   recoverable without the cloud being involved at all. */
const BACKUP_KEY = "patrol_backups";
const BACKUP_EVERY = 6*60*60*1000;   // at most one snapshot per six hours
const BACKUP_KEEP = 4;

let pushTimer = null;
let inFlight = false;
let pulledOnce = false;   // nothing is pushed before this device has pulled
let status = { state: "off", at: 0, error: null };
const listeners = [];

function configured(){ return !!ENDPOINT; }

function emit(state, error){
  status = { state, at: Date.now(), error: error || null };
  listeners.slice().forEach(fn => { try { fn(status); } catch(e){} });
}
function onStatus(fn){ listeners.push(fn); return status; }

/* ---------------------------------------------------------
   THE SQUAD CODE
   The only credential. Whoever has it has the saves, which is
   the right trade for a family game: no accounts, no email,
   nothing to reset when a nine-year-old forgets a password.
   --------------------------------------------------------- */
function formatCode(raw){
  const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 8 ? s.slice(0,4) + "-" + s.slice(4) : "";
}
function validCode(raw){ return !!formatCode(raw); }

function newCode(){
  let out = "";
  const buf = new Uint8Array(8);
  if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
  else for(let i=0;i<8;i++) buf[i] = Math.floor(Math.random()*256);
  for(let i=0;i<8;i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return formatCode(out);
}

/*
 * Codes minted before the shared default existed have to be let go of.
 *
 * Sync used to generate a random code per device and store it. `code()` then
 * returned that stored value forever, so a device that had ever pressed SYNC
 * NOW kept syncing to a squad of one - a phone showing a completely different
 * save, with the default it was supposed to adopt sitting right there unused.
 *
 * A code is only kept now if somebody deliberately typed it in via `join()`,
 * which sets MANUAL_KEY. Anything else was auto-minted and is discarded in
 * favour of the family's.
 */
const MANUAL_KEY = "patrol_squad_manual";
/* The squad this device last completed a sync with, so a change of squad can
   be told apart from an ordinary sync. */
const SEEN_KEY = "patrol_squad_seen";
function adoptFamilySquad(){
  try {
    if(localStorage.getItem(CODE_KEY) && !localStorage.getItem(MANUAL_KEY)){
      localStorage.removeItem(CODE_KEY);
    }
  } catch(e){ /* no storage means the default applies anyway */ }
}
adoptFamilySquad();

/** This device's code, which is the family's unless somebody chose another. */
function code(){
  try { return localStorage.getItem(CODE_KEY) || DEFAULT_CODE; } catch(e){ return DEFAULT_CODE; }
}
/** True when this device is on the shared family squad rather than its own. */
function isDefaultCode(){ return code() === DEFAULT_CODE; }
function setCode(raw, manual){
  const c = formatCode(raw);
  if(!c) return "";
  try {
    localStorage.setItem(CODE_KEY, c);
    if(manual) localStorage.setItem(MANUAL_KEY, "1");
  } catch(e){}
  return c;
}
function clearCode(){
  try { localStorage.removeItem(CODE_KEY); } catch(e){}
  emit("off");
}
/** The code for this device - the family's, unless one was set. */
function ensureCode(){ return code(); }

/* ---------------------------------------------------------
   LOCAL BACKUPS
   The cloud protects against losing a device. This protects
   against the cloud: a bad merge, a mistaken reset, or a sync
   that pushed something wrong is undoable from the machine
   you are sitting at, with no network involved.
   --------------------------------------------------------- */
function backups(){
  try {
    const list = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch(e){ return []; }
}

/**
 * Snapshots every pilot, at most once per BACKUP_EVERY. Rate-limited because
 * the point is to keep a few *old* states: taking one on every save would fill
 * the ring with four copies of this afternoon and lose yesterday.
 */
function snapshotBackup(force){
  try {
    const list = backups();
    const now = Date.now();
    if(!force && list.length && now - list[0].at < BACKUP_EVERY) return list;
    const pilots = SF.profile.snapshot();
    if(!Object.keys(pilots).length) return list;      // nothing worth keeping
    list.unshift({ at: now, pilots });
    const trimmed = list.slice(0, BACKUP_KEEP);
    localStorage.setItem(BACKUP_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch(e){ return backups(); }                     // a full quota is not fatal
}

/**
 * Puts a snapshot back. Records are re-stamped as of now so the restored state
 * is the newest one everywhere - otherwise the next sync would look at the old
 * timestamps, decide the cloud was fresher, and undo the restore.
 */
function restoreBackup(index){
  const snap = backups()[index || 0];
  if(!snap) return 0;
  snapshotBackup(true);                               // the state being replaced
  const now = Date.now();
  let n = 0;
  Object.keys(snap.pilots).forEach(name => {
    const rec = snap.pilots[name];
    if(!rec || !rec.name) return;
    rec.savedAt = now + 1;
    SF.profile.saveRaw(rec);
    n++;
  });
  if(n) sync();
  return n;
}

/* ---------------------------------------------------------
   MERGE
   Pure, and exported, because this is the part that can lose
   somebody's afternoon if it is wrong.
   --------------------------------------------------------- */

/** The squad this device last synced with, or "" the first time. */
function lastSquad(){
  try { return localStorage.getItem(SEEN_KEY) || ""; } catch(e){ return ""; }
}
function rememberSquad(c){
  try { localStorage.setItem(SEEN_KEY, c); } catch(e){}
}

/*
 * Records stamped in the future are poison, and get their stamps rewritten.
 *
 * Conflicts resolve on savedAt, so a record dated ahead of real time beats
 * every honest save until the wall clock catches up to it - one device with a
 * wrong clock (an iPad whose battery died, a deliberately changed date) would
 * pin the entire squad to its stale state, and every fix anyone made would
 * quietly revert. Both sides of a sync pass through here: anything claiming to
 * be from the future is re-stamped to now, after which the ordinary rules are
 * safe again. The slack absorbs honest clock skew between devices.
 */
const FUTURE_SLACK = 5*60000;
function sanitizePilots(map){
  const limit = Date.now() + FUTURE_SLACK;
  Object.keys(map || {}).forEach(n => {
    const rec = map[n];
    if(rec && (rec.savedAt || 0) > limit) rec.savedAt = Date.now();
  });
  return map;
}

/*
 * Joining a squad you were not on before is NOT a merge.
 *
 * Timestamps decide conflicts, and they answer "which was saved last", not
 * "which is the real one". A device that has been played on recently carries
 * newer stamps than a squad that holds months of progress, so an ordinary
 * merge would let the thin, recent save win and quietly delete the campaign
 * you switched squads to get. The moment a device changes squad, the squad is
 * the truth: its records win outright.
 *
 * Pilots that exist only on this device are still kept and pushed up - they
 * are not in conflict with anything, and losing them would be its own bug.
 */
function adoptSquad(mine, theirs){
  const out = {};
  Object.keys(mine || {}).forEach(n => { out[n] = mine[n]; });
  Object.keys(theirs || {}).forEach(n => { if(theirs[n]) out[n] = theirs[n]; });
  return out;
}

/*
 * MERGING ONE PILOT WHO WAS PLAYED IN TWO PLACES.
 *
 * This used to replace the whole record: newest savedAt wins, take everything.
 * But savedAt answers "which was saved last", not "which is the real one", and
 * two devices diverge for perfectly ordinary reasons - the iPad in the car with
 * no signal, the iPhone at home. Marc three-stars mission 12 on one and clears
 * mission 5 on the other, and whichever syncs second silently deleted the
 * other's afternoon. The feature whose whole purpose is "your progress follows
 * you" was the thing eating it.
 *
 * Almost everything in a profile is MONOTONIC - it only ever goes up, or a set
 * only ever gains members - so it merges without needing to know which device
 * is "right". Stars take the max. Cleared is an OR. Medals, paints, stories and
 * saved skies are unions. Only the genuinely conflicting fields - the spendable
 * wallet, and the cosmetic choices where there IS one right answer and it is
 * "whatever they picked most recently" - fall back to the timestamp.
 *
 * Pure and exported, because this is the part that can lose somebody's
 * afternoon if it is wrong, and pure things can be pinned in the test suite.
 */
const MAX_FIELDS = ["highscore", "totalKills", "bossesDefeated", "maxCombo",
                    "lifetimeMoney", "rescues", "missionsCompleted",
                    "flawlessMissions", "powerupsCollected"];
const OR_FIELDS  = ["vaultDone", "sky29Done"];
const SET_FIELDS = ["achievements"];
const COSMETIC_SETS = ["paints", "trails", "decals", "fireworks", "customs"];

function unionList(a, b){
  const out = Array.isArray(a) ? a.slice() : [];
  (Array.isArray(b) ? b : []).forEach(v => { if(out.indexOf(v) < 0) out.push(v); });
  out.sort();
  return out;
}

/*
 * Key order is part of the result, not an accident of it.
 *
 * The merge is compared with JSON.stringify in two places that matter - "has
 * this actually changed since the copy on disk?" and "does the squad already
 * have this?" - and Object.assign preserves insertion order, so merging A into
 * B and B into A produced byte-different records with identical meaning. That
 * would have made every sync look like a change, write the store, and push
 * again: a quiet loop of pointless traffic. Sorting the keys makes the merge
 * genuinely order-independent, which is also the property worth pinning.
 */
function sortedMap(obj){
  const out = {};
  Object.keys(obj).sort().forEach(k => { out[k] = obj[k]; });
  return out;
}

/** Merges one pilot's two records. `newer`/`older` decided by savedAt. */
function mergeRecord(a, b){
  if(!a) return b;
  if(!b) return a;
  const newer = (b.savedAt || 0) > (a.savedAt || 0) ? b : a;
  const older = newer === b ? a : b;
  // Start from the newer record so any field this function does not know about
  // - including anything a future version adds - keeps newest-wins behaviour.
  const out = Object.assign({}, older, newer);

  MAX_FIELDS.forEach(k => { out[k] = Math.max(a[k] || 0, b[k] || 0); });
  OR_FIELDS.forEach(k => { out[k] = !!(a[k] || b[k]); });
  SET_FIELDS.forEach(k => { out[k] = unionList(a[k], b[k]); });

  /*
   * The wallet is the one number that is not monotonic - it goes DOWN when you
   * buy something - so it cannot take the max, or a purchase made on one device
   * would be refunded by the other. The newer record's wallet wins, which is
   * the honest reading of "this is what they have left".
   */
  out.money = newer.money || 0;

  // Upgrades only go up, and a level bought on either device is bought.
  const ups = {};
  Object.keys(Object.assign({}, a.upgrades, b.upgrades)).forEach(k => {
    ups[k] = Math.max((a.upgrades && a.upgrades[k]) || 0,
                      (b.upgrades && b.upgrades[k]) || 0);
  });
  out.upgrades = sortedMap(ups);

  // The campaign ledger, mission by mission and tier by tier. This is the part
  // that actually held the lost afternoons.
  const missions = {};
  const ids = Object.assign({}, a.missions, b.missions);
  Object.keys(ids).forEach(id => {
    const ra = (a.missions && a.missions[id]) || null;
    const rb = (b.missions && b.missions[id]) || null;
    if(!ra || !rb){ missions[id] = ra || rb; return; }
    const rec = { cleared: !!(ra.cleared || rb.cleared), stars: {}, best: {} };
    Object.keys(Object.assign({}, ra.stars, rb.stars)).sort().forEach(t => {
      rec.stars[t] = Math.max((ra.stars && ra.stars[t]) || 0, (rb.stars && rb.stars[t]) || 0);
    });
    Object.keys(Object.assign({}, ra.best, rb.best)).sort().forEach(t => {
      rec.best[t] = Math.max((ra.best && ra.best[t]) || 0, (rb.best && rb.best[t]) || 0);
    });
    // `met` names WHICH objectives were ticked, and has to agree with the star
    // count beside it - so it comes from whichever side actually scored higher.
    const metA = ra.met || {}, metB = rb.met || {};
    const met = {};
    Object.keys(Object.assign({}, metA, metB)).sort().forEach(t => {
      const sa = (ra.stars && ra.stars[t]) || 0, sbb = (rb.stars && rb.stars[t]) || 0;
      met[t] = (sa >= sbb ? metA[t] : metB[t]) || metA[t] || metB[t];
    });
    if(Object.keys(met).length) rec.met = met;
    missions[id] = rec;
  });
  out.missions = sortedMap(missions);

  // Sets of things owned or seen. A medal claimed anywhere is claimed.
  out.cosmetics = {};
  COSMETIC_SETS.forEach(k => {
    out.cosmetics[k] = unionList((a.cosmetics || {})[k], (b.cosmetics || {})[k]);
  });
  out.stories = sortedMap(Object.assign({}, a.stories, b.stories));
  out.medalsClaimed = sortedMap(Object.assign({}, a.medalsClaimed, b.medalsClaimed));

  // Saved skies: union by id, newest first, capped the same way the board caps.
  const skies = [];
  const seenSky = {};
  [].concat(newer.workshopSkies || [], older.workshopSkies || []).forEach(s => {
    if(s && s.id && !seenSky[s.id]){ seenSky[s.id] = 1; skies.push(s); }
  });
  if(skies.length) out.workshopSkies = skies.slice(0, 8);

  // Best score per custom sky - a record, so it takes the max.
  const wbA = a.workshopBest || {}, wbB = b.workshopBest || {};
  const wb = {};
  Object.keys(Object.assign({}, wbA, wbB)).sort().forEach(id => {
    const x = wbA[id], y = wbB[id];
    wb[id] = (!x || (y && y.score > x.score)) ? y : x;
  });
  if(Object.keys(wb).length) out.workshopBest = sortedMap(wb);

  // Endless and rush bests are records too.
  ["endlessBest", "endlessLongest", "bossRushBest"].forEach(k => {
    const v = Math.max(a[k] || 0, b[k] || 0);
    if(v) out[k] = v;
  });

  out.savedAt = Math.max(a.savedAt || 0, b.savedAt || 0);
  return out;
}

function mergePilots(mine, theirs){
  const out = {};
  Object.keys(mine || {}).forEach(n => { out[n] = mine[n]; });
  Object.keys(theirs || {}).forEach(n => {
    const b = theirs[n];
    if(!b) return;
    out[n] = mergeRecord(out[n], b);
  });
  return out;
}

/**
 * Writes merged records to disk, skipping anything the device already has a
 * newer copy of. `force` is for adopting a squad, where the incoming record
 * wins even though it is older - the timestamp guard is exactly what has to be
 * overridden there.
 */
function applyPilots(map, force){
  const P = SF.profile;
  /*
   * Read the store ONCE. This used to call P.snapshot() inside the loop, which
   * re-reads and re-parses every pilot on the device for every pilot in the
   * map - sixteen full JSON.parses for a family of four where four would do.
   */
  const localAll = P.snapshot();
  let changed = 0;
  Object.keys(map).forEach(n => {
    const rec = map[n];
    if(!rec || typeof rec !== "object" || !rec.name) return;
    const local = localAll[n];
    /*
     * MERGE against the local copy, then write if anything actually changed.
     *
     * Two things had to be true at once here and a timestamp could only ever
     * deliver one of them. The incoming record is a field-level merge of both
     * sides (see mergeRecord), so its savedAt is the MAX of the two - which
     * means a "is it newer than mine?" guard skips it precisely when this
     * device held the later stamp, throwing away the other device's stars,
     * which is the bug the merge exists to fix. But writing unconditionally
     * would let a stale record clobber a newer local save, which is the bug the
     * guard existed to prevent.
     *
     * Merging again here settles both: the result is a superset of the local
     * record by construction, so nothing local can be lost, and anything the
     * incoming side knows about is picked up. `force` (adopting a squad) still
     * overwrites outright - that is the one case where the incoming record is
     * meant to win even though it is older.
     */
    /*
     * The STORED stamp is capped at now before the merge decides which side is
     * newer. A record dated into the future beats every honest save until the
     * wall clock catches up, so one device with a wrong clock could pin the
     * whole squad to its stale state and quietly revert every fix anyone made.
     * (sanitizePilots re-stamps future records on both sides of a real sync;
     * this covers the copy already sitting on disk, which nobody sanitized.)
     */
    const localSafe = local
      ? Object.assign({}, local, { savedAt: Math.min(local.savedAt || 0, Date.now()) })
      : local;
    const next = force ? rec : mergeRecord(localSafe, rec);
    if(local && JSON.stringify(local) === JSON.stringify(next)) return;
    P.saveRaw(next);
    changed++;
  });
  return changed;
}

/* ---------------------------------------------------------
   TRANSPORT
   --------------------------------------------------------- */
function url(c){ return ENDPOINT.replace(/\/+$/, "") + "/save?code=" + encodeURIComponent(c); }

/*
 * Every request goes through here so that *nothing* in the transport can throw
 * synchronously into a caller. Sync now runs unprompted at boot, so a missing
 * `fetch`, a blocked request or a malformed URL used to take the whole script
 * down with it - and the script that dies is the one that draws the game.
 * Sync failing has to be a status line, never a broken menu.
 */
function request(c, init){
  try {
    if(typeof fetch !== "function") throw new Error("No network in this browser");
    return fetch(url(c), init)
      .then(r => { if(!r.ok) throw new Error("HTTP " + r.status); return r; });
  } catch(e){
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

function fetchRemote(c){
  return request(c, { method: "GET", cache: "no-store" })
    .then(r => r.json())
    .then(d => (d && d.pilots) || {});
}
function putRemote(c, pilots){
  return request(c, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, pilots }),
  }).then(() => true);
}

/**
 * Pull, merge, push. One round trip each way, and the merge happens here
 * rather than on the Worker so the backend stays a dumb key-value store.
 */
function sync(opts){
  const o = opts || {};
  if(!configured()) return Promise.resolve(false);
  const c = o.code || code();
  if(!c) return Promise.resolve(false);
  if(inFlight) return Promise.resolve(false);
  inFlight = true;
  emit("syncing");

  let mine;
  try { mine = SF.profile.snapshot(); }
  catch(e){ inFlight = false; emit("error", String(e.message || e)); return Promise.resolve(false); }

  const switching = lastSquad() !== c;
  if(switching) snapshotBackup(true);   // keep what this device had, before it changes

  sanitizePilots(mine);
  return fetchRemote(c)
    .then(theirs => {
      sanitizePilots(theirs);
      const hasRemote = Object.keys(theirs).length > 0;
      // Adopting only makes sense if the squad has anything to adopt; against
      // an empty squad this is a first upload, not a takeover.
      const adopt = switching && hasRemote;
      const merged = adopt ? adoptSquad(mine, theirs) : mergePilots(mine, theirs);
      const pulled = applyPilots(merged, adopt);
      /*
       * Only write back when the merge actually produced something the squad
       * does not already hold. Timestamps can no longer answer that - a merged
       * record carries the max of both stamps, so it can equal theirs while
       * containing strictly more - so compare the content.
       */
      const needsPush = Object.keys(merged).some(n =>
        !theirs[n] || JSON.stringify(merged[n]) !== JSON.stringify(theirs[n]));
      return (needsPush ? putRemote(c, merged) : Promise.resolve(true))
        .then(() => {
          rememberSquad(c);
          pulledOnce = true;
          emit("ok");
          return pulled > 0;
        });
    })
    .catch(err => { emit("error", String(err.message || err)); return false; })
    .then(r => { inFlight = false; return r; });
}

/*
 * Called by profile.save(). Batches a burst of writes into one round trip.
 *
 * Nothing is pushed until this device has pulled at least once. A device that
 * has never talked to the squad knows nothing about it, and a save made in
 * those first seconds - picking a pilot is enough - carries a stamp newer than
 * anything in the cloud. Pushing that would hand the squad an empty save that
 * beats the real one on timestamp. Pull first, always.
 */
function touch(){
  if(!configured() || !code()) return;
  if(!pulledOnce) return;
  if(pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; sync(); }, PUSH_DELAY);
}

/**
 * Joins another device's squad. Their records merge in rather than replacing
 * this device's - a pilot who only exists here is pushed up, not deleted.
 */
function join(raw){
  const c = formatCode(raw);
  if(!c) return Promise.reject(new Error("That code doesn't look right"));
  setCode(c, true);            // deliberate, so it survives the default
  return sync({ code: c }).then(() => c);
}

/**
 * Sync once at boot, so a device that was off catches up before anyone plays -
 * and take a local snapshot first, while the state is still whatever this
 * device believed. Snapshotting after the merge would only ever record the
 * post-sync state, which is useless for undoing a bad sync.
 */
function boot(){
  snapshotBackup(false);
  if(!configured() || !code()) { emit("off"); return; }
  sync();
}

SF.cloud = {
  configured, code, ensureCode, setCode, clearCode, newCode, formatCode, validCode,
  isDefaultCode, DEFAULT_CODE, adoptFamilySquad,
  sync, touch, join, boot, onStatus,
  mergePilots, mergeRecord, applyPilots, adoptSquad, sanitizePilots,
  backups, snapshotBackup, restoreBackup,
  get status(){ return status; },
};
})();
