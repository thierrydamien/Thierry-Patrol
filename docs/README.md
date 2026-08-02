# SkyForce — Thierry Family Edition (Web)

An arcade shooter in the spirit of Sky Force: fly missions, rescue people,
earn coins, spend them in the Armory, replay missions on harder tiers for
more stars. Runs in any browser — no install, no MySQL, nothing to sign up
for.

Live at **https://thierrydamien.github.io/space/** (served from this `docs/`
folder). Progress is saved per pilot, per browser.

For how it's built and why, see **[DESIGN.md](DESIGN.md)**.

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

## The campaign
Eight missions, each with three star objectives shown in the briefing and
tracked live in the HUD:

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

| Tier | Enemies | Return fire | Pays | Needs |
|---|---|---|---|---|
| ROOKIE | slow, fragile, +1 life | sparse, never aimed | 0.7x | — |
| PILOT | standard | occasional | 1x | — |
| ACE | +60% health, faster | 28% aimed, they strafe | 1.8x | 6 ★ |
| VETERAN | +130% health | 45% aimed, smarter | 2.8x | 14 ★ |
| NIGHTMARE | +220% health | 62% aimed, ruthless | 4.5x | 24 ★ |

## The Armory
14 upgrades across 53 levels (~$70,000 to max everything) in four shelves:

- **Guns** — Spread Shot, Rapid Fire, Plasma Rounds, Piercing Rounds, Seeker Rounds
- **Staying Alive** — Energy Shield, Extra Life, Hull Plating
- **Ship** — Ion Thrusters, Tractor Beam
- **Specials** — Salvage Rig, Wingman Drone, Smart Bombs, Overdrive

Every level costs more than the last and visibly changes the ship — bullets
grow and change colour as Plasma Rounds levels up, drones fly alongside you,
shield charges show as rings.

Buying gear earns **rank**: Rookie Cadet → Wing Cadet → Squadron Pilot →
Flight Leader → Star Ace → Wing Commander → Space Legend → Thierry Legend.
Your rank badge shows on the pilot picker, the menu and the Armory card.

## Bosses
Two encounters, both with:
- **Phases** at health thresholds that change how they attack, ending in an enrage
- **Telegraphed attacks** — a charging ring, a target lock on your ship, a red
  warning column before the sweeping beam — so you always get a moment to move
- **Weak points** (the glowing yellow rings) that take double damage and, when
  destroyed, permanently disable the attack they power
- Visible damage: scorching, chunks torn out of the hull, smoke, then fire

## Medals, records and the family board
22 medals to unlock, a best score and star count per pilot, and a
Championship screen ranking everyone in the family by stars.

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
