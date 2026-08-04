/*
 * Comms runtime: decides what gets said, when, and shuts up when the game is
 * busy shouting about something else.
 *
 * Rules that keep it from becoming noise:
 *  - one panel at a time, ~2.8s, then it slides out;
 *  - every event has its own cooldown, so a run of pick-ups says one thing;
 *  - a minimum gap between any two lines;
 *  - nothing is queued: if something better happens mid-line, it takes over.
 *
 * It holds no DOM and no ctx - the renderer asks it what to draw.
 */
(function(){
"use strict";
const SF = window.SF;
const { COMMS, fill } = SF.commsData;

const MIN_GAP = 1.4;      // seconds between any two lines
const SHOW_TIME = 2.8;

const state = {
  active: null,           // { text, speaker, name, color, levels, life, max }
  lastAt: {},             // event id -> sim time it last fired
  now: 0,
  vars: { you:"PILOT", mate:"" },
  self: null,             // { name, color, levels } - the pilot's own ship
  mate: null,             // { name, color, levels } - a squadmate, if any
  enabled: true,
};

/** Called at mission start with the flying profile and their squadmates. */
function begin(profile, crew){
  const art = SF.shipart;
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
  const last = state.lastAt[event];
  if(last != null && state.now - last < def.cooldown) return;
  if(state.active && state.active.life < MIN_GAP) return;
  // A "mate" line with nobody else in the house comes from control instead.
  const useMate = def.speaker === "mate" && !!state.mate;
  const who = useMate ? state.mate : null;
  const line = def.lines[Math.floor(Math.random()*def.lines.length)];
  state.lastAt[event] = state.now;
  state.active = {
    text: fill(line, Object.assign({}, state.vars, vars)),
    speaker: who ? who.name : "CONTROL",
    color: who ? who.color : "#7fc4ff",
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

SF.comms = { begin, say, update, clear, current, _state: state };
})();
