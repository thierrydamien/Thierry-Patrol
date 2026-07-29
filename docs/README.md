# SkyForce — Thierry Family Edition (Web)

A browser port of the family's SkyForce game, playable on any phone,
tablet, or computer — no install, no NetBeans, no MySQL required.

This is a from-scratch JS/HTML5 canvas rewrite of the Java game's design:
same idea (levels, money economy, Armory upgrades, callsigns, ship colors,
family leaderboard), reimplemented for the browser. It does **not** share
save data with the desktop Java version — this one keeps each player's
progress in the browser itself (`localStorage`), per device.

## Playing it
Open `index.html` (or the hosted GitHub Pages URL once deployed). Pick
your name on the "Who's playing?" screen, then Play / Armory / Championship.
- **Desktop:** Arrow keys or A/D to move, cannon auto-fires.
- **Touch:** drag anywhere on the game to steer, cannon auto-fires.

## Files
- `index.html` — all screens (profile picker, menu, armory, leaderboard, game)
- `style.css` — visual styling
- `game.js` — all game logic, screen navigation, and persistence
- `_smoketest.js` — a jsdom-based smoke test covering navigation and the
  core game flow (not real canvas rendering, since jsdom doesn't implement
  that without native deps — this catches DOM/logic wiring bugs instead)

## Running the smoke test
```
npm install
npm test
```

## Notes / things to know
- Progress is per-browser (`localStorage`), not synced across devices.
  If Marc plays on the family tablet and later on a phone, those are two
  separate save files. Fine for now since it's just two players sharing
  a device most likely — worth flagging if that stops being true.
- Two players ("Marc" and "Charles") exist by default; use "+ Add Player"
  on the picker screen for anyone else.
