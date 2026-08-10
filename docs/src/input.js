/*
 * InputManager. Keyboard + pointer, normalised into a tiny state object the
 * player entity reads. Nothing else in the game touches DOM events.
 *
 * Touch steering follows the finger with the ship lifted above it (so a thumb
 * never covers the ship) and tracks the pointer id, so releasing an ability
 * button with the other hand doesn't drop your steering finger.
 *
 * Mouse steering is the same idea without the hold: the ship follows the
 * pointer whenever it is over the playfield, button up or down, so a Mac
 * trackpad plays like the iPad's glass. No lift for a cursor - it doesn't
 * hide the ship the way a thumb does.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp } = SF.core;

const state = {
  up:false, down:false, left:false, right:false,
  dragging:false, dragX:0, dragY:0,
  bombPressed:false, overdrivePressed:false, pausePressed:false,
};

let canvas = null, VW = 390, VH = 620;
const TOUCH_LIFT = 48;   // keeps a thumb clear of the (now larger) ship
let dragPointerId = null;
let hoverSteer = false;  // mouse steering with no button held (see pointermove)

function keyDown(e){
  const k = e.key;
  if(k === "ArrowLeft" || k === "a" || k === "A") state.left = true;
  if(k === "ArrowRight"|| k === "d" || k === "D") state.right = true;
  if(k === "ArrowUp"   || k === "w" || k === "W") state.up = true;
  if(k === "ArrowDown" || k === "s" || k === "S") state.down = true;
  if(k === "b" || k === "B" || k === " ") state.bombPressed = true;
  if(k === "v" || k === "V" || k === "Shift") state.overdrivePressed = true;
  if(k === "p" || k === "P" || k === "Escape") state.pausePressed = true;
  if(k === " " || k === "ArrowUp" || k === "ArrowDown") e.preventDefault();
}
function keyUp(e){
  const k = e.key;
  if(k === "ArrowLeft" || k === "a" || k === "A") state.left = false;
  if(k === "ArrowRight"|| k === "d" || k === "D") state.right = false;
  if(k === "ArrowUp"   || k === "w" || k === "W") state.up = false;
  if(k === "ArrowDown" || k === "s" || k === "S") state.down = false;
}

function pointerToVirtual(clientX, clientY, lift){
  const rect = canvas.getBoundingClientRect();
  state.dragX = clamp((clientX - rect.left) / rect.width * VW, 0, VW);
  state.dragY = clamp((clientY - rect.top) / rect.height * VH - lift, 0, VH);
}

/* The lift exists because a thumb hides what's under it. A cursor hides
   nothing - lifting for a mouse would park the ship 48px above where the
   player is pointing, and make "put the ship exactly there" impossible. */
const liftFor = e => e.pointerType === "touch" ? TOUCH_LIFT : 0;

/**
 * The field can be re-measured after attach() (an iOS home-screen app only
 * learns its safe-area insets after the scripts have run), and a stale width
 * here maps a thumb to the wrong place - the ship would stop short of one edge
 * and overshoot the other.
 */
function setField(vw, vh){ VW = vw; VH = vh; }

function attach(canvasEl, vw, vh){
  canvas = canvasEl; VW = vw; VH = vh;
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  canvas.addEventListener("pointerdown", e => {
    state.dragging = true; dragPointerId = e.pointerId; pointerToVirtual(e.clientX, e.clientY, liftFor(e));
  });
  window.addEventListener("pointermove", e => {
    if(state.dragging && e.pointerId === dragPointerId){
      pointerToVirtual(e.clientX, e.clientY, liftFor(e));
      return;
    }
    /*
     * Hover steering. A Mac trackpad reaches the browser as a mouse: gliding
     * a finger across it moves the pointer with no button down. So for mouse
     * pointers the playfield itself is the touch surface - the ship chases
     * the pointer the moment it crosses the canvas and settles when it
     * leaves, no click required, same as a finger on the iPad. Touch never
     * takes this path: a touchscreen only emits pointermove while a finger
     * is down, and that case is the held-drag branch above.
     */
    if(dragPointerId !== null || e.pointerType !== "mouse") return;
    const r = canvas.getBoundingClientRect();
    /*
     * Fullscreen letterboxes a 3:4 playfield inside a 16:10 laptop display, so
     * the sky is flanked by wide black bars. Treating those as "outside" meant
     * the ship went dead the moment the pointer drifted onto one, and hunting
     * for an invisible cursor to get back was worse than the drift. In
     * fullscreen the whole screen IS the game: anywhere steers, and
     * pointerToVirtual's clamp parks the ship on the nearest edge. Windowed,
     * only the canvas counts - past it are the browser's own controls and
     * other apps, and nobody is flying with those.
     */
    const live = r.width > 0 && (!!document.fullscreenElement ||
      (e.clientX >= r.left && e.clientX <= r.right &&
       e.clientY >= r.top && e.clientY <= r.bottom));
    if(live){
      hoverSteer = true; state.dragging = true;
      pointerToVirtual(e.clientX, e.clientY, 0);
    } else if(hoverSteer){
      hoverSteer = false; state.dragging = false;
    }
  });
  const end = e => {
    if(e.pointerId === dragPointerId){
      dragPointerId = null;
      // Releasing a button doesn't drop a mouse the way lifting a finger
      // drops a touch - hover steering carries straight on through the click.
      state.dragging = hoverSteer;
    }
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/** Consumed once per frame by the game so a press fires exactly one action. */
function consumeBomb(){ const v = state.bombPressed; state.bombPressed = false; return v; }
function consumeOverdrive(){ const v = state.overdrivePressed; state.overdrivePressed = false; return v; }
function consumePause(){ const v = state.pausePressed; state.pausePressed = false; return v; }
function clearMovement(){
  state.up = state.down = state.left = state.right = false;
  state.dragging = false; hoverSteer = false;
}

SF.input = { state, attach, setField, consumeBomb, consumeOverdrive, consumePause, clearMovement };
})();
