/*
 * AudioManager.
 *
 * Every sound is synthesised at runtime (no audio files to download, nothing
 * to license) and every gameplay system talks to it through named hooks -
 * `SF.audio.play("enemyExplode")` - so adding or retuning a sound never means
 * touching gameplay code.
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
}

function isMuted(){ return muted; }
function setMuted(v){
  muted = !!v;
  localStorage.setItem("patrol_muted", muted ? "1" : "0");
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

function play(name, arg){
  if(!ctx || muted) return;
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
   Two loops sequenced from the same oscillators as the SFX -
   no files, nothing to download, and the mute button already
   gates it because everything routes through `master`.

   A lookahead scheduler (the standard WebAudio pattern): a
   coarse timer wakes every 120ms and schedules every step
   that falls inside the next quarter second at sample-exact
   times, so the groove never wobbles with the main thread.
   --------------------------------------------------------- */
let musicGain = null, musicTimer = null, musicTrack = null;
let musicStep = 0, musicNext = 0, noiseBuf = null;

/* Minor pentatonic on A - everything in it sounds fine together, which is
   what lets a tiny pattern loop for minutes without grating. */
const PENT = [0, 3, 5, 7, 10, 12, 15, 17];
const hz = (root, semi) => root * Math.pow(2, semi/12);

const TRACKS = {
  /*
   * Repetition was the first review note, so every track is a SONG now, not a
   * bar: a chord progression (roots in semitones over A), patterns that
   * alternate by section, scheduled rests, and a touch of velocity jitter so
   * no two passes sound machine-identical.
   */

  /* Menus: slow i-VI-iv-III drift, arp contour changes with each chord,
     every fourth cycle sits out a bar to let the drone breathe. */
  menu: {
    bpm: 72, div: 2,
    step(i, t){
      const CH = [0, 8, 5, 3];                       // A F D C
      const root = CH[Math.floor(i/16) % CH.length];
      const cycle = Math.floor(i/64) % 4;
      const restBar = cycle === 3 && (i % 64) < 8;   // a held breath
      if(i % 16 === 0) note(hz(55, root), "sine", 0.050, 3.6, t, 400);
      if(i % 16 === 8) note(hz(55, root + 7), "sine", 0.032, 3.0, t, 400);
      if(restBar) return;
      const CONTOURS = [[0,2,4,6,4,2],[4,2,0,2,6,4],[0,4,2,6,4,7],[6,4,2,0,2,4]];
      const arp = CONTOURS[Math.floor(i/16) % 4][(i>>1) % 6];
      if(i % 2 === 0) note(hz(220, root + PENT[arp % 8]), "triangle", vel(0.030), 0.55, t, 2400);
      if(i % 32 === 24) note(hz(880, root + PENT[(i>>4) % 5]), "sine", 0.016, 1.2, t, 5000);
    },
  },

  /* Combat: i-VI-III-VII progression, two alternating bass riffs, a fill at
     every section turn, and every eighth chord a breakdown - hats and pad
     only - before the bass slams back in. */
  combat: {
    bpm: 128, div: 4,
    step(i, t){
      const CH = [0, 8, 3, 10];                      // A F C G
      const chordIx = Math.floor(i/32);
      const root = CH[chordIx % CH.length];
      const section = Math.floor(i/128) % 2;
      const breakdown = chordIx % 8 === 7;
      const RIFFS = [
        [0,0,7,0, 5,0,3,0, 0,0,7,0, 10,0,7,3],
        [0,0,0,7, 0,3,0,5, 0,0,10,0, 7,5,3,0],
      ];
      if(!breakdown){
        const b = RIFFS[section][i % 16];
        if(i % 2 === 0) note(hz(55, root + b), "square", vel(0.042), 0.16, t, 700);
      } else if(i % 32 >= 24 && i % 2 === 0){
        // the fill that announces the bass is coming back
        note(hz(110, root + PENT[(i>>1) % 5]), "sawtooth", vel(0.026), 0.10, t, 1200);
      }
      if(i % 4 === 2) hat(t, 0.020);
      if(breakdown && i % 8 === 0) note(hz(220, root + 12), "sine", 0.022, 0.8, t, 1800);
      const runUp = [0,2,3,4, 2,3,4,5, 3,4,5,6, 4,5,6,7][i % 16];
      if(!breakdown && i % 4 === 0)
        note(hz(440, root + PENT[runUp % 8]), "triangle", vel(0.020), 0.14, t, 3200);
      if(i % 128 === 124) note(hz(110, root + 12), "sawtooth", 0.026, 0.5, t, 900);
    },
  },

  /* Boss: faster, and built on a minor-second shove - the ugliest interval
     there is, at low volume, which reads as dread rather than noise. Tom
     thumps on the floor, sixteenth hats, a two-note tremolo stab per bar. */
  boss: {
    bpm: 140, div: 4,
    step(i, t){
      const root = (Math.floor(i/64) % 2) ? 1 : 0;   // the whole bed lurches up a semitone
      const b = [0,1,0,1, 0,1,3,1, 0,1,0,1, 5,3,1,0][i % 16];
      if(i % 2 === 0) note(hz(55, root + b), "square", vel(0.046), 0.13, t, 650);
      if(i % 8 === 0) note(hz(41, root), "sine", 0.060, 0.30, t, 300);     // tom thump
      if(i % 2 === 1) hat(t, 0.012);
      if(i % 16 === 12 || i % 16 === 14)
        note(hz(880, root + 10), "sawtooth", vel(0.016), 0.09, t, 2600);   // stab pair
      if(i % 64 === 56) note(hz(220, root + 6), "sawtooth", 0.028, 0.7, t, 1000); // tritone turn
    },
  },
};

/** ±15% velocity so no two passes are machine-identical. */
function vel(g){ return g * (0.85 + Math.random()*0.3); }

/** One scheduled note through its own envelope and lowpass, into master. */
function note(freq, type, gain, dur, when, cutoff){
  if(!ctx || muted) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = type; o.frequency.value = freq;
  f.type = "lowpass"; f.frequency.value = cutoff || 3000;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(f); f.connect(g); g.connect(musicGain);
  o.start(when); o.stop(when + dur + 0.05);
}
/** A tiny noise tick - the hi-hat. The buffer is built once. */
function hat(when, gain){
  if(!ctx || muted) return;
  if(!noiseBuf){
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate*0.05, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
  }
  const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = noiseBuf;
  f.type = "highpass"; f.frequency.value = 6000;
  g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(musicGain);
  src.start(when);
}

/** Switches the loop: "menu", "combat", or null for silence. Fades both ways. */
function setMusic(name){
  if(name === musicTrack) return;
  init();
  if(!ctx){ musicTrack = name; return; }
  if(!musicGain){
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
  }
  musicTrack = name;
  if(musicTimer){ clearInterval(musicTimer); musicTimer = null; }
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  if(!name){
    musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    return;
  }
  musicGain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.6);
  const track = TRACKS[name];
  musicStep = 0;
  musicNext = ctx.currentTime + 0.1;
  const stepDur = 60 / track.bpm / track.div;
  musicTimer = setInterval(() => {
    if(!ctx || muted) return;               // muted: skip scheduling, keep time
    while(musicNext < ctx.currentTime + 0.25){
      track.step(musicStep++, musicNext);
      musicNext += stepDur;
    }
  }, 120);
}

SF.audio = { init, play, isMuted, setMuted, setMusic };
})();
