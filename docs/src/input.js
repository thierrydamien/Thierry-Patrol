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

/*
 * WHICHEVER ONE YOU LAST USED IS THE ONE FLYING.
 *
 * Hover steering made a trackpad play like glass, and in doing so it quietly
 * took the keyboard away. `state.dragging` latched true the moment the cursor
 * first crossed the playfield and never let go, and the player entity does not
 * ADD the pointer's pull to the keys - it overwrites the velocity with it. So
 * on any Mac, holding Left flew the ship RIGHT, back to wherever the cursor
 * happened to be resting. Measured before the fix: ship centred at 191, Left
 * held for six-tenths of a second, ship at 309 - the cursor's position.
 *
 * A passive hover now yields to the keys, and the pointer takes the ship back
 * when it actually MOVES. A held drag - a finger on glass, a mouse button
 * down - is not a hover and still outranks everything, because that is
 * somebody deliberately holding on.
 *
 * The threshold is what makes it usable rather than a fight: a hand resting on
 * a trackpad emits tiny moves, and without it the ship would be stolen back
 * mid-keypress by a knuckle.
 */
const RECLAIM_PX = 5;
let keysHaveIt = false;       // the keys took the ship off a hovering cursor
let hoverX = 0, hoverY = 0;   // the last pointer position we saw
let yieldX = 0, yieldY = 0;   // where it was standing when the keys took over

/** A movement key went down: the hover lets go, a real grip does not. */
function keysTakeOver(){
  if(!hoverSteer) return;
  hoverSteer = false;
  state.dragging = dragPointerId !== null;
  keysHaveIt = true;
  yieldX = hoverX; yieldY = hoverY;
}

/** True when the pointer is entitled to the ship. */
function pointerMeansIt(x, y){
  hoverX = x; hoverY = y;
  if(hoverSteer || !keysHaveIt) return true;    // already flying, or nobody took it
  if(Math.hypot(x - yieldX, y - yieldY) < RECLAIM_PX) return false;
  keysHaveIt = false;                            // a deliberate move: it is theirs
  return true;
}

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

/*
 * OUR CURSOR HAS TO BE SOMEWHERE YOU CAN SEE IT.
 *
 * Pointer lock means the OS cursor is gone and this ring is the only cursor
 * there is - and it used to be drawn ONLY while over something clickable. Off
 * a button it was nothing at all, so in fullscreen the pointer simply
 * vanished and finding it again meant waving the trackpad until something lit
 * up. A cursor you have to search for is not a cursor.
 *
 * It is always drawn while locked now, in two strengths: a small dim ring
 * that says "your pointer is here", and the bright one over anything
 * clickable. In flight the quiet ring is worth having on its own - the ship
 * springs TOWARD the pointer and lags behind it, so the ring is the steering
 * target, which is information the game was hiding.
 */
function place(){
  if(!reticle) return;
  reticle.style.left = lockX + "px";
  reticle.style.top  = lockY + "px";
}
function showReticle(on, hot){
  if(!on && !reticle) return;
  if(!reticle){
    reticle = document.createElement("div");
    reticle.id = "vcursor";
    reticle.setAttribute("aria-hidden", "true");
    document.body.appendChild(reticle);
  }
  reticle.classList.toggle("on", !!on);
  reticle.classList.toggle("hot", !!hot);
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
  }
  // Always on while the pointer is ours; bright only over something tappable.
  showReticle(locked, !!hovered);
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
  const was = state.left || state.right || state.up || state.down;
  if(k === "ArrowLeft" || k === "a" || k === "A") state.left = true;
  if(k === "ArrowRight"|| k === "d" || k === "D") state.right = true;
  if(k === "ArrowUp"   || k === "w" || k === "W") state.up = true;
  if(k === "ArrowDown" || k === "s" || k === "S") state.down = true;
  // Steering with the keys means the hovering cursor is not steering.
  if(!was && (state.left || state.right || state.up || state.down)) keysTakeOver();
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

/*
 * THE SKY RIVER'S GRIP ON THE STICK.
 *
 * The ship follows the pointer with a spring strong enough to hold station
 * against ~any push (gain 12: a 150px/s stream reaches equilibrium with the
 * ship sitting twelve pixels off the finger - invisible). So a current that
 * merely shoves the hull is a current the controls silently delete, which is
 * exactly the bug the level shipped with.
 *
 * What a river actually does to a steered boat is move the WATER the stick
 * steers relative to. `flowX` is that: an offset on the point the pointer
 * names. It is applied in two places because pointers have two behaviours -
 * at event time here, so a finger actively steering carries the drift with
 * it, and per-frame via flowNudge, so a motionless mouse drifts too (a still
 * mouse fires no events, and the first cut only worked while wiggling).
 * The game relaxes it whenever the ship is out of the stream.
 */
let flowX = 0;
function flowNudge(dx){
  flowX = clamp(flowX + dx, -VW*0.55, VW*0.55);
  if(state.dragging || hoverSteer) state.dragX = clamp(state.dragX + dx, 0, VW);
}
function flowRelax(dt){
  if(!flowX) return;
  const d = -flowX * Math.min(1, dt*1.8);
  flowX += d;
  if(Math.abs(flowX) < 0.5) flowX = 0;
  if(state.dragging || hoverSteer) state.dragX = clamp(state.dragX + d, 0, VW);
}

function pointerToVirtual(clientX, clientY, lift){
  const rect = canvas.getBoundingClientRect();
  state.dragX = clamp((clientX - rect.left) / rect.width * VW + flowX, 0, VW);
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
      // A pointer that has not really moved does not get to interrupt the keys.
      if(!pointerMeansIt(e.clientX, e.clientY)) return;
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
    // Same rule under lock: the cursor is ours, but the keys can still have
    // the ship until somebody actually moves it.
    hover(document.elementFromPoint(lockX, lockY));
    if(!pointerMeansIt(lockX, lockY)) return;
    hoverSteer = true; state.dragging = true;
    pointerToVirtual(lockX, lockY, 0);
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
    if(locked){
      releasing = false;
      // Draw it the moment the lock lands, at the spot lockPointer parked it,
      // rather than leaving the screen cursor-less until the first move.
      showReticle(true, false);
      place();
      return;
    }
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
  // A clean slate, so the next pointer move re-acquires however small it is.
  // Leaving the yield point standing here made an untouched cursor unable to
  // take the ship back after a pause, which is not what "clear" means.
  keysHaveIt = false;
  flowX = 0;      // the river does not follow you out of its own mission
}

SF.input = { state, attach, setField, consumeBomb, consumeOverdrive, consumePause, clearMovement,
             flowNudge, flowRelax,
             _hoverSteering: () => hoverSteer,
             lockPointer, unlockPointer, isPointerLocked, lockSupported };
})();
