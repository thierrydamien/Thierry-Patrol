/*
 * KING PAPA'S DEATH — the silliest twelve seconds in the game.
 *
 * The first version was "a big explosion", and a big explosion is not a
 * JOKE. What makes a seven-year-old actually howl is not spectacle, it's
 * the RUNNER: you think it's over, and it isn't. So this is built like a
 * cartoon gag rather than a boss death — five acts, two fake-outs, and a
 * punchline that only lands because you were sure it had already finished.
 *
 *   1. OW      — the head swells like a balloon, goes red, and POPS...
 *                 down to nothing. Silence. Surely that's it?
 *   2. BACK    — he's back, BIGGER, spinning, crown flying off, going
 *                 "IS THAT ALL YOU'VE GOT?" - then farts around the screen
 *                 like a let-go balloon. Surely THAT'S it?
 *   3. SPLIT   — he bursts into five tiny bouncing Papa heads that bonk
 *                 off the walls and off each other, squeaking.
 *   4. MERGE   — the five rush back together and inflate to fill the whole
 *                 screen. Everything goes quiet. He winks.
 *   5. KABOOM  — the biggest, dumbest firework in the game, and it rains
 *                 stars AND tiny papas. The crown parachutes down last.
 *
 * Same rules as finale.js: simulation time only, and nothing here can hurt
 * the player. It is entirely theatre, and it is entirely the point.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, rand, TAU } = SF.core;
const { VW, VH } = SF.entityConst;
const fx = SF.fx;
const audio = SF.audio;

/*
 * What Papa actually says to his kids, in the language he says it in. The
 * game is English everywhere else; this one moment is theirs, so it is not
 * translated and never will be.
 */
const FRENCH = ["Bien joué !", "Amuse-toi bien !", "Je t'aime !"];

const ACTS = [
  { id:"ow",     dur: 2.0 },
  { id:"back",   dur: 3.0 },
  { id:"split",  dur: 2.6 },
  { id:"merge",  dur: 1.9 },
  // Kaboom got longer on request: "make sure the ending is long enough so
  // they can enjoy it and have a good laugh." It now carries three spoken
  // lines (see FRENCH below) with real air between them, not a blast that
  // is over before the joke lands.
  { id:"kaboom", dur: 6.2 },
];
const TOTAL = ACTS.reduce((n, a) => n + a.dur, 0);

let show = null;     // { t, minis:[...], said:{} }

function reset(){ show = null; }
function active(){ return !!show; }
function state(){ return show; }

function begin(boss){
  show = { t: 0, minis: [], said: {}, crownX: boss.x, crownY: boss.y, crownV: 0,
           puffX: boss.x, puffY: boss.y, puffVX: 0, puffVY: 0 };
  audio.play("papaOw");
  return show;
}

function act(){
  if(!show) return null;
  let t = show.t;
  for(let i = 0; i < ACTS.length; i++){
    if(t < ACTS[i].dur) return { id: ACTS[i].id, k: t/ACTS[i].dur, i };
    t -= ACTS[i].dur;
  }
  return null;
}

/*
 * Where a named act begins, nudged a hair past the boundary. Summing the
 * durations by hand looks equivalent and isn't: 2.0 + 3.0 + 2.6 lands one
 * ULP BELOW the merge boundary, so act() reported "split at 100%" instead
 * of "merge at 0%". Anything that jumps between acts goes through here.
 */
function actStart(id){
  let t = 0;
  for(let i = 0; i < ACTS.length; i++){
    if(ACTS[i].id === id) return t + 1e-4;
    t += ACTS[i].dur;
  }
  return t;
}

/** One mini popped: a small bang, a squeak, a taunt and a star. */
function popMini(m, world){
  fx.explosion(m.x, m.y, 70, "#ffd23f", true);
  fx.ring(m.x, m.y, 90, "#ffffff", 3, 0.35);
  fx.shake(8);
  audio.play("papaPop");
  fx.text(m.x, m.y - 20,
          ["OI!","NOT THE FACE!","OW!","RUDE!","HEY!"][Math.floor(rand(0, 5))],
          "#ffd23f", 18, true);
  if(world && world.spawnPickup){
    const st = world.spawnPickup("star", m.x, m.y);
    st.vx = rand(-60, 60); st.vy = rand(-40, 20);
  }
}

/** Fires once per act, whatever the frame rate. */
function once(key, fn){
  if(show.said[key]) return;
  show.said[key] = true;
  fn();
}

function update(dt, boss, world){
  if(!show) return false;
  show.t += dt;
  const a = act();
  if(!a || !boss) { show = null; return true; }

  // The boss holds station through the whole routine - he is not sinking,
  // he is performing.
  boss.wobble = 0;

  if(a.id === "ow"){
    once("ow", () => {
      fx.text(VW/2, VH*0.30, "OW! MY FACE!", "#ffd23f", 34, true);
      fx.shake(14);
    });
    // The pop at the end of act one: everything stops. The fake-out only
    // works if the screen genuinely goes quiet.
    if(a.k > 0.72) once("owpop", () => {
      fx.explosion(boss.x, boss.y, 150, "#ffd23f", true);
      fx.ring(boss.x, boss.y, 220, "#ffffff", 5, 0.5);
      fx.hitStop(160);
      fx.shake(22);
      audio.play("papaPop");
    });

  } else if(a.id === "back"){
    once("back", () => {
      fx.flash(0.45, "255,210,63");
      fx.shake(20);
      fx.text(VW/2, VH*0.28, "IS THAT ALL YOU'VE GOT?!", "#ff5d73", 30, true);
      audio.play("papaBack");
    });
    // Halfway through he lets go and flies round the room like a balloon.
    if(a.k > 0.45){
      once("raspberry", () => {
        audio.play("papaRaspberry");
        fx.text(VW/2, VH*0.36, "PFFFFFFFT!", "#ffffff", 26, true);
        show.puffVX = rand(-420, 420) || 300;
        show.puffVY = -260;
      });
      show.puffVX += Math.sin(show.t*18)*900*dt;
      show.puffVY += Math.cos(show.t*13)*760*dt;
      show.puffX += show.puffVX*dt;
      show.puffY += show.puffVY*dt;
      if(show.puffX < 40 || show.puffX > VW-40){ show.puffVX *= -1; audio.play("papaBoing"); }
      if(show.puffY < 90 || show.puffY > VH-140){ show.puffVY *= -1; audio.play("papaBoing"); }
      show.puffX = clamp(show.puffX, 40, VW-40);
      show.puffY = clamp(show.puffY, 90, VH-140);
      if(Math.random() < 0.5)
        fx.spark(show.puffX, show.puffY, rand(-90,90), rand(-40,90), "#ffd23f", 0.4, 3);
    }

  } else if(a.id === "split"){
    once("split", () => {
      audio.play("papaSplit");
      fx.explosion(show.puffX, show.puffY, 110, "#ffd23f", true);
      fx.text(VW/2, VH*0.26, "NOW THERE'S FIVE OF ME!", "#4ade80", 28, true);
      for(let i = 0; i < 5; i++){
        const ang = -Math.PI/2 + (i - 2)*0.5;
        show.minis.push({
          x: show.puffX, y: show.puffY,
          vx: Math.cos(ang)*rand(180, 340), vy: Math.sin(ang)*rand(120, 260),
          spin: rand(-6, 6), rot: rand(0, TAU), r: 34,
          hp: 2, alive: true,        // two taps each: shootable, never a chore
        });
      }
    });
    /*
     * They are SHOOTABLE. Watching the best gag in the game happen to you is
     * not as good as being in it - so the five bounce, and you pop them.
     *
     * The valve, same as everywhere else in this project: popping all five
     * cuts straight to the punchline, but running out of time merges them
     * anyway. The comedy timing never depends on a seven-year-old's aim, and
     * a kid who empties the magazine into all five gets rewarded with a
     * faster, louder finish rather than the same wait.
     */
    const bs = world && world.bullets ? world.bullets.items : null;
    show.minis.forEach((m, i) => {
      if(!m.alive) return;
      m.vy += 260*dt;
      m.x += m.vx*dt; m.y += m.vy*dt;
      m.rot += m.spin*dt;
      if(m.x < m.r || m.x > VW-m.r){ m.vx *= -0.92; m.x = clamp(m.x, m.r, VW-m.r); audio.play("papaBoing"); }
      if(m.y > VH-m.r-40){ m.y = VH-m.r-40; m.vy *= -0.86; audio.play("papaBoing"); }
      if(m.y < m.r+70){ m.y = m.r+70; m.vy *= -0.86; }
      // Player rounds pop them.
      if(bs){
        for(let k = 0; k < bs.length; k++){
          const b = bs[k];
          if(!b.alive) continue;
          const rr = b.r + m.r;
          if((b.x-m.x)*(b.x-m.x) + (b.y-m.y)*(b.y-m.y) < rr*rr){
            b.alive = false;
            if(--m.hp <= 0){
              m.alive = false;
              popMini(m, world);
              break;
            }
            fx.sparks(b.x, b.y, 6, "#ffd23f", 150);
            audio.play("papaBoing");
          }
        }
      }
      for(let j = i+1; j < show.minis.length; j++){
        const o = show.minis[j];
        if(!o.alive) continue;
        const dx = o.x-m.x, dy = o.y-m.y, d = Math.hypot(dx, dy);
        if(d > 0.01 && d < m.r + o.r){
          const nx = dx/d, ny = dy/d, push = (m.r + o.r - d)/2;
          m.x -= nx*push; m.y -= ny*push; o.x += nx*push; o.y += ny*push;
          m.vx -= nx*90; o.vx += nx*90;
          if(Math.random() < 0.3) audio.play("papaBoing");
        }
      }
    });
    // All five popped: skip the rest of the bouncing and get to the joke.
    if(show.minis.length && show.minis.every(m => !m.alive)){
      once("allpopped", () => {
        fx.text(VW/2, VH*0.34, "GOT THEM ALL!", "#4ade80", 30, true);
        show.t = actStart("merge");
      });
    }

  } else if(a.id === "merge"){
    once("merge", () => {
      audio.play("papaMerge");
      // If the player popped them all, he pulls himself back together anyway -
      // which is a better punchline than sparing them ever was.
      const wiped = show.minis.length && show.minis.every(m => !m.alive);
      fx.text(VW/2, VH*0.24, wiped ? "YOU CAN'T GET RID OF ME!" : "UH OH",
              "#ffffff", wiped ? 26 : 30, true);
      show.minis.forEach(m => { m.alive = true; });   // reassembling
    });
    // They rush back to the middle and become one enormous head.
    show.minis.forEach(m => {
      const tx = VW/2, ty = VH*0.42;
      m.x += (tx - m.x) * Math.min(1, dt*4.5);
      m.y += (ty - m.y) * Math.min(1, dt*4.5);
      m.rot += 9*dt;
    });
    // The held breath before the punchline.
    if(a.k > 0.82) once("wink", () => { fx.hitStop(320); audio.play("papaWink"); });

  } else if(a.id === "kaboom"){
    once("kaboom", () => {
      const cx = VW/2, cy = VH*0.42;
      fx.flash(1, "255,240,180");
      fx.hitStop(280);
      fx.shake(52);
      audio.play("megaBoom");
      audio.play("papaKaboom");
      for(let r = 0; r < 8; r++)
        fx.ring(cx, cy, 90 + r*95, r%2 ? "#ffd23f" : "#ffffff", 7 - r*0.7, 0.5 + r*0.16);
      const COLS = ["#ffd23f","#ff5d73","#4ade80","#3fc9ff","#c084fc","#ff4fd8"];
      for(let i = 0; i < 14; i++)
        fx.firework(rand(50, VW-50), rand(VH*0.12, VH*0.62), COLS[i % COLS.length]);
      fx.explosion(cx, cy, 420, "#ffd23f", true);
      fx.debris(cx, cy, 60, "#ffd23f");
      fx.embers(cx, cy, 70);
      fx.text(VW/2, VH*0.32, "PAPA GOES KA-BOOM!!!", "#ffd23f", 38, true);
      fx.text(VW/2, VH*0.40, "bye bye!", "#ffffff", 24, true);
      // The loot: a wide shower, plus tiny papa heads raining down as
      // collectables. Stars are treasure; the heads are the souvenir.
      for(let i = 0; i < 46; i++){
        const st = world.spawnPickup("star", rand(26, VW-26), rand(-120, VH*0.35));
        st.vx = rand(-70, 70);
      }
      for(let i = 0; i < 10; i++){
        const hd = world.spawnPickup("papahead", rand(40, VW-40), rand(-200, -20));
        hd.vx = rand(-50, 50);
      }
      show.minis.length = 0;
      // The crown outlives him and parachutes down.
      show.crownX = cx; show.crownY = cy; show.crownV = -120;
    });
    // Fireworks keep going off through the whole finish - the sky is still
    // laughing after the joke lands.
    if(Math.random() < 0.09)
      fx.firework(rand(50, VW-50), rand(VH*0.12, VH*0.55),
                  ["#ffd23f","#ff5d73","#4ade80","#3fc9ff","#c084fc"][Math.floor(rand(0,5))]);
    show.crownV += 200*dt;
    show.crownY += show.crownV*dt;
    show.crownX += Math.sin(show.t*3)*40*dt;
    // Papa's own goodbye, spoken the way he actually talks to his kids: in
    // French, one line at a time, with room to breathe between them rather
    // than crammed in over the blast. Each line gets its own firework salvo
    // so the sky punctuates it.
    FRENCH.forEach((line, i) => {
      const at = 0.20 + i*0.27;
      if(a.k > at) once("fr" + i, () => {
        fx.text(VW/2, VH*(0.52 + i*0.06), line, "#ffe9a8", 26, true);
        audio.play("papaWink");
        for(let f = 0; f < 3; f++)
          fx.firework(VW*(0.25 + i*0.25) + rand(-30,30), VH*(0.20 + (i%2)*0.1),
                      ["#ffd23f","#ff4fd8","#4ade80"][i]);
      });
    });
  }

  if(show.t >= TOTAL){ show = null; return true; }
  return false;
}

SF.papadeath = { reset, begin, active, act, state, update, TOTAL, ACTS, FRENCH };
})();
