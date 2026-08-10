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

- **14 upgrades, 53 levels, ~£944k** to max out. Four colour-coded shelves:
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
between them puts the payoff somewhere the purchase isn't. The ship bay sits at
the top of that one screen and scrolls with it (see 8x - it used to be sticky).
The shelves are tabs rather than one long scroll: four
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
  tripled income - one NIGHTMARE run paid £30k against the Armory total, enough
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
(`£394,240`, not `£394240`) and the buy button lost a point of font size to fit.

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
without grating. The first review note was "repetitive", which was fair for
an eight-bar loop: each track is a song now - a chord progression, bass riffs
that alternate by section, a scheduled breakdown every eighth chord, velocity
jitter so no two passes are identical - and bosses bring their own third
track, built on a minor-second shove at 140bpm, which reads as dread rather
than noise.

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

## 8y. Silent Running

One mission flies with the guns cold - Sky Force's courier levels, and the
change of texture a fifteen-stop campaign needs. Mission 9, first stop of the
chase into their space: you are sneaking, so nothing may fire - not the guns
(skipped in updatePlayer), not bombs or overdrive (both refuse, and the
buttons are hidden rather than greyed: absent reads as "not this mission",
grey reads as "broken").

With shooting gone the game IS the temptation: coins rain down a random lane
every few seconds, and the objectives are complete / grab 60 coins / don't
lose a life - greed pulls you into the traffic the mission is throwing at
you. The cast is everything that threatens without needing to be shot:
kamikazes and interceptors that chase, snipers that draw their lines, walls
with one gap, minelayers, rocks.

Inserting a mission mid-campaign renumbers everything after it, and records
are keyed by mission id - so migrate() gained a v2 shift (9-14 up to 10-15,
descending so nothing collides, lastMission nudged, one-shot flag). The trap
worth writing down: the flag must NOT appear in blank(), because load()
assigns the saved record over a blank - a preset flag marks every old save
as already-migrated and the shift never runs. The smoke test caught exactly
that.

## 8z. Rescues everywhere, the lap home, and a settings panel

Three playtest notes landed together and each got the structural fix rather
than the patch:

**Freeing people is always a star.** The rescue mechanic existed, but two
missions broke the rule silently: Cold Approach flew five carriers without a
rescue objective, and Silent Running had nobody to free at all (you can't
shoot a carrier open with cold guns). The rule is now written into the smoke
test - `rescueCount(m) > 0` implies `rescueAll` in the objectives - and
Silent Running got `podDrops`: pilots who drift down through the traffic on
their own, caught by flying into them. Rescue by dodging, on the mission
about dodging.

**Missions exit, they don't stop.** A won mission used to hard-cut to the
results the moment the last enemy died. Now the fight ends into a victory
lap - "AREA CLEAR!", the calm menu track fades in, five seconds of free
flight to sweep up the last coins under a long invulnerability window - and
then the autopilot takes the stick: the same block that flies the launch
runs in reverse, throttle pinned, double engine trail, off the top of the
screen. Then the one detail the first cut got wrong, per the customer: the
sky holds EMPTY for a beat after the ship is gone, and only then do the
results land (~7.3s clear-to-results, measured). The launch and the fly-off
bookend every mission with the same move.

**Settings is a place, not a scatter.** One overlay, reachable from the
pilot picker and the menu: master sound, music and effects as separate
persisted switches (music mutes at the gain node so toggling back on rejoins
the song mid-flight), screen shake (a feel multiplier for most players,
motion sickness for a few - killed at the source in fx.js), the Squad Sync
panel's entry point, and pilot reset. Reset is the one deliberately scary
button: two confirms, then a fresh blank saved immediately - which stamps it
newest, so the wipe wins the per-pilot merge on every synced device instead
of being quietly "repaired" by it.

## 8aa. Real music

The family supplied seven copyright-free recordings, which retired the
synthesized score (it lives in git history). The lesson that mattered was
codecs, twice over: the source OGGs would have been silent on the iPads
(Safari has never played OGG Vorbis), and the obvious fix - AAC - would have
been silent in codec-free Chromium builds. MP3 is the one format that plays
everywhere, so MP3 it is. The player keeps the game's logical vocabulary
(`setMusic("combat")`) and adds two ideas on top: combat owns three songs
and rotates one per mission so back-to-back flights don't repeat, and
"defeat" is a one-shot sting that hands over to the menu theme when it ends.
Autoplay refusals self-heal - every tap already calls `init()` for the
WebAudio unlock, and now that also retries the paused music element.

## 8ab. The app layer

A review pass with fresh eyes found the gaps that weren't in the game but
around it:

- **It's an app now.** Manifest, home-screen icons rendered from the game's
  own upgraded hero ship, and a service worker. The caching rule that keeps
  deploys safe: code is network-first (a deploy is picked up on the next
  online load; the cache only answers when the network can't), assets are
  cache-first (music and sprites load once, then come from disk forever). So
  after one online visit the game works in the car.
- **Losing the screen pauses the game.** App switch, iPad lock, tab change -
  `visibilitychange` pauses a live mission and the music with it. Nobody
  comes back to a dead ship they never saw die.
- **Power-ups tick down in plain sight.** Draining pills under the objective
  list, one per active buff. A 9-second buff nobody can see the end of reads
  as "my guns went weird for a bit"; a draining bar is a resource you race.
- **A losing streak earns real advice.** Two fails in a row on the same
  mission and tier turns the retry line into "try an easier difficulty, or
  buy an upgrade in the ARMORY" - a seven-year-old doesn't think of either
  on his own. Any win resets the streak.

## 8ac. The Daily Patrol

Roadmap items 1 and 4 turned out to be one feature. An endless mode alone is
solo score-chasing; a daily seed alone is a gimmick; together they're a
sibling rivalry: one seed per calendar day (hashed `toDateString`, the same
key the daily-double bonus flips on) drives `mulberry32`, so both brothers -
and every device - fly an IDENTICAL sky, at a fixed PILOT tier. The only
variable left is who flies it better.

The generator (`daily.js`) escalates in one-minute bands - wider enemy pool,
tighter gaps, bigger formations, elites from minute four - with a carrier
forced in every ~45s so rescues stay on the menu, and a wall surge every
minute to spike the pulse. The script cuts at 25 minutes; outliving it
completes the mission outright. The existing WaveDirector runs it untouched:
it was always just a `waves` array consumer.

Endless runs keep their own book (`endlessBest`, `endlessLongest`) and never
touch campaign records or `lastMission` - the campaign hint must keep
pointing at a real map stop. Death isn't failure here: the results say
PATROL OVER in gold, the defeat sting never plays, kills are shown without
the demoralizing /5966 denominator, and the "Daily crown" line names the
current holder. The menu button's subtitle is the taunt: "beat Charles's
5,250 pts".

## 8ad. The firing range, and advice you can tap

Two closures of old loops, one grace note:

- **TEST RANGE** (button in the hangar bay): twenty seconds of targets that
  never shoot back, flown with the real loadout, immune, timed, and it exits
  to the Armory - never the results screen. It exists because a freshly
  bought cannon could only be FELT a whole mission later; now it's ten
  seconds after the purchase. It leaves the profile exactly as it found it
  (no records, no money, no medals - the smoke test proves the profile is
  byte-identical) and deliberately does not burn the first-flight-of-the-day
  double.
- **TRY ON ROOKIE** is a button now. The losing-streak tip said "try an
  easier difficulty" - advice a seven-year-old reads and doesn't act on.
  After two losses on a harder tier the results screen grows a one-tap
  button that relaunches the same mission on ROOKIE.
- The victory lap opens with its own fanfare (rising major arpeggio with a
  sparkle) instead of borrowing the wave-clear chime.

## 8ae. The boss death, and the sky that claps

A boss that blinked out the frame its HP hit zero was throwing away the best
moment in the game. It's a two-act death now: killBoss() only STARTS it -
the hulk goes dark, lists, sinks, and a drumroll of chain detonations
marches across the hull, starting slow and accelerating to a blur (2.3s,
scripted in simulation time inside bosses.update, so pause behaves) - then
finalBossBlast() ends it: white-out, a triple shockwave, a debris storm, a
long hit-stop, and a sub-bass megaBoom. The shockwave also clears the sky -
every minion and every bullet still flying dies with the ship that brought
them, which reads as causal and feels tremendous.

The bug worth writing down: applyDamage marks a dead boss `!alive` so
bullets pass through the wreck - and both bosses.update and drawBoss bailed
on `!alive`, so the whole death sequence froze invisibly at frame one. The
jsdom unit test passed because it staged `dying` by hand without going
through applyDamage; only the browser probe caught it. Guards are now
`!alive && !dying`, and the unit test mirrors the real kill path.

And when any mission ends, the victory lap now fires fireworks - spherical
glitter bursts with gravity, a pop sound quiet enough to salvo - every half
second or so until the results land. A cleared sky deserves applause.

## 8af. Silent Running, second pass: fair, and explained

The playtest verdict was blunt: dodging traffic with no gun is fair; dodging
AIMED FIRE on top of it often wasn't dodgeable at all - unavoidable damage,
the one thing a skill mission must never contain. The calibration took two
steps: full fire was undodgeable, and full silence turned out flat - so
`world.silent` now THROTTLES `spawnEnemyBullet` itself: the whole fleet
shares one shot every couple of seconds (measured live: one bolt in 47s,
never two on screen). The only dedicated shooters are a few telegraphed
Marksmen; the minelayers stayed out. The difficulty lives in hulls, walls,
chasers, greed - and the occasional single bolt you see coming.

And the fiction finally answers "why can't I shoot?" the way the customer
suggested: the Sentinel's last blast broke the guns. It's told three times,
in three sizes - a GUNS DOWN story card the first time the briefing opens
("the crew can fix them - but not out here"), the brief itself, and a radio
line at launch ("Guns are dead, {you}. Don't fight - FLY."). The mission
sits directly after the Sentinel fight, so the story writes itself.

## 8ag. Boss Rush

The bosses are the game's best moments and the new death sequence made
chaining them irresistible. The rush queues every boss the pilot has
ALREADY BEATEN, in campaign order, back to back - it grows as the campaign
does, which makes it a progress mirror rather than an endgame afterthought.
Shields recharge between rounds ("SHIELDS RESTORED"), lives don't. Fixed
PILOT tier so the family record means one thing: `bossRushBest`, the
deepest anyone has run the queue, shown as the score-to-beat on the menu
button and as the Rush record line on the results. No stars, no campaign
records touched - same bookkeeping shape as the Daily Patrol. Gauntlet
Runner (3 bosses in one rush) joins the medals.

Implementation was pleasantly small: the whole mode is a mission object
with `bossRush:true` and empty waves, one `spawnRushBoss()` that reuses the
normal boss-arrival ceremony (alarm, entrance card, boss music), and one
branch where the post-blast `finishTimer` either spawns the next boss in
the queue or begins the victory lap. Every system downstream - the death
drumroll, the final blast, fireworks, the fly-off - just works.

## 8ah. Flight Tuning

"Ship classes" shipped as three TUNES of the one good hull - the drawn-faces
lesson applied to ships: a second code-drawn hull would hit the same quality
ceiling, but stats have no ceiling. VANGUARD is the baseline; FALCON trades
gun cadence for +22% speed; TITAN trades speed for a spare life. The rule
in the table itself: every tune that gains something gives something up, so
there is no best, only a playstyle - which for twin brothers means an
argument, which is the point. Chosen in MY SHIP with free instant switching,
and the sales pitch is the spec panel: the SPEED and FIRE RATE bars sweep to
the new numbers the moment a card is tapped. `dps` is scaled with the tune
so boss HP sizing stays honest. Per-pilot, synced, migrated ("warpdrive9000"
from a foreign save falls back to vanguard).

The toast component also grew a `label` - it announced everything as MEDAL
UNLOCKED, which was fine when medals were all it announced.

## 8ai. Two new bosses, a harder rush, and a menu with faces

The customer's verdict on the menu was right: six same-grey rows with pasted
emoji. Each mode now owns an accent colour (edge + background whisper) and a
glyph drawn in the game's own neon canvas style - FLY shows the pilot's
ACTUAL ship, the rush a horned red hull, the daily a sunrise, and so on. No
emoji anywhere in the row labels.

And "boss rush is too easy" got the structural answer: more bosses, harder
stages, new mechanics. THE JAILER (mission 6, Prison Break - which suddenly
makes sense as a boss mission) owns the game's first attack that touches the
STICK: a tractor beam that drags the ship toward the hull, escapable at
about a third of player thrust; its cell weak points free a rescue pod each
when blown open - the boss is the rescue mission. THE PHANTOM (mission 13)
cloaks to a shimmer between actions and blinks: vanish, reappear over YOUR
column marked by a white ring, arrive shooting. Kill the core and it can't
jump. Both slot into the rush queue (six bosses now, campaign order), and
each rush stage multiplies hp (+15%/stage) and attack pace (+10%/stage) via
`boss.hurry` - deeper is genuinely harder. Rush Master (5 bosses) joins the
medals.

The bug worth writing down: the cloak's lazy initializer returned "visible"
on the first update instead of initializing-then-lerping - invisible in play
(it converges in frames), caught only because the unit test called update
exactly once.

## 8aj. Their Treasury, and the no-adjacent-bosses rule

The customer set a pacing rule worth keeping: never two boss missions in a
row. The Warden (12) and the new Phantom (13) sat adjacent, and the fix was
content, not shuffling - Their Treasury, the heist level, now sits between
them. Its identity is greed: thieves who steal your coins and pay them back
double when caught, turret-and-guardian vaults, boulders full of pay, and
coinRush as its third star. Sixteen missions now; bosses land on 4, 6, 8,
12, 14, 16 - a clean every-other-ish drumbeat through act two - and the
smoke test enforces the rule itself: no mission with a boss may be followed
by another.

Second id-shift, same machinery: migrate() v3 moves records 13-15 up to
14-16 (descending, one-shot, synced), chained after v2 - and the test now
covers the compound case (a pre-v2 save rides both shifts, a v2-era save
rides only the new one).

## 8ak. Supply drops

The customer wanted bombs, overdrive, health and shields as pickups -
"something special that doesn't happen too often". Rarity IS the feature, so
supply drops are a tier above powerups in every register: one or two per
mission (scheduled up front in the middle stretch, like the rescue pods),
announced with a chime and a SUPPLY DROP! callout, drawn as glowing hex
canisters with the prize on the lid, and collected with a fanfare bigger
than any powerup's. The prizes: +1 Smart Bomb, +1 Overdrive, full shield
recharge, and - rarest, 15 weight - an extra life.

Three rules keep them honest: a silent run only draws the calm prizes (a
bomb you cannot fire is a prize that insults the winner); the test range
schedules none (profile-neutral by contract); and in a Boss Rush each dead
boss yields one while the queue still has bosses in it - the mercy that
makes a deep run survivable. A bomb crate on a pilot who never bought the
upgrade also CREATES the button (bombsMax bumps to 1) - a free taste of the
Armory's best argument.

## 8al. Tunes v2: boss trophies you can see

The customer's three notes on flight tuning, all structural: it should
change how the ship LOOKS, there should be more of them, and they should be
boss rewards. So tunes are trophies now - one per campaign boss, in order:
FALCON (Marauder), TITAN (Jailer), VIPER (Sentinel, overclocked cannons),
SCAVENGER (Warden, the collector rig), GHOST (Phantom, phase plating), and
APEX (Leviathan) - which deliberately breaks the every-gain-has-a-cost rule
because it is THE campaign-completion reward. Locked cards name the boss to
beat; a first clear pops TUNE UNLOCKED.

Each tune paints accents on the hull in the same code-drawn language as the
21 bolt-on parts (the face lesson holds: no new hull art, only new parts):
swept fins and hot plumes, riveted slabs, red-tipped rails, a golden scoop,
a breathing shimmer, gold trim. Threaded through every ship drawing - the
hangar, combat, the menu icon, the pilot cards - so "which tune am I
flying?" is answered by looking.

And MY SHIP stopped being two things: the 21-chip parts inventory (per the
customer: confusing, not that useful) is gone, replaced by the tuning bay -
big cards with kid-readable green-▲/red-▼ lines and a one-line how-it-works.
migrate() reverts any fitted tune whose boss this pilot hasn't actually
beaten, so a copied save can't wear an unearned crown.

## 8am. The emoji sweep

Same verdict as the menu, applied everywhere: emoji pasted next to canvas
art reads as scaffolding. Tune cards now use the most honest icon possible -
YOUR ship wearing that tune, drawn live; settings rows, toasts, record
lines, the briefing's objective list and the championship's daily row are
plain typographic now. What stays: the padlock (a universal state glyph),
and the medal set - those emoji ARE the medal art, a consistent set inside
a designed card. The toast trophy now appears only on actual medals.

## 8an. THE DEVOURER - the finale

The brief was "the moment players talk about afterwards". The answer was to
break, on purpose and only once, every rule of scale the game had kept.

**Two missions, not one.** The no-adjacent-bosses rule forced a breather
before it, which turned out to be the best thing in the act: mission 17,
"The Long Dark", is deliberately sparse and near-starless, and the Devourer
itself hangs in its SKY the whole way - painted into the backdrop by a
skygen prop, too big to fight, with one red eye. You spend a mission looking
at what is coming. Then mission 18 is the fight.

**The arrival.** Four scripted beats (~10.6s): black with one line of text
("THEIR STAR WENT OUT AT 04:00. SOMETHING ATE IT."), a slow descent out of
the dark with the room shaking, systems powering on bank by bank, then the
name slamming down. HUD, radio, and every on-screen button step aside
(`body.cinema`), the ship holds fire, and the music cuts to SILENCE - the
loudest cue available.

**Five phases, five questions.** Each phase asks one readable thing:
which columns are lit (laneBeams) → where is the claw sweeping (clawSweep,
plus hangars pouring ships) → where is the gap (spiral/ring) → which half is
safe (starLance) → all of it. The fairness contract is enforced by tests:
every arena attack has a WARN stage that paints the danger and cannot hurt
you, then a short BURN stage that can. Warnings are transparent and dashed;
live fire is solid. `beamHits` grew to cover all of them, so the collision
layer still knows nothing about any of it.

**The fleet.** At 13% health every pilot the squadron ever rescued flies in -
the household under their real names and colours, then RIO, BASHER, KESTREL
and the rest - and they shoot. Their rounds are spawned into the PLAYER's
bullet pool, so weak points, hit flashes and boss damage all work for free.
It is a damage assist, a breather, and the campaign's whole premise paying
itself off in one shot.

**The death.** Eight seconds in five stages where nothing else gets two:
armour blowing off piece by piece, light tearing out of the seams, an
implosion that drags every bullet on screen INTO the hull and goes quiet,
then a white-out with a five-ring shockwave that clears the sky, then slow
embers while the fleet holds station. Only then the results.

Three bugs worth keeping in the record, all caught by looking at it rather
than by tests: the boss silhouette system (a tinted enemy sprite, scaled) is
fine at 150px and reads as a coloured blob at 300, so the finale got the
only hand-drawn hull in the game; the generic tint aura and the 0.42-alpha
hit flash - invisible problems on small bosses - bleached that hull to grey
under sustained fire; and the claw's pincers were built in head-local
coordinates but painted in screen space, which parked them in the top-left
corner of the playfield.

## 8ao. Measuring the finale instead of trusting it

The Devourer was designed on a claim - "reading the telegraph saves you" -
and claims about difficulty are exactly the thing this project has learned
not to guess at. A throwaway probe flew the fight four times: two pilots
(one that ignores every warning, one that reads them) x two loadouts.

The first run said two things at once. The claim held, emphatically: at
identical gear, reading the warnings took survival from 18 seconds to 71.
And the fight was still too hard - NOBODY won. The careful pilot reached 4%
boss health and then ran out of lives, which is the worst possible outcome:
"so close, then dead, again" is precisely the loop the brief said to avoid.

Two fixes, both aimed at attrition rather than at difficulty: fightSeconds
95 -> 70 (still the longest fight in the game by a distance, but no longer a
war of endurance), and every phase break now sheds a supply crate - a
pressure valve landing exactly when the fight escalates, which also reads as
scavenging from the wreck. Re-measured: a careful, well-equipped pilot now
wins with ONE hit taken and no lives lost, while careless pilots still lose.
Skill and preparation are rewarded; carelessness is not.

Worth noting what the probe also exposed by accident: the "careful" bot
sometimes dealt LESS damage than the careless one, because parking in the
nova's safe ring aims your guns away from the boss. Dodging costs damage -
an emergent tension nobody designed, and a good one.

## 8ap. Every boss to the finale's standard

Three linked asks, and they turned out to be one job.

**Hulls.** Every boss except the Devourer was a tinted ENEMY sprite, scaled
up. That is fine at 130px and it is a coloured blob at 300 - and it is
actively wrong for fights whose mechanic is "shoot the parts off", because
there were no visible parts. `bossart.js` now holds a hand-drawn hull for
each: the Marauder's welded raider wedge with two enormous side cannons, the
Jailer's lit cell blocks behind bars, the Sentinel's carrier deck and
command tower, the Warden's minelaying rig, the Phantom's blade with three
lenses, the Leviathan's four-part frame. Each is built around ITS OWN weak
point coordinates, so the thing the game tells you to shoot is visibly a
thing bolted onto the ship.

**Armour.** `armoured: true` makes a boss SEALED: hull fire chips at 35% and
can never take it below a 45% reserve, so the parts must come off before the
core can be killed. Stripping the last one fires "CORE EXPOSED!" - white
ring, hit-stop, unlocking chord - and the fight opens up. The Jailer,
Sentinel, Leviathan and Devourer are sealed; the Marauder (first boss) and
the two gimmick bosses are not, so the idea is taught before it is
required. Three signals keep it fair: a HUD line counting parts left, a
"SHOOT THE PARTS!" callout after enough wasted hull hits, and the radio.

**Difficulty.** The customer said bosses die too fast, and the probe agreed:
the Marauder was dying in 15s against a 26s design, the Warden in 37 against
50. The cause was ACCURACY - the engine sizes every boss from "share of your
DPS that actually lands", measured long ago against small evasive bosses.
Against the current roster (bigger hulls, players who park underneath) 0.32
was far too low. 0.46 is the re-measured value, and it lifts every boss in
the game at once; the armoured fights had their design targets trimmed to
compensate for the phase armour adds.

Two bugs the new tests caught, both invisible in play until they weren't:
weak-point hits damage the hull too, and that path bypassed the seal - so a
sealed boss could die with plates still attached and skip its own mechanic.
And the chip floor was 1, which meant the hull was already dead by the time
the last plate fell: "CORE EXPOSED!" would have been followed instantly by
the boss exploding, with no core phase at all.

## 8aq. Six silhouettes, and the part you could never hit

Two customer notes, one of them a bug report in disguise.

**"The first three or four bosses are the same with different colour."**
Fair, and the hulls being hand-drawn didn't save them: every one was a wide
slab with two round parts on its flanks. Drawing them separately isn't the
same as designing them separately. They are now four different SHAPES, and
the weak point layouts moved to suit: the Marauder is a dart with its
cannons out on forward-swept arms, the Jailer is a GRABBER - a narrow body
with two long arms hanging down and out, a barred cell clamped in each claw,
the only thing in the game that hangs below itself and the only one that
puts the parts you must shoot down at your own altitude rather than up on a
deck - the Sentinel is a carrier deck with pods on the wingtips and
the command tower high on the spine, and the Warden is a RING - the only
circular thing in the game. The Marauder also stopped being a generic
shooter and got the game's only ram: it rears up, marks your column, and
DIVES, hull-first. A first boss should teach "read the wind-up, then move",
and a charge teaches it in one move.

**"The Leviathan is impossible to kill."** It was. Its pods sit at +-62 from
the hull, the patrol clamp let it drift to x=78, which put the outer pod at
x=16 - and the ship clamps at x=24 and fires straight up. The part was
literally unreachable, so an armoured Leviathan could not be stripped and
therefore could not be killed. The patrol limit is no longer a magic 78: it
is derived from the boss's own parts (`reach + 34`), so no weak point can
ever sit outside the column the guns can follow. A test now asserts that for
every boss at both patrol limits.

And the customer's diagnosis of WHY it went unnoticed was right too: at 176
the Leviathan's four parts were close enough to the middle that spraying the
centre hit them anyway, so nobody had to aim. It is 250 now, with its parts
pushed to the corners, and the Devourer went to 360 to stay unmistakably the
largest thing in the game.

## 8ar. The weak point that was never a hitbox

**"Sky Sentinel can't be killed."** Then, an hour later: **"last boss also
can't be killed"**, with a photo of ARMOURED - 4 PARTS LEFT over a health bar
that had barely moved. Two reports, one cause, and it was not the one I had
just fixed.

Weak points were never hitboxes. Bullets were tested against the boss's BODY
circle and consumed there; `damage()` was then handed the point of impact and
asked which part, if any, was under it. So a round aimed at a part died on the
hull's perimeter and got scored at the perimeter - which is nowhere near the
part. I stopped guessing and computed it for all seven bosses: **every weak
point on every boss was unhittable by an aimed shot.** Parts only ever came
off by luck, clipped by angled spread rounds that happened to enter the body
circle near one. Armour gating turned that from an annoyance into a wall: a
sealed boss cannot die with parts attached, and the parts could not be
removed, so the Sentinel and the Devourer were unkillable exactly as
reported. The Warden and Marauder survived only because they aren't sealed.

Two changes, both in the collision layer where the bug actually lived:

- **Parts are tested first, on their own geometry.** A part outside the body
  circle (the Sentinel's wingtip pods) or buried deep inside it (its command
  tower) is now hit by a shot pointed at it, because the shot is checked
  against the part, not against the hull that happens to contain it.
- **While any part still stands, the hull is POROUS.** A round chips it once
  and keeps flying to look for a seam. Otherwise a big boss's body simply
  eats every shot before it can reach the thing you were aiming at, which was
  the whole problem restated. Strip the last part and the body goes solid.

`damage()` also tested the bare part radius while the collision layer tested
`bullet.r + part.r` - so a shot could be consumed as a part hit and then
scored as a hull hit. It vanished and the part took nothing. Both sides agree
on `wp.r + 6` now.

The lesson worth keeping: two systems each held half of "did that hit?", and
each was individually reasonable. No unit test failed, because every test
asked one of them in isolation. What caught it was writing down what the
player does - point at the pod, fire straight up - and computing whether that
can ever land. It couldn't, for any boss, and hadn't for the whole life of
the feature. That test now exists, per boss, per part.

Then the numbers moved under me. Aiming suddenly WORKED, and a part hit is
double damage, so effective output roughly doubled and every fight halved -
the Devourer fell in 32s against a 58s design. `ACCURACY` went 0.46 -> 0.8,
re-measured with the bot rather than guessed. Final: Sentinel 33s against 33,
Leviathan 50 against 50, Devourer killed at 51s having cost a life. Bosses
are hard again, and now they're hard for the reason they're supposed to be.

## 8as. The map draws the monsters

"Any ideas to make the campaign look cooler?" The map already had a painted
sky, a serpentine route and your own ship parked at the frontier. What it
didn't show was the thing the campaign is actually about: seven monsters.
A boss stop was a red disc with a number on it - which tells you the game
THINKS something scary is there, without showing you.

So the map now borrows the fights' own hull painters:

- **A boss stop IS the boss.** The same hand-drawn hull the battle uses,
  hovering at its stop. Ahead of you it looms as a dark silhouette with a
  "?" and no name - kids see that SOMETHING big is waiting without seeing
  what. Beaten, it stays behind as a cracked, dimmed wreck under a green
  DEFEATED strap: the route becomes a trophy shelf of everything you've
  killed. The mission number moves into a small chip so it never fights
  the artwork.
- **The Devourer dwarfs everything** - drawn at 150 to the other hulls' 92,
  a shadow the size of a small planet at the very top of the map. The
  destination is visible from mission one, which is what makes it a
  journey.
- **Their star.** A baleful red giant painted over the far end of the
  route, with a red wash bleeding down the top of the sky - you climb out
  of friendly blue space into somebody else's red.
- **Life.** A three-spark supply convoy runs the lit stretch of route (the
  road you opened is in use), and a shooting star crosses the map every
  few seconds. Both are nearly free.

The badge took two goes. A hull has no middle to put a number in, so the
first attempt parked it in a small dark pill in the corner - and the
customer caught it immediately: "there are no numbers for bosses so it's
not consistent". They were right, and the diagnosis was sharper than
"it's too small": a dim chip is a DIFFERENT KIND OF OBJECT from the bold
numeral on a mission disc, so the map stopped counting in one currency.
The badge is now a miniature mission disc - same radial gradient, same
stroke rules (gold at three stars, white when unlocked, faint when not),
same bold numeral, just smaller. Red for a boss, grey when locked, exactly
like the discs. Every stop reads as the same thing again.

One layout lesson: hulls are twice a disc's height, so the BOSS strap that
sat above a disc landed exactly on the name of the stop above. Straps hang
BELOW hulls now. Caught by screenshot, like every other layout bug - the
smoke test's jsdom has no canvas, so it can only assert that the map's
dependencies exist (every campaign boss has a painter) and that drawing
doesn't throw.

## 8at. Every stop wears its mission

Bosses got hulls, and the customer immediately saw the remaining flatness:
"apart from the boss, every level looks the same". Eleven identical blue
discs on a route that is supposed to be a journey through different places.

Each ordinary stop now wears its own mission, and both halves are DERIVED
so a new level gets a face for free:

- **A silhouette of the level's signature enemy** inside the disc. Full-
  colour sprites at 50px turn into grey smudges, so the sprite is flooded
  to one dark shape - at that size you read "the pointy one" or "the fat
  one" instantly, which is all a face needs to do.
- **A colour taken from what the mission asks of you**: purple for guns-
  down, gold for a coin run, dust-brown for a debris field, green for a
  big rescue, blue for a straight fight. The test order matters - nearly
  every level carries pods, so the rescue test is greedy and would paint
  half the route green; the narrower identities get asked first.

Picking the signature enemy took three tries, all measured with a dry run
over the real wave scripts rather than eyeballed: most-bodies picks the
grunt everywhere (they are the filler in 17 of 18 levels); rarest-first
picks whatever cameos once, so Weaving Through came out as a THIEF level.
Bodies-divided-by-spread lands on the enemy a level is built around. And
where a brief states the identity outright ("kill the hive first", "the
gold glowing ones are elites") the mission now names its own `face` in the
data - five do - rather than hoping a heuristic agrees. The Gauntlet's
disc glows elite-gold behind its brute, the same tell elites wear in play.

The smoke test asserts no two ordinary stops share a face, because the
face is picked by a heuristic that a new level could quietly collide with.

## 8au. Every boss arrives like the finale

The customer, on the Devourer's entrance: "it puts the player on edge and
it's super cool - can every single boss be introduced like that?" Yes,
and the general engine is a fifth the code of the bespoke one, because the
finale had already discovered the grammar: guns cold, HUD away, letterbox,
the dark, the descent, the NAME.

`bossintro.js` runs three beats in about six seconds - alarm (klaxon in
the boss's own tint, "ALL WINGS — CONTACT"), rise (the hull comes down
slow and heavy, the room trembling), name (the card slams in: THE
MARAUDER, *first of the raiders*, hairlines flying apart in its colour).
Because the card is driven entirely by the boss's own identity - name,
epithet, tint, hull - seven bosses get seven different arrivals from one
timeline. Boss Rush gets the cinematic on every stage; its "BOSS n OF m"
score line waits until the fight starts.

Two rules kept the finale on its throne: the general arrival is shorter
(6.1s vs 10.6s), never fully black, and its three cues sit an octave or
two ABOVE the Devourer's - so when the last boss drops into sub-bass and
total dark, even a player who has seen seven arrivals feels the floor
shift. And the smoke test pins the hierarchy: `bossintro.TOTAL <
finale.INTRO_TOTAL` is an assertion, not a hope.

The browser probe caught a script error no unit test would: control's
fight-start line was "that's their flagship" - fine when it was written
against one boss, wrong over the Marauder now that the cinematic has just
named who it actually is. Comms lines that follow a naming card can't
claim identities; the line is now about the fight, not the enemy.

## 8av. The fleet is the family now

Two customer notes on the finale's last minutes, both about the same thing:
the ending belongs to the people it's for.

**"No made up planes."** Phase five used to fill the wing with invented
callsigns - RIO, BASHER, KESTREL - behind the household pilots. Kids
notice, and they're right to: a made-up name in the family's finest moment
means nothing to the people the moment is for. The fleet is now ONLY the
real squadron - the other pilots of this household, under their own names,
colours and ship builds. A device with a lone pilot gets no fleet at all
(and no "everyone came" fanfare, which would be a lie): an empty seat is
honest, an invented wingman is not. The smoke test now asserts the roster
IS the household and that no name pool survives in the code.

**"Could they speed off screen together with my plane at the end?"** They
could and now they do. The victory lap ends, autopilot pins the player's
throttle - and `beginFlyoff()` pins the family's too. They leave in the
same ragged stagger they arrived in (each plane 0.14s behind the last,
engine flare at the tail), because a squadron of people should never move
like a formation of drones. Verified in the browser: four named planes
climbing out with the player, sky empty two seconds later.

## 8aw. Four new rules: the campaign grows to 22

"Ideas for additional levels that would feel different?" The levels that
already felt different - Silent Running, the Treasury - all changed a RULE,
not an enemy mix. So each of the four new missions changes exactly one:

- **The Storm (6)** - the wind is the level. Gusts cycle calm -> warn ->
  blow, and the warn beat is the design: 0.9s of streaks with NO push, so
  you read the direction and lean before the shove. The gust moves the
  SHIP, not the target - under a finger the ship visibly drags off your
  line. Enemies drift at half strength so the whole sky agrees about the
  weather.
- **The Convoy (9)** - protect, don't just survive. Three unarmed haulers
  cross bottom-to-top on rails; enemy fire and rammers hurt THEM, and the
  star objective is bringing every one home. Their collision pass runs
  before the player's early-return, because the convoy doesn't get a
  breather while you respawn.
- **The Trench Run (17)** - walls. A new `gate` formation builds a
  wall-to-wall rank of boulders with ONE two-slot hole, rolled fresh per
  wave: read the wall, find the gap, commit - or blast your own door, both
  work. Zero new entities: the whole level is a formation.
- **The Searchlight (20)** - your glow is the only lamp. A darkness veil
  with holes punched where things glow: your ship, every pickup (rescues
  call to you across the dark), and BOTH sides' fire - fairness is the
  fixed rule the level bends everything else around. Drifting pilots in
  the dark make the flashlight fantasy the objective.

Structural cost: 18 -> 22 shifts mission ids, so `missionsVer` 4 is the
first migration that's a MAP rather than an offset - four inserts at once.
Highest old id first, every new id above its old one, so nothing
overwrites. Tune trophies, the rush queue, the sector labels and the sky
list all follow the new numbering; the smoke test pins the boss stops at
4, 7, 10, 14, 16, 19, 22 and walks a three-era save through all three
migrations.

## 8ax. The opening card, written for a seven-year-old

"The message at the beginning of a level disappears too quickly. It's also
too complex for kids to read." Both true, and both the same line of code:
the card printed the mission's full `brief` - two clauses of adult prose,
up to 180 characters - at 14px, for 2.6 seconds. Nobody was ever going to
read that, least of all the audience.

Every mission now carries a `goal`: one short instruction in plain words,
capped at 36 characters by the test suite. "GUARD the big blue ships!"
"WALLS! Find the gap and fly through" "They dive at you — swerve away!"
The brief still exists in full on the briefing screen, where there is time
to read and nothing is shooting at you.

The card holds for **6 seconds** instead of 2.6, at 19px instead of 14. A
long hold needs a long fade, though - the band draws OVER the traffic, so
it now spends its last 1.5 seconds going see-through rather than sitting
opaque and then blinking out. Screenshotted at 1s, 3s and 5.5s to confirm
the last frame is a ghost you can fight through.

The browser probe caught the real bug, which no unit test would have: on
the first flight of the day the code REPLACED the sub-line with "FIRST
FLIGHT TODAY — DOUBLE PAY!". The instruction vanished exactly when it was
most needed - and for two kids who play daily, that is every session. A
money note must never take the instruction's place; the bonus gets its own
popup below the card now, and a test asserts nothing writes to the goal
line after it is set.

## 8ay. The Convoy, rebuilt: one ship, actually hunted

"I like the idea for the convoy but it's not clear how it works and the
enemies aren't really attacking it. Also, it'd be better to protect 1
single convoy instead of it going up and disappearing and another coming
up after." Three notes, and all three were fair - the first version was an
escort mission where nothing escorted anything.

**The enemies weren't attacking it, and that was literal.** Not a tuning
problem: no code path existed for it. Every behaviour aimed at the player,
every aimed shot targeted the player, so the haulers only ever took splash
and the occasional accidental collision. "Protect them" was a promise the
enemies never tested. Now enemies carry a `huntsEscort` flag - two in three
on this mission - and for those, kamikazes lock onto the HAULER (climbing
to reach it if they must, since the usual "always dives" floor assumed the
target was below), interceptors hold its line instead of sinking past it,
and aimed fire is aimed at it. The remaining third still come for you, so
parking next to the hauler is never a free win.

**One ship, the whole mission.** Three haulers crossing in sequence read as
scenery drifting past: by the time you worked out what one was, it had
gone, and there was nothing to get attached to. Now a single hauler rises
to station, holds there for the entire level wearing its damage where you
can see it, and runs for home only when the sky is clear. Arriving is the
win. Its health bar is the level's tension, so it is sized to absorb a real
beating rather than die to one bad moment.

**Clarity was a drawing problem.** The first cut hid the health bar until
the ship was hurt - so the thing you were meant to protect looked exactly
like the things you were meant to shoot. It now wears friendly brackets, a
permanent health bar that flashes red under 35%, and the words OUR HAULER —
PROTECT IT under its hull. Control calls out when it's breaking up.

Verified by probe rather than assertion: mid-fight the hauler was at
193/260 with 6 of 14 live enemies actively hunting it. Before this change
that number was zero, by construction.

### The invisible wall was real

"It goes too high up and then acts like it's kind of stuck by an invisible
wall." Both halves were literally true, and the first half caused the
second.

The hauler stationed itself at `VH*0.30` = 240. The player's own ceiling is
`PLAY_TOP` = **250**. So the ship you were escorting parked ten pixels
ABOVE the highest point you could fly: you could never get alongside it,
and flying up to defend it ran you into a wall just underneath it. A
station height is not a decoration - it has to sit inside the band the
player can actually reach. It is `PLAY_TOP + 110` now, with room to fly
above, beside and below, so you can put yourself between the hauler and
whatever is coming.

The "stuck" feeling had a second cause worth writing down: the approach
decelerated proportionally to the remaining distance, so the last stretch
crawled at 20px/s and then stopped *exactly* on its mark. Anything that
slows to nothing and freezes reads as a collision. It now eases in on a
spring with a floor under its speed, and on station it never holds still -
a ~5s vertical bob and a ~9s lateral weave across its lane. The periods are
deliberately short: a slow sine spends most of its life near the extremes,
where it is flat, and two seconds of stillness looks parked all over again.

Probe numbers after the fix: arrives 447 -> 351 smoothly, then travels
x 328 -> 239 while bobbing, and the player sits at y=332 above a hauler at
372 with the clamp untouched.

## 8az. The Rival - and the half of the pitch that was wrong

The customer asked, before commissioning it: "would this actually be
good?" The honest answer was *half of it*. My own pitch had said the ace
"dodges your shots", and that is precisely the failure pattern this whole
project keeps designing out: an enemy that evades tells a seven-year-old
their guns are broken, exactly as the unkillable armoured bosses did. A
duel is a great idea; unconditional evasion is not.

So the shipped version rests on two rules:

**She mirrors you.** VESPER's lane is your lane reflected across the
centre line, so she is always on the far side, crossing when you cross. A
child reads that in a second - "she's copying me!" - and it teaches the
level's trick: you cannot out-shoot a reflection by standing still, you
have to make her commit and fire where she is GOING. Which is mission 2's
lesson, cashed in eleven levels later. Measured in the browser: player at
x=90 pushes her to 444; player at x=520 pulls her to 82.

**Her dodge has a cooldown.** She jinks away from an incoming round, but
only once every 1.5s, and she flares and leans for a fifth of a second
BEFORE she moves. One burst can be slipped; sustained fire always lands.
That valve is the whole difference between a duel and a tantrum - and the
tell means being beaten by her is always something you watched happen.
Both are asserted: the mirror, the jink, the telegraph, and that a second
round during cooldown does NOT produce a dodge.

She is deliberately not a boss. Ship-sized, no cutscene, no phases, no
weak points - she arrives mid-flight with a card and a taunt, and the
mission never stops for her. `toughSeconds` sizes her from your own guns
like the rocks do, so she lasts about as long at every gear level. Killing
her pays a boss-sized send-off because beating her IS the level.

Campaign is 23 missions now; `missionsVer` 5 shifts the old 13-22 up one.
Bosses land at 4, 7, 10, 15, 17, 20, 23 - still none adjacent.

## 8ba. Paint, weather, a grudge, and one secret

Four ideas approved in one breath, each with a constraint attached - and
the constraints were the design brief.

**The remix pass** ("some levels", not all): a rule reappears at most once,
and only where it means something new. Their Treasury caught the Storm -
the gusts now blow loose PICKUPS around, so the coin level became "chase
the money through the gale", chaos-treasure rather than chaos-danger. The
Long Dark got the Searchlight's veil at half strength (`blackout:"soft"`),
so the level named The Long Dark is finally, literally, dark - thinner
veil, wider lamp, same fairness rule that every glow punches through.
Convoy and trench stay singular. The map keeps identities honest: coins
outrank weather in the face heuristic, so the Treasury still reads as the
coin level, not "another windy one".

**The rematch** ("not every boss or it'd get boring"): exactly once.
Vesper returns in All Hands - six missions after she fell, elite, gold-lit,
her dodge valve at 0.95s instead of 1.5s and her tell shorter - but still a
valve: sustained fire beats her both times. VESPER RETURNS gets a card and
a comms line, not a cutscene, and the suite pins the count: two rival waves
in the whole campaign, one of them elite.

**The Paint Shop** ("needs to be very visual"): it sells nothing you can't
see from across the room. Five premium hull paints - each card in the shop
is the pilot's OWN ship, all bought parts fitted, wearing that colour - and
applying one repaints the big hangar ship the same instant, plus the map
ship, the finale fleet and the comms portraits, because paint is just
shipColor and one pipeline colours everything. Four engine trails burn
behind the ship every frame of every fight, sized to be seen from a sofa.
Money finally has somewhere to go after the Armory maxes.

**The Star Vault** ("one time only, hidden well enough that they'd need my
hints"): five quick taps on the red giant painted at the top of the
campaign map. Not a button, not a node, no glow, no hint text anywhere in
the game - a stray tap resets the ritual. It opens a golden one-off
scramble (coin rain, thieves, boulders), pays the SOLAR GOLD paint the
shop refuses to sell, applies it on the spot, and seals forever on that
profile - `vaultDone` guards both the door and the code path behind it.
Being per-profile means each kid gets their own moment when their dad
finally leans over and whispers where to tap.

Two bugs the probe caught that no unit test would: the celebration flash
was handed a deadline where it expected a purchase timestamp, driving a
canvas arc radius negative; and `player.trail` already existed (the engine
afterimage array), silently swallowing the cosmetic until it was renamed
`trailFx`. Name collisions inside a flat record don't throw - they just
eat your feature.

## 8bb. The Style Shop: one home for every look

Four notes on the shop, a day after it opened.

**"You can change colour in PILOT and also in the paint shop - confusing."**
Right: two pickers for the same property is a bug in the information
architecture, not a convenience. The PILOT tab's colour row is gone; the
six free squadron colours moved into the shop as a tap-to-wear swatch row
above the paid paints. One home for every way the ship can look - and the
test now asserts the pilot tab must NOT grow a picker back.

**The pink line.** `.shop-group` carried a 5px category-coloured left
border. Removed everywhere - the tab colour and the cards already carry
the identity, and a giant vertical stripe was just furniture.

**The pinned ship bay.** Sticky is right for the shelves, where buying a
part changes the ship you're looking at. On browsing tabs (STYLE SHOP, MY
SHIP) the cards already show the ship, and a sticky bay turned scrolling
into peering through a letterbox. The bay unpins on those two tabs.
(Superseded - see 8x, it now unpins everywhere.)

**"Anything else?" - renamed to STYLE SHOP, and two shelves added:**
- **Nose art**: three decals (thunderbolt, ace star, shark fangs) painted
  by shipart on TOP of every part layer - a decal a bought wing could
  bury wouldn't be worth buying. It rides everywhere the ship does:
  flight, hangar, map, pilot card, the finale fleet.
- **Victory fireworks**: the palette the sky claps in after every win.
  Classic is free and fitted from birth; Gold Rain, Emerald Sky and
  Rainbow Salute are bought once and fire on every victory lap after.

## 8bc. Unarmed haulers, and the Star Vault becomes a joke worth keeping

**"It doesn't make sense that the ship you rescue shoots at you."** It
doesn't. The Prison Hauler had a gun because every enemy got one by
default, and nobody had read the fiction back: it is a transport full of
OUR people. It is unarmed now - the escorts around it do the shooting -
and the roster test pins `carrier.fire === null` so it stays that way.

**The Star Vault v2.** The first cut was "a normal level with enemies",
which missed the point of a secret. Now: the sky RAINS collectable golden
stars (a new pickup - spinning, haloed, £25 and 150 points each, magnet
applies) over a nearly empty sky - three lazy asteroid drifts are the only
company. And then the punchline: **KING PAPA**, "the greatest dad in the
galaxy" - a giant photographed head in a gold ring, pixel crown always
slightly askew, riding a comically small rocket, with stars orbiting him
because he IS the treasure. He has no weak points and no armour: he is a
pinata, and the fight is the joke. When he pops: white-out, six rings,
eight fireworks, "PAPA GOES KA-BOOM!", and a RING OF 34 STARS flung
outward with a long finish timer so the kids can scoop the loot.

The photograph is never committed by anyone but the family: the renderer
loads `assets/papa.png` at runtime (the pilot-portrait pattern), and until
it exists the boss wears a gold "?" medallion that says where to put it.

One real fix fell out: `patrolMargin` derived only from weak-point reach,
and a boss with NO weak points (papa) got the bare floor of 78 - half his
head patrolled off-screen. The margin is now also floored by the hull's
own half-width, which protects every future big boss too.

## 8bd. "Do better" — KING PAPA's death becomes a comedy routine

The verdict on the first version was fair: *"I asked for something super
crazy and memorable and funny so they laugh like crazy. DO better."* What
I had shipped was a big explosion, and a big explosion is not a JOKE. It
was loud, not funny - and I had confused the two.

What actually makes a seven-year-old howl is not spectacle, it is the
RUNNER: you are certain it is over, and it isn't. So the death was rebuilt
as a cartoon gag in five acts (`papadeath.js`, twelve seconds, the longest
thing in the game after the finale) with two deliberate fake-outs:

1. **OW** - the head swells like a balloon, goes red, and POPS to nothing.
   The screen goes quiet. Surely that's it?
2. **BACK** - he returns BIGGER, spinning, indignant: "IS THAT ALL YOU'VE
   GOT?!" - then lets go and farts around the room like a released balloon,
   boinging off the walls. Surely THAT'S it?
3. **SPLIT** - he bursts into five tiny crowned Papas that bounce off the
   floor, the walls and each other, squeaking on every bonk.
4. **MERGE** - the five rush back to the middle and inflate to fill the
   screen. Everything stops. He winks.
5. **KABOOM** - fourteen fireworks, eight rings, and a shower of 46 stars
   AND 10 collectable tiny Papa heads. The crown outlives him and
   parachutes down. Catching a head pops "HI KIDS!" / "LOVE YOU!" / "BE
   GOOD!" / "BYE!"

It has the game's only cartoon audio shelf - a comedy "ow", a balloon pop,
a slide-whistle comeback, a nine-tone raspberry, boings, and a sub-bass
kaboom under a party fanfare. Everything else in this game is sci-fi; this
one boss gets to be a Saturday morning.

The suite drives all five acts end to end (order, the five minis, the star
AND souvenir shower), because a joke that silently strands the run is
worse than no joke. One probe lesson worth keeping: calling
`SF.bosses.damage()` directly never triggers the death, because `killBoss`
only runs when the COLLISION layer consumes the result - the honest way to
test a death is to let the player's own guns land the last round.

## 8be. The first ninety seconds, and paint you can actually see

**"Make sure the first levels - special attention to the first one - will
make my kids like the game. They are the most important ones."** Missions
two and three were already right: something new every eight seconds -
weavers, a rescue, a thief, strikers, rocks, a sniper, a boulder. Mission
ONE was the outlier and, read honestly, the worst level in the game:
twelve waves of nothing but grunts for ninety-seven seconds, no rescue at
all, and a third star of "take no damage" - so a seven-year-old's very
first flight was repetitive AND ended by telling them they had failed.

Rebuilt around two rules. Something HAPPENS every twenty seconds: the
first prison hauler now arrives at 0:22 instead of 0:47, so the thing the
whole game is about - flying into a drifting person and hearing PILOT
RESCUED - lands inside the first half-minute, and there are three of them
so a miss isn't a ruined run. And every star is something you EARN by
doing, never something you lose by being touched: `noDamage` is gone from
mission one entirely. It didn't move to mission three either, because
mission three has people to free and the older rule - every mission with
prisoners stars their rescue - outranks it. `noDamage` already lives at
Cold Approach, which is where a no-hit run belongs.

The suite now guards the funnel directly: the first wave inside two
seconds, a hauler inside thirty, three haulers minimum, no star lost by
contact, and nothing but grunts and haulers in the whole level.

**Nose art was scrapped.** "The difference is too small, it's impossible
to see any difference between them - if you can't make it good, scrap it."
Correct: at flight size the whole ship is about fifty pixels, so a decal
drawn at five percent of the hull was three pixels of mush. Something you
pay for and cannot see is worse than nothing. Replaced with LIVERIES -
whole-hull paint jobs, each a big simple high-contrast shape spanning most
of the ship: racing stripes nose to tail, a flame job pouring up from the
engines, one enormous lightning bolt, a chequered racing band. Verified
the only way that counts: all five rendered side by side at 52px, the size
they actually fly at. The first stripes attempt failed that test - plain
white vanished into the hull's own white panels - so they gained a dark
border, which is what makes them read on any paint colour.

**Free colours joined the grid.** They were a row of little dots above the
paid cards, which made them look like a different, lesser thing. They are
full cards now - same ship, same size, same button - just marked FREE.

## 8bf. Papa says goodbye in French

"When the papa boss is defeated I want it to speak French (since that's
the language I speak with my kids)" - Bien joué ! / Amuse-toi bien ! /
Je t'aime ! - "and make sure the ending is long enough so they can enjoy
it and have a good laugh."

The whole game is in English. This one moment isn't, and shouldn't be:
it is a father talking to his own children, so it is in the language he
actually says those words in, and it is never getting translated. The
three lines land one at a time through the punchline, each with its own
firework salvo so the sky punctuates them, and the souvenir Papa heads
say the same things as the kids catch them.

Length was the other half. The kaboom act went 2.6s -> 6.2s so the lines
have air between them instead of being crammed over the blast, and the
finish afterwards went 4s -> 7s, because after twelve seconds of routine
there is still a skyful of stars and souvenirs to hoover up - and the
victory lap comes after THAT. The routine is 15.7 seconds now, the
longest thing in the game bar the finale, and the suite pins both the
minimum length and the exact French.

## 8bg. The changes WERE shipped - the cache was lying

"Nose art is still the same" and "there are still squadron colours and
paint jobs even though I asked you to merge them." Both had already been
fixed on `main` - checked directly against the deployed commit, liveries
present, the old swatch row gone, one PAINT JOBS heading. The bug was not
in the game. It was that the customer's device was still running
yesterday's code.

The service worker's `networkFirst` called plain `fetch(req)`, which is
NOT actually network-first: it still consults the browser's own HTTP
cache, and GitHub Pages serves JavaScript with a ten-minute max-age. A
deploy could be live, the worker could be doing exactly what its own
comment claimed, and the player would still be handed old code - which is
precisely what happened, twice, invisibly. Fixed with `cache: "reload"`,
which forces a real round-trip to the server instead of trusting a cache
entry that has no idea a deploy happened.

Two things now exist so this can never again be a silent, undiagnosable
gap: the cache name bumped (`patrol-v2`), which purges every stale entry
on activate, and a build stamp in Settings - `build 2026-08-05.3 · tap to
refresh` - that wipes every cache, unregisters the worker, and hard-
reloads. "Is the new version actually on this device?" now has an answer
a parent can read and a button that fixes it without a laptop.

Separately, while re-verifying: the free colours WERE already merged into
one grid under one heading, but they were still named "SQUADRON BLUE" etc
- a family name that read as a separate, lesser set even sharing a shelf
with LASER LIME and DEEP AQUA. Renamed into the same register (SKY BLUE,
CRIMSON, JADE...) so nothing marks them as a different kind of thing
except the green FREE button.

## 8bh. The Star Vault, made replayable

"I want to be able to re-do the secret level. Make it so you can do it as
many times as you want." The five-tap door on the map used to lock itself
after one win (`profile.vaultDone`) - both the tap ritual and the direct
mission start refused a second visit. Both gates are gone. `vaultDone`
still means exactly one thing now: whether the SOLAR GOLD paint has been
won, because that prize stays a genuine one-off. Everything else - the
star rain, KING PAPA, all five acts of his death, his French goodbye -
plays in full on every single visit.

## 8bi. The blank column, and a percent that lied

Two bugs from one screenshot.

**The blank space on the left.** `.shop-group` at desktop widths becomes a
2-column CSS grid - built for the plain upgrade shelves, a flat list of
`.shop-item` rows that fill two columns nicely. The Style Shop reuses
`.shop-group` as an outer WRAPPER around several headings and their own
card grids, and the 2-column split tore that structure apart: a heading
landed alone in column 1, its actual card grid got squeezed into column
2, and the screenshot's big blank rectangle was column 1 sitting empty
under a heading three words long. Fixed with one override
(`.shop-group.paint-shop { display:block }`) so the wrapper stays a single
flowing column; the cards inside it already have their own responsive
grid and were never the problem.

**"Sometime I end a level and it's not 100%."** Exact, and traceable to
one line: `progress = max(timeline, cleared) * (mission.boss ? 0.65 : 1)`.
That 0.65 was meant to mean "a boss is still ahead, save some of the bar
for the fight" - but it tested whether the MISSION has a boss, not
whether the boss is still ALIVE. The instant a boss died, `bossActive`
dropped to `false`, the formula fell into the same branch a boss-less
mission uses, and the 0.65 penalty applied anyway - so the readout
dropped back to roughly two-thirds through the entire victory lap. A new
`run.bossCleared` flag, set the moment any boss-death path finishes and
checked before the old formula, pins the number at 100% from the kill
onward. In a Boss Rush, a fresh boss spawning flips `bossActive` back to
true and wins the first branch regardless, so the readout correctly
resumes tracking the NEW fight's health instead of sticking at 100%
between stages - covered by its own test.

## 8bj. The guns stop when the fight does

"After a boss is killed and the level is won, the plane should stop
shooting." It didn't: the auto-guns are gated on the mission being a
silent-running one and on the two cutscene phases, and nothing else - so
once the boss died the ship kept hammering an empty sky through the
celebration, the whole five-second victory lap, the fly-off and the beat
after it. It read as a ship that hadn't noticed it had won, and the shot
loop talked over the music at exactly the moment the win is meant to land.

The gate now also covers every won state: `finishTimer > 0` (the beat
right after a boss dies), `clearing`, `lap`, `outro`, `gone`, and
`run.ended`. Boss Rush is untouched by construction - `finishTimer` runs
down to zero before the next boss spawns, so the guns come straight back
for the following round, which the test asserts explicitly rather than
assuming.

Worth noting how the browser probe nearly lied: sampling began the instant
the last shot landed, while `phase` was still `boss`, and counted the
final legitimate bullet of the fight as a failure. Waiting on
`bossCleared` before judging turned "1 bullet" into the correct 0. When a
probe measures a transition, it has to wait for the transition.

## 8bk. The five little Papas fight back

"When it becomes 5 little faces, shouldn't they need to be killed instead
of disappearing automatically?" Yes - and the question exposed the weakest
moment in the best gag in the game: the funniest thing on screen was the
one thing the player wasn't allowed to touch. It was a cutscene wearing a
boss fight's clothes.

They are shootable now. Two hits each, they flash pinker on the last one
so you can see which still need a tap, and popping one gives a bang, a
squeak, a taunt ("OI!", "NOT THE FACE!", "RUDE!") and a star.

The valve is the same one this project keeps reaching for: **pop all five
and it cuts straight to the punchline; ignore them and they merge anyway.**
Comic timing must never depend on a seven-year-old's aim - a kid who can't
hit a bouncing head still gets the whole routine on schedule, and a kid who
empties the magazine into all five is rewarded with a faster, louder
finish. And if you DO wipe them out, he reassembles regardless, which turns
the reward into a better joke than sparing them ever was: "YOU CAN'T GET
RID OF ME!"

One real bug fell out of the test. Jumping to the merge by summing the act
durations - `2.0 + 3.0 + 2.6` - lands one ULP BELOW the boundary, so `act()`
reported "split at 100%" instead of "merge at 0%". In the running game it
self-corrected on the next frame and would never have been noticed; the
test noticed. Act jumps now go through `actStart(id)`, which nudges past
the boundary rather than trusting float addition to hit it exactly.

Process note: two edits in this round silently did nothing because the
shell had been left inside `docs/` by an earlier `cd`, so relative paths
resolved to `docs/docs/...`. The heredocs printed their success messages
regardless. Absolute paths for file surgery, always - and verify the edit
landed rather than trusting the script's own report.

## 8bl. Two ways a hit can look like a miss

"When you shoot an enemy the missiles go through it. It should hit the
enemy and stop so you know it has hit them."

One complaint, two unrelated causes, and the second one only became
findable because fixing the first didn't make the report go away.

**Tunnelling.** Collision tested the bullet's END position only. A player
round flies at 660px/s, so a steady 60fps step is 11px and a Grunt - r13,
plus the round's r5, so 18px of overlap to catch - is safe. But the frame
budget is not a promise. On a tired iPad mid-explosion the step doubles to
22px; past the loop's own tab-switch clamp it is 33px. The round teleports
from just-in-front-of the enemy to just-behind it and never registers.
Worst of all it got worse the busier the screen, which is exactly when it
is least forgivable. Collision now sweeps the segment the bullet actually
travelled - one dot product, `sweep()` in systems.js - and cannot miss at
any framerate. Boss weak points (r17-26) got the same treatment for the
same reason.

**Piercing Rounds.** The upgrade spent a pierce charge on ANY contact, so
an upgraded shot sailed straight on through a wounded enemy. It was doing
precisely what the shop advertised - "bullets go straight through enemies
and keep flying" - and it read as a miss every single time, because the
only feedback distinguishing "passed through after hitting" from "passed
through without hitting" was a two-frame spark.

The fix is a rule rather than a nerf: **your rounds punch clean through
anything they DESTROY, and stop dead on anything they don't.** A shot that
only wounds is always absorbed, whatever you own. A shot that kills carries
on to the next target, and the kill is its own loud feedback, so there is
no ambiguity left to have. The upgrade is arguably better now - "blasts
through 3 enemies and keeps going" is a clearer promise than "hits 4
enemies per bullet" ever was - and the shop copy was rewritten to match,
because a description that lies about the mechanic is how this started.

On top of both: the impact itself is louder. Sparks spray back along the
shot, a hard white ring pops at the contact point, and the enemy takes a
small shove along the round's direction so the shot has weight. The bullet
is also parked ON the hull it struck rather than wherever the frame's step
happened to end, so the effects land on the enemy instead of behind it.

Measured in Chromium with pierce at max against a pinned, unkillable
target: 135 approach frames, zero rounds past it. The jsdom suite covers
the invariants (steady frame, dropped frame, wound-vs-kill, weak points),
but the thing worth writing down is that **the browser probe is what made
the second cause visible** - the unit tests were happy with pierce all
along, because pierce was working exactly as designed. Designed wrong.

## 8blb. The third cause: the hull was porous on purpose

"It still looks like the missiles are going through the boss. They should
hit the boss and stop."

Same complaint, third mechanism, and this one was not a bug at all - it was
a deliberate mechanic doing exactly what it was written to do.

When weak points got their own hitboxes, the hull was made **porous**: while
any part survived, a round chipped the body once and kept flying "to look
for a seam". That was belt-and-braces insurance for the real fix, and it
was invisible in a unit test because nothing about it was wrong. But most
of a boss fight happens with plates still bolted on, so for most of every
boss fight the player's entire stream of fire visibly poured straight
through the thing they were shooting at.

The one case porosity genuinely covered is a part **buried inside the body
circle**. The Sky Sentinel's core sits 30px above centre inside a 63px
hull; a plainly solid body would swallow every round aimed at it and make
an armoured boss unkillable all over again - the exact bug porosity was
invented to fix.

So the hull is solid, with one narrow exception: a round is allowed through
only if it is **actually lined up on a surviving part it has not reached
yet**. `threadsToWeakPoint()` casts the round's heading forward and asks
whether it passes within striking distance of a part still ahead of it.
Those rounds thread the seam and visibly burst on the part a frame or two
later. Everything else - the overwhelming majority, and every round in the
screenshot - stops dead on the plating where it struck.

**Damage is unchanged, and that was measured rather than argued.** A
non-threading round always did exactly one hull hit and then flew off
screen doing nothing more; now it does exactly one hull hit and stops. A
throwaway harness fought all eight bosses head-on with a fixed sweeping
pattern of fire, before and after: identical time-to-kill and identical hit
counts on every single one, to the frame.

The other thing the sweep exposed: `damage()` locates which part was struck
from the bullet's own coordinates, so a round left at the end of its step -
which sweeping can put well past a small part - was being scored as a HULL
hit. The shot vanished and the part took nothing. Rounds are now parked ON
the part before the hit is scored.

The test that matters most here is not any of the unit checks - it is the
one that fights every boss in the game to death and fails by name if any of
them survives. Three of the four things that went wrong in this area were
reachability, and reachability is not something to take on trust.

## 8bm. The squadron comes out for everyone

"I want the other friendly planes to come help at the end of each boss like
in the final boss. That said, don't have this happen in the boss rush mode
where only the very last boss should have the planes like it currently is."

The family arriving mid-fight was a one-off flag - `lastLight` - sitting on
a single phase of a single boss, twenty-three missions deep. It is the best
three seconds in the game and almost nobody was ever going to see it.

Now every campaign boss earns it, and the first one lands at mission 4
instead of mission 23. The predicate is `squadronDue()` in game.js:

- A fight can name its own moment, and the Devourer still does. Its finale
  is choreographed to the beat, so `lastLight` is honoured as an override
  and that arrival is unchanged, frame for frame.
- Everything else gets the default: the earlier of its final phase and 40%
  health.

The 40% floor is the part that took measuring. Triggering on the final
phase alone looked right on paper, but the Marauder's last phase starts at
20% - and the family roughly doubles your damage while they are out there.
Banner, three-second staggered arrival, boss dead. They would have been on
screen for barely two seconds. Firing at 40% of a 26-second fight buys them
a real five seconds of flying beside you, which is the entire point of them
turning up.

**Boss Rush is held back deliberately.** Seven fights back to back with an
arrival in each turns the moment into wallpaper, so there it stays exactly
as it was: the last boss only. `rushIndex` counts bosses as they spawn, so
it already equals the queue length while the final one is on screen - the
gate is one clause, and the test drives a real two-boss rush to prove both
halves of it.

The fly-off needed no work at all. `beginFlyoff()` was already called on
every mission's lap-to-outro transition, so any squadron present speeds off
the screen alongside you at the end of any boss mission. The best beat in
the finale turned out to be three lines of trigger away from being the best
beat in seven fights.

## 8bn. The campaign opens where you actually are

"When you open the campaign it should open on the next mission. For a new
account it opens at the bottom since that's where the first mission is. For
someone who has completed everything, it opens at the top."

The map is about 2200px of route on an 800px screen and it runs bottom to
top, so where it opens is not a nicety - it is most of the screen's job.
And there was already a `scrollToNextStop()` doing exactly the right maths.
It had simply never worked, for a reason worth writing down:

```js
click($("playBtn"), () => { renderMissions(); show("screen-missions"); });
```

Render, THEN show. `renderMissions()` calls the scroll at the end of itself,
while the section is still `display:none`, so `clientHeight`,
`scrollHeight`, `offsetTop` and `offsetHeight` all came back 0. The maths
dutifully computed `scrollTop = 0` and the campaign opened at the top of the
route - on mission 23's empty sky - for everybody, forever. Nothing threw,
nothing logged, and the function looked correct in review because it *was*
correct. It ran one frame too early.

It now waits for the screen to be genuinely laid out before measuring, with
a generation counter so a newer render drops a pending scroll and a try
budget so a screen that is never opened stops asking after half a second.
It also measures the stop's own button rather than recomputing the layout
fractions - the button is the ground truth for where the stop ended up -
and centres it in the band ABOVE the sticky hint card, because centring it
in the raw viewport puts the mission you came to see behind the card
telling you to fly it.

Measured in Chromium at 520x820, driven through the real pilot-picker and
PLAY path: a fresh pilot opens at scrollTop 1530 of 1530 - the bottom, with
mission 1 dead centre - a pilot who has cleared 1-9 opens at 920 with
mission 10 in view, and a finished pilot opens at 0, the top, on The
Devourer.

The lesson is the one this project keeps relearning: **a UI measurement
taken before layout does not fail, it lies.** The regression test is
written against the ordering rather than the arithmetic - it renders while
hidden, asserts nothing was decided yet, then shows the screen and drains
frames - and it was checked by reverting the fix and confirming it goes
red. A test for a bug like this is worth nothing unless you have watched it
fail.

## 8bo. Cutting the UP NEXT card down to a button

"UP NEXT mission is a bit useless in campaign. I think it could be
removed."

Correct, and the reason is worth recording because the card was not built
badly - it was built for a map that no longer needed it. Every job it had
has been quietly taken over by the map itself, one change at a time:

- **Which mission is next** - the stop is the only unlocked one in a row of
  locked ones, ringed, haloed, with your ship parked beside it.
- **Where it is** - the campaign now scrolls to it on open.
- **Who holds the record** - drawn on the stop's rim as the holder's initial
  in their own ship colour. The comment next to that code already said it:
  "it belongs on the map, not buried in a hint card."
- **Tap to fly** - the stop is a real button, and always was.

So it had become a paragraph describing the picture directly above it, for
an audience that would rather look at the picture, and it was charging
120px of a screen whose entire job is the map. Gone: markup, the render
block, its CSS, and the special case in `scrollToNextStop()` that centred
the target in the band above it rather than in the viewport - the stop now
lands dead centre for anyone mid-campaign.

The map is 136px taller for it, and a check guards against the card
creeping back.

**And then half of it came back, correctly.** "I actually think a next
level button is good but it doesn't need to be a whole card like it used to
be." That is the right read, and it splits the card cleanly in two: the
*shortcut* was worth keeping, the *paragraph* was not. Losing the shortcut
also lost the only literal instruction on the screen - "TAP TO FLY" - and
while the highlighted stop is a strong affordance, a one-tap way in costs
almost nothing.

So `#campaignNext` is one sticky line at the bottom edge: `▶ FLY MISSION 10`
in bold, the mission's name beside it in lighter type. A control, not a
summary. Where the card was five lines and ~130px, the button is one line
and ~40px, and it floats over the map while it scrolls rather than taking a
block out of it. The name is the part that truncates on a narrow phone -
the number is what the button is FOR, so it never does.

The tests hold the shape as well as the behaviour: the button must name the
next mission, must brief that mission when tapped, and must stay two child
elements and under 44 characters. That last check is the interesting one -
it is a guard against this growing back into a card one useful addition at
a time, which is exactly how it became a card the first time.

## 8bp. Is it optimised for iPhone? Mostly - and the gaps were measurable

The honest answer before this pass: **the plumbing was right, the layout was
not.** Everything that usually catches a web game on iOS was already
handled, and handled deliberately:

- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding, so the notch
  and the home indicator are respected
- `apple-mobile-web-app-capable`, a black-translucent status bar, an
  apple-touch-icon and a manifest, so Add to Home Screen looks native
- WebAudio unlocked on the first `pointerdown`/`touchstart`/`keydown`, and
  the music element retried on *every* gesture rather than just the first,
  because iOS refuses autoplay until it feels like not refusing
- MP3 for music, because Safari will not play OGG
- `overscroll-behavior: none`, `touch-action`, `-webkit-user-select: none`
  and `-webkit-text-size-adjust` - no rubber-banding, no double-tap zoom, no
  text selection while a thumb is steering
- `height: 100%` rather than `100vh`, which is the difference between a
  layout that survives Safari's collapsing URL bar and one that does not
- the playfield already adapts to the device's aspect instead of letterboxing

Then it was measured, at four viewports, with a real browser: iPhone SE
(375x667), iPhone 14 (390x844), 14 Pro Max (430x932), and one turned
sideways. Four findings, three of them fixable in CSS.

**1. Landscape could not start a game.** `.menu-bg` used
`justify-content: flex-end` on a scrolling flex column. That is a trap:
when content is taller than the box, flex-end pushes the overflow past the
START edge, and no scroll container can scroll to a negative offset. The
menu reported `scrollHeight === clientHeight` with FLY A MISSION at
y = -164 - the title, the pilot and the first three buttons were simply
gone, unreachably. Turn the phone and the game was over. An auto margin on
a zero-size `::before` does the same visual job and cannot strand anything:
it eats spare room when there is any and collapses to nothing when there is
not.

**2. Every touch target was under Apple's 44px floor.** Ghost buttons at
37px, the campaign's next-mission pill at 33, and the hangar's COMPARE and
TEST RANGE overlays at 25 and 26. The padding was already right; they just
needed a `min-height`, so nothing looks different and nothing is smaller
than a fingertip. Zero targets under 44px now, on every screen, at every
size.

**3. iOS ignores the manifest's orientation lock.** `"orientation":
"portrait"` is honoured on Android and quietly ignored by Safari, so a
vertical shooter on a sideways phone got 23% of the screen. There is now a
TURN YOUR PHONE overlay, scoped by `max-height: 500px` as well as
orientation so that an iPad in landscape - which plays perfectly well - is
never nagged. A live mission pauses when it appears, and stays paused when
you turn back: resuming should be a decision, not a surprise.

**4. The field was sized from the orientation it happened to load in.**
`pickFieldWidth()` read `innerWidth/innerHeight` literally and runs once,
so a phone that loaded in landscape was stuck with a 640-wide field for the
whole session - rotate to portrait and the game used 55% of the screen
instead of 77%, for no reason a player could see. It now takes the short
edge as width and the long edge as height, which is orientation-independent
by construction.

Playfield coverage after the pass: 92% of an iPhone SE, 77-78% of a 14 and
a Pro Max, zero horizontal overflow anywhere, zero JS errors.

One process note, and it is the same one as always. The pause-on-rotate
hook was written with `if(!nag.offsetParent) return;` - and `offsetParent`
is null for a `position: fixed` element whether it is displayed or not. The
check reported "hidden" every single time, so the function ran clean, threw
nothing, and did absolutely nothing. It was caught by a probe that rotated
a live mission and found the game still playing behind the overlay. **A UI
predicate that is wrong in the always-false direction is invisible to
everything except actually trying it.**

## 8bq. Full screen means the same box the menus get

Two reports from a home-screen install on an iPhone: "the menu is full
screen but not when I'm playing a level", and "the bomb and fire icons are
too big on iPhone where space is limited."

**The letterbox.** The field's width floor was 440, which is a 0.55 shape.
A modern iPhone is 0.46. So the fit landed on width and left a fat black
band above and below - measured on a 14, a 374x680 playfield inside a
390x844 screen, 77% of it. The menus, which are plain flowing DOM, filled
everything. Side by side, one screen looked like the app and the other
looked like a picture of the app.

The instinct is to set the floor to whatever the raw screen aspect asks for
- 370 on a 14 - and that is wrong, because **the box the field lands in is
not the screen**. It is the screen minus the status bar and the home
indicator, which in standalone is 390x763, an aspect of 0.51. A 0.50 field
fills that top to bottom with nine pixels to spare either side. Below 400
the picture stops improving and the play space keeps shrinking, so 400 is
the floor. An iPhone SE already asks for 450 and an iPad for 600, so
nothing else in the range moves at all.

The other half was `#screen-game { padding: 8px }`. A flat number throws
away 16px of width for nothing and, worse, knows nothing about system
furniture - on a home-screen install it let the field slide under the
status bar. It is now exactly `env(safe-area-inset-*)` top and bottom and
zero at the sides: edge to edge horizontally, and vertically the full
height between the strips iOS reserves. That is the same box the menus
fill, which is the whole point. Coverage went from 77% to 92-100%, and the
frame's rounded corners are squared off on a phone, where a radius against
the flat edge of the screen reads as a glitch rather than a frame.

Before changing the floor, the narrower field was played: mission 1 and the
first boss fought end to end by a bot at 440, 400, 380 and 370, plus a check
that every weak point on every boss stays inside the reachable column. No
difficulty cliff appeared anywhere in that range - the run-to-run noise was
larger than the trend - and nothing became unreachable. The 440 floor was a
conservative guess, not a measured limit.

**The buttons.** The bomb and the overdrive were 74px each, stacked, on a
field about 374px wide. That is a fifth of the sky, and it sits exactly
where a right thumb needs to be to dodge. They were sized on an iPad, where
74px is a fifth of nothing. On phones they are 56px - still comfortably
past the 44px touch floor, a third less area - along with the pause and
music buttons.

Process note: the test for "and still clears 44px" failed twice on my own
regex before it failed on the code, because `width:\s*(\d+)px` matched
`border-width:2px` under a greedy scan. Read the declaration; do not pattern
match the block.

## 8br. Full screen, third time: measure the box, stop guessing it

"This is a screenshot taken from my phone. It's still not full screen."

Two attempts at this had both been arithmetic on the wrong input. First
`800 * innerWidth/innerHeight` with a 440 floor - a 0.55 field on a 0.46
phone, fitted by width, fat bands above and below. Then the floor dropped to
400 and the padding became safe-area aware, which helped and still left
bars. Both times the sum was right and the number fed into it was wrong.

**The field does not land in the screen. It lands in the screen minus the
status bar and minus the home indicator** - on a modern iPhone about 93px of
difference, which was the entire remaining gap. Every version of this had
been matching the field to the shape of the glass rather than the shape of
the hole it gets drawn in.

So it is measured now, not assumed. `--sa-top` / `--sa-bottom` are defined
once in `:root` from `env(safe-area-inset-*)`; the game screen pads by them,
and `pickFieldWidth()` reads them back through a hidden probe sized to the
same variables. One definition, so CSS and JS cannot drift apart - and if
they ever did, the field would again be matched to a box it is not drawn in,
which is precisely the failure mode this section exists to record.

Measured in Chromium with the real iOS inset values delivered the way a
device delivers them:

| device | usable box | playfield | fill |
|---|---|---|---|
| iPhone 14 | 390x763 | 390x763 | 100% |
| iPhone 15 Pro | 393x759 | 393x759 | 100% |
| 16 Pro Max | 440x860 | 440x860 | 100% |
| iPhone SE | 375x647 | 375x647 | 100% |
| iPad | 768x980 | 768x980 | 100% |

Zero gap in both directions on all five, where before it was 77% with a
band top and bottom. The clamp survives only as a safety net - a phone asks
for ~409 and an iPad for ~627, both comfortably inside 380-640 - rather than
being the thing that decides the shape.

Two process notes, both about the harness rather than the game. The probe
initially read `env()` directly, which Chromium resolves to 0, so the test
rig could not tell a working fix from a broken one - the shared variable
made the behaviour testable as well as correct. And injecting those
variables from an init script lands too late: the scripts at the end of
`<body>` have already read the probe. The stylesheet has to carry them,
because that is what a real device does.

## 8bs. YOUR OWN PAINT: the easel

The Style Shop's whole idea is "if kids spend money it needs to be an
obvious difference". The easel is the same idea with the money removed:
the one livery the shop cannot sell is the one a kid painted themself.

A 12x12 grid is laid over the widest band of the hull - wings and body,
zoomed right in, so every cell is a fat touch target on a phone. Cells
whose centre falls off the hull are dimmed and refuse the brush, so the
easel is ship-shaped rather than a square that lies about its corners; a
small live preview in the panel corner shows the whole ship wearing the
work in progress. Twelve pots and an eraser, one undo step per *stroke*
(a dragged squiggle comes off with one tap - the unit a seven-year-old
thinks in), WIPE IT, and PUT IT ON MY SHIP, which wears it on the spot.

The nose-art lesson (8bb) still rules: this is not a sticker, it is a
whole-hull livery drawn as one crisp pixel-per-cell sprite, scaled with
smoothing off and clipped by the same hull polygon the bought patterns
use - the polygon was lifted to `HULL_POLY` so the easel's reach and the
worn clip can never drift apart.

How it travels is the part worth stealing: the worn form IS the encoded
drawing, a `px1:`-prefixed string riding in `profile.decal`. Every place
that already hands `decal` along - loadout to player to renderer, the
campaign map, the hangar, the finale fleet - carries the drawing without
knowing the feature exists, and it rides cloud sync inside the record
like any other field. The saved art also lives in `profile.paintjob`, so
stripping the hull or buying FLAME JOB never destroys it; the shop grows
a MY OWN PAINT card that leads the wall, because "you made it" beats
anything on the shelves below - and because the easel is free, a
brand-new pilot with £0 still walks out with a ship that is theirs.

Verified at both ends: the jsdom suite drives the real journey (open,
drag a stroke, jab the empty air beside the nose, PUT IT ON, strip it,
wear it again, refuse an empty easel), and a real Chromium run paints
through actual pointer events and then reads the pixels back off a
rendered hull - the red blob and the gold stripe are counted, not
assumed.

## 8bt. The death rewind: "oh, THAT'S what got me"

A seven-year-old's account of dying is "that's not fair". Usually it was
perfectly fair and they simply never saw it - the shot came from outside
where they were looking, or the rock they had been dodging for a second
finally clipped a wingtip. Not knowing is what makes a child put the
tablet down. So when the last life goes, the game rewinds the tape.

A ring buffer holds the last 1.6 seconds at 24Hz and is replayed through
the game's OWN renderers, so it is the real thing rather than a diagram:
the same ships, the same bolts, the same hull with the kid's own paint on
it. A stand-in player object carries the cosmetics that cannot change
during a life and takes its motion from the tape; the boss is drawn by
its live object with only its position wound back, because a snapshot was
never going to reproduce a phase machine and weak points. Four beats: the
death itself, a fast reverse scrub, the replay easing from 0.45x down to
0.15x, and a held freeze with the culprit ringed and NAMED - "KAMIKAZE",
"ENEMY FIRE", "THE BEAM", the boss's own name.

**Two things the first cut got wrong, both reported the same evening.**

*"Too [quick] to actually understand what happened - twice as slow at
least."* It ran 0.9x easing to 0.3x, which put 1.6 seconds of action on
screen in 2.4 - technically slow motion, and still too fast to read.
Halved to 0.45x -> 0.15x, so the same 1.6 seconds takes 4.8. That is the
difference between watching it and following it, and the whole thing is
skippable, so being generous costs a tap.

*"When you die your plane should explode or something like this."* It
always did explode - the rewind simply seized the screen on the very
frame the last life went, so the blast was drawn for exactly no frames.
That is now beat zero: the tape waits 1.25s and hands the frame straight
back to the normal renderer, so the wreck burns over a world already
frozen by the ending. The blast was also promoted while we were there -
a lost life gets the standard 58px pop, but the LAST one gets the
boss-sized send-off in the pilot's own colour: a 150px fireball, three
rings rolling off it, a shower of wreckage and a hard kick. Losing your
last life should look like losing it.

The mission still ends on the frame the killing blow lands. Scores, saves
and medals all run exactly as before; only the results CARD waits, which
keeps the rewind clear of every rule that reads `run.ended`.

Two things this cost, both worth knowing:

**The tape must be written in place.** It records inside the update loop
of a game that has to hold 60fps on a phone, so the buffer is allocated
once per mission and every frame overwrites its slot. Per-frame caps
(40 enemies, 72 enemy bolts, 48 of yours) bound it; a frame that
overflows records the first N, because nobody can tell that the 41st
simultaneous enemy is missing but everybody can feel a growing buffer.

**The skip nearly broke the feature.** "Tap to skip" is not optional -
a replay you cannot escape stops being a kindness the second time you
see it - but the first version listened for any key, and on a keyboard
you fly by HOLDING a direction, which the browser repeats many times a
second. The replay was skipped before its first frame drew: the player
who most needed it was the one guaranteed never to see it. The smoke
test caught it, because the bot flies by holding keys too. Fixed with
two guards - key repeats are ignored, and nothing counts for the first
0.35s.

**The furniture needed its own name.** Hiding the pause and mute buttons
by borrowing the boss arrival's `cinema` class silently did nothing:
`endMission` clears that class, and it runs on the very next call after
the replay starts, so both buttons sat live over the replay. They have
their own `rewinding` class now. Caught by looking at a screenshot, which
is the only thing that would have caught it.

Verified in real Chromium as well as jsdom, because jsdom stubs the 2D
context and can prove the wiring but not that anything is drawn: the
browser run flies a real mission, kills the pilot, and reads pixels back
off the canvas to confirm the scene paints and the culprit's red ring is
actually on screen.

One ordering note for whoever adds the next one: the suite's rewind block
runs LAST, because starting a mission consumes the shared `Math.random`
stream and running it earlier reshuffled the spawns of a boss-rush check
two hundred lines away.

## 8bt2. Full screen, fourth time: measuring once was the bug

"It's full screen in web browser but not when open as an app on iPhone."

Section 8br measured the box instead of guessing it, and that was right. It was
measured **once, at script load**, and that was the remaining bug - because the
two cases differ in *when* the answer exists, not in what the answer is.

Safari lays a tab out inside a viewport that already knows its safe-area
insets, so by the time the scripts at the end of `<body>` run, `env()` is real.
A home-screen app launches through a splash screen and runs those same scripts
before the system has told the page anything, so `env(safe-area-inset-*)` still
reads 0. The field is then sized for a phone with no status bar and no home
indicator - measured honestly, against a box that doesn't exist yet.

Reproduced in Chromium by delivering the insets two ways: in the stylesheet
(browser) versus injected after load (app). Same code, same device, one number
apart:

| | VW | frame | fill |
|---|---|---|---|
| iPhone 14, browser | 409 | 390x763 | 100% |
| iPhone 14, **as an app** | **380** | **362x763** | **92.8%** |

380 is the clamp floor - the field had fallen all the way through its own
safety net. 28px of black down each side, exactly as reported.

So `VW` stopped being a `const`. `SF.field.refresh()` re-measures and, only if
the number actually moved, tells every module that took its own copy. The
subscription is the awkward part and it is the price of destructuring a
constant at load; the alternative is a property lookup in every hot loop, which
is worse. Three things have to be told beyond the plain number holders: the
touch mapping (`SF.input.setField` - a stale width maps a thumb to the wrong
place), the broadphase (the World is built once at load, so its grid would stay
sized to the old width and anything in the new right-hand strip would collide
with nothing), and the render caches sized to the field (the vignette and the
blackout veil, dropped rather than stretched).

**When** to re-measure is the whole design. Not per frame, not on resize:
mid-mission every entity holds coordinates in the old space. The only safe
moment is while a world is being built, so `startMission()` calls it first,
before `reset()`. Menus never use `VW`, so nothing is visibly wrong before the
first launch.

One process note, and it cost an hour. Adding the positive screen-shake
assertion called `shakeOffset()`, which draws `Math.random()` twice - and that
shifted the global RNG stream enough to break a boss-rush assertion 800 lines
later. The rumble probes did the same thing through the shared fake clock.
Both are now contained (`Math.random` pinned across the draws, the clock
borrowed and put back). This is the third time this file has recorded a test
perturbing the stream and breaking something far away, which is really an
argument for the seeded RNG in `core.js` reaching the simulation one day.

## 8bt3. The briefing lost its prose, and LAUNCH stopped moving

"When you open a level on phone you need to scroll to access the launch button.
I want to remove the level description... my kids don't care about the story.
It's more important they can see the launch button without needing to scroll."

Measured before cutting anything, on three phone sizes with real iOS insets,
opening both an early stop and mission 23 (the longest roster in the game):

| | content | box | overflow |
|---|---|---|---|
| iPhone SE, mission 23 | 855 | 667 | **188px** |
| iPhone 14, mission 23 | 862 | 844 | 18px |

The description is 43-65px of that, so removing it - which was the request -
would have left an iPhone SE still scrolling by more than 100px. Doing only
the literal ask would have left the actual problem in place.

So the paragraph went **and** the button was pinned: `.brief-actions` is
`position:sticky; bottom:0` inside the screen's own scroll box. That makes
"can they see LAUNCH without scrolling" true by construction rather than by
arithmetic, on any device, however long a future mission's roster gets. All
three phones now show it at rest, including the SE where 137px still overflows.

Two details that took a second and third pass. The bar has to be **opaque
where the button is** - at 0.97 alpha the difficulty blurb was still legible
either side of LAUNCH and read as a rendering fault rather than as content
scrolling underneath; it is solid from 62% down, with a blurred fade above it.
And `briefBackBtn` deliberately sits *outside* the bar: a sticky element cannot
travel past its own position in flow, so at full scroll the bar stops above the
back button instead of trapping it (verified, `overlapped=false` on all three).

Nothing was lost with the prose. Every mission carries both a long `brief` and
a short `goal`, and it is the `goal` that greets the pilot on the launch banner
- so mission 1 still says "Fly with your finger. Shoot!" at the moment that
advice is useful, rather than in a paragraph nobody reads. The `brief` field
stays in the data: it is still the banner fallback for the Daily Patrol, the
firing range, Boss Rush and the vault, none of which define a `goal`.

## 8bt4. The pause that ate your powerups

Section 8b has said "no gameplay timing on the wall clock" since the
boss-celebration `setTimeout` bug. The temp powerups had been breaking that
rule the whole time, and nothing checked.

Rapid Fire, Spread, Homing, Score x2 and Overdrive were stored as absolute
`performance.now() + 9000` deadlines. Pause was a state flag with no
compensation anywhere - a repo-wide grep for `pausedAt|pauseOffset|resumeAt`
returned nothing. So real time kept burning against a nine-second buff while
the game sat still. **Any pause longer than the buff killed it outright**,
without a shot fired.

Three things made it worse than it sounds. It was not opt-in: `visibilitychange`
auto-pauses, so app-switching, locking the iPad or turning it sideways did it
too. It was *visible* - `draw()` still runs while paused and the HUD boost bars
read the same wall clock, so a kid watched the bar they had just earned drain
away behind the pause overlay. And the same leak hit `bannerUntil` and
`objectiveFlashUntil`, so a banner raised just before a pause was already gone
on resume.

The irony worth recording: `finale.js` opens by stating the rule the rest of
the game was breaking - *"Every clock is simulation time (dt), never wall
clock, so pause works."* The finale choreography obeyed it. `run.time` obeyed
it. The player's own buffs did not.

The fix is one clock. `simMs` advances by `dt` in the frame loop while a
mission is playing or ending, and not at all while paused. Everything
downstream already took `timeMs` as a parameter, so it became pause-correct for
free; the thirteen direct `performance.now()` reads in `game.js` now read the
clock, and `render.js` and `ui.js` get at it through `SF.game.now()` because
they read deadlines `game.js` sets - all three have to agree what time it is.

Two decisions inside that. The clock **advances through the death sequence**,
not just play, because `fx`'s hit-stop deadline rides it and freezing it there
would strand one. And it **never resets**: every deadline is relative, and a
clock that restarted at zero each mission would leave any deadline outliving
its mission parked in the future forever - a fresh run would start hit-stopped
at 12% speed.

Verified twice. In jsdom: a nine-second buff survives thirteen simulated
seconds of pause, the clock reads identical before and after, and the buff
still expires normally once time is actually played. In Chromium with real
elapsed time: twelve real seconds paused, clock moved 0ms, 8.9s of buff left on
resume. (The browser harness could not show the *expiry* half, because headless
runs frames slower than the 50ms `dt` clamp allows, so wall time outruns sim
time there. That clamp is the pre-existing tab-switch guard and is doing its
job.)

The rule is now enforced rather than written down: a test asserts `game.js` -
the simulation - contains no `performance.now()` at all. The remaining wall-clock
reads in the codebase are all correct ones: a cosmetic pulse, the hangar's
celebration animation, and a real-world tap counter for the secret.

## 8bt5. Two songs at once

"When I open the game on iPhone as an app added to my homescreen there's two
musics playing at the same time. I don't have this issue in the web browser."

`setMusic()` faded out exactly one element - the `old` it captured at the top -
and every call began by clearing the running fade timer. Those two facts
together are the bug. A switch landing while a fade was still going killed the
timer that was fading the *previous* track down, and that element was then
referenced by nobody: still playing, still audible, at whatever volume it had
reached, for the rest of the session.

It needs no unusual sequence. `menu -> combat -> boss` is just launching into a
boss mission. Reproduced in Chromium by driving exactly that with the switches
inside the 70ms fade window:

```
after menu->combat->boss, settled   2 sounding: menu.mp3@0.07 boss.mp3@0.68
```

The menu theme is quiet there, but 0.07 is perfectly audible on a phone
speaker, and a switch earlier in the fade strands it louder.

**Why the home-screen app and not the browser.** The bug is not iOS-specific at
all - the browser was hiding it. Autoplay rules refuse the early tracks until a
real gesture, so in a tab the stranded element had usually never started
sounding in the first place. A standalone app is a more trusted media context
and gets to start them, so the same defect finally became audible. The report
was about a platform; the defect was in the fade.

The fix is to stop guessing how many tracks are playing. `musicEls` is already
a registry of every element ever created, so `otherTracks()` returns everything
that is not the current one and the fade tick winds *all* of them down. Same
function guards `applyMusicState()`, so a stranded element cannot play through
a mute, a music-off switch, or a backgrounded app either.

Two notes on testing it. jsdom implements neither `play()` nor `pause()`, so
the music layer was invisible to the smoke test - it now installs a stub that
is just enough of an `<audio>` to answer "how many are sounding". And the test
was checked against the broken code before being kept: four assertions fail on
the old `setMusic`, all pass on the new one. A regression test that never saw
the regression is decoration.

## 8bt6. The title under the clock

"The top of the page is hidden by the top icons of my phone."

The menu screens centre themselves vertically with an auto margin, which means
the gap above the title is *leftover* space - whatever the content doesn't
need. On a fresh profile that's plenty. On a full one - a maxed pilot card
with a longer rank line, every mode unlocked with its own subtitle - the
content eats all of it, the flex box pins to the top, and the only thing
between the title and the glass is the bare safe-area padding. The title sits
flush against the status bar, visually jammed under the clock and the Dynamic
Island.

Reproduced by measurement, not by eye: on a viewport short enough for the menu
to overflow, clearance below the status bar was **0px**. Which is the general
shape of this bug class: spacing that comes out of a *remainder* looks perfect
in every roomy test and vanishes exactly when the screen is fullest.

The fix makes the clearance a floor instead of a remainder:
`padding-top: calc(max(20px, env(safe-area-inset-top)) + 16px)` - the inset is
the hard minimum and the 16px is breathing room ON TOP of it, present whether
or not the flex centring has anything left to give. The bottom edge got the
same treatment, replacing a flat `padding-bottom: 40px` that had been
eyeballed on one phone and ignored the home indicator on all of them. And
`html/body` now paint a solid `#0a0920` under the gradient, because a
standalone app's page box can come up short of the glass and anything it
doesn't cover was flashing white.

One harness note, because it bit again: the test rig originally stood in for
the device by overriding `.screen`'s padding with `!important` - which
silently masked the very rule under test. It now substitutes the inset values
into the stylesheet *text*, so every rule that reads `env()` - including the
new `calc()` - is exercised exactly as written. Same lesson as 8br: fake the
input, never the rule.

## 8bu. The third output channel

A tablet has three output channels and the game only used two. The third one
earns its place here for a reason specific to these players: the sound is
usually off. It gets muted in the car, at the table, next to a sleeping
sibling. Rumble is the only feedback that survives that, and for a kid holding
the iPad it does something a screen and a speaker can't - it puts the hit in
their hands.

**It hangs off the sound hooks, not its own call sites.** `SF.audio.play()`
fans out to `SF.haptics.play()` before its own guards. Gameplay code already
names every moment worth reacting to (`"playerHit"`, `"bossPhase"`,
`"coreExposed"`), and threading a second set of calls through a dozen files
would have guaranteed a table that silently drifted the first time someone
added a sound - there are 66 of them now. One named event is one moment of
feedback; how many channels it comes out of is the device's business. The
fan-out sits *above* the mute and SFX checks deliberately: rumble is its own
setting, so a game played with the sound off is still felt.

**The table was tuned off measurements, and the first cut was wrong.** The
instinct was that killing things is far too frequent to buzz on - enemies pop
constantly. Instrumenting a real mission said otherwise: guns fire at 4/s (never
worth a buzz, and auto-fire means the player didn't even ask), but kills land at
0.6/s, which is a tick you read as a tick. Cutting them gave five buzzes across
a 140-second mission, a feature nobody would notice. Putting them back gives
about 0.5 buzzes/second - punctuation. The smoke test now prints the hook tally
the table was tuned against and fails in *both* directions: over 2.5/second is a
rattle, under 40 in a mission is a feature that isn't there.

Two mechanisms bound the worst case. Each event has its own rate limit, and a
global 45ms floor sits under all of them - `vibrate()` cancels whatever is still
running rather than queuing, so without a floor a burst (a smart bomb killing
fifteen at once) truncates itself into one flat smear instead of reading as the
bomb going off. Anything absent from the table is absent on purpose, and the
smoke test pins the omissions: guns, per-bullet impacts and armour clangs, boss
telegraphs and lane fire, the coins and combo ticks that trail a kill whose own
tick already fired, and every `papa*` sound - KING PAPA is a comedy routine, the
joke is the sound, and buzzing through it would flatten it.

**iOS implements no Vibration API at all.** On an iPhone or iPad - which is
every device this family owns - every call is a no-op, so support is re-checked
per call rather than cached, and the settings row hides itself rather than
offering a switch that does nothing. Checking per call is also what lets the
smoke test install a recording stub and assert on what the game actually asked
the motor for, instead of trusting the table by inspection. The feature is real
on Android phones and tablets and inert on the iPads; that asymmetry is the
honest state of the web platform, not something to paper over.

The switch sits in the existing settings overlay next to Screen shake, its
closest relative - both are feel, not content, and both are the kind of thing
someone turns off once and forgets.

## 8bt7. The Wacky Sky replaces the Daily Patrol

"Daily patrol won't be a mode my kids will enjoy. I want to remove it and add
a more fun mode."

The Daily Patrol was designed as a fairness contest: one seed per day, same
sky for everyone, a fair fight over one number. Two problems. The kids never
cared about the contest - a leaderboard is an adult's idea of a reason to
press a button. And the promise was only half true anyway (8bt-era finding):
the wave *script* was date-seeded, but placement, elites and every per-enemy
trait came from the global `Math.random()`, so two devices agreed on the plan
and then flew different skies.

The Wacky Sky keeps the good machinery - the escalating band script, forced
carriers, the 25-minute cut, the `endless` bookkeeping - and swaps the
premise: every flight rolls two (sometimes three) modifiers from a table of
eight, and the launch banner is the reveal. GIANT ENEMIES, TINY SHIP,
CONFETTI BLASTS, BOUNCY COINS, PAPA RAIN, DOUBLE COINS, TURBO ENGINES,
SLEEPY ENEMIES. The pull is "what did we get THIS time?!", which is a
seven-year-old's actual reason to come back.

**Modifier rules.** Every modifier must be visible within seconds ("12% more
hull" is a patch note, not a party), and none may make the run harder than
the campaign - GIANT trades 25% more hull for a 55% bigger target, so it
plays easier and funnier, on purpose. Effects live in the systems they modify
(`spawnEnemy`, `updatePickups`, the kill callback, `startMission`), switched
by `world.mods` / `run.mods` - the same per-mission flag pattern as
`world.silent` - so `wacky.js` only declares the table and never learns any
physics.

Implementation notes that earned their comments: pickups carry a
`bounces = 3` budget set at spawn (pooled objects keep stale fields, so lazy
defaulting would leak budgets between runs); rescue pods are exempt from
bouncing because a rescue boinging off the floor reads wrong even here; PAPA
RAIN is a drip (one head every 6-11s), not the vault's flood, so each one is
an event a kid points at; and the banner's sub-line now shrinks to fit,
because a three-modifier reveal clipped both edges on a phone - the one line
the mode exists for, unreadable.

**What carries over.** `endlessBest`/`endlessLongest` keep their names and
their values - the family's old Daily bests seed the new crown, so nobody's
record vanished. The medals keep their `daily_*` ids for the same reason
(medals are stored on profiles by id); only their flavour moved. The
first-flight-of-the-day double pay is untouched - it was never part of the
mode, it fires on any mission.

A test-suite lesson, recorded because it is now the FOURTH entry in this
family: the new section runs hundreds of extra frames and free rolls, and in
its original slot it shifted the movement bot's phase enough that the rewind
test's tape recorded a ship parked against a wall. Phase-heavy sections live
at the end of the suite now, beside the pause block, for exactly this reason.

### 8bt7b. Second pass: LOUDER

"I'm playing a game and I can barely tell the difference with a normal game."
Fair, and the miss was mine: the rule said every modifier must be visible in
seconds, and half the table broke it. A DOUBLE COINS + SLEEPY ENEMIES roll
changed nothing a kid could point at, the magnitudes were tuning-level
(giant 1.55x reads as a patch note), and after the six-second banner faded
nothing on screen said the mode was on at all.

Three fixes. Magnitudes went to cartoon level, tiered by bulk: popcorn
doubles (2.1x), mid-weights 1.6x, terrain 1.25x so a boulder never becomes a
wall; tiny is now half a ship; sleepy dropped to 0.35x - syrup, not a quiet
day; turbo to 1.7x. Every silent modifier got a visible signature: DOUBLE
COINS literally rains coins from the top of the sky, SLEEPY enemies snore
drifting "z z z", TURBO streaks the starfield at 1.9x. And the mode wears its
roll all run long: the HUD's tier line (dead weight - the mode is always
PILOT) now cycles one modifier name at a time in its own colour, because the
full list collided with the score on one side and the money on the other.
Launch also got a slot-machine beat: each name pops up in its colour with a
firework, one per beat, under the banner.

### 8bt7c. Third pass: cartoon physics

"The size difference isn't really noticeable... Don't be afraid of overdoing
it. Better too crazy than too simple." A brief that explicit deserves a
mechanism, not another nudge, and the mechanism is the oldest cartoon trick
there is: **draw insane, collide fair**.

GIANT popcorn now TRIPLES on screen while its hitbox grows only 1.6x. The
split is what protects the mode's oldest contract (easier and funnier, never
harder): formations spread across VW however fat their members get, so at 3x
collision radii a 13-grunt wall would physically seal the field. Drawn
enormous, collided fair - a wall LOOKS solid and shreds like popcorn. TINY
went from half a ship to a THIRD (there, art and hitbox shrink together,
because matching them only makes the game easier). And "tiny and huge ships"
got its other half: MEGA SHIP, drawn at 1.9x and colliding at stock - the
one modifier where an honest hitbox would have made the game harder, so it
gets the cartoon split in the other direction. The wingman drones scale with
the hull, which is its own joke. `tiny` and `mega` are the table's first
exclusion pair; the roll walks a shuffle and skips conflicts so the hand
size survives.

## 8bt8. One seed per run: the simulation stream stops being a commons

This file records four separate incidents of the same accident: something
drew from the global RNG and an assertion far away broke - comms shifted the
stream and a spawn-timing check flapped; a screen-shake test's two draws broke
a boss-rush check 800 lines later; the rumble probes did it through the shared
clock; the Wacky Sky block moved the movement bot's phase enough to record a
ship parked against a wall. And the Daily Patrol's same-sky promise quietly
died on it: the script was seeded, the simulation wasn't.

The fix is the one `core.js` had been pointing at all along: `rand`,
`randInt`, `pick` and `chance` - the four helpers every gameplay draw goes
through - now read from a swappable source, and `startMission` reseeds it
with one draw per run (`SF.core.seedSim`). A run is reproducible from
`run.seed` alone; nothing before launch can lean on the stream. Tests (or a
future daily-style mode, or co-op) can pin the roll with
`SF.game.nextRunSeed`, consumed once.

The boundary rule, so it stays fixed: SIMULATION code draws from the helpers,
nothing else; COSMETIC code (particle colours, shake jitter, comms line
choice, confetti) uses `Math.random` directly, so decoration can never
perturb gameplay. The two raw `Math.random` calls that were living inside
enemy behaviours - a swooper's turn direction, a boulder's drift - moved onto
the helpers, because those ARE gameplay.

The proof test paid for two lessons worth keeping. Snapshots must be
order-independent: pools reuse dead slots round-robin, so a second identical
run enumerates the same enemies in a different order - identical battle,
different array. And a snapshot needs witnesses that actually consume the
stream: mission 1's opening grunts fly straight lines from fixed formation
slots, so after eight seconds two different seeds had produced identical
positions - the per-spawn `phase` and `weaveWidth` draws are in the snapshot
because they are where the stream leaves fingerprints.

## 8bt9. "What happened to the image used for the papa boss?"

A "?" medallion where KING PAPA's face should be, mid-fight, on the deployed
game. The photo was not missing: `assets/papa.png` was committed, valid
(512x512 RGBA, 463KB) and unchanged on main. Loading it directly in the
browser worked. The failure was in the loader.

`papaPhoto()` walked a list of six spellings - `.png`, `.jpg`, `.jpeg`,
`.webp`, `.PNG`, `.JPG` - so that whatever the family uploads just works. It
walked that list ONCE and then latched forever, which conflated two very
different failures: "this spelling does not exist" (permanent, 404s instantly)
and "that request failed" (transient - a flaky moment, a mid-deploy hiccup,
or the service worker's cache-first fetch rejecting while briefly offline).

Reproduced by serving a single 503 for the .png:

```
RESP 503 papa.png   RESP 404 papa.jpg  ... RESP 404 papa.JPG
--- server is healthy again from here on ---
(nothing, for eight seconds)
```

One bad request, and the session had no Papa until somebody reloaded the page.

Three fixes, because the bug had three enablers. The sweep now backs off four
seconds and goes round again, up to five sweeps, so a hiccup recovers by
itself while a genuinely absent photo still stops asking (~20s, then quiet).
The photo is **warmed at boot** instead of first requested the moment the boss
lands - mid-fight is both the likeliest moment for a hiccup and the most
visible - and deliberately outside `ASSET_PATHS`, because a family that hasn't
uploaded a picture yet must not have the whole game gated on it. And
`cacheFirst` in the service worker now answers a 503 instead of letting the
fetch throw: a throw escapes into `respondWith` and reaches an `<img>` as
`onerror`, which is precisely the transient failure this section is about.

Same reproduction after the fix: `503 -> five 404s -> backoff -> 200`.

## 8bt10. Landscape windows are not phones waiting to be rotated

"The screen size of the game is optimised for a phone. Would it be possible
to make it larger on an iPad or a computer?"

Measured before touching anything, launching a real mission per screen:

| screen | field | frame | of the usable screen |
|---|---|---|---|
| iPhone 14 portrait | 409 | 390x763 | 100% |
| iPad portrait | 627 | 768x980 | 100% |
| iPad landscape | 600 | 543x724 | 53% |
| laptop 1366x728 | 426 | 388x728 | 28% |
| desktop 1920x1040 | 433 | 563x1040 | 29% |

Height already filled everywhere - the waste was WIDTH. `pickFieldWidth()`
modelled every landscape window as a phone waiting to be rotated (short edge
as field width), which is right for a phone - the rotate nag then makes the
player turn it - and wrong for everything else: a desktop window and a
landscape iPad never rotate. So a 1920x1040 monitor flew a 433-wide phone
field in a thin column.

The rule now matches reality: in a landscape window the height is the
binding edge and width is abundant, so the field takes the WIDEST shape the
game is tuned for - the 640 ceiling that every formation, boss arena and
difficulty pass was validated against. Wider than 640 would be a gameplay
retune, not a sizing fix, and a landscape window always has room for it
(640x800 at full height needs width = 0.8 x height). After: laptop 582x728
(+50% linear, area more than doubled), desktop 832x1040, iPad landscape
579x724, and portrait screens byte-identical.

The phone case this model existed for is covered by two other mechanisms
now: the sub-500px rotate nag blocks play until the phone is upright, and
the field re-measures at mission launch - after the rotation - so the
sideways number never flies a mission. The suite check that pinned the old
rule ("sized from the short edge, whichever way it is held") is rewritten to
the new contract, with desktop, landscape-iPad and portrait-phone cases each
asserted; the remaining pillarbox on a 16:9 monitor is the game's own
portrait shape, which is the game, not a bug.

## 8bt11. Does the wide field actually get used?

"Does the size of the screen influence the way enemies are behaving? I don't
want the extra space to just be empty."

Measured before answering - the same seeded mission flown at 380 wide and
640 wide, sampling every live enemy five times a second for 45 seconds:

| | phone 380 | desktop 640 |
|---|---|---|
| width columns ever visited (of 20) | 18 | 20 |
| average wave spread, as % of field | 61% | 59% |
| outer 20% of the field's share of sightings | 14% | 16% |

So the space IS used: formations take their positions from `VW`, waves span
the same *fraction* of whichever width they get, and the added edges see
their near-fair share of traffic. Behaviours follow the player (kamikazes,
snipers, swoopers aim at the ship), and the ship roams the whole width, so
the chase covers it too.

Two shapes and one number were the exceptions. `vee` drew its arrowhead with
a fixed 62px gap and `line` capped its gap at 84px - the same phone-sized
figure centred in a 640 field - so both now scale gently with width,
unchanged below ~580. And wave COUNTS carried no width term at all, which
meant enemies-per-area thinned as the field grew. `waveSize` now tops counts
up by `clamp(VW/600, 1, 1.2)`: the campaign was tuned on the 600-wide tablet
field, so a 640 field flies ~7% more ships - exactly area-proportional, no
more - phones fly the tuned data untouched, and the 1.2 ceiling stops a
future wider field from silently doubling traffic.

Worth saying plainly: the phone-vs-desktop density gap in the first table
(1.25 vs 0.72 enemies per 100k units squared) is almost entirely the
phone-vs-TABLET gap that has existed since the 600x800 retune - the phone is
the extra-dense compressed case, the wide field is the design reference. The
top-up levels desktop with iPad; it does not try to make the wide sky feel
like a phone's, because the tuned game is the tablet's.

## 8bt12. The Steam-feel pass: twelve pieces of finish

A full review pass against one question - "would this pass for a released
game, not a passion project?" - and twelve fixes from it, roughly in the
order a player meets them:

1. **The typeface ships with the game.** Rajdhani came from Google Fonts,
   which the service worker cannot cache; an installed app played offline
   fell back to Arial and lost the whole typographic identity. Two woff2
   files in `assets/fonts` ride the same cache-first path as the music.
2. **The chrome is drawn, not emoji.** Second half of the 8c4e36e sweep:
   armory tabs, all fourteen shop-upgrade tiles, ability buttons, locks, the
   settings gear, the mute speaker and the fullscreen arrows are canvas
   glyphs in the menu icons' neon line style (`icons.js`). Emoji renders
   differently per platform; these are identical everywhere. Deliberately
   kept as emoji: earned-medal stickers and toast icons - a sticker in a
   drawn disc is charm, and 27 bespoke glyphs would be effort spent making
   the game less charming.
3. **The game never opens a native dialog.** prompt()/confirm() - the single
   most prototype-feeling moments - are replaced by an in-game dialog in the
   story-overlay language, promise-based (`ask`/`confirmDlg`), with a danger
   style for the two-step pilot reset. The suite BANS the natives: its stubs
   now throw.
4. **The results screen stopped colliding with itself.** Medal toasts hold
   for 1.5s (and cut any toast already mid-flight) so the card lands first; a
   bumper haul collapses to one "5 at once!" row where eight double-height
   rows used to shove the results off screen; a comboless run no longer
   prints "x0".
5. **Overlays animate like screens.** One shared 180ms fade-and-settle for
   pause/results/story/settings/dialog, next to navigation that already
   moved. The armory's sticky Back gets the briefing bar's full-bleed
   gradient underlay instead of floating translucently through card text.
6. **Desktop answers the mouse.** Hover states across every interactive
   surface, gated on `(hover:hover)` so touch never sees them; Esc already
   paused; a fullscreen toggle appears only where the API exists (never on
   iOS, never in an installed app).
7. **No developer strings in the game.** The Papa placeholder said "upload
   docs/assets/papa.png" - a repo path, mid-boss-fight. It says "PAPA'S
   PHOTO GOES HERE!" now.
8. **Numbers roll.** Score, money collected and wallet count up over half a
   second (ease-out, exact final value guaranteed); an unaffordable shop tap
   shakes the row, flashes the price and plays a two-falling-notes deny blip
   - the button stays tappable BECAUSE the answer is the point; a disabled
   button that swallows the tap reads as broken to a kid.
9. **Loading is the title card.** First contact was a black void with
   pulsing text; the title art is local, so the first painted frame is now
   the game.
10. **Type-scale nudges.** The 9px armory tab labels (smallest text in the
    game) up to 10px; the HUD's monospace money/score stays - tabular digits
    are the right tool there.
11. **Pause is a save point.** Goal line plus live objective progress
    ("Rescue every stranded pilot — 0/3"), because kids get interrupted
    constantly and "PAUSED / RESUME" told them nothing.
12. **Dim states lifted.** The medals ring is visible at 0%, locked medal
    cards read in daylight, and the armory tab strip fades at its right edge
    until you reach the end - the fifth tab used to be a secret.

## 8x. "I don't want the ship frozen at the top of the screen"

The Armory's ship bay had been `position: sticky; top: 0` since 8d, on the
argument that buying a part and seeing it land on the hull are the same
moment, so the hull should never leave the glass. That argument had already
been half-retracted once: 8bt (the STYLE SHOP pass) unpinned the bay on the
two browsing tabs because a sticky bay "turned scrolling into peering
through a letterbox." A conditional pin is a smell - it means the pin is
losing the argument on some screens and nobody wants to say so.

On a wide desktop window it lost outright. The bay is `aspect-ratio: 620/340`
at full container width, capped at `32vh`; pinned, it froze roughly the top
third of the screen, and because it needs an opaque background (a translucent
one let shelf text scroll up *through* the "next part to fit" line) it
hard-clipped every card sliding under it. The customer's screenshot showed an
upgrade card guillotined mid-sentence at "Now: 6-way fire."

So the bay is `position: static` on every tab. What made the pin defensible in
the first place survives without it: fitting a part already fires a toast
(`FITTED: <part name>`), which announces the change wherever you happen to be
scrolled, and the shelves are tabs rather than one long list, so a shelf on a
phone is a short scroll back to the ship rather than an expedition.

Deleted with it: the `unpinned` class, the `#screen-armory.unpinned` rule, and
the tab-conditional `classList.toggle` in `renderArmory`. Three moving parts
whose only job was to decide when the fourth one was wrong.

## 8y. The trackpad is a touchscreen lying flat

"Make the game fully playable with a Mac trackpad, similar to the iPad
experience - move a finger around the trackpad without needing to click or
hold." The good news is that the browser has already done most of this: a
trackpad glide arrives as plain `pointermove` events with `pointerType:
"mouse"` and no button down. The iPad experience was only missing because the
input layer *required a pointerdown* before it would listen.

So mouse pointers get **hover steering**: whenever a buttonless mouse move
lands inside the playfield canvas, the ship engages and chases it - the same
spring, the same speed cap, the same feel as a finger on glass. When the
pointer leaves the canvas the ship disengages and settles. A click mid-flight
neither starts nor stops anything: `pointerup` hands control straight back to
hover instead of dropping the drag, so clicking the bomb button doesn't make
the ship stutter. Touch is untouched - a touchscreen only emits `pointermove`
while a finger is down, so the hover branch is unreachable for it, and the
smoke test pins that.

Two details carried the feel:

- **No lift for a cursor.** Touch steering lifts the ship 48px above the
  finger because a thumb hides what's under it. A cursor hides nothing;
  keeping the lift would have made "put the ship exactly there" impossible
  on the one input device that's precise enough to want it. `TOUCH_LIFT` now
  applies to `pointerType === "touch"` only - which also fixed the old
  click-drag path for mouse users, which had been inheriting the thumb lift
  for no reason.
- **`cursor: none` on the playfield.** With zero lift the OS arrow would sit
  exactly on the ship, reading as clutter. The ship IS the pointer. The HUD
  buttons and every overlay are DOM elements above the canvas, so the cursor
  reappears the moment there is anything to click - pause, results, dialogs
  all keep a normal arrow.

The hover branch checks `rect.width > 0` before engaging: a hidden screen's
canvas measures 0x0, so menu-time mouse movement can never set a stale drag
target for the next mission's first frame (`clearMovement` also drops the
hover flag, so a mission starts deaf until the pointer actually moves).

Verified in real Chromium, not just jsdom: glide the mouse (no button) to 85%
of the field width, and the ship converges on virtual x 544 for a target of
544, releases the moment the pointer leaves the canvas, and the computed
cursor over the canvas is `none`.

## 9. What I'd do next

Roughly in value order:

1. **Wingman AI** — drones that drift and target rather than firing straight.

## 10. Testing

- `npm test` — jsdom smoke test: loads the real sources, validates the data
  tables (every wave references a real enemy, every boss weak point disables a
  real attack, phases descend), then plays mission 1 to completion and a boss
  mission with a bot, asserting on stars, money, kills, pooling and save
  migration, and checks the rumble table against a recording stub in place of
  the vibration motor jsdom doesn't have, and pins the playfield's ability to
  be re-measured after load. ~657 checks.
- Visual checks are done with Chromium screenshots at iPad and phone sizes
  (throwaway harness, not checked in — see the README). The haptics work was
  checked with `navigator.vibrate` both present and absent, since the two cases
  render different UI.
