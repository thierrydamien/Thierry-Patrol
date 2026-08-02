# SkyForce — design & architecture notes

Written as a working document for whoever touches this next. It covers what
the game is now, why it's built the way it is, and what I'd do next.

---

## 1. Where the code was, and what was wrong with it

The previous version was a single 1,800-line `game.js`: one IIFE holding
config, DOM wiring, entity state, collision maths, rendering and persistence.
It worked, and it was fun for a bit, but it had the problems that stop a
hobby shooter from feeling commercial:

| Problem | Consequence |
|---|---|
| Everything in one scope | No way to change spawning without risking rendering |
| Endless waves, no goals | Every session felt the same; no reason to replay |
| Enemies were one archetype with a flag | No behavioural variety, no formations |
| Boss = HP bar + two attack patterns | No phases, no telegraphs, no weak points |
| Objects allocated per bullet/particle | GC stutter exactly when the screen is busiest |
| O(bullets × enemies) collisions | Fine at 30 enemies, ugly at 120 |
| Hard-coded level tuning | Adding a level meant editing the game loop |
| Progression = money → flat upgrades | No sense of mastery, only of shopping |

## 2. Architecture now

Plain scripts loaded in dependency order (no build step — it stays a static
site, and the smoke test loads the exact same sources the browser does).
Everything hangs off one global `SF`.

```
src/
  core.js          maths, seeded RNG, Pool, SpatialGrid
  audio.js         AudioManager: named sound hooks, synthesised, rate-limited
  data/config.js   upgrades, ranks, difficulty tiers, pick-ups, medals
  data/enemies.js  enemy archetypes, movement behaviours, formation shapes
  data/missions.js the campaign: waves, objectives, boss definitions
  profile.js       ProfileStore: save/load/migrate, stars, medals
  fx.js            ParticleManager + screen shake / hit-stop / flashes
  input.js         InputManager: keyboard + pointer → one state object
  entities.js      World: player + pooled bullets/enemies/pickups & their updates
  bosses.js        BossController: phases, telegraphed attacks, weak points
  systems.js       WaveDirector (spawning) + collision resolution
  render.js        Renderer: parallax layers, entities, boss damage, HUD
  game.js          GameStateManager: run lifecycle, objectives, main loop
  ui.js            every DOM screen + bootstrap
```

**The rules that keep it clean**

- Gameplay code never touches `ctx`; the renderer never mutates the world.
  That's why the whole game is testable headlessly in jsdom.
- The DOM layer talks to the game through exactly two seams: `SF.game.startMission()`
  and `SF.game.onMissionEnd`.
- Data is data. Enemies, formations, waves, bosses, upgrades, difficulty tiers
  and objectives are all tables. A new enemy is a table entry (plus a behaviour
  function only if it moves in a genuinely new way); a new level is a wave list.

**Entity/component vs. what I did.** A full ECS would be overkill at this
scale and would fight the JIT. Entities are flat records in pools, and
behaviour comes from the archetype's named function — data-oriented in the ways
that matter (contiguous reuse, no per-frame allocation, easy to add types)
without the ceremony.

## 3. Game feel

The things that actually make shooting feel good, in rough order of impact:

- **Momentum-based movement.** The ship accelerates, carries a little
  velocity and banks into turns. Touch steering is a spring toward the finger
  (lifted 36px so your thumb never covers the ship), not a teleport.
- **Hit-stop.** Heavy impacts freeze the simulation for 55–140ms while effects
  and audio keep running. Single cheapest trick in the book.
- **Layered kill feedback.** White flash on the sprite → sparks → tumbling
  debris with gravity → smoke → shockwave ring for big kills → screen shake
  scaled to what died → damage numbers on non-lethal hits.
- **Visible power curve.** Bullets change colour, size and glow with Plasma
  Rounds (yellow → orange → cyan → magenta), muzzle flashes grow, the shot
  sound drops in pitch. You can *see* your upgrades.
- **Quiet guns, loud impacts.** Automatic fire means a shot sound several
  times a second, so it's a soft triangle blip at ~⅓ volume, rate-limited to
  one per 110ms and detuned each time. All the punch lives in the explosions.
- **Coins.** Money is a physical drop you fly to collect (and can miss),
  which is what gives Tractor Beam a reason to exist.

## 4. Progression loop

```
fly a mission → collect coins + rescue pilots → earn stars for objectives
     ↑                                                    ↓
  harder tier pays 1.8-4.5x                    spend in the Armory
     ↑                                                    ↓
  stars unlock harder tiers  ←  gear makes hard tiers survivable
```

- **14 upgrades, 53 levels, ~$70k** to max out. Four colour-coded shelves:
  Guns, Staying Alive, Ship, Specials.
- **Abilities**: Smart Bomb and Overdrive are levelled upgrades with per-mission
  charges and their own buttons.
- **Ranks** (Rookie Cadet → Thierry Legend) come from gear owned, shown on the
  pilot picker, menu and Armory, with a promotion banner.
- **Stars** gate difficulty tiers (ACE at 6★, VETERAN at 14★, NIGHTMARE at 24★),
  so the campaign and the shop pull on each other.
- Every mission pays a completion bonus scaled by stars and difficulty —
  replaying mission 2 on VETERAN is a legitimate money strategy.

## 5. Mission design

Eight hand-built missions, each a timeline of waves plus an optional boss.
Three star objectives each, drawn from a shared table (`complete`, `kill90`,
`killAll`, `rescueAll`, `noDamage`, `keepLives`), tracked live in the HUD and
scored on the results screen.

Teaching curve: 1 = fly and shoot · 2 = moving targets · 3 = enemies that
shoot back · 4 = armour, then the first boss · 5 = kamikazes (dodging) ·
6 = rescue pressure · 7 = elites · 8 = everything + three-phase boss.

Rescue pods come from Prison Haulers: shoot the hauler before it escapes,
then fly to the pod. Missing one costs you a star, which is the good kind of
pressure — it changes how you play, not just whether you survive.

## 6. Enemies

Eight archetypes over seven behaviours: `dive`, `weave`, `hover` (holds
station and shoots), `swoop` (dives at your column), `kamikaze` (locks on and
accelerates), `turret` (parks and shells), `brute` (armoured, strafes away
from your fire on smart tiers), `carrier` (flees with a prisoner).

Any archetype can be promoted to **elite** (×3.5 HP, ×4 payout, gold glow,
always drops a power-up). Seven formation shapes (line, vee, arc, column,
twin columns, sides, scatter) with per-slot spawn delays.

Difficulty tiers change *behaviour*, not just numbers: `smart` unlocks
strafing and target-leading, `aimed` sets what share of shots lead you, and
`fireRate` scales how often anything shoots.

## 7. Bosses

Two encounters, both built from the same declarative shape:

- **Phases** trigger at health fractions and change speed, attack list and
  timing. The final phase is an enrage.
- **Five attacks**: spread volley, aimed burst, ring burst, sweeping beam,
  minion call — each with its own **telegraph** (charging ring, target lock,
  beam warning column, hatch flash) so nothing is a surprise.
- **Weak points** are destructible sub-hitboxes that take double damage and
  permanently disable the attack they power. Aim well and the fight gets
  easier — skill compounds instead of HP just dropping.
- Damage is composited onto the sprite: scorch marks burn in, chunks tear out
  of the silhouette below half health, smoke then fire, a shudder near death,
  and a staged blast when it dies.

## 8. Performance

- **Pools everywhere** (bullets 320, enemy bullets 400, enemies 140, pickups
  160, particles 900). Zero allocation in the hot loop; a hard cap recycles
  the oldest slot rather than growing.
- **Uniform-grid broadphase** (48px cells) for bullets vs enemies; everything
  else is a handful of circle tests.
- Frame-rate independent smoothing (`damp`), `dt` clamped at 50ms so a tab
  switch can't teleport anything.
- The next frame is queued *before* the work, so one bad frame can never
  freeze the game mid-run.

## 9. What I'd do next

Roughly in value order:

1. **Daily challenge** — the seeded RNG is already in `core.js`; one fixed
   seed per day, fixed loadout, leaderboard per family member.
2. **Ship classes** — a second hull with different stats (glass cannon vs
   tank), which doubles the reason to keep earning.
3. **Wingman AI** — drones that drift and target rather than firing straight.
4. **Sprite sheets** — the art is 3 PNGs recoloured at runtime; hand-drawn
   frames for the enemy types would lift the visuals more than any code change.
5. **Music** — a two-loop synth track (menu/combat) from the existing audio
   engine; no files needed.
6. **Endless mode** — after mission 8, procedurally generated waves using the
   same director, for score chasing.

## 10. Testing

- `npm test` — jsdom smoke test: loads the real sources, validates the data
  tables (every wave references a real enemy, every boss weak point disables a
  real attack, phases descend), then plays mission 1 to completion and a boss
  mission with a bot, asserting on stars, money, kills, pooling and save
  migration. ~45 checks.
- Visual checks are done with Chromium screenshots at iPad and phone sizes
  (throwaway harness, not checked in — see the README).
