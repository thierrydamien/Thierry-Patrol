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

function code(){
  try { return localStorage.getItem(CODE_KEY) || ""; } catch(e){ return ""; }
}
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
/** The code for this device, minting one on first use. */
function ensureCode(){ return code() || setCode(newCode()); }

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

function fetchRemote(c){
  return fetch(url(c), { method: "GET", cache: "no-store" })
    .then(r => { if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(d => (d && d.pilots) || {});
}
function putRemote(c, pilots){
  return fetch(url(c), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, pilots }),
  }).then(r => { if(!r.ok) throw new Error("HTTP " + r.status); return true; });
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

  const mine = SF.profile.snapshot();
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

/** Sync once at boot, so a device that was off catches up before anyone plays. */
function boot(){
  if(!configured() || !code()) { emit("off"); return; }
  sync();
}

SF.cloud = {
  configured, code, ensureCode, setCode, clearCode, newCode, formatCode, validCode,
  sync, touch, join, boot, onStatus,
  mergePilots, applyPilots,
  get status(){ return status; },
};
})();
