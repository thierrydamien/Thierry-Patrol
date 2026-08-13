/*
 * Drawn UI glyphs - the second half of the emoji sweep.
 *
 * The first sweep (8c4e36e) replaced emoji with drawn art where it was
 * content: enemies, insignia, menu icons. This module finishes the job for
 * the CHROME - armory tabs, shop tiles, ability buttons, locks, the settings
 * gear, the mute speaker - which had quietly grown a second emoji population.
 * Emoji render differently on every platform, so the iPad and the desktop
 * were wearing different faces; these draw identically everywhere, in the
 * same neon line style as drawMenuIcons, and they work offline for free.
 *
 * The third sweep: medals. The emoji-in-a-disc experiment ("a collectible
 * sticker") was the loudest clip-art tell left in the game - a money-mouth
 * face and a bank building next to hand-drawn spacecraft - so every medal
 * now gets a bespoke motif on one shared gold-disc treatment (medal()).
 *
 * API:
 *   SF.icons.paint(canvas, name, color)  - draws into an existing canvas
 *   SF.icons.el(name, color, px)         - returns a ready <canvas>
 *   SF.icons.medal(id, px, locked)       - a ready <canvas> medal disc
 * Painters draw in a 40x40 box around (20,20); el() handles DPR scaling.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI * 2;

/* Every painter gets (c, color) with the canvas already scaled to a 40x40
   box, stroke/fill preset to the colour, lineWidth 3, round caps, and a soft
   glow. They only draw shape. */
const P = {

  /* ---- armory tabs ---- */
  guns(c){          // twin cannon barrels, muzzle flashes up
    c.lineWidth = 5;
    [[14, 0], [26, 0]].forEach(([x]) => {
      c.beginPath(); c.moveTo(x, 30); c.lineTo(x, 12); c.stroke();
    });
    c.lineWidth = 3;
    [[14], [26]].forEach(([x]) => {
      c.beginPath(); c.moveTo(x, 9); c.lineTo(x - 3, 5); c.moveTo(x, 9); c.lineTo(x + 3, 5); c.stroke();
    });
    c.beginPath(); c.moveTo(10, 32); c.lineTo(30, 32); c.stroke();
  },
  armour(c){        // shield
    c.beginPath();
    c.moveTo(20, 5); c.lineTo(32, 10); c.lineTo(32, 20);
    c.quadraticCurveTo(32, 30, 20, 35);
    c.quadraticCurveTo(8, 30, 8, 20);
    c.lineTo(8, 10); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(20, 11); c.lineTo(20, 28); c.stroke();
  },
  ship(c){          // rocket
    c.beginPath();
    c.moveTo(20, 4); c.quadraticCurveTo(27, 12, 27, 22); c.lineTo(27, 28)
    c.lineTo(13, 28); c.lineTo(13, 22); c.quadraticCurveTo(13, 12, 20, 4);
    c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(13, 24); c.lineTo(7, 30); c.moveTo(27, 24); c.lineTo(33, 30); c.stroke();
    c.beginPath(); c.moveTo(16, 31); c.lineTo(20, 37); c.lineTo(24, 31); c.stroke();
  },
  extras(c){        // four-point sparkle
    c.beginPath();
    c.moveTo(20, 4); c.quadraticCurveTo(22, 18, 36, 20);
    c.quadraticCurveTo(22, 22, 20, 36);
    c.quadraticCurveTo(18, 22, 4, 20);
    c.quadraticCurveTo(18, 18, 20, 4);
    c.closePath(); c.fill();
  },
  paint(c){         // brush stroke
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(8, 32); c.quadraticCurveTo(18, 26, 30, 10); c.stroke();
    c.lineWidth = 3;
    c.beginPath(); c.arc(31, 8, 4, 0, TAU); c.fill();
    c.beginPath(); c.arc(7, 33, 3, 0, TAU); c.fill();
  },
  parts(c){         // wrench across a bolt
    c.lineWidth = 6; c.beginPath(); c.moveTo(15, 25); c.lineTo(27, 13); c.stroke();
    c.lineWidth = 4;
    c.beginPath(); c.arc(12, 28, 6, -0.6, Math.PI * 1.35); c.stroke();
    c.beginPath(); c.arc(30, 10, 6, Math.PI - 0.6, Math.PI * 2.35); c.stroke();
  },
  pilot(c){         // helmet with visor
    c.beginPath(); c.arc(20, 18, 12, Math.PI, 0); c.lineTo(32, 26)
    c.quadraticCurveTo(32, 30, 28, 30); c.lineTo(12, 30);
    c.quadraticCurveTo(8, 30, 8, 26); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(12, 19); c.lineTo(28, 19); c.stroke();
  },

  /* ---- shop upgrades ---- */
  spread(c){        // three diverging bolts
    [[-10, -6], [0, -10], [10, -6]].forEach(([dx, dy]) => {
      c.beginPath(); c.moveTo(20, 32); c.lineTo(20 + dx, 14 + dy); c.stroke();
      c.beginPath(); c.arc(20 + dx, 12 + dy, 2.2, 0, TAU); c.fill();
    });
  },
  rapid(c){         // lightning zap
    c.beginPath();
    c.moveTo(24, 4); c.lineTo(12, 22); c.lineTo(19, 22); c.lineTo(16, 36);
    c.lineTo(28, 17); c.lineTo(21, 17); c.closePath(); c.fill();
  },
  damage(c){        // starburst
    for(let i = 0; i < 8; i++){
      const a = (i / 8) * TAU, r = i % 2 ? 9 : 15;
      c.beginPath(); c.moveTo(20, 20);
      c.lineTo(20 + Math.cos(a) * r, 20 + Math.sin(a) * r); c.stroke();
    }
    c.beginPath(); c.arc(20, 20, 4, 0, TAU); c.fill();
  },
  pierce(c){        // arrow punching through a bar
    c.beginPath(); c.moveTo(20, 34); c.lineTo(20, 10); c.stroke();
    c.beginPath(); c.moveTo(14, 16); c.lineTo(20, 6); c.lineTo(26, 16); c.stroke();
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(8, 22); c.lineTo(15, 22); c.moveTo(25, 22); c.lineTo(32, 22); c.stroke();
  },
  homing(c){        // crosshair
    c.beginPath(); c.arc(20, 20, 10, 0, TAU); c.stroke();
    [[20, 4, 20, 12], [20, 28, 20, 36], [4, 20, 12, 20], [28, 20, 36, 20]]
      .forEach(([x1, y1, x2, y2]) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); });
    c.beginPath(); c.arc(20, 20, 2.4, 0, TAU); c.fill();
  },
  shield(c){ P.armour(c); },
  life(c){          // heart
    c.beginPath();
    c.moveTo(20, 33);
    c.bezierCurveTo(6, 22, 8, 8, 20, 15);
    c.bezierCurveTo(32, 8, 34, 22, 20, 33);
    c.closePath(); c.fill();
  },
  armor(c){         // brick courses
    c.strokeRect(8, 10, 24, 20);
    c.beginPath(); c.moveTo(8, 20); c.lineTo(32, 20); c.stroke();
    c.beginPath(); c.moveTo(20, 10); c.lineTo(20, 20); c.moveTo(14, 20); c.lineTo(14, 30);
    c.moveTo(26, 20); c.lineTo(26, 30); c.stroke();
  },
  thrusters(c){     // exhaust chevrons
    c.beginPath(); c.moveTo(12, 6); c.lineTo(20, 14); c.lineTo(28, 6); c.stroke();
    c.beginPath(); c.moveTo(12, 16); c.lineTo(20, 24); c.lineTo(28, 16); c.stroke();
    c.beginPath(); c.moveTo(12, 26); c.lineTo(20, 34); c.lineTo(28, 26); c.stroke();
  },
  magnet(c){        // horseshoe
    c.lineWidth = 5;
    c.beginPath(); c.arc(20, 18, 10, Math.PI, 0, true); c.stroke();
    c.beginPath(); c.moveTo(10, 18); c.lineTo(10, 28); c.moveTo(30, 18); c.lineTo(30, 28); c.stroke();
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(7, 31); c.lineTo(13, 31); c.moveTo(27, 31); c.lineTo(33, 31); c.stroke();
  },
  fortune(c){       // coin
    c.beginPath(); c.arc(20, 20, 13, 0, TAU); c.stroke();
    c.font = "bold 15px Rajdhani, Arial, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("£", 20, 21);
  },
  wingman(c){       // little drone: body + wings
    c.beginPath(); c.arc(20, 18, 5, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(6, 24); c.lineTo(15, 20); c.moveTo(34, 24); c.lineTo(25, 20); c.stroke();
    c.beginPath(); c.moveTo(20, 25); c.lineTo(20, 31); c.stroke();
  },
  bomb(c){          // round bomb, lit fuse
    c.beginPath(); c.arc(19, 24, 10, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(24, 15); c.quadraticCurveTo(28, 10, 32, 9); c.stroke();
    c.beginPath(); c.arc(33, 8, 2.4, 0, TAU); c.fill();
  },
  overdrive(c){     // flame
    c.beginPath();
    c.moveTo(20, 4);
    c.bezierCurveTo(28, 12, 31, 18, 31, 25);
    c.bezierCurveTo(31, 32, 26, 36, 20, 36);
    c.bezierCurveTo(14, 36, 9, 32, 9, 25);
    c.bezierCurveTo(9, 20, 12, 16, 14, 13);
    c.bezierCurveTo(14, 18, 17, 19, 20, 4);
    c.closePath(); c.fill();
  },

  /* ---- chrome ---- */
  lock(c){          // padlock
    c.beginPath(); c.arc(20, 15, 7, Math.PI, 0); c.stroke();
    c.beginPath(); c.moveTo(13, 15); c.lineTo(13, 19); c.moveTo(27, 15); c.lineTo(27, 19); c.stroke();
    const r = 6;
    c.beginPath();
    c.moveTo(10 + r, 18); c.lineTo(30 - r, 18); c.arcTo(30, 18, 30, 18 + r, 4);
    c.lineTo(30, 32 - 4); c.arcTo(30, 32, 30 - 4, 32, 4);
    c.lineTo(10 + 4, 32); c.arcTo(10, 32, 10, 32 - 4, 4);
    c.lineTo(10, 18 + 4); c.arcTo(10, 18, 10 + 4, 18, 4);
    c.closePath(); c.fill();
  },
  gear(c){          // settings cog
    for(let i = 0; i < 8; i++){
      const a = (i / 8) * TAU;
      c.beginPath();
      c.moveTo(20 + Math.cos(a) * 10, 20 + Math.sin(a) * 10);
      c.lineTo(20 + Math.cos(a) * 15, 20 + Math.sin(a) * 15);
      c.stroke();
    }
    c.beginPath(); c.arc(20, 20, 10, 0, TAU); c.stroke();
    c.beginPath(); c.arc(20, 20, 4, 0, TAU); c.fill();
  },
  soundOn(c){       // speaker + waves
    c.beginPath();
    c.moveTo(8, 16); c.lineTo(14, 16); c.lineTo(21, 9); c.lineTo(21, 31);
    c.lineTo(14, 24); c.lineTo(8, 24); c.closePath(); c.fill();
    c.beginPath(); c.arc(24, 20, 6, -0.9, 0.9); c.stroke();
    c.beginPath(); c.arc(24, 20, 11, -0.9, 0.9); c.stroke();
  },
  soundOff(c){      // speaker + strike
    c.beginPath();
    c.moveTo(8, 16); c.lineTo(14, 16); c.lineTo(21, 9); c.lineTo(21, 31);
    c.lineTo(14, 24); c.lineTo(8, 24); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(26, 14); c.lineTo(34, 26); c.moveTo(34, 14); c.lineTo(26, 26); c.stroke();
  },
  pause(c){         // two bars
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(14, 10); c.lineTo(14, 30); c.stroke();
    c.beginPath(); c.moveTo(26, 10); c.lineTo(26, 30); c.stroke();
  },
  play(c){          // solid triangle
    c.beginPath(); c.moveTo(13, 8); c.lineTo(31, 20); c.lineTo(13, 32);
    c.closePath(); c.fill();
  },
  retry(c){         // loop arrow
    c.beginPath(); c.arc(20, 20, 11, -0.4, Math.PI*1.55); c.stroke();
    c.beginPath(); c.moveTo(34, 12); c.lineTo(30, 19); c.lineTo(24, 14);
    c.closePath(); c.fill();
  },
  back(c){          // a plain left chevron with a shaft: "that way, out"
    // Deliberately not `undo`'s loop-arrow. A loop reads as "do it again" to
    // a child; the way OUT of a room has to be an arrow pointing out of it.
    c.beginPath(); c.moveTo(33, 20); c.lineTo(13, 20); c.stroke();
    c.beginPath(); c.moveTo(21, 9); c.lineTo(9, 20); c.lineTo(21, 31);
    c.closePath(); c.fill();
  },
  undo(c){          // back arrow
    c.beginPath(); c.moveTo(30, 28); c.quadraticCurveTo(30, 14, 14, 14); c.stroke();
    c.beginPath(); c.moveTo(19, 7); c.lineTo(11, 14); c.lineTo(19, 21);
    c.closePath(); c.fill();
  },
  phone(c){         // handset outline, tipped
    c.save(); c.translate(20, 20); c.rotate(-0.35);
    c.strokeRect(-8, -14, 16, 28);
    c.beginPath(); c.moveTo(-3, 10); c.lineTo(3, 10); c.stroke();
    c.restore();
  },
  skull(c){         // friendly pirate skull
    c.beginPath(); c.arc(20, 17, 10, Math.PI*0.95, Math.PI*0.05); c.stroke();
    c.beginPath(); c.moveTo(10, 17); c.lineTo(10, 23); c.quadraticCurveTo(10, 27, 14, 27);
    c.lineTo(26, 27); c.quadraticCurveTo(30, 27, 30, 23); c.lineTo(30, 17); c.stroke();
    c.beginPath(); c.arc(15.5, 18, 2.6, 0, TAU); c.fill();
    c.beginPath(); c.arc(24.5, 18, 2.6, 0, TAU); c.fill();
    c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(16, 30); c.lineTo(16, 34); c.moveTo(20, 30); c.lineTo(20, 34);
    c.moveTo(24, 30); c.lineTo(24, 34); c.stroke();
  },
  jolly(c){         // skull over crossbones
    c.save(); c.translate(0, -3); c.scale(0.8, 0.8); c.translate(5, 3); P.skull(c); c.restore();
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(9, 30); c.lineTo(31, 36); c.moveTo(31, 30); c.lineTo(9, 36); c.stroke();
  },
  star(c){          // five points, filled
    c.beginPath();
    for(let i=0;i<5;i++){
      const a = -Math.PI/2 + i*TAU/5, b = a + TAU/10;
      c.lineTo(20 + Math.cos(a)*14, 20 + Math.sin(a)*14);
      c.lineTo(20 + Math.cos(b)*6, 20 + Math.sin(b)*6);
    }
    c.closePath(); c.fill();
  },
  stars3(c){        // a haul of stars
    const star = (x, y, r) => {
      c.beginPath();
      for(let i=0;i<5;i++){
        const a = -Math.PI/2 + i*TAU/5, b = a + TAU/10;
        c.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r);
        c.lineTo(x + Math.cos(b)*r*0.44, y + Math.sin(b)*r*0.44);
      }
      c.closePath(); c.fill();
    };
    star(20, 16, 10); star(9, 28, 6); star(31, 28, 6);
  },
  flag(c){          // mission flag on a pole
    c.beginPath(); c.moveTo(12, 6); c.lineTo(12, 34); c.stroke();
    c.beginPath(); c.moveTo(12, 8); c.lineTo(30, 12); c.lineTo(12, 19);
    c.closePath(); c.fill();
  },
  banner(c){        // swallow-tail pennant
    c.beginPath(); c.moveTo(10, 7); c.lineTo(30, 7); c.lineTo(24, 14); c.lineTo(30, 21);
    c.lineTo(10, 21); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(10, 7); c.lineTo(10, 34); c.stroke();
  },
  trophy(c){        // cup with handles
    c.beginPath(); c.moveTo(13, 8); c.lineTo(27, 8); c.lineTo(26, 20);
    c.quadraticCurveTo(24, 26, 20, 26); c.quadraticCurveTo(16, 26, 14, 20);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(11, 12, 4, Math.PI*0.5, Math.PI*1.6); c.stroke();
    c.beginPath(); c.arc(29, 12, 4, Math.PI*1.4, Math.PI*0.5); c.stroke();
    c.beginPath(); c.moveTo(20, 26); c.lineTo(20, 30); c.stroke();
    c.beginPath(); c.moveTo(14, 33); c.lineTo(26, 33); c.stroke();
  },
  crown(c){         // three-point crown
    c.beginPath(); c.moveTo(9, 30); c.lineTo(8, 13); c.lineTo(15, 19); c.lineTo(20, 9);
    c.lineTo(25, 19); c.lineTo(32, 13); c.lineTo(31, 30); c.closePath(); c.fill();
  },
  dice(c){          // one die, five pips
    const r = 7;
    c.beginPath();
    c.moveTo(9 + r, 9); c.lineTo(31 - r, 9); c.arcTo(31, 9, 31, 9 + r, 6);
    c.lineTo(31, 31 - 6); c.arcTo(31, 31, 31 - 6, 31, 6);
    c.lineTo(9 + 6, 31); c.arcTo(9, 31, 9, 31 - 6, 6);
    c.lineTo(9, 9 + 6); c.arcTo(9, 9, 9 + 6, 9, 6);
    c.closePath(); c.stroke();
    [[14,14],[26,14],[20,20],[14,26],[26,26]].forEach(([x,y]) => {
      c.beginPath(); c.arc(x, y, 2.1, 0, TAU); c.fill();
    });
  },
  timer(c){         // stopwatch
    c.beginPath(); c.arc(20, 22, 11, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(20, 22); c.lineTo(20, 14); c.moveTo(20, 22); c.lineTo(26, 24); c.stroke();
    c.beginPath(); c.moveTo(16, 7); c.lineTo(24, 7); c.stroke();
    c.beginPath(); c.moveTo(20, 7); c.lineTo(20, 11); c.stroke();
  },
  comet(c){         // head + tail
    c.beginPath(); c.arc(13, 27, 6, 0, TAU); c.fill();
    c.lineWidth = 2.6;
    c.beginPath(); c.moveTo(18, 22); c.lineTo(33, 7); c.stroke();
    c.beginPath(); c.moveTo(14, 19); c.lineTo(25, 8); c.stroke();
    c.beginPath(); c.moveTo(21, 26); c.lineTo(32, 15); c.stroke();
  },
  crate(c){         // supply crate
    c.strokeRect(9, 12, 22, 18);
    c.beginPath(); c.moveTo(9, 18); c.lineTo(31, 18); c.stroke();
    c.beginPath(); c.moveTo(20, 18); c.lineTo(20, 30); c.stroke();
    c.beginPath(); c.moveTo(16, 12); c.lineTo(16, 18); c.moveTo(24, 12); c.lineTo(24, 18); c.stroke();
  },
  vault(c){         // safe door with dial
    c.strokeRect(8, 8, 24, 24);
    c.beginPath(); c.arc(20, 20, 6.5, 0, TAU); c.stroke();
    for(let i=0;i<4;i++){
      const a = i*TAU/4 + TAU/8;
      c.beginPath();
      c.moveTo(20 + Math.cos(a)*6.5, 20 + Math.sin(a)*6.5);
      c.lineTo(20 + Math.cos(a)*10, 20 + Math.sin(a)*10);
      c.stroke();
    }
  },
  wings(c){         // pilot wings, centre boss
    c.beginPath(); c.arc(20, 20, 4, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(15, 19); c.quadraticCurveTo(6, 14, 4, 20);
    c.quadraticCurveTo(9, 22, 15, 23); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(25, 19); c.quadraticCurveTo(34, 14, 36, 20);
    c.quadraticCurveTo(31, 22, 25, 23); c.closePath(); c.fill();
  },
  rosette(c){       // ribbon rosette
    c.beginPath(); c.arc(20, 16, 8, 0, TAU); c.fill();
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(16, 23); c.lineTo(13, 34); c.stroke();
    c.beginPath(); c.moveTo(24, 23); c.lineTo(27, 34); c.stroke();
  },
  hundred(c){       // the number, set in the game's face
    c.font = "700 17px Rajdhani, Arial, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("100", 20, 21);
    c.beginPath(); c.moveTo(9, 30); c.lineTo(31, 30); c.stroke();
  },
  nova(c){          // a star going up in rays
    for(let i=0;i<8;i++){
      const a = i*TAU/8;
      c.beginPath();
      c.moveTo(20 + Math.cos(a)*8, 20 + Math.sin(a)*8);
      c.lineTo(20 + Math.cos(a)*16, 20 + Math.sin(a)*16);
      c.stroke();
    }
    c.beginPath(); c.arc(20, 20, 5, 0, TAU); c.fill();
  },

  expand(c){        // fullscreen corners
    [[6, 14, 6, 6, 14, 6], [26, 6, 34, 6, 34, 14],
     [34, 26, 34, 34, 26, 34], [14, 34, 6, 34, 6, 26]]
      .forEach(([x1, y1, x2, y2, x3, y3]) => {
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.stroke();
      });
  },
  contract(c){      // exit-fullscreen corners
    [[14, 6, 14, 14, 6, 14], [26, 6, 26, 14, 34, 14],
     [34, 26, 26, 26, 26, 34], [6, 26, 14, 26, 14, 34]]
      .forEach(([x1, y1, x2, y2, x3, y3]) => {
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.stroke();
      });
  },
};

/** Draws glyph `name` into `canvas`, filling it, in `color`. */
function paint(canvas, name, color){
  const fn = P[name];
  const c = canvas.getContext && canvas.getContext("2d");
  if(!fn || !c) return false;
  const w = canvas.width, h = canvas.height;
  c.clearRect(0, 0, w, h);
  c.save();
  c.scale(w / 40, h / 40);
  c.strokeStyle = color; c.fillStyle = color;
  c.lineWidth = 3; c.lineCap = "round"; c.lineJoin = "round";
  c.shadowColor = color; c.shadowBlur = 4;
  try { fn(c); } catch(e){ /* a glyph must never break a screen */ }
  c.restore();
  return true;
}

/** A ready-to-insert canvas: CSS `px` square, drawn at 2x for retina. */
function el(name, color, px){
  const cv = document.createElement("canvas");
  cv.width = px * 2; cv.height = px * 2;
  cv.style.width = px + "px"; cv.style.height = px + "px";
  cv.className = "icon-glyph";
  paint(cv, name, color);
  return cv;
}

/* Which motif each medal wears. One shared gold-disc treatment + a bespoke
   glyph per medal keeps 28 awards reading as one set - the thing the emoji
   grid never managed. Unknown ids fall back to the plain star. */
const MEDAL_GLYPH = {
  first_blood:"damage",  sharpshooter:"homing",  combo_master:"rapid",
  first_win:"flag",      three_star:"star",      star_hoard:"stars3",
  rescuer:"pilot",       boss_slayer:"skull",    boss_hunter:"jolly",
  untouchable:"armour",  century:"hundred",      thousand:"comet",
  high_roller:"fortune", warchest:"vault",       first_upgrade:"parts",
  maxed_one:"extras",    quartermaster:"crate",  big_spender:"crown",
  ace_pilot:"wings",     veteran_wings:"rosette",nightmare:"overdrive",
  campaign:"trophy",     daily_ace:"dice",       daily_iron:"timer",
  gauntlet:"thrusters",  devourer:"nova",        rush_master:"banner",
};

/**
 * A medal: ribbon straps behind a gold disc, the medal's own motif struck
 * into the face. Locked medals keep the shape in gunmetal so the shelf shows
 * what is missing, not blank slots.
 */
function medal(id, px, locked){
  const cv = document.createElement("canvas");
  cv.width = px * 2; cv.height = px * 2;
  cv.style.width = px + "px"; cv.style.height = px + "px";
  cv.className = "icon-glyph";
  const c = cv.getContext("2d");
  if(!c) return cv;
  c.scale(px / 20, px / 20);          // same 40x40 box the painters use

  // Ribbon straps, meeting behind the top of the disc.
  c.fillStyle = locked ? "#2b3044" : "#c2123a";
  c.beginPath(); c.moveTo(11, 2); c.lineTo(19, 2); c.lineTo(17, 15); c.lineTo(9, 12);
  c.closePath(); c.fill();
  c.fillStyle = locked ? "#232738" : "#9b0e2e";
  c.beginPath(); c.moveTo(21, 2); c.lineTo(29, 2); c.lineTo(31, 12); c.lineTo(23, 15);
  c.closePath(); c.fill();

  // The disc. Gold face lit from the upper left; a darker rolled rim.
  const cx = 20, cy = 24, r = 13.5;
  const face = c.createRadialGradient(cx - r*0.4, cy - r*0.45, r*0.15, cx, cy, r);
  if(locked){
    face.addColorStop(0, "#4a5068"); face.addColorStop(0.7, "#31374c"); face.addColorStop(1, "#232838");
  } else {
    face.addColorStop(0, "#ffe9ae"); face.addColorStop(0.55, "#f5b93c"); face.addColorStop(1, "#c07a12");
  }
  c.save();
  if(!locked){ c.shadowColor = "rgba(245,166,35,0.55)"; c.shadowBlur = 6; }
  c.fillStyle = face;
  c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
  c.restore();
  c.lineWidth = 1.6;
  c.strokeStyle = locked ? "rgba(255,255,255,0.18)" : "#8a5406";
  c.beginPath(); c.arc(cx, cy, r - 0.8, 0, TAU); c.stroke();

  // The motif, struck into the face - dark on gold, like a coin.
  const fn = P[MEDAL_GLYPH[id]] || P.star;
  c.save();
  c.translate(cx, cy); c.scale(0.5, 0.5); c.translate(-20, -20);
  const ink = locked ? "rgba(200,210,235,0.5)" : "#6b3d08";
  c.strokeStyle = ink; c.fillStyle = ink;
  c.lineWidth = 3.4; c.lineCap = "round"; c.lineJoin = "round";
  try { fn(c); } catch(e){ /* a glyph must never break a screen */ }
  c.restore();
  return cv;
}

SF.icons = { paint, el, medal, names: Object.keys(P) };
})();
