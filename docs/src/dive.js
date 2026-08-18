/*
 * THE DIVE - the water column.
 *
 * The Drowned Sky's backdrop (skygen.js) is the ocean FLOOR; this module is
 * the water between the floor and the camera, and it is the reason the level
 * feels submerged rather than merely teal: light shafts swinging slowly from
 * the surface, caustic shimmer drifting over everything, schools of fish that
 * get out of the squadron's way - and bubbles. The bubbles matter most: they
 * are the one thing in the whole game that travels UP the screen while the
 * world scrolls down, and that single reversed motion is what convinces the
 * eye there is water here.
 *
 * Same shape as sky29.js: a mission flag (`dive`) plus hooks game.js already
 * knows how to call - begin/update, one draw pass under the world (drawSky)
 * and one over it (drawOver). All state lives in S; reset() clears it.
 *
 * Everything here is ambience. Nothing collides, nothing scores, and the
 * fish are cowards by design - they flee the fight, they never join it.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

let S = null;

/*
 * THE WATER COLUMN OVERLAY - one canvas, one blit.
 *
 * Rays, caustics and the depth vignette are all full-screen washes, and a
 * software rasterizer (headless test rigs, cheap tablets) pays for every
 * full-screen composite separately: drawn naively they took the frame rate
 * to HALF of what neighbouring missions manage. So all three render into a
 * single half-resolution canvas, repainted ~11 times a second - water light
 * moves slowly, nobody can see a 90ms-old sunbeam - and the frame pays one
 * stretched drawImage. The stretch even helps: upscaling softens the light
 * exactly the way water does.
 *
 * The whole overlay sits OVER the fight (drawOver), which is also where the
 * physics puts it: you are looking THROUGH lit water at the ships, so the
 * shafts, the dapple and the deep-blue edges all belong in front.
 */
let column = null, colW = 0, colH = 0, colAt = -1;

function paintColumn(VW, VH){
  const K = 0.5, w = Math.max(1, Math.round(VW*K)), h = Math.max(1, Math.round(VH*K));
  if(!column || colW !== w || colH !== h){
    column = document.createElement("canvas");
    column.width = w; column.height = h;
    colW = w; colH = h;
  }
  const c = column.getContext("2d");
  c.clearRect(0, 0, w, h);

  // Caustic shimmer: soft bright patches sliding over everything.
  for(const ca of S.caustics){
    const a = 0.05 + Math.sin(S.t*0.8 + ca.ph)*0.02;
    const g = c.createRadialGradient(ca.x*K, ca.y*K, 0, ca.x*K, ca.y*K, ca.r*K);
    g.addColorStop(0, "rgba(140,220,235," + a.toFixed(3) + ")");
    g.addColorStop(1, "rgba(140,220,235,0)");
    c.fillStyle = g;
    c.beginPath(); c.arc(ca.x*K, ca.y*K, ca.r*K, 0, TAU); c.fill();
  }

  // God rays: four shafts from the surface, swinging like the water is.
  for(let i = 0; i < 4; i++){
    const x0 = w*(0.14 + i*0.24);
    const tilt = Math.sin(S.t*0.13 + i*1.7)*0.16 + 0.10;
    const w0 = w*(0.045 + (i % 2)*0.02);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(150,230,240,0.13)");
    g.addColorStop(0.75, "rgba(150,230,240,0.025)");
    g.addColorStop(1, "rgba(150,230,240,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x0 - w0, 0);
    c.lineTo(x0 + w0, 0);
    c.lineTo(x0 + w0*2.6 + tilt*h, h);
    c.lineTo(x0 - w0*2.6 + tilt*h, h);
    c.closePath(); c.fill();
  }

  // The depth vignette goes on LAST, over the rays - the water really is
  // thicker toward the edges of what you can see, sunbeams included.
  const g = c.createRadialGradient(w/2, h*0.42, h*0.30, w/2, h*0.42, h*0.78);
  g.addColorStop(0, "rgba(2,16,26,0)");
  g.addColorStop(1, "rgba(2,16,26,0.34)");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}

function reset(){ S = null; }

function begin(){
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S = { t: 0, bubbles: [], schools: [], caustics: [], vent: 0, thrust: 0 };
  for(let i = 0; i < 3; i++) S.schools.push(newSchool(W, H, i, true));
  for(let i = 0; i < 6; i++)
    S.caustics.push({ x: Math.random()*W, y: Math.random()*H,
                      r: 60 + Math.random()*80, vx: (Math.random() - 0.5)*14,
                      vy: (Math.random() - 0.5)*8, ph: Math.random()*TAU });
}

function active(){ return !!S; }

/* ------------------------------------------------------------------ */
/*  FISH                                                                */
/* ------------------------------------------------------------------ */

function newSchool(W, H, id, anywhere){
  const dir = Math.random() < 0.5 ? 1 : -1;
  const n = 8 + Math.floor(Math.random()*6);
  const fish = [];
  for(let i = 0; i < n; i++)
    fish.push({ ox: (Math.random() - 0.5)*70, oy: (Math.random() - 0.5)*40,
                ph: Math.random()*TAU, s: 0.8 + Math.random()*0.5 });
  return {
    id, dir, fish,
    x: anywhere ? Math.random()*W : (dir > 0 ? -70 : W + 70),
    y: H*(0.15 + Math.random()*0.6),
    speed: 42 + Math.random()*26,
    drift: 0,                     // vertical lean, mostly from dodging pilots
  };
}

function updateSchool(sc, dt, W, H, pilots){
  // The school flees any pilot inside its comfort circle; otherwise the
  // vertical lean relaxes away and it settles back to level swimming.
  let flee = 0;
  for(const p of pilots){
    if(!p) continue;
    const dx = sc.x - p.x, dy = sc.y - p.y;
    const d2 = dx*dx + dy*dy;
    if(d2 < 130*130) flee += (dy >= 0 ? 1 : -1) * (1 - Math.sqrt(d2)/130);
  }
  sc.drift += (flee*90 - sc.drift) * Math.min(1, dt*3);
  sc.x += sc.dir * sc.speed * dt;
  sc.y += (sc.drift + Math.sin(sc.id*3 + performanceT(sc)) * 6) * dt;
  sc.y = Math.max(H*0.08, Math.min(H*0.9, sc.y));
  return sc.dir > 0 ? sc.x > W + 90 : sc.x < -90;
}
/* The school's own slow bob rides the module clock. */
function performanceT(sc){ return S ? S.t*0.6 + sc.id : 0; }

/* ------------------------------------------------------------------ */
/*  UPDATE                                                              */
/* ------------------------------------------------------------------ */

function update(dt, run, world){
  if(!S || run.ended) return;
  const W = SF.game.VW || 600, H = SF.game.VH || 800;
  S.t += dt;
  const pilots = world.players || (world.player ? [world.player] : []);

  for(let i = 0; i < S.schools.length; i++)
    if(updateSchool(S.schools[i], dt, W, H, pilots))
      S.schools[i] = newSchool(W, H, S.schools[i].id, false);

  // Ambient bubbles from the floor...
  S.vent -= dt;
  if(S.vent <= 0 && S.bubbles.length < 40){
    S.vent = 0.16 + Math.random()*0.2;
    S.bubbles.push({ x: Math.random()*W, y: H + 8,
                     r: 1.5 + Math.random()*3,
                     vy: 36 + Math.random()*48, ph: Math.random()*TAU });
  }
  // ...and a thin stream off every thruster, because the ships breathe too.
  S.thrust -= dt;
  if(S.thrust <= 0 && S.bubbles.length < 46){
    S.thrust = 0.32;
    for(const p of pilots){
      if(!p) continue;
      S.bubbles.push({ x: p.x + (Math.random() - 0.5)*8, y: p.y + 16,
                       r: 1 + Math.random()*1.6,
                       vy: 60 + Math.random()*30, ph: Math.random()*TAU });
    }
  }
  for(let i = S.bubbles.length - 1; i >= 0; i--){
    const b = S.bubbles[i];
    b.y -= b.vy*dt;
    b.x += Math.sin(S.t*3 + b.ph)*12*dt;
    b.r += dt*0.6;                       // pressure lets go as they climb
    if(b.y < H*0.04) S.bubbles.splice(i, 1);
  }

  for(const c of S.caustics){
    c.x += c.vx*dt; c.y += c.vy*dt;
    if(c.x < -c.r) c.x = W + c.r; if(c.x > W + c.r) c.x = -c.r;
    if(c.y < -c.r) c.y = H + c.r; if(c.y > H + c.r) c.y = -c.r;
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - under the world                                              */
/* ------------------------------------------------------------------ */

function drawSky(ctx, timeMs, VW, VH){
  if(!S) return;

  // The fish, under the fight - the level's civilians. No transforms: at
  // thirty-six fish a frame, save/translate/restore per fish measured as a
  // quarter of the whole level's draw cost. Direction is a sign, not a scale.
  ctx.fillStyle = "rgba(185,226,234,0.72)";
  for(const sc of S.schools){
    const d = sc.dir;
    for(const f of sc.fish){
      const fx2 = sc.x + f.ox, fy = sc.y + f.oy + Math.sin(S.t*2 + f.ph)*3;
      const flick = Math.sin(S.t*9 + f.ph)*2.2;
      ctx.beginPath(); ctx.ellipse(fx2, fy, 4.6*f.s, 1.8*f.s, 0, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(fx2 - d*4*f.s, fy);
      ctx.lineTo(fx2 - d*7*f.s, fy - 2*f.s + flick);
      ctx.lineTo(fx2 - d*7*f.s, fy + 2*f.s + flick);
      ctx.closePath(); ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  DRAW - over the world                                               */
/* ------------------------------------------------------------------ */

function drawOver(ctx, timeMs){
  if(!S) return;
  const VW = SF.game.VW || 600, VH = SF.game.VH || 800;

  // The whole water column - rays, dapple, depth - in a single blit.
  if(colAt < 0 || S.t - colAt > 0.09 ||
     colW !== Math.max(1, Math.round(VW*0.5)) || colH !== Math.max(1, Math.round(VH*0.5))){
    paintColumn(VW, VH);
    colAt = S.t;
  }
  ctx.drawImage(column, 0, 0, VW, VH);

  // Bubbles ride over even the light - right against the glass. One stroke
  // each; only the big ones can afford a highlight.
  ctx.strokeStyle = "rgba(205,240,248,0.5)";
  ctx.lineWidth = 1;
  for(const b of S.bubbles){
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
    if(b.r > 2.6){
      ctx.beginPath(); ctx.arc(b.x - b.r*0.3, b.y - b.r*0.3, b.r*0.3, -2.4, -0.9); ctx.stroke();
    }
  }
}

SF.dive = { _state: () => S, reset, begin, active, update, drawSky, drawOver };
})();
