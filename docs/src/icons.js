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
 * Deliberately NOT covered: medal stickers and toast icons. An earned medal's
 * emoji lives inside a drawn disc and reads as a collectible sticker - 27
 * bespoke glyphs would be effort spent making the game less charming.
 *
 * API:
 *   SF.icons.paint(canvas, name, color)  - draws into an existing canvas
 *   SF.icons.el(name, color, px)         - returns a ready <canvas>
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

SF.icons = { paint, el, names: Object.keys(P) };
})();
