/*
 * Comms runtime: decides what gets said, when, and shuts up when the game is
 * busy shouting about something else.
 *
 * Rules that keep it from becoming noise:
 *  - one panel at a time, ~2.8s, then it slides out;
 *  - every event has its own cooldown, so a run of pick-ups says one thing;
 *  - a minimum gap between any two lines;
 *  - nothing is queued: if something better happens mid-line, it takes over;
 *  - on a phone it says nothing at all (see isPhone).
 *
 * It holds no DOM and no ctx - the renderer asks it what to draw.
 */
(function(){
"use strict";
const SF = window.SF;
const { COMMS, fill } = SF.commsData;

const MIN_GAP = 1.4;      // seconds between any two lines
const SHOW_TIME = 2.8;

/*
 * A phone is the one screen where this panel costs more than it gives.
 *
 * It has to live inside the flight envelope - there is no margin to put it in
 * - and on a ~390-wide field that corner is a sixth of the sky. So the ship
 * flies behind it, the panel ducks to a whisper to stay out of the way, and
 * the player is left with neither a readable line nor a clear view of the
 * thing they are steering. A tablet and a desktop have the room for both, and
 * keep talking.
 *
 * "Phone" is a touch device whose short edge is under 500px - the same
 * breakpoint the stylesheet already shrinks the special buttons at. Both
 * halves are load-bearing: an iPad mini is 744 across, so it stays talkative,
 * and a desktop window dragged narrow still has a mouse and can be dragged
 * back, so it is not a phone either.
 */
function isPhone(){
  try {
    if(!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) return false;
    const doc = document.documentElement;
    const vw = doc.clientWidth  || window.innerWidth  || 820;
    const vh = doc.clientHeight || window.innerHeight || 1100;
    return Math.min(vw, vh) < 500;
  } catch(e){ return false; }   // a browser that cannot answer keeps its comms
}

const state = {
  active: null,           // { text, speaker, name, color, levels, life, max }
  lastAt: {},             // event id -> sim time it last fired
  now: 0,
  vars: { you:"PILOT", mate:"" },
  self: null,             // { name, color, levels } - the pilot's own ship
  mate: null,             // { name, color, levels } - a squadmate, if any
  enabled: true,          // false on a phone - decided per mission in begin()
};

/** Called at mission start with the flying profile and their squadmates. */
function begin(profile, crew){
  const art = SF.shipart;
  // Asked per mission, not once at load: a desktop window can be resized and a
  // tablet rotated between one launch and the next.
  state.enabled = !isPhone();
  state.now = 0;
  state.lastAt = {};
  state.active = null;
  state.self = { name: profile.callsign || profile.name, color: profile.shipColor,
                 levels: art.levelsOf(profile),
                 pilot: { name: profile.name, avatar: profile.avatar, shipColor: profile.shipColor, badge: profile.badge } };
  const mate = (crew && crew[0]) || null;
  state.mate = mate ? { name: mate.callsign, color: mate.color, levels: mate.levels || {},
                        pilot: mate.pilot || null } : null;
  state.vars = { you: state.self.name, mate: state.mate ? state.mate.name : "" };
}

/**
 * Say something about `event`. Silently does nothing if the bucket is on
 * cooldown or another line is still fresh - callers fire freely and let the
 * pacing rules here decide.
 */
function say(event, vars){
  if(!state.enabled) return;
  const def = COMMS[event];
  if(!def || !state.self) return;
  /*
   * MISSION 0'S RADIO BELONGS TO PAPA. Generic control chatter ("lost the
   * chain", pickup callouts) talking over the story beats made the level
   * read as a normal mission with a voice-over fighting it. While the
   * prologue runs, control stays off the air entirely; the brothers may
   * banter through the flight check and the raid, but once the theft
   * starts, everyone but the workshop goes quiet - menace is silence.
   */
  if(SF.prologue && SF.prologue.active() && !/^prologue/.test(event)){
    const st = SF.prologue._s && SF.prologue._s();
    if(def.speaker === "control") return;
    if(def.speaker === "mate" && st && st.theftAt) return;
  }
  const last = state.lastAt[event];
  if(last != null && state.now - last < def.cooldown) return;
  if(state.active && state.active.life < MIN_GAP) return;
  // A "mate" line with nobody else in the house comes from control instead.
  const useMate = def.speaker === "mate" && !!state.mate;
  // The workshop is Papa's bench on the ground - control-shaped, but with
  // its own name and the workbench gold, so Mission 0's voice reads as
  // family rather than air traffic. Translated here because the panel is
  // canvas text, which the DOM sweep can never reach.
  const isWorkshop = def.speaker === "workshop";
  const who = useMate ? state.mate : null;
  const line = def.lines[Math.floor(Math.random()*def.lines.length)];
  state.lastAt[event] = state.now;
  state.active = {
    text: fill(line, Object.assign({}, state.vars, vars)),
    speaker: who ? who.name : (isWorkshop && SF.i18n ? SF.i18n.t("WORKSHOP") : isWorkshop ? "WORKSHOP" : "CONTROL"),
    color: who ? who.color : (isWorkshop ? "#ffd23f" : "#7fc4ff"),
    levels: who ? who.levels : state.self.levels,
    shipColor: who ? who.color : state.self.color,
    pilot: who ? (who.pilot || null) : state.self.pilot,
    isControl: !who,
    life: 0, max: SHOW_TIME,
  };
}

function update(dt){
  state.now += dt;
  const a = state.active;
  if(a){
    a.life += dt;
    if(a.life >= a.max) state.active = null;
  }
}

function clear(){ state.active = null; }
function current(){ return state.active; }

SF.comms = { begin, say, update, clear, current, isPhone, _state: state };
})();
