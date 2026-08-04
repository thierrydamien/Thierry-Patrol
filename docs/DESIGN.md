# Thierry Patrol — design & architecture notes

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

- **14 upgrades, 53 levels, ~$944k** to max out. Four colour-coded shelves:
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

## 8j. Why the hard tiers were still easy: an empty screen

After the health rework the hard tiers still played easy with good guns, and
the instinct to raise health again would have been wrong. Instrumenting a
maxed-ship run without god mode showed why:

| tier | enemies on screen (avg/peak) | enemy bullets (avg/peak) |
|---|---|---|
| PILOT | 1.1 / 11 | 1.8 / 38 |
| ACE | 1.3 / 10 | 1.3 / 24 |
| VETERAN | 1.7 / 12 | 1.0 / 24 |
| NIGHTMARE | **3.0 / 16** | 2.0 / 24 |

Three enemies on screen at a time is an empty playfield. A well-armed ship
deletes everything on arrival, so the *stock* of enemies stays near zero
whatever their individual health is - health changes how long one kill takes,
not how much is happening. Difficulty in a shooter is pressure, and pressure is
population.

And the knob for it was dead code. Every tier declared a `spawn` field
(ROOKIE 1.35 down to NIGHTMARE 0.52) that **nothing in the codebase ever
read** - the hard tiers had never once been denser. It is now `density`, it is
applied in `WaveDirector.waveSize`, and NIGHTMARE runs at 9.6/34 with 9.2
bullets on screen.

Two supporting details:

- A wave whose count more than doubles is **split into two salvos** ~2.6s
  apart rather than spawned as one enormous formation, so a "wall" of thirty
  stays a readable shape instead of a solid bar.
- Per-kill payout is divided by `sqrt(density)`. Tripling the headcount had
  tripled income - one NIGHTMARE run paid $30k against the Armory total, enough
  to buy the game out in two flights. The square root keeps hard tiers clearly
  more lucrative without letting headcount run the economy. Completion and
  rescue bonuses are per-mission rather than per-head, so they keep the full
  tier rate.

The general lesson, and the reason to instrument before tuning: **check the
stock, not the flow.** Kill counts and per-enemy stats both looked healthy
while the screen was empty.

## 8k. Pricing the Armory with a simulated career

"Too easy to max out" was measurable too. A career simulator - fly the hardest
unlocked tier, bank, greedily buy the cheapest thing affordable, repeat -
finished the entire Armory in **17 runs / 55 minutes**. Fourteen hand-written
price lists could not be reasoned about as a whole, which is how that happened
without anyone noticing.

They are now one curve: `costCurve(first, levels)` with a shared `COST_GROWTH`
(4.6) and `COST_BASE` (1.6), so the whole economy is two numbers. The growth is
deliberately steep rather than the base being high - the first level of
anything stays pocket money so a new pilot gets a win in their first mission or
two, and it is the *last* level of each track that costs a campaign.

Calibrated by sweeping the constants against the simulator:

| growth / base | runs to max | 50% | 75% |
|---|---|---|---|
| old hand-written | 17 | 9 | 13 |
| 4.2 / 1.0 | 57 | 11 | 18 |
| **4.6 / 1.6** | **118** (6.5h) | 16 | 32 |

The shape matters as much as the total: half a ship in 16 runs, three quarters
in 32, and the last quarter takes 86 more. You get strong quickly and finished
slowly, which is the right way round - a child should feel powerful early and
still have something to want in six months.

Prices now reach six figures, so the UI formats with separators
(`$394,240`, not `$394240`) and the buy button lost a point of font size to fit.

## 8l. The campaign map

The mission select was eight cards in a column - it told you the missions
existed, which is a menu, not a campaign. It is now a route drawn across a
starfield: a serpentine line from bottom to top, travelled stretches lit gold
and the rest a dashed plan, sector names (HOME PATROL -> ENEMY SPACE) over the
groups, boss stops ringed in red spikes, stars earned on each stop's rim, the
next stop pulsing, and the pilot's *own* ship - `shipart` again, so it carries
every part they've bought - parked at the furthest stop reached.

The structural decision worth keeping: **the canvas draws it, the DOM catches
the taps.** Layout is computed once in normalised [0,1] coordinates; the canvas
multiplies by its pixel size, and one transparent `<button>` per stop is
positioned by percentage over the top. So hit-testing, focus rings, keyboard
access and the existing `click()` sound wiring all come free, and the two
layers can never disagree about where a stop is - which is exactly the bug you
get from hand-rolled canvas hit-testing.

The serpentine period needed care: at `sin(i*1.15)` the last two stops landed
almost on top of each other. `sin(i*0.85 + 0.6)` keeps every neighbour on the
opposite side.

Two notes from the first pass:

- **The sky is painted once.** Nebula clouds, filaments, a galaxy, three
  planets and dust are rendered into an offscreen canvas the first time the map
  is shown and blitted every frame; only the star twinkle is live. Redrawing a
  dozen radial gradients at 60fps to produce an identical image would be
  pointless. Planet positions are chosen for the gaps the route leaves (it runs
  x 0.20-0.80), so nothing ever sits under a stop.
- **Red does not mean boss to a child.** The spiked ring was the only marker
  and it relied on a convention an eight-year-old has not learned yet. Boss
  stops now carry a literal `☠ BOSS` tag, shown dimmed on locked stops too, so
  you can see what is coming. Colour should reinforce a label, never replace
  one.

## 8m. A sky per mission

Eight levels shared one JPG, so mission 8 looked exactly like mission 1.
`skygen.js` generates one nebula per mission from a palette and a seed. Two
properties make it work in a scrolling shooter:

- **Vertically tileable.** Every element is drawn three times - at y, y-H and
  y+H - so the image wraps with no seam and the playfield can scroll through it
  forever. The old art was pan-only precisely because it could not wrap.
- **Built once.** Hundreds of gradients are rasterised into an offscreen canvas
  at mission start; the frame cost is one `drawImage`. All eight generate in
  ~170ms.

The first attempt looked like wallpaper, and the reasons are worth keeping:

1. **Space is mostly black.** Filling the canvas with colour reads as a
   gradient, not a nebula. The base is now near-black, the gas clusters around
   two bright cores rather than spreading evenly, blob alpha dropped from
   ~0.12 to ~0.05, and a vignette pulls the corners down.
2. **Dust lanes are what make it look photographed.** Dark blobs carved back
   out of the glow give the silhouettes; without them a nebula is a smear.
3. **A star is a hard point with a tight glow.** The first pass used a wide
   pale halo and every star read as a grey bubble. Core radius under a pixel,
   halo 4x that, and four-point diffraction spikes on the brightest few - those
   spikes are what makes it read as astrophotography, and they cost four lines.

A second pass fixed three more things, and they are the ones that matter for
any future backdrop work:

- **Keep the paintings.** Generated art is not automatically better art. The
  original `BackNew.jpg` (a planet and two moons) and the never-used
  `BackBack.jpg` (the Milky Way core) are now missions 1 and 5. `skygen.build()`
  returns `null` for those and the renderer falls back to the old cover-fit pan,
  because a photograph has no seamless wrap. Mixing the two is deliberate.
- **Empty is not the same as dark.** Eight moody nebulae with nothing in them
  all read as the same nebula. Each generated sky now carries two or three
  *props* - a ringed gas giant, a banded world, a cracked moon, a red dwarf, an
  asteroid field, a distant galaxy - and that, not the palette, is what makes
  them tell apart.
- **Scenery has to stay scenery.** At full size and opacity the first gas giant
  filled the playfield and bullets stopped reading against its bands. Props are
  drawn at 62% alpha and roughly half the radius I first chose. If a background
  object competes with a bullet, the background object is wrong.

Star counts came down hard too - 520 specks per sky to 165, and the foreground
parallax layer from 86 to 35. They were reading as noise over the gameplay
rather than as depth behind it.

## 8n. The briefing

It was a text panel over a list of five identical rows, and tapping a row
launched the game. Now it is a dossier:

- **A hero image**: the mission's *own* backdrop (painting or generated) with
  the pilot's current ship composited into it - the level, before you fly it.
- **"What's out there"**: the real `enemyArt` sprites for the archetypes this
  mission's wave script uses, heaviest first. It answers the only question
  worth asking before launching, and because it reads the wave data it can
  never drift out of date.
- **Tier chips instead of rows**, with the selected one glowing in its own
  colour and a detail line underneath quoting the numbers that actually matter
  now that density exists: *"280% as many enemies - 4.4x health - pays 2.8x"*.
- **A separate LAUNCH button**, tinted to the tier. Selecting a difficulty and
  starting a game were the same tap before, which is an easy misfire for a
  child, and it left no room to show what the choice meant.

Two details worth keeping:

- Objective stars light for the tier you have selected, not "any tier ever".
  Stars are stored as a count rather than a set, and objectives are scored in
  order, so lighting the first N pips is the honest reading of that.
- The hero gets a soft radial lift. The in-game skies are deliberately
  near-black so bullets read against them; as a static image at that size the
  same art just looks like it failed to load. The lift is applied in the
  briefing only - the playfield keeps its contrast.

## 8o. Medals and the championship

Same treatment as the briefing, same two ideas.

**Medals** were a flat list of rows. Now: a progress ring, the count, and
*"NEXT UP: Star Collector - collect 15 stars in total"*. That last line is the
point - a medal screen that only shows what you have already done has nothing
to offer, while naming the nearest unearned one turns it into a to-do list.
Locked medals are greyed silhouettes rather than blanks, so you can see the
shape of what you have not won.

**The championship** was two lines of text, which is what a ranked list
degenerates into when a household has two or three pilots. Now it is a podium -
second left, first centre and taller, third right, the arrangement everyone can
read without a legend - with each pilot standing behind their own ship, drawn
from their own upgrades via `shipart`.

Underneath is the part that will actually get played for: **who holds what**,
every mission with its record holder and score, your own rows highlighted. The
star total tells you who is ahead; this tells you which mission to go and take
back. It reuses `P.familyBest()`, so it is the same data the mission cards and
the results screen already quote.

One CSS note: the podium blocks originally just stopped, and read as clipped
rather than as standing on something. They needed a floor - a border under the
whole row - which is the kind of thing that is obvious in a screenshot and
invisible in code review.

## 8p. The name, and the art that came with it

The game was called SkyForce, after the Java project it grew out of - which
was itself named after **Sky Force**, a real commercial game by Infinite Dice.
That is a borrowed name, and two things had to change with it.

The worse of the two was not the name. `assets/Menu.jpg` - the home screen
background - *was the actual Sky Force promotional artwork, logo included*. It
is gone; the home screens now paint their own sky (`drawTitleArt`), with the
pilot's real ship and a wing of three flying out of it.

The name is now **Thierry Patrol** - the family's own name, and *patrol* is
already in the game's vocabulary: the ship sprite wears PATROL on its wings and
mission 1 is First Patrol. (It went through *Novawing* on the way, which is why
there are two legacy eras below.)

A rename has one trap: saves are keyed by pilot name under a prefix, so changing
the prefix silently orphans everyone's money, gear and records. `profile.js`
keeps a `LEGACY` list of past `{index, prefix}` pairs and, on the first load
under a new name, copies the newest surviving era across - leaving the originals
in place, so an older build still finds its own save. The mute flag falls back
the same way. The prefix is generic now (`patrol_`), so a third rename costs
nothing. Nobody notices a rename, which is the point.

## 8q. Squad Sync

Saves lived in `localStorage`, which is per browser, per device. Clear the site
data or pick up the other iPad and a season of progress is gone. So: a
Cloudflare Worker over KV, one entry per squad code.

Three decisions worth writing down.

**The backend knows nothing about the game.** It stores a blob under a key and
validates the key's shape; it has never heard of an upgrade, a mission or a
star. The game's data model changes most weeks and none of those changes can
break sync or need a deploy on the other side.

**Conflicts resolve per pilot, not per device.** Every `save()` is stamped, and
the newer record wins for each pilot independently. Whole-blob last-write-wins
would have been three lines shorter and would silently roll back Charles's run
because Marc's iPad pushed last — the exact failure that makes people stop
trusting sync. Each push also pulls and merges first, so the window in which
anything can be lost is one request long.

**The squad code is the entire auth story.** Eight characters from a 30-letter
alphabet with the ambiguous glyphs removed (no O/0, I/1, S/5 — these get read
aloud across a room and typed by a child), plus a per-IP rate limit in the
Worker. No accounts, no email addresses, no password for a nine-year-old to
forget. What is at stake is a callsign, a ship colour and some scores.

The whole thing is additive: with no `ENDPOINT` every function short-circuits
and the button does not render, so a fork of this repo gets the offline game
and no dead controls. It is deployed now, at
`https://thierry-patrol.wgsync.workers.dev`.

Tested at both ends. The unit checks cover the merge (`mergePilots`,
`applyPilots`) because that is the function that can lose someone's afternoon.
End-to-end, a throwaway harness runs the *real* `worker/src/index.js` against a
`Map`-backed KV shim and drives two independent browser contexts through it:
join, pull, per-pilot merge, and same-pilot last-write-wins.

## 8r. Act two

The campaign was eight missions and ended on the Sentinel. Doubling it to
fourteen was mostly data - a mission is an entry in `MISSIONS`, not a branch in
the game loop, which is what that design was for - but three things did not
come free.

**The map had to be sized by the campaign, not the other way round.** Stops are
laid out as fractions of the canvas, so adding six of them moved fourteen stops
into the space eight used to have: 55px apart, under 76px tap targets. Two
neighbouring missions shared pixels and you could launch the wrong one. The fix
is `ROUTE_GAP` - the spacing is the constant now and the canvas height is
derived from it. The map is taller than the screen as a result, so opening the
campaign scrolls your next stop to the middle rather than showing you mission
14's empty sky.

**Act two needed its own skies.** `skygen` picks a backdrop with
`missionIndex % SKIES.length`, so with eight skies missions 9-14 would have
silently replayed 1-6 - the exact complaint that produced generated skies in
the first place. Six more, running colder heading out and hotter as you close
on their home star, so the run has a direction you can see. There is a check
for this now: the sky list must be at least as long as the campaign.

**New bosses needed new verbs.** Two more remixes of spreadVolley and ringBurst
would have made act two feel like act one at higher numbers. So: `spiralArms`,
two rotating streams with a gap that moves rather than one instant ring, and
`mineField`, which seeds the arena instead of shooting at you - the boss makes
the fight harder without ever touching you, and taking your time costs you
room. Both hang off weak points, so the Warden runs out of mines if you blow
its hatches off. The Leviathan is the only four-phase fight in the game and has
four weak points, which is the reward for having learned every earlier boss.

Testing these was worth the detail. Driving a boss to death and asserting it
used every attack it declares *failed* - correctly. The probe was damaging the
hull at the boss's centre, which is inside the core weak point's radius, so it
was disabling attacks as it went. That is the feature working. The check now
damages away from the weak points to measure phases, and fires every declared
attack explicitly rather than waiting on a random picker.

## 8s. Making sync safe rather than clever

Two changes, both of which removed a failure mode rather than adding a feature.

**The squad code is now baked in.** Minting a random code per device sounds
right - it is what a real product would do - but it bought a failure mode with
no benefit for a game exactly one family plays. A new iPad synced to nothing
until somebody typed eight characters into it, and losing the code lost the
cloud copy, because there is no account to recover it from. Every device now
defaults to the household's code, so a browser that has never seen the game
pulls their progress on first load. The trade is written next to the constant:
this repo is public, so the key is public, and the protection is that nobody
has a reason to care.

**Local backups, because the cloud is also a thing that can go wrong.** A
rolling four snapshots of every pilot, at most one per six hours - rate-limited
on purpose, since taking one per save would fill the ring with four copies of
this afternoon and lose yesterday. Taken at boot *before* the merge, because a
snapshot of the post-sync state cannot undo a bad sync. Restoring re-stamps the
records as of now, or the next sync would read the old timestamps, decide the
cloud was fresher, and quietly undo the restore.

The interesting bug came free with the first change. Sync now runs unprompted
at boot, and jsdom has no `fetch` - so `fetchRemote` threw *synchronously*,
which is the one thing a promise chain does not catch. That exception escaped
into `ui.js` at load and took the whole script down: no menu, no game, over a
failed background sync. Every request goes through one wrapper now that cannot
throw at its caller, and the test asserts the menu still works after a sync
fails. A browser blocking the request would have done exactly what jsdom did.

## 8t. One squad, and the bugs the phone found

The shared-default squad shipped with a hole: `code()` preferred any *stored*
code over the default, and the random-code era had stored one on every device
that ever pressed SYNC NOW. Those devices kept syncing with a squad of one -
which is how a phone opened onto a completely different save. Auto-minted
codes are dropped now; only a code somebody deliberately typed into `join()`
(tracked by a "manual" flag) is kept.

Fixing that forced a better question: what should happen when a device
*changes* squad? Not a merge. Timestamps answer "saved last", not "the real
one" - a freshly-played device carries newer stamps than a squad holding
months of progress, so an ordinary merge would let the thin recent save
quietly delete the campaign you switched squads to get. On a squad change the
squad's records win outright, pilots only the device knows are kept, and the
pre-switch state goes into the local backups first.

Two more sharp edges, found by the harness rather than by a player:

- **A device must pull before it may push.** Sync runs at boot, but a save
  made in the first seconds - picking a pilot is enough - carries a stamp
  newer than everything in the cloud, and pushing it would hand the squad an
  empty save that wins on timestamp.
- **Future-stamped records are poison.** Conflicts resolve on `savedAt`, so
  one device with a wrong clock would pin the entire squad to its stale state,
  every fix reverting on the next sync. Both sides of every sync pass through
  a sanitizer that re-stamps anything claiming to be from the future; for the
  local compare the stored stamp is capped at now. The first version clamped
  to now-plus-slack and the test caught it: a poisoned record still won for
  exactly the slack window.

The e2e rig deserves its own note: its first version loaded the page once
just to plant localStorage, and that load synced - polluting the exact state
the test was fabricating, and producing a failure that looked like the
feature. `addInitScript` plants state before any game script runs. When a
test of sync misbehaves, suspect the rig syncing first.

## 8u. The polish pass

A deliberate commercial-quality pass, combat feel first. The findings worth
keeping:

**The player flew the wrong ship.** The hangar's whole promise is a
physically-evolving ship - and in combat the player flew the stock PNG, every
bought part invisible. The single highest-value change of the pass was one
line of plumbing (loadout carries `levels`) plus swapping `drawPlayer` to
`shipart.drawShip`. Wingmen too: they now fly their own builds.

**Additive blending is most of "juice".** Sparks, muzzle stars, fireballs and
embers are drawn in a second `lighter` pass, so overlapping light stacks
toward white like real glare. Same particle counts as before - the change is
compositing, not volume. Explosions gained a rolling fireball core (one
pre-rendered radial sprite) and flickering embers with gravity.

**Bake the glow, never blur per frame.** The old bullets set `shadowBlur`
per bullet per frame - the most expensive call in the renderer once a maxed
ship fills the screen - and still read as flat rects. Bolts, enemy orbs,
coins (eight spin phases of a bevelled gold face) and elite auras are all
pre-rendered sprites now; the per-frame cost is a blit. Faster AND better
looking, which is the test a polish change has to pass.

**Direction reads as causation.** Hit sparks spray *back along the shot*
instead of a neutral radial puff - that one change makes hits read as "my
shot did that".

**Bosses borrow the fleet's art.** The tinted-PNG boss was the last
prototype-grade visual: each boss now renders the drawn silhouette of the
archetype it commands (Marauder→brute, Sentinel→carrier, Warden→bomber,
Leviathan→hive), scaled up, through the same scorch-and-chunks damage
compositing as before.

Smaller, same philosophy: engine flame scaled by live velocity; overdrive
speed streaks; energy-skin shield; glass HUD panel with labelled glowing
readouts placed clear of the corner buttons; combo counter that pops on each
step; cinematic full-width banners; a cached vignette; foreground dust for
speed; the rescue emoji replaced by a drawn survivor pod.

## 8w. Making the sky answer back

The complaint was "too easy", and the reflex would have been bigger health
numbers. Instrumentation said the real problem was different: **most of the
fleet died without ever acting.** Measured on PILOT with mid-campaign gear,
24% of grunts, 13% of weavers and 0% of swoopers got a shot off before dying,
and the mechanics enemies - Guardians, Menders, Hives, Minelayers - lived
1-3 seconds against a *randomly sweeping bot*, which means a player who aims
deleted them before their mechanic ever came on stage. The player was not
reacting to anything, because there was nothing to react to.

Three changes, none of which is blanket HP:

**First shot at 55% of a normal roll** (entities.js). Fire timers used to
start with a full interval roll, so an enemy that lived 2.5 seconds against a
2.4-4.0s first-shot roll usually died silent. One line; the acted-before-dying
rate roughly doubled across the popcorn.

**Cadence by role** (enemies.js). The "react to me" cast - strikers, turrets,
brutes, swoopers, interceptors - fires meaningfully more often. The popcorn
keeps a slower sustain: the first attempt tightened everyone and measurably
tipped mission 2 from comfortable (1 life lost) to failed (4), because five
heat sources stacked on one tier. The final shape keeps the early first shot
everywhere and the higher sustain only on the threat cast.

**Durability floors on mechanics carriers only** (toughSeconds, the rocks'
trick). Guardian 1.1s, Mender 1.0, Hive 1.1, Minelayer 0.9, Turret 1.0,
Brute 1.2, Hauler 1.2, and small floors on Splitter/Thief/Marksman - sized
from the player's own DPS, so they hold their role at any gear level, while
grunts and weavers stay meltable on purpose: that is still the reward for
upgrading. Two traps found on the way: elites must multiply the scaled path,
not the floor (a 3.5x floor made elite brutes four-second wave enemies), and
the floor scales across tiers like boss fights (bossHp 0.8-1.5), not with
hpMult (0.8-7.5) - hard tiers already track firepower, and stacking hpMult on
top turned every Mender into a sponge exactly where the game is hardest.

PILOT additionally aims a little more (0.10 -> 0.12). ROOKIE is untouched.
Verified by replaying: mission 2 completes in 6 of 7 bot runs at 2-3 lives
lost (was 1 - more pressure, still comfortable, and the bot flies into
bullets that a human dodges); the stock-ship ROOKIE bot failures match the
pre-change baseline exactly, i.e. bot incompetence, not regression.

## 8x. The director's pass: moments, not features

The final pass before showing it to the players. By then the screens looked
right and the balance measured right; what was missing was ceremony. Five
additions, all of them "moments":

**Music, at last.** Two loops sequenced live from the same oscillators as the
SFX - a slow pentatonic drift for the menus, a driving bass-and-hat loop for
combat - using the standard WebAudio lookahead scheduler (a coarse timer
schedules every note falling in the next quarter second at sample-exact
times). No files, nothing to download, and the mute button already gates it
because everything routes through the same master gain. Everything stays in A
minor pentatonic, which is what lets an eight-bar pattern loop for minutes
without grating.

**The launch is a launch.** The ship starts below the screen and rockets up
to its station with the throttle pinned and the guns cold for 1.1 seconds.
One easing line in `updatePlayer`, and tapping LAUNCH finally feels like the
word.

**Bosses get an entrance.** While one descends, the screen letterboxes, an
ALERT pulses, the name card lands with an epithet ("THE WARDEN - keeper of
the minefields") and a klaxon sounds. The mission banner yields the centre of
the screen while it plays.

**The first flight of the day pays double.** Per pilot, one banner, one
doubled payScale, a date on the profile - and a reason to come back tomorrow
that takes a seven-year-old zero reading to understand. The wallet label
reads CREDITS x2 while it is live.

**Three stars rains confetti.** Fifty-four CSS-animated scraps over the
results screen. Pride deserves paper.

## 9. What I'd do next

Roughly in value order:

1. **Daily challenge** — the seeded RNG is already in `core.js`; one fixed
   seed per day, fixed loadout, leaderboard per family member.
2. **Ship classes** — a second hull with different stats (glass cannon vs
   tank), which doubles the reason to keep earning.
3. **Wingman AI** — drones that drift and target rather than firing straight.
4. **Endless mode** — after mission 8, procedurally generated waves using the
   same director, for score chasing.

## 10. Testing

- `npm test` — jsdom smoke test: loads the real sources, validates the data
  tables (every wave references a real enemy, every boss weak point disables a
  real attack, phases descend), then plays mission 1 to completion and a boss
  mission with a bot, asserting on stars, money, kills, pooling and save
  migration. ~45 checks.
- Visual checks are done with Chromium screenshots at iPad and phone sizes
  (throwaway harness, not checked in — see the README).
