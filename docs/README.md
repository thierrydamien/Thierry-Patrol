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
  the real game — it's not automatic). **B** sets off a smart bomb.
- **Touch:** drag anywhere on the game to steer, **hold the FIRE button**
  (bottom-right) to shoot, tap 💣 (bottom-left) for a smart bomb.
- A boss shows up every 3rd level (3, 6, 9...) with its own health bar.
- Chain kills quickly for a combo multiplier on score/money.
- Power-ups occasionally drift down mid-level — fly through to grab a
  temporary boost (rapid fire, spread shot, shield, 2x score, homing
  shot, or a screen-clearing bomb).
- 20 achievements to unlock, viewable from the menu.
- Speaker icon in the top-right of the game mutes sound; setting is
  remembered per browser.

## Difficulty tiers
Pressing PLAY asks which mission you want. Harder tiers send faster,
armoured enemies — and from ACE upward, some enemies shoot back (those
are tinted purple) — but they pay out far more money, so a run on a hard
tier funds a lot of Armory levels.

| Tier | Enemy speed | Armour | Shooters | Pays | Unlocked by |
|---|---|---|---|---|---|
| ROOKIE | 0.7x | — | — | 0.7x | always (starts you with a spare life) |
| PILOT | 1x | — | — | 1x | always |
| ACE | 1.28x | +1 HP | 12% | 1.7x | reach level 4 on PILOT |
| VETERAN | 1.55x | +2 HP | 22% | 2.6x | reach level 5 on ACE |
| NIGHTMARE | 1.9x | +3 HP | 32% | 4x | reach level 6 on VETERAN |

The screen shows your gear level and suggests a tier to match it. The
loop is deliberate: the tier that's brutal today becomes comfortable once
you've spent a few runs' earnings in the Armory.

## The Armory
13 upgrades, each with several levels that cost more as you climb — Spread
Shot, Rapid Fire, Plasma Rounds (damage), Piercing Rounds, Seeker Rounds,
Energy Shield, Extra Life, Ion Thrusters, Hull Plating, Tractor Beam,
Salvage Rig (money bonus), Wingman Drones, and Smart Bombs. 50 levels in
total, around **$65,000** to max out everything — an early run pays tens
of dollars, a strong run on a hard tier pays thousands, so it's a long
climb by design.

Saves made before the upgrade levels existed are migrated automatically:
each old one-off purchase becomes level 1 of the matching upgrade, and
the old best level is credited to PILOT.

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
The test drives two real play sessions (oscillating movement, real
collisions, holding fire) rather than just checking menus: ~60 simulated
seconds on PILOT and ~30 more on NIGHTMARE, so the difficulty-only paths
(armoured enemies, enemies returning fire, payout multipliers) actually
run. It also buys every upgrade to its cap, which both checks the cost
ladder and makes the play session exercise drones, piercing, seekers and
bombs. Two inert test-only hooks (`window.__SKYFORCE_TEST_INVINCIBLE__`
and `window.__SKYFORCE_TEST_EASY_BOSS__`, both `undefined`/false in real
play) let it reliably reach and verify the boss-defeat path.

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
