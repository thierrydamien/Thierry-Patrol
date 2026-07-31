# SkyForce — Levels & Weapon Economy

## Setup (do this first)
1. Run `schema_updates.sql` against your existing `skyforce` MySQL database:
   `mysql -u root -p skyforce < SkyForce/schema_updates.sql`
   (Only adds a new `wallet` table — doesn't touch anything existing.)
2. Open the project in NetBeans as before and run it.

## What's new

**Levels** — `Game_Level/GameLevel.java` (new)
Replaces the old "enemy speed ramps with raw score" logic with 5 hand-tuned
levels (speed, spawn rate, enemies-per-wave, kills-to-clear, money bonus).
Clear enough kills and you advance, get a brief "LEVEL X INCOMING" banner,
and a money bonus. Past level 5 it keeps scaling endlessly so the game
doesn't just stop.

**Money & the Armory** — `Game_Shop/Shop.java` (new), reachable via a new
"Armory" button on the main menu.
Kill enemies to earn $2 each, plus a bonus on every level clear. Spend it on:
- Spread Shot — 3-way bullets ($150, permanent)
- Rapid Fire — faster fire rate ($120, permanent)
- Energy Shield — absorbs one hit per run ($100, permanent)
- Extra Life — +1 starting life, stacks up to 3 ($80 each)

Money and upgrades persist per-account in the new `wallet` table, so they
carry over between play sessions.

## Files touched
- `Game_Level/GameLevel.java` — new, level tuning data
- `Game_Shop/Shop.java` — new, the Armory screen (plain code, not a NetBeans
  `.form`, so it's safe to hand-edit — see note in the file)
- `Game_Enemy/Enemy.java` — speed now comes from the current level instead of
  a hardcoded score-threshold ladder
- `Game_Bullet/Bullet.java` — added optional horizontal drift for spread shot
- `Game_Player/Player.java` — wired up spread/rapid/shield/extra-lives
- `Game_Manager/GameManager.java` — level progression, money tracking,
  wallet load/save, HUD updates
- `Game_Menu/Menu.java` — added the Armory button (added in code, not via
  the GUI Builder, so reopening Menu.form in the designer won't touch it)
- `schema_updates.sql` — new, adds the `wallet` table

## Two pre-existing bugs fixed along the way (not something I went looking
for — both directly blocked the weapon feature from working)
1. **Fire rate timer reset every frame**, not just when a shot fired, so
   holding Space barely shot at all. Rapid Fire wouldn't have meant anything
   without this fix.
2. **Score/Lives HUD text only rendered when enemies were on screen** (it was
   drawn inside the enemy loop). That would've made the HUD vanish during
   the level-clear banner, so it's now drawn every frame regardless.

## Sound, combos, and boss fights (Java desktop version, later pass)
- `Game_Audio/SoundEngine.java`: procedurally synthesized sound effects
  (no audio files), same palette as the web version. Mute toggle on the
  main menu.
- Combo scoring: chaining kills within 1.3s scales score/money up to x3,
  shown in the HUD.
- `Game_Boss/Boss.java` + `Game_Bullet/EnemyBullet.java`: a boss appears
  every 3rd level, alternating between a spread volley and an aimed burst
  that tracks the player, with its own health bar. This required adding
  enemy projectiles to the Java version for the first time (previously
  only contact damage existed).
- Found and fixed a third pre-existing bug while wiring this up:
  `drawHud()`'s highscore query dereferenced `SignIn.dbConn` with no
  null-check, which would have crashed the game every single frame if
  the DB connection ever dropped mid-session. Now guarded.
- **Verified with a real integration test**, not just a compile check:
  a headless Xvfb display + the actual unmodified game code ran both
  boss encounters end-to-end (spread pattern at level 3, aimed pattern
  at level 6) — enemy bullets fired, boss HP dropped on hits, both
  bosses defeated, level progressed correctly past each. This was a
  one-off verification harness, not checked into the repo (it needs a
  non-headless JDK + Xvfb + reflection into private fields to drive a
  non-dodging test bot) — happy to package a reusable version if useful.

Everything compiles cleanly (checked with `javac` here). I can't run the
Swing GUI or hit a live MySQL instance from this sandbox, so please play-test
locally and tell me what needs rebalancing (costs, level pacing, kill
requirements) or what to add next (more weapons, a boss level, etc.).
