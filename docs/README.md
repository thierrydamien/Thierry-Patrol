# SkyForce — Thierry Family Edition (Web)

An arcade shooter in the spirit of Sky Force: fly missions, rescue people,
earn coins, spend them in the Armory, replay missions on harder tiers for
more stars. Runs in any browser — no install, no MySQL, nothing to sign up
for.

Live at **https://thierrydamien.github.io/space/** (served from this `docs/`
folder). Progress is saved per pilot, per browser.

For how it's built and why, see **[DESIGN.md](DESIGN.md)**.

## Built for the iPad
The playfield is 800 tall and 440-640 wide, picked from your device's aspect
when the game loads, so on an iPad it fills the screen edge to edge with no
letterboxing and gives you real room to manoeuvre. Enemy formations, wave
sizes, speeds, sprite scale and the HUD are all tuned for that width rather
than stretched into it - including three formations (three-lane, gap-in-the-
wall, and crossing pincers) that only work on a wide field.

## Playing it
Pick your pilot, choose a mission, choose a difficulty, fly.

- **The guns are automatic.** You never hold a fire button — you fly, dodge,
  collect, and set off specials.
- **Desktop:** arrow keys or WASD to fly in any direction. **B** = smart bomb,
  **V** = overdrive, **P**/**Esc** = pause.
- **Touch / iPad:** drag anywhere on the playfield (the ship rides just above
  your finger). The 🔥 and 💣 buttons on the right are your specials — they
  only appear if you own them, and show how many charges are left.
- **Coins** drop from everything you destroy and are real money — fly over
  them before they fall off the bottom. The Tractor Beam upgrade pulls them in.
- **Prison Haulers** (marked SOS) are carrying stranded pilots. Shoot one down
  before it escapes, then fly to the pod it drops.

## The briefing
Picking a mission opens a proper dossier, not a list of buttons: the mission's
own sky as a hero image with your ship in it, the brief, the three star
objectives (lit for the tier you've selected), **"what's out there"** — the
actual enemy art for the archetypes this mission uses, biggest first — and a
row of difficulty chips showing how many enemies, how much health and what it
pays. You pick a tier, then hit **LAUNCH**, which is tinted to match.

## The campaign
The mission select is a **route across a star map**, not a list: eight stops
along a winding line from HOME PATROL out to ENEMY SPACE, with your own ship —
drawn from your actual upgrades — parked at the furthest one you've reached.
The stretches you've flown are lit gold, the rest is a faint dashed plan ahead
of you. Boss stops wear a **☠ BOSS** tag (red spikes alone only read as danger
if you already know the convention), stars you've earned sit on each stop's
rim, and the one you're up to pulses. The sky behind it is nebula clouds,
three planets, a distant galaxy and drifting dust — painted once and reused,
so it costs nothing to animate over.

Eight missions of **2 to 3.5 minutes** each (about 20 minutes of flying in
total), each with three star objectives shown in the briefing and tracked live
in the HUD. Missions are built in acts with lulls between them, a halfway
bonus, and a build to the finale:

| # | Mission | Teaches | Boss |
|---|---|---|---|
| 1 | First Patrol | flying and shooting | — |
| 2 | Weaving Through | moving targets, first rescue | — |
| 3 | Return Fire | enemies that shoot back | — |
| 4 | Heavy Metal | armour, gun platforms | **The Marauder** |
| 5 | Kamikaze Run | dodging lock-on attackers | — |
| 6 | Prison Break | rescue under pressure | — |
| 7 | The Gauntlet | elites | — |
| 8 | Sky Sentinel | everything at once | **Sky Sentinel** |

Finish a mission to unlock the next one. Stars unlock the harder difficulty
tiers, which pay far more — so the campaign and the Armory feed each other.

| Tier | How many | Health | Return fire | Needs |
|---|---|---|---|---|
| ROOKIE | 0.75x | 0.8x, +1 life | sparse, never aimed | — |
| PILOT | 1x | standard | occasional | — |
| ACE | **2.05x** | 2.6x | 28% aimed, they strafe | 6 ★ |
| VETERAN | **2.8x** | 4.4x | 45% aimed, smarter | 14 ★ |
| NIGHTMARE | **3.6x** | 7.5x | 62% aimed, ruthless | 24 ★ |

The "how many" column is the one that actually makes a tier hard. On a maxed
ship, NIGHTMARE now keeps around **10 enemies on screen at a time and peaks
above 30**, against 1–3 before — a well-armed ship deletes things on arrival,
so health alone can never fill an empty screen.

On ROOKIE and PILOT enemy health is exactly as written, so buying guns visibly
makes things melt — that's the reward for upgrading. The three hard tiers also
**scale enemy health to the firepower you actually bring**, more so the harder
you go, so turning up to NIGHTMARE fully kitted out is still a fight rather
than a victory lap.

## The Armory
14 upgrades across 53 levels in four shelves:

- **Guns** — Spread Shot, Rapid Fire, Plasma Rounds, Piercing Rounds, Seeker Rounds
- **Staying Alive** — Energy Shield, Extra Life, Hull Plating
- **Ship** — Ion Thrusters, Tractor Beam
- **Specials** — Salvage Rig, Wingman Drone, Smart Bombs, Overdrive

**Each level costs 4.6x the one before it**, so the first level of anything is
pocket money and the last level of a track is a trophy. Maxing everything is
~$944,000 — a simulated career (fly the hardest tier you've unlocked, bank,
buy) reaches half a ship in 16 runs and a *complete* one in **118 runs, about
6.5 hours of flying**. You get strong quickly; you get finished slowly.

Every level visibly changes the ship — bullets grow and change colour as Plasma
Rounds levels up, drones fly alongside you, shield charges show as rings, and
each level bolts a physical part onto the hull in the hangar.

Buying gear earns **rank**: Rookie Cadet → Wing Cadet → Squadron Pilot →
Flight Leader → Star Ace → Wing Commander → Space Legend → Thierry Legend.
Your rank badge shows on the pilot picker, the menu and the Armory card.

## Enemies that change how you play
**Nineteen archetypes**, each with its **own drawn ship** — a dart, a gunship,
a hauler, a comb, a rifle, a fork — so you can tell what something is before it
does anything. Beyond the eight that just shoot at you, these need a different
answer rather than more bullets:

- **Guardian** — projects a shield dome over everything near it. Your shots
  splash off until you kill the Guardian, which turns a wave into a priority
  problem.
- **Splitter** — bursts into three homing shards when you kill it. The kill
  is the start of the problem, not the end of it.
- **Coin Thief** — hunts your dropped coins and runs for the top of the
  screen with them. Shoot it down and it drops everything; let it go and that
  money is gone for good.
- **Mender** — repairs damaged enemies with a visible green beam. It undoes
  work you have already done, which makes it the most annoying thing to ignore.
- **Hive** — never shoots you, just keeps producing drones. Leave it and the
  screen fills up.
- **Minelayer** — drops mines that sit, blink faster as they arm, and go off
  on their own. Turns a corner of the screen into somewhere you can't fly.
- **Marksman** — parks and takes deliberate shots, drawing the line it is
  about to fire down so you always get a moment to move.
- **Interceptor** — matches your column and keeps correcting. Unlike a
  kamikaze it never commits, so you have to actually break the lock.
- **Asteroids** — drifting rocks. Dodge them or break them up for cash. They're
  scenery, not opposition, so they never count against your "destroy the
  enemies" star.
- **Boulders** — an occasional set piece (three missions out of eight, with a
  ⚠ ASTEROID FIELD ⚠ warning). Roughly **five seconds of concentrated fire**
  whatever you fly, they crack visibly as you work on them, and they break into
  three asteroids and a fat payout. Ramming one costs you a life *and the rock
  is still there* — so a boulder is a decision, not a target.

The first one of each in a run gets a radio line explaining what it wants —
a new mechanic nobody explains just reads as the game being broken.

## The art
Almost all of it is **drawn in code**, so it needs no image files at all.

- **The enemy fleet** (`src/enemyart.js`) — one silhouette per archetype, built
  from polygons with a fixed light source, rasterised once into an offscreen
  canvas and blitted. Nineteen distinct ships cost exactly what one shared
  sprite cost.
- **The skies** (`src/skygen.js`) — **a different backdrop for every mission**.
  Missions 1 and 5 use the original painted artwork (Home Reach and Ice
  Fields); the other six are generated from a palette and a seed, each with its
  own furniture — ringed gas giants, banded worlds, cracked moons, a red dwarf,
  asteroid fields, distant galaxies — over clustered emission clouds and dark
  dust lanes. The generated ones are **vertically tileable**, so the playfield
  genuinely scrolls through them; the paintings pan, as they always did.

The player's ship and the two bosses still use the original artwork.

## Bosses
Two encounters, both with:
- **Phases** at health thresholds that change how they attack, ending in an enrage
- **Telegraphed attacks** — a charging ring, a target lock on your ship, a red
  warning column before the sweeping beam — so you always get a moment to move
- **Weak points** (the glowing yellow rings) that take double damage and, when
  destroyed, permanently disable the attack they power
- Visible damage: scorching, chunks torn out of the hull, smoke, then fire

A boss is sized in **seconds of fight, not hit points** — its health pool is
derived from the firepower you actually turn up with, so the Marauder is a
~30-second fight and the Sky Sentinel a ~50-second one whether you fly in with
a stock hull or a maxed one. The difficulty tier still scales it on top.

## Made for this family, not for a store page
The other pilot in the house isn't a leaderboard row — they're in the game:

- **Your wingmen are your siblings.** Buy the Wingman Drone and the escorts that
  appear fly in the other pilot's own ship colour with their callsign printed
  underneath. The results screen tells you who flew with you.
- **Records are household records.** Every mission card says who holds it —
  "🏅 Charlie holds this · 5120", or "Nobody has flown this yet - claim it" — and
  after a run you're told either "🏆 new best!" or exactly how many points you
  still need.
- **Pick your own badge.** 16 emoji (🦈 🐉 🍕 🦄 …) in the Armory; it shows on the
  pilot picker, the menu and your pilot card, on top of the rank you've earned.
- **A flight log** on the pilot card: missions flown, pilots rescued, enemies
  down, best combo — their record, not the game's.
- **Losing isn't a telling-off.** A failed run says **SHIP DOWN**, tells you how
  far you got, and reminds you that you keep every coin you collected.
- **The copy is written for kids** — "Little robot buddies fly next to you and
  shoot too", not "Escort drones that fire alongside you".

## The Hangar
Every upgrade track bolts a **physical part** onto the ship, so maxing things
out visibly builds a different machine: Rapid Fire grows a second, then a
fourth barrel, then a spinning gatling drum; Spread Shot adds wing pods, then
outer pylons, then a full broadside; Energy Shield lights a containment ring
around the hull; Ion Thrusters open the exhaust into afterburners. **21 parts**
in all.

The hangar *is* the Armory — one screen, because buying a part and seeing it
appear are the same moment:

- The ship sits **pinned at the top** and idles there (bobbing, exhaust
  flickering, rings turning) while you shop, so a part you buy appears on the
  hull without going anywhere.
- The **next part you haven't earned** is ghosted onto the hull, named, with
  exactly which upgrade level buys it — and each shop row says which part it
  will fit.
- **COMPARE** puts the factory ship beside yours at the same scale, so the
  transformation actually registers.
- The shelves are **tabs** — Guns, Staying Alive, Ship, Specials, plus My Ship
  (all 21 parts, lit or grey) and Pilot (callsign, colour, badge, flight log).
  Only one is ever on screen, so a whole shelf fits an iPad without scrolling.

## Comms
Someone talks to you about more than shooting: pick-ups ("Shield online!"), a
near miss ("Whoa! Nearly had you."), your last life, a broken combo, a big
streak, a rescue, the halfway mark, a record you just took. Lines come from
mission control or from the other pilot in the house, one at a time, rate
limited per event so it never turns into chatter. **The ship in the panel is
the speaker's real ship** — when your brother says something, you see the ship
he's been building.

## Story
Comic-style beats fire once each and are drawn with your *actual* ship:

- **the first part you fit** — stock hull, then what you've made of it
- **twenty upgrades in** — a proper ending. Command stops calling you a cadet,
  and the last panel says out loud that this is the end of the beginning: the
  game keeps going, and there are harder skies.
- **campaign cleared** — a curtain, and a push toward the tiers that used to be
  impossible.

## Medals
22 to unlock, shown as a grid of discs with a progress ring and — more usefully
— **the next one still to win** called out at the top, so the screen is a
to-do list rather than a record of things that already happened. Locked medals
are greyed silhouettes, not blanks: you can see the shape of what you haven't
got.

## The Championship
A **podium**: second place left, first in the middle and taller, third right,
each pilot standing behind their own ship drawn from their own upgrades. Below
it, **who holds what** — every mission with the name of whoever in the house
owns the record and the score to beat, with your own rows highlighted. A total
tells you who's ahead; this tells you which mission to go and take back.

## Running the tests
```
npm install
npm test
```
The smoke test loads the real sources exactly as the browser does, validates
the data tables, then plays mission 1 to completion and a boss mission with a
bot — asserting on stars earned, money banked, kills, pool bounds and old-save
migration. It stubs the 2D canvas (jsdom has no renderer without native deps),
so visuals are verified separately with Chromium screenshots at iPad and phone
sizes; that harness is a throwaway rather than a checked-in dependency.

## Notes
- Progress is per-browser (`localStorage`). The same pilot on a tablet and a
  phone is two separate save files.
- Saves from every previous version are migrated forward automatically —
  old one-off purchases become the equivalent upgrade levels, and old endless
  progress is credited as cleared missions.
- Opening `index.html` straight off disk works, but browsers block pixel
  read-back on `file://`, so the ship keeps its original orange instead of
  your chosen colour. Serve the folder (or use the live URL) for the real thing.
