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
  data/comms.js    radio chatter: what gets said about what
  data/story.js    story beats: comic panels and the milestone ending
  profile.js       ProfileStore: save/load/migrate, stars, medals
  fx.js            ParticleManager + screen shake / hit-stop / flashes
  input.js         InputManager: keyboard + pointer → one state object
  entities.js      World: player + pooled bullets/enemies/pickups & their updates
  bosses.js        BossController: phases, telegraphed attacks, weak points
  systems.js       WaveDirector (spawning) + collision resolution
  render.js        Renderer: parallax layers, entities, boss damage, HUD
  shipart.js       the ship drawn from its upgrade levels: 21 bolt-on parts
  comms.js         which line plays when, and the pacing rules that stop noise
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

## 2b. The playfield (tablet-first)

The field is **800 tall, 440-640 wide**, chosen once at load from the device
aspect. On an iPad that lands at ~556-600 - so the playfield fills the glass
with no letterboxing, the 4:5 background art is cover-fitted instead of
squashed, and the ship has ~13 ship-widths of lateral room instead of the 8 it
had at the old phone-shaped 390x620. Landscape uses the full 640; phones get
440, which is proportioned rather than a thin band.

Widening was not a scale-up. Everything that lives in that space was retuned:

- **Formations rebuilt** for the width, with a shared 50px edge margin, plus
  three shapes that only make sense on a wide field: `tripleColumns` (three
  lanes), `wall` (a solid rank with one gap to thread), `pincer` (two diagonal
  streams crossing the middle).
- **Wave sizes up ~45%** across all eight missions so the extra area is
  populated - a wider screen with the old counts reads as empty.
- **Speeds up ~25%** (enemies, their shots, player bullets) because the field
  is 29% taller; pacing per screen-crossing is unchanged.
- **Player**: top speed 330 → 430 and acceleration to match, so crossing the
  wider field is still a fast, deliberate move rather than a slog.
- **Sprites up ~22%**, four hover bands instead of three, wider weave
  amplitudes, wider brute strafing, wider boss patrol and beam.
- **HUD re-laid out** for the aspect: score left, mission centre, wallet right,
  lives and mission bar on a second row, all positioned relative to VW.
- **Star density is per-area**, so the parallax doesn't thin out.

`entities.js` is the only file that states the field size; everything else
derives from `SF.entityConst`. The smoke test asserts no formation can place
an enemy outside the field at any supported width.

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
**Each runs 2-3.5 minutes** (the campaign is ~20 minutes of flying): missions
are written as three or four acts with deliberate lulls between them, a
halfway callout and cash bonus at the midpoint, and rising density toward a
finale. The first pass at 30-45 seconds each was simply too short to build any
tension - a mission ended before the loadout you'd bought had a chance to
matter.
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

## 8b. Two rules the systems enforce

Both of these came out of instrumented playtests where missions failed to end:

- **Nothing may park on the field forever.** A mission ends when the field is
  clear, so an enemy that can't leave is a soft-lock. Gun Platforms now have a
  tour of duty, and every enemy carries a 28-second leash after which it dives
  away whatever its behaviour says.
- **No gameplay timing on the wall clock.** The boss-defeat celebration used a
  `setTimeout`, which meant a mission could sit in the boss phase with the boss
  already dead. Delays that gate progress are simulation timers, ticked in
  `update()`, so they respect pause and can't be dropped.

Related geometry rule: the ship's ceiling (`PLAY_TOP`) must sit *below* where
bosses park. When it didn't, bullets spawned above the boss and sailed past it
- the fight was unwinnable from the top of the screen.

## 8c. Designing it for two specific kids

Everything above is generic arcade-shooter craft. What makes this *theirs* is
that the game knows there is more than one of them and that they are children:

- **The other pilot is content, not a leaderboard row.** `P.squadmates()` feeds
  `buildLoadout`, so Wingman Drones are flown by the household's other pilots -
  their colour, their callsign under the sprite. Nothing about the drone system
  changed; the data it reads did.
- **Every mission card carries a household record** (`P.familyBest()` scans all
  profiles). "Charlie holds this · 5120" is a far stronger hook at this age than
  an abstract high score, and it makes replaying a mission you've already
  three-starred worth doing.
- **Failure is softened, not hidden.** "SHIP DOWN", the percentage you reached,
  and the fact that you keep every coin. The run still failed and the stars are
  still unearned - the framing just doesn't scold.
- **Identity is cheap and immediate.** A badge is one tap and free, unlike gear;
  it sits next to the rank badge you earn, so there's a thing to express and a
  thing to work toward.
- **The copy is at reading level.** Upgrade descriptions and mission briefs are
  written for an 8-year-old ("Little robot buddies fly next to you and shoot
  too"), and the smoke test asserts none of them is missing.

Deliberately *not* done, because it needs facts about the kids I don't have:
real names/photos in the art, birthdays, favourite colours as defaults, or
voice lines. Those belong to whoever knows them.

## 8d. Making progress physical

Two systems, one idea: the numbers should show up somewhere you can look at.

**One screen, not two.** The hangar and the Armory are the same screen, because
buying a part and seeing it appear are the same moment - a navigation step
between them puts the payoff somewhere the purchase isn't. The ship bay is
`position: sticky` inside the scrolling `.screen`, so it stays on the glass
while you shop. The shelves are tabs rather than one long scroll: four
categories plus a parts ladder and a pilot tab, one on screen at a time, which
gets a whole shelf onto an iPad with no scrolling at all. The pilot tab's
markup lives in a `<template>` and is cloned on demand, so the ids it owns
only exist while it's open (`renderPilotCard` returns early if it isn't).

**The hangar and `shipart.js`.** A single procedural pass draws a pilot's ship
from a plain `{upgradeId: level}` object - hull sprite plus one bolted-on part
per upgrade tier owned, 21 parts over the 14 tracks. It takes no gameplay
state, which is what lets the *same function* draw the hangar, the comms
portrait and the story panels. The declaration order of `PARTS` is the ladder,
so `nextPart()` doubles as a suggested build path, and the hangar ghosts that
part onto the hull at ~30% alpha: there is always something visibly missing.
Compare mode draws stock and current at identical scale, because a
transformation you can't A/B doesn't read as one.

The hangar's idle loop queues its *next* frame last (the opposite of the game
loop, which queues first so a bad frame can't freeze it) - an idle animation
must stop dead when you leave the screen rather than keep a callback alive
behind every other screen.

One layout rule earned its place: `.screen` is a scrolling flex column, and
flex items shrink by default, so a fixed-ratio block (the ship bay) got crushed
into a strip on a short viewport instead of the page scrolling - visible at
100% browser zoom, invisible at 75%. Nothing on a scrolling screen should ever
be shrunk to fit, so `flex-shrink` is off for every direct child except on the
playfield, which is deliberately window-sized.

**Comms.** `comms.js` holds one active line, never a queue: if something better
happens mid-line it takes over. Pacing is three rules - a per-event cooldown, a
minimum gap between any two lines, and one panel at a time - which is what
keeps a system that fires on *pick-ups and near misses* from becoming noise.
Near misses are detected by scanning the (bounded) enemy-bullet pool for a
shot that got inside a 26px ring while level with the ship without touching
it: cheap, and it's the moment kids actually feel.

Worth noting: adding comms shifted the global RNG stream and broke a smoke-test
assertion that checked enemies were alive *on one specific frame*. The check
was wrong, not the code - it now asserts cumulative spawns. Any test that
depends on the exact frame something happens is a test that will flap.

## 8e. Boss scaling, and the bug underneath it

The complaint was "bosses die way too easily". Instrumenting it first was worth
more than any amount of re-tuning, because it found two separate causes.

**A boss sized in hit points cannot work.** Measured single-target DPS runs
~4 for a stock ship, 81 mid-game and 295 maxed - a **70x** span - while boss
health scaled 2.2x with the difficulty tier and not at all with gear. A maxed
ship killed the Sky Sentinel in five seconds. Bosses are now sized in *seconds
of fight*: `hp = fightSeconds x dps x ACCURACY x tier`, where `dps` comes from
the loadout and ACCURACY (0.32) is measured from instrumented bot runs, not
guessed. Because the pool derives from firepower, fight length is independent
of gear - and one constant moves every boss fight at once.

**And a real bug was doing most of the damage.** `pierceLeft` is recomputed
every frame, so a piercing bullet that survived hitting the boss stayed alive
*inside* the boss hitbox and re-damaged it on every subsequent frame - up to 48
hits from a single bullet against a big target. Enemies hid this because they
die and get removed; a boss just sits there. Bullets now carry a `hitBoss` flag
and can damage a boss exactly once, whatever their pierce. The smoke test
asserts it directly.

Worth keeping in mind for whatever comes next: any per-frame "how many things
may this hit" counter is a bug waiting to happen against a target that doesn't
die on the first hit.

## 8f. Interactions, not just more enemies

The other complaint was repetition. The fix wasn't more shooting archetypes -
it was four things that need a *different answer*:

- **Guardian**: a shield dome over everything near it, so your shots splash
  off. Recomputed from scratch every frame rather than tracked as state, which
  means killing the Guardian drops the bubble on everyone instantly with no
  bookkeeping and no stale flags.
- **Splitter**: bursts into three homing shards, so the kill escalates.
- **Coin Thief**: hunts loose coins and flees upward with them. This is the
  only enemy that can take something you already earned, which is why it is the
  one worth chasing.
- **Asteroids**: scenery with mass. Flagged `hazard`, so the wave director
  leaves them out of `totalPlanned` and they never count against a
  "destroy the enemies" star - they'd otherwise silently make objectives
  unachievable.
- **Boulders**: the set piece version, on three missions out of eight so they
  stay an event. Two decisions make them work. First, `toughSeconds` sizes them
  from the player's DPS the way bosses are sized - *terrain that evaporates
  isn't terrain*, and a fixed 52 HP would be a wall early and confetti later.
  (Ordinary enemies deliberately do **not** scale this way: becoming easy to
  sweep aside is the reward for upgrading.) Second, ramming a hazard costs a
  life and leaves the rock intact, unlike every other enemy, which is the
  difference between an obstacle and a target.

Each gets one explanatory radio line the first time it appears in a run. A new
mechanic nobody explains reads as the game being broken ("why aren't my bullets
working?"), and that is worth a line of dialogue.

## 8g. The health curve, and why it is per-tier

"Enemies are way too easy to kill with better weapons" was right, and my
earlier framing - *becoming easy to sweep aside is the reward for upgrading* -
was only half true. It is the right answer on the easy tiers and the wrong one
on the hard tiers, where it turned NIGHTMARE into a victory lap.

So health is now two terms. `hpMult` is flat per tier (ACE 2.6x, VETERAN 4.4x,
NIGHTMARE 7.5x - up from 1.6/2.3/3.2). `hpTrack` is the share of the *player's*
firepower the tier claws back: 0 on ROOKIE and PILOT, then 0.35 / 0.6 / 0.85.
Below a reference DPS nothing scales at all, so a beginner never meets inflated
enemies.

Measured shots-to-kill for a maxed ship, before -> after:

| | grunt | striker | brute | carrier |
|---|---|---|---|---|
| PILOT | 1 -> 1 | 1 -> 1 | 1 -> 1 | 2 -> 2 |
| NIGHTMARE | 2 -> 8 | 3 -> 16 | 7 -> 48 | 9 -> 63 |

PILOT is untouched - upgrades still feel enormous. Note that equal shots-to-kill
between a stock and a maxed ship is not equal *time*-to-kill: six barrels firing
twice as fast still clear a screen far quicker, so the payoff survives even
where the tier claws the most back. In bot playtests the NIGHTMARE kill ratio
fell from 77% to 50%, which is the "destroy 90% of enemies" star becoming a real
ask on the hardest tier rather than a formality.

## 8h. Nineteen archetypes, and how to tell them apart

Six more enemies, each defined by the *response* it demands rather than a stat
line: **Marksman** (telegraphed line - move), **Interceptor** (never commits -
break the lock), **Minelayer** (area denial - go round), **Mine** (arms and
self-destructs), **Hive** (grows if ignored - priority target), **Mender**
(undoes damage - priority target).

Two supporting changes made them possible:

- `behaviourCtx` gained `world`, so a behaviour can spawn (Minelayer, Hive) or
  reach across the field (Mender). Behaviours still receive no globals.
- The three ad-hoc "does this count?" checks (`fromBoss`, `hazard`, and now
  laid mines and hive drones) collapsed into one `counted` flag set at spawn.
  Without it, spawned adds would inflate the objective total or make 90%
  unreachable - a bug that would only surface as "this star is impossible".

## 8i. Drawing the fleet

Nineteen archetypes sharing one recoloured PNG made "which one is the healer"
a colour memory test. Emblems over the hull were the stopgap; the fix was to
draw the ships.

`enemyart.js` builds each archetype from polygons - a dart, a swept crescent, a
flat-topped gunship, a boxy hauler, a hex comb, a rifle with engines, a
two-prong fork - over a shared vocabulary (`hull` for the lit-from-top-left
gradient plus outline, `plate`, `cockpit`, `thruster`) so nineteen ships still
look like one fleet. Palettes are derived from each archetype's existing tint,
so the data didn't change.

Two things make it practical:

- **Rasterise once, blit forever.** Each (type, colour, elite) combination is
  drawn into an offscreen canvas the first time it is needed and cached. The
  per-frame cost is one `drawImage` - identical to the old shared sprite - so
  the detail is free.
- **Ships are drawn nose-down**, the way they fly, which lets the light source
  stay fixed. The old art faced up and was rotated 180 degrees at draw time,
  which rotated its highlights with it and is why everything looked flat.

Worth recording: the first pass drew exhausts as bright triangles pointing off
the tail, and the entire fleet looked like it had horns. An exhaust has to be
diffuse at its edges or the eye reads it as hull. It is now a dark nozzle plus
a soft radial bloom.

Side effect worth having: enemies no longer go through the runtime tinting
path, so they render correctly even on `file://` where pixel read-back is
blocked.

## 9. What I'd do next

Roughly in value order:

1. **Daily challenge** — the seeded RNG is already in `core.js`; one fixed
   seed per day, fixed loadout, leaderboard per family member.
2. **Ship classes** — a second hull with different stats (glass cannon vs
   tank), which doubles the reason to keep earning.
3. **Wingman AI** — drones that drift and target rather than firing straight.
4. **Sprite sheets** — the art is 3 PNGs recoloured at runtime, which is now
   the single biggest weakness: nineteen archetypes share one silhouette and
   lean on tint plus an emblem to be told apart. Per-archetype art would lift
   the game more than any code change left on this list.
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
