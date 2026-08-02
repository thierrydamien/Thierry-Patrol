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
- **The guns are automatic** — you never hold a fire button. All you do is
  fly, and set off specials.
- **Desktop:** arrow keys or WASD to fly **in any direction**. **B** (or
  Space) sets off a smart bomb.
- **Touch / iPad:** drag anywhere on the playfield to fly the ship around
  (it rides just above your finger, so your thumb never covers it), and
  tap the 💣 button (bottom-right) for a smart bomb. The special button
  only appears when you actually have a special to fire, and shows how
  many are left.
- **Most enemies shoot back**, firing straight down as they descend; on
  the harder tiers a share of them lead their shots at you instead (those
  are tinted purple). Only flying into an enemy or being hit costs a life
  — anything that gets past you just leaves the screen.
- A boss shows up every 3rd level (3, 6, 9...) with its own health bar.
- Chain kills quickly for a combo multiplier on score/money.
- Power-ups occasionally drift down mid-level — fly through to grab a
  temporary boost (rapid fire, spread shot, shield, 2x score, homing
  shot, or a screen-clearing bomb).
- 20 achievements to unlock, viewable from the menu.
- Bosses visibly come apart as you damage them — hit flashes, scorch
  marks, chunks torn out of the hull, smoke, then fire and a shudder when
  they're nearly done.
- Speaker icon in the top-right of the game mutes sound; setting is
  remembered per browser.

## About the sound
With automatic guns the shot sound plays several times a second all
session, so it's deliberately tiny: a soft triangle blip at about a third
of the old volume, rate-limited to at most one every 130ms (so a high fire
rate can't stack it into a buzzsaw) and slightly detuned each time so it
never drones. The punch was moved to the things worth hearing — hits,
explosions, level clears, boss alerts. If it's still too much, the ♪ button
in the top-right mutes everything and the setting sticks per browser.

## On an iPad
This is the main way it gets played, so: the playfield uses the whole
screen rather than a phone-sized strip, the page can't rubber-band scroll
or double-tap-zoom while you're steering, safe areas are respected, and
the Armory lays its shelves out two-up on a tablet-width screen. Sound is
unlocked on the first tap (iOS refuses to start audio any other way).
Nothing needs holding down — one thumb steers, and the only button is the
special-weapon trigger.

## The background
The nebula is drawn slightly oversized and drifted around inside that
margin — a slow camera pan, so there's never a seam — with three parallax
star layers scrolling over it at different speeds and the odd comet
streaking through. It all speeds up as the levels climb, so later levels
feel faster before an enemy even appears.

## Pilot ranks
Buying Armory levels earns rank: **Rookie Cadet → Wing Cadet → Squadron
Pilot → Flight Leader → Star Ace → Wing Commander → Space Legend →
Thierry Legend**. Your rank badge shows on the player picker, the menu
greeting and the Armory's pilot card, and a promotion pops a banner. The
game also calls you by your callsign when you clear a level or drop a
boss.

## Difficulty tiers
Pressing PLAY asks which mission you want. Harder tiers send faster,
armoured enemies that shoot more often — and from ACE upward, a share of
them aim at you instead of firing straight down — but they pay out far
more money, so a run on a hard tier funds a lot of Armory levels.

| Tier | Enemy speed | Armour | Aimed shots | Rate of fire | Pays | Unlocked by |
|---|---|---|---|---|---|---|
| ROOKIE | 0.7x | — | — | sparse | 0.7x | always (starts you with a spare life) |
| PILOT | 1x | — | — | 0.8x | 1x | always |
| ACE | 1.28x | +1 HP | 20% | 1x | 1.7x | reach level 4 on PILOT |
| VETERAN | 1.55x | +2 HP | 35% | 1.2x | 2.6x | reach level 5 on ACE |
| NIGHTMARE | 1.9x | +3 HP | 50% | 1.4x | 4x | reach level 6 on VETERAN |

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
