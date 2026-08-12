/*
 * YOUR OWN PAINT - the livery a kid draws themself.
 *
 * The Style Shop's hard-won rule (see LIVERY_ART in shipart.js) applies to
 * this too: at flight size the whole ship is about fifty pixels, so paint
 * either spans the hull or vanishes. So this is not a sticker on a wing -
 * the drawing IS a livery. A 12x12 grid is laid over the widest band of the
 * hull (wings and body), the kid fills cells with a finger, and the result
 * is worn exactly like a bought pattern: painted over every part, clipped
 * to the hull, everywhere the ship appears - flight, hangar, campaign map,
 * the finale fleet.
 *
 * The worn form is the encoded string itself, carried in profile.decal
 * under a "px1:" prefix. That is the entire integration: every place that
 * already hands `decal` along (loadout -> player -> renderer, the map, the
 * fleet) carries the drawing without knowing it exists, and it rides cloud
 * sync inside the record like any other field. The drawing also lives in
 * profile.paintjob, so stripping the hull or buying FLAME JOB never
 * destroys the artwork - it waits on the easel.
 *
 * This module is pure data + drawing (no DOM); the easel UI lives in ui.js.
 */
(function(){
"use strict";
const SF = window.SF;

const COLS = 12, ROWS = 12;
/*
 * Where the grid sits on the hull, in hull units (hull box of size S centred
 * on the origin, nose at -S/2): the band from just above the canopy down to
 * the tail. Square region, square cells - what the kid draws is what the
 * hull wears, undistorted.
 *
 * Deliberately UNCHANGED when the hull became a drawn one with a wider
 * wingspan: every saved "px1:" drawing maps cells through this box, so
 * moving it would silently shift years of saved art around the hull. The
 * silhouette fix lives entirely in HULL_POLY (shipart.js), which now traces
 * the visible hull by construction - so the mask below and the worn clip
 * follow the real wing edges instead of stopping along invisible diagonals.
 */
const REGION = { x:-0.30, y:-0.18, w:0.60, h:0.60 };

/*
 * Twelve pots, one row: bold flat colours that read on any hull paint, in
 * the same family as the game's own art (the gold is the game's gold, the
 * ink is the livery-border ink). Index 0 is "no paint" - the eraser.
 */
const PALETTE = ["#ffffff","#12161f","#ff3b30","#ff8a3d","#ffd23f","#35d461",
                 "#22d3ee","#3b82f6","#a855f7","#ff4fd8","#8a94a8","#9a6a3f"];
const PREFIX = "px1:";
const DIGITS = "0123456789abc";          // 0 = empty, 1..12 = palette pots

/** Is this decal value a kid drawing rather than a Style Shop pattern id? */
function isCustom(decal){
  return typeof decal === "string" && decal.slice(0, PREFIX.length) === PREFIX;
}

/** "px1:..." -> cell array, or null for anything malformed. Never throws. */
function decode(str){
  if(!isCustom(str)) return null;
  const body = str.slice(PREFIX.length);
  if(body.length !== COLS*ROWS) return null;
  const cells = new Array(COLS*ROWS);
  for(let i = 0; i < body.length; i++){
    const v = DIGITS.indexOf(body[i]);
    if(v < 0) return null;
    cells[i] = v;
  }
  return cells;
}

/** Cell array -> "px1:...". An untouched grid encodes to null: nothing to wear. */
function encode(cells){
  if(!cells || cells.length !== COLS*ROWS) return null;
  let out = "", any = false;
  for(let i = 0; i < cells.length; i++){
    const v = cells[i]|0;
    if(v < 0 || v >= DIGITS.length) return null;
    if(v) any = true;
    out += DIGITS[v];
  }
  return any ? PREFIX + out : null;
}

/*
 * The usable mask: a cell is paintable when its centre is on the hull, so
 * the easel is ship-shaped rather than a square that lies about the corners.
 * Built lazily from the SAME polygon shipart clips liveries with - one
 * silhouette, shared, so the easel and the worn paint can never disagree.
 */
let mask = null;
function buildMask(){
  const poly = SF.shipart.HULL_POLY;
  const inside = (x, y) => {
    let inWing = false;
    for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if((yi > y) !== (yj > y) && x < (xj - xi)*(y - yi)/(yj - yi) + xi) inWing = !inWing;
    }
    return inWing;
  };
  mask = new Array(COLS*ROWS);
  for(let r = 0; r < ROWS; r++){
    for(let c = 0; c < COLS; c++){
      const x = REGION.x + (c + 0.5)/COLS*REGION.w;
      const y = REGION.y + (r + 0.5)/ROWS*REGION.h;
      mask[r*COLS + c] = inside(x, y);
    }
  }
}
function usable(col, row){
  if(col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
  if(!mask) buildMask();
  return mask[row*COLS + col];
}

/*
 * One tiny canvas per drawing - a PIXEL per cell - blown up with smoothing
 * off wherever it's worn. One drawImage per frame instead of a hundred
 * fillRects, and the cells stay knife-crisp at any size.
 */
const sprites = new Map();
function sprite(str){
  if(sprites.has(str)) return sprites.get(str);
  const cells = decode(str);
  if(!cells) return null;
  const cv = document.createElement("canvas");
  cv.width = COLS; cv.height = ROWS;
  const ctx = cv.getContext("2d");
  if(!ctx) return null;
  for(let i = 0; i < cells.length; i++){
    if(!cells[i]) continue;
    ctx.fillStyle = PALETTE[cells[i] - 1];
    ctx.fillRect(i % COLS, Math.floor(i/COLS), 1, 1);
  }
  // The easel mints a new string per stroke while previewing; don't let a
  // long drawing session hold every intermediate frame forever.
  if(sprites.size > 64) sprites.clear();
  sprites.set(str, cv);
  return cv;
}

/** Wears the drawing on a hull of size S centred on the origin (shipart space). */
function paint(ctx, S, str){
  const img = sprite(str);
  if(!img) return;
  ctx.save();
  SF.shipart.hullClip(ctx, S);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, REGION.x*S, REGION.y*S, REGION.w*S, REGION.h*S);
  ctx.restore();
}

SF.paintjob = { COLS, ROWS, REGION, PALETTE, isCustom, decode, encode, usable, paint, sprite };
})();
