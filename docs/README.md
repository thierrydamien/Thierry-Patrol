# SkyForce — Thierry Family Edition (Web)

A browser port of the family's SkyForce game, playable on any phone,
tablet, or computer — no install, no NetBeans, no MySQL required.

This uses the **actual game art and controls** from the Java version —
the real `orange.png`/`red.png` ship and enemy sprites (same crop
rectangles as `Game_Graphics/loadImage.java`), the real `Menu.jpg` and
`BackNew.jpg` backgrounds, and hold-to-fire controls (not auto-fire).
Ship color tinting uses the same hue-preserving technique as
`Game_Graphics/ImageTint.java`. On top of that, the same small set of
additions as the Java version — callsigns, ship colors, the family
banner, the leaderboard, the Armory — plus the extra content that was
separately requested for the web version (bosses, combos, achievements,
power-ups, sound).

It does **not** share save data with the desktop Java version — this one
keeps each player's progress in the browser itself (`localStorage`), per
device.

## Playing it
Open `index.html` (or the hosted GitHub Pages URL once deployed). Pick
your name on the "Who's playing?" screen, then Play / Armory / Championship.
- **Desktop:** Arrow keys or A/D to move, **hold Space to fire** (matches
  the real game — it's not automatic).
- **Touch:** drag anywhere on the game to steer, **hold the FIRE button**
  (bottom-right) to shoot.
- A boss shows up every 3rd level (3, 6, 9...) with its own health bar.
- Chain kills quickly for a combo multiplier on score/money.
- Power-ups occasionally drift down mid-level — fly through to grab a
  temporary boost (rapid fire, spread shot, shield, 2x score, homing
  shot, or a screen-clearing bomb).
- 13 achievements to unlock, viewable from the menu.
- Speaker icon in the top-right of the game mutes sound; setting is
  remembered per browser.

## Files
- `index.html` — all screens (profile picker, menu, armory, leaderboard, game)
- `style.css` — visual styling
- `game.js` — all game logic, screen navigation, rendering, and persistence
- `assets/` — the real game art, copied from `SkyForce/src/Image/` (ship
  and enemy sprites pre-cropped/resized from the originals for faster
  loading — same crop rectangles as the Java loader, just smaller files)
- `_smoketest.js` — a jsdom-based smoke test covering navigation and the
  core game flow (not real canvas rendering, since jsdom doesn't implement
  that without native deps — this catches DOM/logic wiring bugs instead)

## Running the smoke test
```
npm install
npm test
```
The test drives a real ~60-simulated-second play session (oscillating
movement, real collisions, holding fire) rather than just checking menus,
and uses two inert test-only hooks (`window.__SKYFORCE_TEST_INVINCIBLE__`
and `window.__SKYFORCE_TEST_EASY_BOSS__`, both `undefined`/false in real
play) so it can reliably reach and verify the boss-defeat path.

For actually verifying visuals (not just logic), a separate one-off
screenshot harness was used (real image decoding + real canvas rendering
via the `canvas` npm package, which needs native libs like libcairo) —
not checked in here since it's a heavier dependency than the rest of this
project needs, but easy to recreate if useful for future changes.

## Notes / things to know
- Progress is per-browser (`localStorage`), not synced across devices.
  If Marc plays on the family tablet and later on a phone, those are two
  separate save files. Fine for now since it's just two players sharing
  a device most likely — worth flagging if that stops being true.
- Two players ("Marc" and "Charles") exist by default; use "+ Add Player"
  on the picker screen for anyone else.
