/*
 * AudioManager.
 *
 * Effects are synthesised at runtime; music is real recordings (see the MUSIC
 * section). Every gameplay system talks to it through named hooks -
 * `SF.audio.play("enemyExplode")`, `SF.audio.setMusic("combat")` - so adding
 * or retuning a sound never means touching gameplay code.
 *
 * Two rules learned the hard way:
 *  - Automatic guns fire several times a second, so shot sounds are quiet,
 *    short, detuned and rate-limited. Impacts carry the punch instead.
 *  - iOS starts the audio context suspended and only resumes it inside a real
 *    user gesture, so every tap gets a chance to unlock it.
 *
 * These named hooks are also where haptics hang off - see the fan-out in
 * `play()` and the header of haptics.js. One named event is one moment of
 * feedback, and gameplay code shouldn't have to know how many output channels
 * the device it's running on happens to have.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, rand } = SF.core;

let ctx = null;
let master = null;
// The old key is still read once so the game doesn't come back unmuted for
// anyone who silenced it before the rename.
let muted = (localStorage.getItem("patrol_muted") ||
             localStorage.getItem("novawing_muted") ||
             localStorage.getItem("skyforce_muted")) === "1";
// Finer switches than the master mute, for the settings screen: music and
// effects each have their own persisted toggle. Stored inverted ("_off") so a
// missing key - every existing device - means ON.
let musicOn = localStorage.getItem("patrol_music_off") !== "1";
let sfxOn   = localStorage.getItem("patrol_sfx_off") !== "1";
const lastPlayed = Object.create(null); // per-sound rate limiting

function init(){
  if(!ctx){
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    } catch(e){ ctx = null; }
  }
  if(ctx && ctx.state === "suspended" && ctx.resume) ctx.resume();
  // Music blocked by autoplay rules gets another chance on every gesture.
  tryPlay();
}

function isMuted(){ return muted; }
function setMuted(v){
  muted = !!v;
  localStorage.setItem("patrol_muted", muted ? "1" : "0");
  applyMusicState();
}
function musicEnabled(){ return musicOn; }
function setMusicEnabled(v){
  musicOn = !!v;
  localStorage.setItem("patrol_music_off", musicOn ? "0" : "1");
  applyMusicState();
}
function sfxEnabled(){ return sfxOn; }
function setSfxEnabled(v){
  sfxOn = !!v;
  localStorage.setItem("patrol_sfx_off", sfxOn ? "0" : "1");
}

/** One oscillator blip. `glide` bends the pitch over the note's life. */
function tone(freq, dur, type, gain, glide, delay){
  if(!ctx || muted) return;
  const t0 = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || "square";
  osc.frequency.setValueAtTime(freq, t0);
  if(glide) osc.frequency.exponentialRampToValueAtTime(Math.max(glide, 1), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

/** Filtered white noise - the body of every explosion. */
function noise(dur, gain, filterFrom, filterTo, delay){
  if(!ctx || muted) return;
  const t0 = ctx.currentTime + (delay || 0);
  const frames = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for(let i = 0; i < frames; i++) data[i] = (Math.random()*2 - 1) * (1 - i/frames);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFrom, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(filterTo, 40), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t0);
}

/*
 * The sound table. `minGap` is the rate limit in ms; `fn` receives an optional
 * intensity/level argument from the caller so the same hook can get meatier as
 * the player's weapons scale up.
 */
const SOUNDS = {
  // Guns: deliberately small. `power` (0..1) makes heavier weapons sound heavier.
  shoot: { minGap: 110, fn: (power) => {
    const p = clamp(power || 0, 0, 1);
    tone(560 - p*140 + rand(-30, 30), 0.035 + p*0.02, "triangle", 0.014 + p*0.012, 340 - p*90);
  }},
  shootHeavy: { minGap: 140, fn: () => { tone(220, 0.07, "sawtooth", 0.03, 120); }},

  hitArmour:  { minGap: 45, fn: () => { tone(rand(900,1100), 0.03, "square", 0.02, 500); }},
  enemyExplode: { minGap: 35, fn: (big) => {
    noise(big ? 0.34 : 0.2, big ? 0.32 : 0.2, big ? 1400 : 2200, 90);
    tone(big ? 150 : 240, big ? 0.26 : 0.16, "sawtooth", 0.055, big ? 40 : 70);
  }},
  bossHit:    { minGap: 40, fn: () => { tone(rand(300,380), 0.05, "square", 0.03, 160); }},
  bossPhase:  { minGap: 500, fn: () => {
    [180, 240, 300].forEach((f,i) => tone(f, 0.3, "sawtooth", 0.08, f*0.6, i*0.09));
    noise(0.5, 0.25, 1200, 80);
  }},
  bossExplode:{ minGap: 400, fn: () => {
    noise(0.9, 0.45, 1800, 60);
    [392, 494, 587, 784, 988].forEach((f,i) => tone(f, 0.18, "triangle", 0.09, null, i*0.09));
  }},
  playerHit:  { minGap: 120, fn: () => { noise(0.28, 0.3, 900, 60); tone(150, 0.22, "sawtooth", 0.08, 55); }},
  shieldBreak:{ minGap: 120, fn: () => { tone(760, 0.22, "sine", 0.07, 180); noise(0.18, 0.14, 2600, 400); }},
  pickup:     { minGap: 60, fn: () => { [660, 880, 1180].forEach((f,i) => tone(f, 0.07, "square", 0.05, null, i*0.045)); }},
  rescue:     { minGap: 60, fn: () => { [523, 659, 784, 1046].forEach((f,i) => tone(f, 0.11, "sine", 0.06, null, i*0.06)); }},
  coin:       { minGap: 30, fn: () => { tone(rand(1000,1250), 0.05, "square", 0.028, 1600); }},
  bomb:       { minGap: 300, fn: () => { noise(0.8, 0.5, 2400, 50); tone(70, 0.6, "sawtooth", 0.12, 24); }},
  overdrive:  { minGap: 300, fn: () => { [330,440,554,660].forEach((f,i)=>tone(f,0.16,"sawtooth",0.06,null,i*0.05)); }},
  combo:      { minGap: 60, fn: (n) => { tone(480 + Math.min(n||0, 20)*26, 0.05, "square", 0.035); }},
  waveClear:  { minGap: 300, fn: () => { [392,523,659].forEach((f,i)=>tone(f,0.1,"triangle",0.055,null,i*0.06)); }},
  missionWin: { minGap: 800, fn: () => { [523,659,784,1046,1318].forEach((f,i)=>tone(f,0.22,"triangle",0.075,null,i*0.11)); }},
  missionFail:{ minGap: 800, fn: () => { [392,330,262,196].forEach((f,i)=>tone(f,0.3,"sawtooth",0.075,null,i*0.16)); }},
  alarm:      { minGap: 400, fn: () => { [220,180,220,180].forEach((f,i)=>tone(f,0.17,"sawtooth",0.075,null,i*0.2)); }},
  telegraph:  { minGap: 120, fn: () => { tone(1200, 0.08, "sine", 0.03, 1500); }},
  achievement:{ minGap: 300, fn: () => { [660,880,1108,1318].forEach((f,i)=>tone(f,0.11,"sine",0.06,null,i*0.075)); }},
  uiClick:    { minGap: 40, fn: () => { tone(660, 0.04, "square", 0.03, 880); }},
  uiBuy:      { minGap: 80, fn: () => { [523,784,1046].forEach((f,i)=>tone(f,0.09,"square",0.05,null,i*0.05)); }},
  star:       { minGap: 90, fn: (n) => { tone(700 + (n||0)*180, 0.16, "triangle", 0.07, null); }},
};

SOUNDS.chargeWind = { minGap: 700, fn: () => {
  // Engines spooling for a ram: a rising whine.
  tone(120, 0.55, "sawtooth", 0.07, 640);
} };
SOUNDS.chargeHit = { minGap: 500, fn: () => {
  noise(0.45, 0.3, 1400, 70);
  tone(70, 0.4, "square", 0.1, 34);
} };

SOUNDS.armourClang = { minGap: 90, fn: () => {
  // A dead, ringing clang: the sound of a shot that did nothing.
  tone(rand(1500,1800), 0.05, "square", 0.022, 700);
  noise(0.05, 0.05, 4000, 1200);
} };
SOUNDS.coreExposed = { minGap: 900, fn: () => {
  // Armour off: a bright unlocking chord.
  [330, 440, 554, 740, 880].forEach((f,i) => tone(f, 0.3, "triangle", 0.07, null, i*0.06));
  noise(0.5, 0.16, 3000, 300);
} };

SOUNDS.bossAlarm = { minGap: 2500, fn: () => {
  // Two slow klaxon sweeps - dread, not panic.
  tone(320, 0.42, "sawtooth", 0.11, -140, 0);
  tone(320, 0.42, "sawtooth", 0.11, -140, 0.5);
} };

SOUNDS.gust = { minGap: 1200, fn: () => {
  // The Storm's shove: a broadband whoosh that sweeps down as it passes.
  noise(1.6, 0.14, 2600, 300);
  tone(90, 1.2, "sine", 0.05, 60);
} };

SOUNDS.supplyDrop = { minGap: 1500, fn: () => {
  // The "look up!" ping: two bright descending chimes, like something
  // valuable falling into the level.
  [1318, 880].forEach((f,i) => tone(f, 0.22, "sine", 0.07, f*0.7, i*0.16));
} };

SOUNDS.supplyGet = { minGap: 400, fn: () => {
  // Bigger than any powerup: a rising major fanfare with a shimmer on top.
  [392, 523, 659, 784].forEach((f,i) => tone(f, 0.16, "triangle", 0.08, null, i*0.07));
  tone(2093, 0.12, "sine", 0.045, null, 0.3);
  noise(0.12, 0.06, 5000, 900, 0.28);
} };

/* ---------------------------------------------------------
   KING PAPA
   The only cartoon sounds in the game. Everything else here
   is sci-fi; this shelf is boings, raspberries and slide
   whistles, because the Star Vault is a joke and jokes need
   the right noises.
   --------------------------------------------------------- */
SOUNDS.papaOw = { minGap: 300, fn: () => {
  // A comedy "ow": a squashed rising honk.
  tone(300, 0.16, "square", 0.09, 620);
  tone(180, 0.22, "triangle", 0.06, 420);
} };
SOUNDS.papaPop = { minGap: 300, fn: () => {
  // Balloon pop: a click and a short pitch drop.
  noise(0.09, 0.34, 6000, 400);
  tone(900, 0.10, "square", 0.08, 90);
} };
SOUNDS.papaBack = { minGap: 300, fn: () => {
  // The comeback: a rising slide whistle, silly rather than scary.
  tone(220, 0.6, "sine", 0.10, 1500);
  tone(330, 0.5, "triangle", 0.05, 1800, 0.05);
} };
SOUNDS.papaRaspberry = { minGap: 200, fn: () => {
  // The let-go balloon. Buzzy, wobbling, descending, undignified.
  for(let i = 0; i < 9; i++)
    tone(rand(150, 260) - i*8, 0.12, "sawtooth", 0.055, rand(90, 180), i*0.075);
  noise(0.75, 0.09, 900, 250);
} };
SOUNDS.papaBoing = { minGap: 70, fn: () => {
  tone(rand(500, 780), 0.13, "sine", 0.055, rand(170, 260));
} };
SOUNDS.papaSplit = { minGap: 300, fn: () => {
  // One becomes five: a bright arpeggio going up.
  [523, 659, 784, 988, 1318].forEach((f,i) => tone(f, 0.12, "square", 0.055, null, i*0.06));
} };
SOUNDS.papaMerge = { minGap: 300, fn: () => {
  // Sucked back together: a descending swoop.
  tone(1200, 0.55, "sine", 0.08, 160);
  noise(0.5, 0.06, 2600, 300);
} };
SOUNDS.papaWink = { minGap: 300, fn: () => {
  // The beat before the bang: two cheeky ticks.
  tone(1600, 0.05, "square", 0.05, 2000);
  tone(2000, 0.05, "square", 0.04, 2400, 0.09);
} };
SOUNDS.papaKaboom = { minGap: 500, fn: () => {
  // Enormous and daft at once: sub-bass under a party fanfare.
  tone(42, 1.5, "sawtooth", 0.16, 26);
  noise(1.4, 0.4, 3000, 60);
  [523, 659, 784, 1046, 1318, 1568].forEach((f,i) =>
    tone(f, 0.30, "triangle", 0.075, null, 0.25 + i*0.09));
} };

/* ---------------------------------------------------------
   BOSS ARRIVALS
   Every boss enters with a three-beat cinematic (bossintro.js).
   These are its cues - deliberately shorter and pitched a full
   octave or two above the Devourer's, so when the finale drops
   into sub-bass the player FEELS that this one is different.
   --------------------------------------------------------- */
SOUNDS.bossWake = { minGap: 3000, fn: () => {
  // The dimming: a low swell with an uneasy minor second on top.
  tone(55, 1.4, "sine", 0.16, 45);
  tone(116, 1.2, "sawtooth", 0.04, 62);
  noise(1.2, 0.05, 500, 90);
} };
SOUNDS.bossRise = { minGap: 2500, fn: () => {
  // Machinery coming down: a grinding descent, lighter than the finale's.
  tone(68, 2.0, "sawtooth", 0.09, 90);
  tone(104, 1.8, "square", 0.035, 130);
  noise(1.8, 0.09, 380, 1200);
} };
SOUNDS.bossRoar = { minGap: 2500, fn: () => {
  // The name card hit: a two-octave blare, over in a second.
  [82, 164].forEach(f => tone(f, 1.0, "sawtooth", 0.11, f*0.94));
  tone(76, 1.1, "square", 0.06, 58);
  noise(0.8, 0.2, 1500, 80);
} };

/* ---------------------------------------------------------
   THE DEVOURER
   Exclusive cues. Everything here sits lower and longer than
   the rest of the game's palette - the finale should sound
   like a bigger room.
   --------------------------------------------------------- */
SOUNDS.devourerWake = { minGap: 4000, fn: () => {
  // Sub-bass swell out of nothing: the sound of the lights going out.
  tone(28, 2.6, "sine", 0.26, 20);
  tone(41, 2.2, "sawtooth", 0.05, 30);
  noise(2.4, 0.06, 300, 40);
} };
SOUNDS.devourerRise = { minGap: 3000, fn: () => {
  // Vast machinery moving: a slow grinding descent.
  tone(34, 3.2, "sawtooth", 0.13, 52);
  tone(52, 3.0, "square", 0.05, 78);
  noise(3.0, 0.13, 220, 900);
} };
SOUNDS.devourerPower = { minGap: 2500, fn: () => {
  // Systems coming online, one bank at a time.
  [110, 147, 185, 220, 294].forEach((f, i) =>
    tone(f, 0.5, "triangle", 0.05, f*1.5, i*0.34));
  noise(1.8, 0.08, 600, 3000);
} };
SOUNDS.devourerRoar = { minGap: 3000, fn: () => {
  // The name card hit: a detuned three-octave blare.
  [41, 82, 164].forEach(f => tone(f, 1.5, "sawtooth", 0.13, f*0.94));
  tone(38, 1.6, "square", 0.08, 30);
  noise(1.2, 0.3, 1800, 60);
} };
SOUNDS.devourerCharge = { minGap: 300, fn: () => {
  tone(180, 0.75, "sawtooth", 0.055, 620);
  noise(0.6, 0.06, 400, 2600);
} };
SOUNDS.laneFire = { minGap: 250, fn: () => {
  noise(0.5, 0.3, 3200, 120);
  tone(120, 0.4, "sawtooth", 0.09, 44);
} };
SOUNDS.clawGroan = { minGap: 700, fn: () => {
  tone(62, 1.1, "sawtooth", 0.10, 38);
  noise(0.9, 0.09, 500, 130);
} };
SOUNDS.clawSlam = { minGap: 500, fn: () => {
  noise(0.4, 0.34, 900, 60);
  tone(52, 0.5, "square", 0.12, 26);
} };
SOUNDS.hangarOpen = { minGap: 700, fn: () => {
  noise(0.7, 0.16, 1400, 260);
  [74, 98].forEach((f,i) => tone(f, 0.5, "square", 0.06, f*1.4, i*0.12));
} };
SOUNDS.novaBurn = { minGap: 400, fn: () => {
  noise(1.0, 0.34, 5200, 200);
  tone(220, 0.8, "sawtooth", 0.07, 60);
} };
SOUNDS.lanceCharge = { minGap: 600, fn: () => {
  tone(90, 1.5, "sawtooth", 0.09, 900);
  noise(1.4, 0.09, 300, 4200);
} };
SOUNDS.lanceFire = { minGap: 500, fn: () => {
  noise(1.1, 0.42, 6000, 140);
  tone(70, 1.0, "sawtooth", 0.16, 30);
  tone(140, 0.8, "square", 0.07, 44);
} };
SOUNDS.fleetArrive = { minGap: 3000, fn: () => {
  // The cavalry: a bright rising major fanfare, wide and warm.
  [392, 523, 659, 784, 1046].forEach((f,i) => tone(f, 0.5, "triangle", 0.075, null, i*0.1));
  [196, 262].forEach((f,i) => tone(f, 1.2, "sine", 0.06, null, i*0.1));
} };
SOUNDS.devourerDeath = { minGap: 4000, fn: () => {
  [41, 55, 82].forEach((f,i) => tone(f, 2.0, "sawtooth", 0.11, f*0.55, i*0.1));
  noise(2.2, 0.22, 1600, 50);
} };
SOUNDS.devourerImplode = { minGap: 3000, fn: () => {
  // The held breath: a rising whine that stops dead.
  tone(60, 1.3, "sawtooth", 0.12, 1800);
  noise(1.3, 0.14, 200, 5200);
} };
SOUNDS.devourerFinalBlast = { minGap: 4000, fn: () => {
  // Bigger than megaBoom, and layered under it.
  tone(30, 2.4, "sine", 0.3, 18);
  tone(60, 1.6, "sawtooth", 0.14, 24);
  noise(2.6, 0.55, 4000, 30);
  [262, 330, 392, 523, 659, 784].forEach((f,i) =>
    tone(f, 0.6, "triangle", 0.06, null, 0.9 + i*0.11));
} };

SOUNDS.tractor = { minGap: 900, fn: () => {
  // The Jailer's beam: a low warbling drone, more grip than gun.
  [82, 110, 82].forEach((f,i) => tone(f, 0.42, "sawtooth", 0.07, f*1.4, i*0.3));
} };

SOUNDS.megaBoom = { minGap: 1500, fn: () => {
  // The final boss blast: a sub-bass swell under a long roar of air - felt
  // as much as heard, and bigger than anything else in the game.
  tone(45, 1.1, "sine", 0.22, 28);
  tone(90, 0.7, "sawtooth", 0.09, 40);
  noise(1.3, 0.5, 2600, 40);
  [523, 659, 784].forEach((f,i) => tone(f, 0.2, "triangle", 0.05, null, 0.5 + i*0.12));
} };

SOUNDS.firework = { minGap: 90, fn: () => {
  // A pop and a fizz of glitter, quiet enough to salvo.
  noise(0.1, 0.09, 4200, 500);
  tone(rand(680, 980), 0.24, "sine", 0.018, 220, 0.03);
} };

SOUNDS.victory = { minGap: 2000, fn: () => {
  // The AREA CLEAR fanfare: a rising major arpeggio with a sparkle on top -
  // brighter than waveClear, smaller than missionWin.
  [523, 659, 784, 1046].forEach((f,i) => tone(f, 0.16, "triangle", 0.07, null, i*0.09));
  [2093, 2637].forEach((f,i) => tone(f, 0.10, "sine", 0.035, null, 0.36 + i*0.07));
} };

/* The tape running backwards: a falling sweep under a reversed rush of air. */
SOUNDS.rewind = { minGap: 900, fn: () => {
  tone(880, 0.42, "sine", 0.05, 180);
  noise(0.40, 0.10, 4200, 700);
} };

SOUNDS.flyoff = { minGap: 2000, fn: () => {
  // Engines opening up for the ride home: a long rising sweep over a rush of air.
  tone(140, 0.9, "sawtooth", 0.07, 560);
  noise(0.8, 0.16, 600, 5200);
} };

function play(name, arg){
  // The same event drives the vibration motor. Deliberately above the guards
  // below: rumble is its own setting, so a game played with the sound off - as
  // most of them are - is still felt.
  if(SF.haptics) SF.haptics.play(name, arg);
  if(!ctx || muted || !sfxOn) return;
  const s = SOUNDS[name];
  if(!s) return;
  const now = ctx.currentTime * 1000;
  if(now - (lastPlayed[name] || -9999) < s.minGap) return;
  lastPlayed[name] = now;
  try { s.fn(arg); } catch(e){ /* never let audio break a frame */ }
}

// Any first interaction anywhere counts as the gesture that unlocks audio.
["pointerdown","touchstart","keydown"].forEach(evt =>
  window.addEventListener(evt, init, { passive: true }));

/* ---------------------------------------------------------
   MUSIC
   Real recordings now (assets/music/*.mp3 - MP3, because the
   iPads run Safari and Safari won't play OGG). The customer
   supplied the tracks copyright-free; the synthesized score
   this replaced lives in git history.

   The game keeps talking in logical names - setMusic("menu"),
   "combat", "boss" - and this layer picks a file: combat owns
   several songs and rotates one per mission so back-to-back
   flights don't repeat, and "defeat" plays once then hands
   over to the menu theme.
   --------------------------------------------------------- */
const MUSIC = {
  title:  { files: ["title"],  vol: 0.55 },   // the pilot picker fanfare
  menu:   { files: ["menu"],   vol: 0.50 },
  combat: { files: ["combat-1", "combat-2", "combat-3"], vol: 0.60 },
  boss:   { files: ["boss"],   vol: 0.68 },
  defeat: { files: ["defeat"], vol: 0.60, once: true, then: "menu" },
};
let musicTrack = null;        // logical name currently asked for
let musicEl = null;           // the <audio> actually sounding
let musicVol = 0;             // its target volume
const musicEls = {};          // file key -> HTMLAudio, made once, reused
const rotation = {};          // logical name -> which file plays next
let fadeTimer = null;

function elFor(key){
  let el = musicEls[key];
  if(!el){
    try {
      el = new Audio("assets/music/" + key + ".mp3");
      el.preload = "auto";
    } catch(e){ return null; }
    musicEls[key] = el;
  }
  return el;
}

/*
 * Everything that is NOT the current track, i.e. everything that has to end up
 * silent.
 *
 * This exists because of "two musics playing at the same time". setMusic()
 * used to capture a single `old` element to fade out, and every call clears
 * the running fade timer - so a switch that landed while a fade was still
 * going killed the timer that was fading the PREVIOUS track down and left it
 * sounding forever, at whatever volume it had reached. menu -> combat -> boss,
 * which is just launching into a boss mission, was enough to do it: reproduced
 * with the menu theme stranded at 0.07 under the boss theme at 0.68.
 *
 * Fading one element was always going to be a guess about how many were
 * playing. The registry knows, so ask it.
 */
function otherTracks(){
  const out = [];
  for(const k in musicEls){
    const e = musicEls[k];
    if(e && e !== musicEl) out.push(e);
  }
  return out;
}

/** Try to sound the current element. Autoplay rules may refuse before the
    first tap - init() retries on every gesture, so it recovers by itself. */
function tryPlay(){
  if(!musicEl || muted || !musicOn) return;
  try {
    const pr = musicEl.play();
    if(pr && pr.catch) pr.catch(() => {});
  } catch(e){ /* jsdom, or autoplay refusal - a later gesture retries */ }
}

/** Pause/resume to match the mute + music switches, without losing place.
    A hidden tab counts as "off" too - background music from a page nobody is
    looking at is how a game gets force-closed. */
function applyMusicState(){
  // Whatever state we are moving into, nothing but the current track may be
  // sounding: a stranded element would otherwise play straight through a mute,
  // a music-off switch and a backgrounded app.
  otherTracks().forEach(e => { try { e.pause(); } catch(err){} });
  if(!musicEl) return;
  if(muted || !musicOn || document.hidden){
    try { musicEl.pause(); } catch(e){}
  } else {
    musicEl.volume = musicVol;
    tryPlay();
  }
}
document.addEventListener("visibilitychange", applyMusicState);

/** Switches the soundtrack: a logical name, or null for silence. The old
    song fades down while the new one fades up. */
function setMusic(name){
  if(name === musicTrack) return;
  musicTrack = name;
  musicEl = null;
  const def = name && MUSIC[name];
  if(def){
    const ix = (rotation[name] || 0) % def.files.length;
    rotation[name] = ix + 1;
    const el = elFor(def.files[ix]);
    if(el){
      el.loop = !def.once;
      el.onended = def.once ? () => {
        if(musicTrack === name){ musicTrack = null; setMusic(def.then || null); }
      } : null;
      try { el.currentTime = 0; } catch(e){}
      el.volume = 0;
      musicEl = el;
      musicVol = def.vol;
      tryPlay();
    }
  }
  if(fadeTimer) clearInterval(fadeTimer);
  fadeTimer = setInterval(() => {
    let busy = false;
    // Every outgoing track, not just the one this call happened to displace.
    otherTracks().forEach(e => {
      if(e.paused) return;
      e.volume = Math.max(0, e.volume - 0.10);
      if(e.volume > 0) busy = true;
      else try { e.pause(); } catch(err){}
    });
    if(musicEl && !muted && musicOn && musicEl.volume < musicVol){
      musicEl.volume = Math.min(musicVol, musicEl.volume + 0.07);
      busy = true;
    }
    if(!busy){ clearInterval(fadeTimer); fadeTimer = null; }
  }, 70);
}


SF.audio = { init, play, isMuted, setMuted, setMusic,
             musicEnabled, setMusicEnabled, sfxEnabled, setSfxEnabled,
             // Both tables are exported for the smoke test: MUSIC so it can
             // verify every file exists, SOUNDS so it can check no rumble is
             // keyed to an event that doesn't exist.
             MUSIC, _sounds: SOUNDS };
})();
