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

/* ---------------------------------------------------------
   POINTER LOCK - fullscreen that actually holds on
   ---------------------------------------------------------
 * Steering everywhere on screen (§8y2) fixed the letterbox bars but left the
 * real edges: run the cursor off the bottom of a Mac and the Dock slides up
 * over the game; run it off the top and the menu bar and the browser's "Exit
 * Full Screen" button are waiting. Neither is something a page can veto - the
 * Dock answers to the OS cursor, and there is no web API that reaches it.
 *
 * The only lever a page actually has is to make there BE no OS cursor.
 * Pointer lock hands us raw movement deltas instead, and we keep the cursor
 * ourselves, clamped to the window - so it cannot arrive at an edge, cannot
 * summon the Dock, and cannot reach anything that would drop fullscreen.
 *
 * §8y2 rejected pointer lock for a real reason: it takes every mouse event
 * hostage, and the pause, mute and ability buttons are DOM elements over the
 * canvas. That cost is paid back below - we own the cursor, so we can hit-test
 * it against the HUD ourselves and synthesise the press. The buttons keep
 * working; they just answer to our cursor rather than the system's.
 */
const INTERACTIVE = "button, a, input, select, textarea, [role=button]";
let locked = false;              // the OS cursor is ours
let lockX = 0, lockY = 0;        // our cursor, in client coordinates
let reticle = null, hovered = null;
let releasing = false;           // we asked for the unlock - not an Esc

function lockSupported(){
  return !!(document.documentElement.requestPointerLock && document.exitPointerLock);
}

/**
 * Requested right after fullscreen is granted, and again on any click made
 * while fullscreen without it (coming back from another tab drops the lock,
 * and re-taking it needs a fresh gesture).
 */
function lockPointer(){
  if(!lockSupported() || locked || !document.fullscreenElement) return;
  lockX = window.innerWidth/2;
  lockY = window.innerHeight*0.72;      // near the ship, so nothing jumps
  try {
    const r = document.fullscreenElement.requestPointerLock();
    if(r && r.catch) r.catch(() => {});
  } catch(e){ /* Safari can refuse; fullscreen still works, just unlocked */ }
}
function unlockPointer(){
  if(!locked) return;
  releasing = true;
  try { document.exitPointerLock(); } catch(e){}
}
function isPointerLocked(){ return locked; }

/** A ring that appears only over something clickable - see hover(). */
function place(){
  if(!reticle) return;
  reticle.style.left = lockX + "px";
  reticle.style.top  = lockY + "px";
}
function showReticle(on){
  if(!on && !reticle) return;
  if(!reticle){
    reticle = document.createElement("div");
    reticle.id = "vcursor";
    reticle.setAttribute("aria-hidden", "true");
    document.body.appendChild(reticle);
  }
  reticle.classList.toggle("on", !!on);
}
/*
 * The cursor is ours now, so :hover never fires. `vhover` stands in for it:
 * without some feedback, aiming an invisible cursor at a button is guesswork.
 */
function hover(raw){
  const el = raw && raw.closest ? raw.closest(INTERACTIVE) : null;
  if(el !== hovered){
    if(hovered) hovered.classList.remove("vhover");
    hovered = el;
    if(hovered) hovered.classList.add("vhover");
    showReticle(!!hovered);
  }
  place();
}

/*
 * Press whatever is under our cursor. The HUD is a mix by design - the
 * ability buttons listen for pointerdown so they fire instantly under a
 * thumb, everything else listens for click - so send both. No control in the
 * game listens for both, so nothing fires twice.
 */
function press(el){
  const base = { bubbles:true, cancelable:true, clientX:lockX, clientY:lockY };
  try {
    const pe = { ...base, pointerId:1, pointerType:"mouse", isPrimary:true };
    el.dispatchEvent(new PointerEvent("pointerdown", pe));
    el.dispatchEvent(new PointerEvent("pointerup", pe));
  } catch(e){ /* PointerEvent constructor missing: the click below still lands */ }
  if(el.focus) el.focus();
  if(el.click) el.click();
}

function keyDown(e){
  const k = e.key;
  if(k === "ArrowLeft" || k === "a" || k === "A") state.left = true;
  if(k === "ArrowRight"|| k === "d" || k === "D") state.right = true;
  if(k === "ArrowUp"   || k === "w" || k === "W") state.up = true;
  if(k === "ArrowDown" || k === "s" || k === "S") state.down = true;
  if(k === "b" || k === "B" || k === " ") state.bombPressed = true;
  if(k === "v" || k === "V" || k === "Shift") state.overdrivePressed = true;
  /*
   * In fullscreen, Escape is the one way out and it means exactly that - it
   * must not also pause on the way. `p` still pauses, and outside fullscreen
   * Escape keeps its old job.
   */
  if(k === "p" || k === "P" || (k === "Escape" && !document.fullscreenElement))
    state.pausePressed = true;
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
    if(locked) return;                       // clientX is meaningless under lock
    /*
     * ONE FINGER FLIES. There is one iPad and there are two brothers: a palm
     * resting on the edge of the screen, a second child reaching in, or a stray
     * thumb during a boss fight used to take the ship instantly, because this
     * overwrote dragPointerId whichever pointer arrived. It read as the game
     * glitching, and mid-fight it was unrecoverable. A mouse may still take
     * over from anything - there is only ever one of those.
     */
    if(dragPointerId !== null && e.pointerType === "touch") return;
    state.dragging = true; dragPointerId = e.pointerId; pointerToVirtual(e.clientX, e.clientY, liftFor(e));
  });
  window.addEventListener("pointermove", e => {
    if(locked) return;                       // the locked handler steers instead
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

  /* ---- locked steering ------------------------------------------------ */
  /*
   * Under lock the event carries deltas, not a position, so we integrate our
   * own and clamp it to the window. That clamp is the whole feature: the
   * cursor stops one pixel short of every screen edge, so the Dock is never
   * asked to appear and the browser's exit affordances are never reachable.
   * The ship is clamped again inside pointerToVirtual, so it still parks on
   * the nearest wall while the cursor sits out on a letterbox bar.
   */
  window.addEventListener("mousemove", e => {
    if(!locked) return;
    lockX = clamp(lockX + (e.movementX || 0), 0, window.innerWidth  - 1);
    lockY = clamp(lockY + (e.movementY || 0), 0, window.innerHeight - 1);
    hoverSteer = true; state.dragging = true;
    pointerToVirtual(lockX, lockY, 0);
    hover(document.elementFromPoint(lockX, lockY));
  });

  window.addEventListener("mousedown", e => {
    if(!locked){
      // Fullscreen without the lock: a tab switch dropped it, and taking it
      // back needs a gesture. This click is one.
      if(document.fullscreenElement) lockPointer();
      return;
    }
    const under = document.elementFromPoint(lockX, lockY);
    const hit = under && under.closest ? under.closest(INTERACTIVE) : null;
    if(hit){ e.preventDefault(); press(hit); }
  });

  document.addEventListener("pointerlockchange", () => {
    locked = !!document.pointerLockElement;
    if(locked){ releasing = false; return; }
    hover(null); showReticle(false);
    state.dragging = false; hoverSteer = false;
    if(releasing){ releasing = false; return; }
    /*
     * The lock went away and we didn't ask for it. On a desktop that means
     * Escape - the one exit we promised - so take fullscreen down with it,
     * and the player is out in a single press rather than two. A tab switch
     * lands here too, and there the right answer is to stay in fullscreen and
     * re-lock on their next click (see mousedown above).
     */
    if(!document.hidden && document.fullscreenElement)
      document.exitFullscreen().catch(() => {});
  });
}

/** Consumed once per frame by the game so a press fires exactly one action. */
function consumeBomb(){ const v = state.bombPressed; state.bombPressed = false; return v; }
function consumeOverdrive(){ const v = state.overdrivePressed; state.overdrivePressed = false; return v; }
function consumePause(){ const v = state.pausePressed; state.pausePressed = false; return v; }
function clearMovement(){
  state.up = state.down = state.left = state.right = false;
  state.dragging = false; hoverSteer = false;
}

SF.input = { state, attach, setField, consumeBomb, consumeOverdrive, consumePause, clearMovement,
             lockPointer, unlockPointer, isPointerLocked, lockSupported };
})();
