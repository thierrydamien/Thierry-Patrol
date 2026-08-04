/*
 * Pilot portraits - illustrated headshots, and nothing else.
 *
 * Two generations of procedurally drawn faces were reviewed by the customer
 * ("the teeth are so scary", "absolutely terrible") before the obvious lesson
 * landed: code-drawn faces have a quality ceiling well below "my kids will
 * love this", and the family's own illustrated art has none.
 *
 * So this module does one job: if assets/pilots/<name>.png exists (lowercase
 * profile name, square-ish headshot), paint() shows it circle-cropped in a
 * ring of the pilot's ship colour and returns true. If not, it paints nothing
 * and returns false, and every call site falls back to what the game showed
 * before faces existed - ships and insignia, which look good.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

const photos = {};   // name -> { img, ok, pending, waiters:[] }
function photoFor(name){
  if(!name) return null;
  const key = String(name).toLowerCase();
  let rec = photos[key];
  if(!rec){
    rec = photos[key] = { img: new Image(), ok: false, pending: true, waiters: [] };
    rec.img.onload = () => {
      // A load event with no pixels (broken file, jsdom) is not a portrait.
      rec.ok = (rec.img.naturalWidth || 0) > 0;
      rec.pending = false;
      rec.waiters.splice(0).forEach(fn => { try { fn(); } catch(e){} });
    };
    rec.img.onerror = () => { rec.ok = false; rec.pending = false; rec.waiters.length = 0; };
    rec.img.src = "assets/pilots/" + encodeURIComponent(key) + ".png";
  }
  return rec;
}

/** True once this pilot has an installed portrait. */
function has(name){
  const rec = photoFor(name);
  return !!(rec && rec.ok);
}

/**
 * Paints the pilot's installed portrait centred on (cx, cy) in a box of size
 * S: circle-cropped, ringed in their ship colour. Returns false (and paints
 * nothing) when there is no portrait - callers keep their old rendering.
 */
function paint(ctx, cx, cy, S, profile){
  const rec = photoFor(profile && profile.name);
  if(!rec || !rec.ok) return false;
  const r = S*0.48;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  const iw = rec.img.naturalWidth || 1, ih = rec.img.naturalHeight || 1;
  const cover = (r*2) / Math.min(iw, ih);
  ctx.drawImage(rec.img, cx - iw*cover/2, cy - ih*cover/2, iw*cover, ih*cover);
  ctx.restore();
  ctx.strokeStyle = (profile && profile.shipColor) || "#3399ff";
  ctx.lineWidth = Math.max(2, S*0.045);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  return true;
}

/**
 * Mounts the portrait into a DOM element if one exists (repainting when a
 * still-loading image lands). Returns false when there is none - the caller
 * mounts whatever it used before.
 */
function mount(el, profile, px){
  if(!el || !profile) return false;
  const rec = photoFor(profile.name);
  if(!rec || (!rec.ok && !rec.pending)) return false;
  const size = px || 40;
  const render = () => {
    if(!rec.ok) return;
    el.innerHTML = "";
    const cv = document.createElement("canvas");
    cv.width = cv.height = size*2;
    cv.style.width = cv.style.height = size + "px";
    el.appendChild(cv);
    const c = cv.getContext("2d");
    if(c) paint(c, size, size, size*1.9, profile);
  };
  if(rec.ok){ render(); return true; }
  rec.waiters.push(render);
  return false;   // nothing shown yet - caller provides the fallback
}

SF.pilotart = { photoFor, has, paint, mount };
})();
