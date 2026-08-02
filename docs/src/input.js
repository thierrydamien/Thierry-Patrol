/*
 * InputManager. Keyboard + pointer, normalised into a tiny state object the
 * player entity reads. Nothing else in the game touches DOM events.
 *
 * Touch steering follows the finger with the ship lifted above it (so a thumb
 * never covers the ship) and tracks the pointer id, so releasing an ability
 * button with the other hand doesn't drop your steering finger.
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

function pointerToVirtual(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  state.dragX = clamp((clientX - rect.left) / rect.width * VW, 0, VW);
  state.dragY = clamp((clientY - rect.top) / rect.height * VH - TOUCH_LIFT, 0, VH);
}

function attach(canvasEl, vw, vh){
  canvas = canvasEl; VW = vw; VH = vh;
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  canvas.addEventListener("pointerdown", e => {
    state.dragging = true; dragPointerId = e.pointerId; pointerToVirtual(e.clientX, e.clientY);
  });
  window.addEventListener("pointermove", e => {
    if(state.dragging && e.pointerId === dragPointerId) pointerToVirtual(e.clientX, e.clientY);
  });
  const end = e => { if(e.pointerId === dragPointerId){ state.dragging = false; dragPointerId = null; } };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/** Consumed once per frame by the game so a press fires exactly one action. */
function consumeBomb(){ const v = state.bombPressed; state.bombPressed = false; return v; }
function consumeOverdrive(){ const v = state.overdrivePressed; state.overdrivePressed = false; return v; }
function consumePause(){ const v = state.pausePressed; state.pausePressed = false; return v; }
function clearMovement(){ state.up = state.down = state.left = state.right = false; state.dragging = false; }

SF.input = { state, attach, consumeBomb, consumeOverdrive, consumePause, clearMovement };
})();
