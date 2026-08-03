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
 * The household's own squad, baked in.
 *
 * Sync originally minted a random code per device, which meant a new iPad
 * synced to nothing until somebody typed eight characters into it, and losing
 * the code lost the cloud copy - there is no account to recover it from. For a
 * game exactly one family plays, that is a failure mode bought with no
 * benefit. Every device now defaults to this code, so a browser that has never
 * seen the game before pulls the family's progress on first load, and there is
 * no longer anything to write down.
 *
 * The trade, stated plainly: this repo is public, so the key to these saves is
 * public too. Anyone who found it could read or overwrite a callsign, a ship
 * colour and some scores. `join()` still exists, so setting a private code on
 * every device takes that away again.
 */
const DEFAULT_CODE = "PAWD-QATD";

/* Local safety net, independent of the network: a rolling set of snapshots of
   every pilot on this device, so a bad sync or an accidental reset is
   recoverable without the cloud being involved at all. */
const BACKUP_KEY = "patrol_backups";
const BACKUP_EVERY = 6*60*60*1000;   // at most one snapshot per six hours
const BACKUP_KEEP = 4;

let pushTimer = null;
let inFlight = false;
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

/** This device's code, which is the family's unless somebody set another. */
function code(){
  try { return localStorage.getItem(CODE_KEY) || DEFAULT_CODE; } catch(e){ return DEFAULT_CODE; }
}
/** True when this device is on the shared family squad rather than its own. */
function isDefaultCode(){ return code() === DEFAULT_CODE; }
function setCode(raw){
  const c = formatCode(raw);
  if(!c) return "";
  try { localStorage.setItem(CODE_KEY, c); } catch(e){}
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
function mergePilots(mine, theirs){
  const out = {};
  Object.keys(mine || {}).forEach(n => { out[n] = mine[n]; });
  Object.keys(theirs || {}).forEach(n => {
    const a = out[n], b = theirs[n];
    if(!b) return;
    if(!a || (b.savedAt || 0) > (a.savedAt || 0)) out[n] = b;
  });
  return out;
}

/** Writes merged records to disk, skipping the ones already identical. */
function applyPilots(map){
  const P = SF.profile;
  let changed = 0;
  Object.keys(map).forEach(n => {
    const rec = map[n];
    if(!rec || typeof rec !== "object" || !rec.name) return;
    const local = P.snapshot()[n];
    if(local && (local.savedAt || 0) >= (rec.savedAt || 0)) return;
    P.saveRaw(rec);
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

  return fetchRemote(c)
    .then(theirs => {
      const merged = mergePilots(mine, theirs);
      const pulled = applyPilots(merged);
      // Only write back when we actually hold something they don't.
      const needsPush = Object.keys(merged).some(n =>
        !theirs[n] || (merged[n].savedAt || 0) > (theirs[n].savedAt || 0));
      return (needsPush ? putRemote(c, merged) : Promise.resolve(true))
        .then(() => { emit("ok"); return pulled > 0; });
    })
    .catch(err => { emit("error", String(err.message || err)); return false; })
    .then(r => { inFlight = false; return r; });
}

/** Called by profile.save(). Batches a burst of writes into one round trip. */
function touch(){
  if(!configured() || !code()) return;
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
  setCode(c);
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
  isDefaultCode, DEFAULT_CODE,
  sync, touch, join, boot, onStatus,
  mergePilots, applyPilots,
  backups, snapshotBackup, restoreBackup,
  get status(){ return status; },
};
})();
