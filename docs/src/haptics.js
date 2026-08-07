/*
 * Haptics.
 *
 * A tablet has three output channels and the game only used two. The third one
 * earns its place here for a reason specific to these players: the sound is
 * usually off. It gets muted in the car, at the table, in the room next to a
 * sleeping sibling. Rumble is the only feedback that survives that, and for a
 * kid holding the iPad it does something a screen and a speaker can't - it puts
 * the hit in their hands.
 *
 * Three rules this file exists to enforce:
 *
 *  - Not every sound deserves a buzz. Guns fire four times a second; a motor
 *    running that fast is a continuous rattle that means nothing and eats the
 *    battery. Only events a kid would say out loud ("I got hit", "I got the
 *    shield", "I killed it") are in the table below, and the frequencies were
 *    measured off a real mission rather than guessed - see DESIGN.md 8e.
 *  - The Vibration API has no amplitude control, only duration and rhythm, so
 *    "heavier" has to be spelled as a longer pulse or a pattern, never a
 *    stronger one.
 *  - Nothing here may throw. A vibration failing is not a reason for a frame
 *    to die.
 *
 * Events arrive through SF.audio.play() rather than through their own call
 * sites: gameplay code already names every moment worth reacting to, and
 * threading a second set of calls through a dozen files would guarantee a table
 * that drifts the first time someone adds a sound. One named event is one
 * moment of feedback; how many channels it comes out of is the device's
 * business. See the fan-out at the top of audio.js's play().
 *
 * Support is re-checked on every call rather than cached at load, so the smoke
 * test can install a recording stub and assert on what the game actually asked
 * the motor for. It matters here: iOS Safari implements no Vibration API at
 * all, so on the family's iPads every call below is a no-op and the settings
 * row says so instead of pretending.
 */
(function(){
"use strict";
const SF = window.SF;

// Stored inverted ("_off") to match the sound and shake switches: a missing key
// - every device that already has the game - means ON.
let enabled = localStorage.getItem("patrol_haptics_off") !== "1";
let lastAny = -9999;                        // global floor, see FLOOR_MS
const lastPlayed = Object.create(null);     // per-event rate limiting

/*
 * Calls don't queue - a new vibrate() cancels whatever is still running - so
 * without a global floor a burst of events truncates itself into one flat
 * smear. A smart bomb killing fifteen things at once should feel like the bomb,
 * not like fifteen kills fighting over the motor. 45ms is far enough apart that
 * two pulses still read as two.
 */
const FLOOR_MS = 45;

/*
 * The table. `pattern` is a duration in ms, an [on, off, on, ...] array, or a
 * function of the same argument the sound got, returning one of those or null
 * to stay silent. `minGap` is this event's own rate limit in ms.
 */
const PATTERNS = {
  // Damage. The one thing that must always be felt, so it gets the longest
  // single pulse in the game - nothing else is a flat 45ms.
  playerHit:   { minGap: 140, pattern: 45 },
  shieldBreak: { minGap: 140, pattern: [22, 40, 22] },

  // Killing things is the core loop, so this is the one event felt
  // continuously rather than as punctuation. `big` is the same flag the sound
  // uses to pick the heavy body, so the two channels agree by construction.
  enemyExplode:{ minGap: 70,  pattern: (big) => big ? 20 : 10 },

  // Rewards: short taps. They land while the player is still flying and
  // shouldn't compete with whatever hits them next.
  pickup:      { minGap: 110, pattern: 12 },
  supplyGet:   { minGap: 140, pattern: [14, 40, 20] },
  rescue:      { minGap: 140, pattern: [14, 45, 14] },
  star:        { minGap: 140, pattern: 18 },
  achievement: { minGap: 400, pattern: [18, 40, 18, 40, 45] },

  // Abilities. The only events the player caused on purpose by pressing
  // something, so they get the meatiest patterns - a button that clears the
  // screen should feel like it did.
  bomb:        { minGap: 300, pattern: [70, 40, 30] },
  overdrive:   { minGap: 300, pattern: [18, 30, 18, 30, 40] },

  // Bosses: arrival, the turn of each phase, armour coming off, and the kill.
  // The beats of the fight, not the exchange of fire inside it.
  bossWake:    { minGap: 500, pattern: [30, 60, 45] },
  bossRoar:    { minGap: 500, pattern: [40, 50, 60] },
  bossPhase:   { minGap: 500, pattern: [35, 55, 35] },
  coreExposed: { minGap: 500, pattern: [20, 40, 20, 40, 50] },
  bossExplode: { minGap: 400, pattern: [50, 45, 35, 45, 90] },
  chargeHit:   { minGap: 400, pattern: [40, 40, 40] },
  bossAlarm:   { minGap: 500, pattern: [28, 40, 28] },
  alarm:       { minGap: 400, pattern: [28, 40, 28] },

  // The finale gets its own beats: it is the one fight built as a set piece.
  devourerWake:      { minGap: 700, pattern: [35, 60, 35, 60, 70] },
  devourerRoar:      { minGap: 700, pattern: [45, 50, 70] },
  devourerDeath:     { minGap: 700, pattern: [60, 50, 45, 50, 100] },
  devourerFinalBlast:{ minGap: 700, pattern: [80, 60, 100] },
  megaBoom:    { minGap: 400, pattern: [60, 45, 45] },

  // End of a run.
  waveClear:   { minGap: 300, pattern: 14 },
  missionWin:  { minGap: 800, pattern: [25, 55, 25, 55, 70] },
  missionFail: { minGap: 800, pattern: [60, 70, 60] },
  victory:     { minGap: 800, pattern: [25, 55, 25, 55, 70] },

  // Menus: a tick you feel under the thumb, not one you notice as a buzz.
  uiClick:     { minGap: 60,  pattern: 8 },
  uiBuy:       { minGap: 140, pattern: [10, 30, 10] },
};

/*
 * Deliberately absent. Measured over real missions (the smoke test prints the
 * hook tally it was tuned against), these either fire faster than a motor can
 * say anything distinct, or land on a moment something else already covers:
 *   shoot, shootHeavy       4/s, and auto-fire means the player didn't even ask
 *   hitArmour, bossHit,
 *   armourClang             every bullet that lands on something tough
 *   telegraph, laneFire,
 *   chargeWind, lanceFire   wind-ups and patterns, several a second in a fight
 *   coin, combo             they trail the kill that caused them, whose own
 *                           tick has already fired by the time they arrive
 *   papa*                   KING PAPA is a comedy routine; the joke is the
 *                           sound, and buzzing through it would flatten it
 */

function supported(){
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}
function isEnabled(){ return enabled; }
function setEnabled(v){
  enabled = !!v;
  localStorage.setItem("patrol_haptics_off", enabled ? "0" : "1");
  if(!enabled) stop();
}
function stop(){
  if(!supported()) return;
  try { navigator.vibrate(0); } catch(e){ /* never let a motor break a frame */ }
}

/**
 * Fires the pattern registered for `name`, if there is one.
 * @param {string} name the same event name the sound table uses
 * @param {*} arg the same argument the sound got (e.g. `big` for explosions)
 * @returns {number|number[]|null} what was sent to the motor, or null
 */
function play(name, arg){
  if(!enabled || !supported()) return null;
  // A buzz from a backgrounded tab is a phone going off in a pocket.
  if(typeof document !== "undefined" && document.hidden) return null;
  const p = PATTERNS[name];
  if(!p) return null;

  const now = performance.now();
  if(now - (lastPlayed[name] || -9999) < p.minGap) return null;
  if(now - lastAny < FLOOR_MS) return null;

  const pattern = typeof p.pattern === "function" ? p.pattern(arg) : p.pattern;
  if(pattern === null || pattern === undefined) return null;

  lastPlayed[name] = now;
  lastAny = now;
  try { navigator.vibrate(pattern); } catch(e){ return null; }
  return pattern;
}

// A long pattern shouldn't outlive the tab that started it.
if(typeof document !== "undefined"){
  document.addEventListener("visibilitychange", () => { if(document.hidden) stop(); });
}

SF.haptics = { play, stop, supported, isEnabled, setEnabled, _patterns: PATTERNS };
})();
