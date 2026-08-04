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

SOUNDS.bossAlarm = { minGap: 2500, fn: () => {
  // Two slow klaxon sweeps - dread, not panic.
  tone(320, 0.42, "sawtooth", 0.11, -140, 0);
  tone(320, 0.42, "sawtooth", 0.11, -140, 0.5);
} };

SOUNDS.flyoff = { minGap: 2000, fn: () => {
  // Engines opening up for the ride home: a long rising sweep over a rush of air.
  tone(140, 0.9, "sawtooth", 0.07, 560);
  noise(0.8, 0.16, 600, 5200);
} };

function play(name, arg){
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
  const old = musicEl;
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
    if(old && old !== musicEl){
      old.volume = Math.max(0, old.volume - 0.10);
      if(old.volume > 0) busy = true;
      else try { old.pause(); } catch(e){}
    }
    if(musicEl && !muted && musicOn && musicEl.volume < musicVol){
      musicEl.volume = Math.min(musicVol, musicEl.volume + 0.07);
      busy = true;
    }
    if(!busy){ clearInterval(fadeTimer); fadeTimer = null; }
  }, 70);
}


SF.audio = { init, play, isMuted, setMuted, setMusic,
             musicEnabled, setMusicEnabled, sfxEnabled, setSfxEnabled,
             MUSIC };   // the table is exported so the smoke test can verify every file exists
})();
