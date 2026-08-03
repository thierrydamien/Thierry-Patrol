# SkyForce — Thierry Family Edition

A Java arcade-style 2D shooter, forked and personalized for the Thierry
family. Based on **Java-SkyForce-2D-Game** by Ranmal Dewage and the ALPHA
Team (Apache-2.0 licensed — see LICENSE).

**🌐 Also playable in the browser** — `docs/` holds **Novawing**, a
from-scratch web game with no install/MySQL required. Once GitHub Pages is enabled for this
repo (Settings → Pages → Deploy from branch → `main` / `docs`), it's live
at `https://<your-username>.github.io/<repo-name>/`.

Each player logs in with their own account, so progress, money, and
upgrades are tracked separately per person.

## What's different from the original
- **Levels** — 5 hand-tuned levels with increasing difficulty, a
  "LEVEL X INCOMING" banner between them, and endless scaling after that.
- **Money & the Armory** — earn money by playing, spend it on permanent
  upgrades: Spread Shot, Rapid Fire, an Energy Shield, and extra lives.
- **Callsigns** — each player can set their own callsign, shown on the
  main menu greeting, the in-game HUD, and the family leaderboard.
- **Ship colors** — pick a ship color in the Armory; it's applied to your
  ship in-flight.
- **Thierry Family Championship** — the leaderboard is personalized with
  the family name and shows callsigns instead of raw usernames.

See `SkyForce/schema_updates.sql` for the one-time database migration
this fork needs (adds a `wallet` table for money/upgrades/callsign/color;
doesn't touch existing tables), and `CHANGES.md` for the full list of
what changed under the hood.

## Setup
1. Import `SkyForce/` into NetBeans (or build with Ant).
2. Set up the `skyforce` MySQL database as the original project expects
   (`user` and `highscore` tables), then run:
   `mysql -u root -p skyforce < SkyForce/schema_updates.sql`
3. Run the project. Each family member registers their own account, then
   sets a callsign and ship color from the Armory.

## Game Visuals

<img src="https://i.ibb.co/qm9B0CP/GamePlay.jpg" alt="GamePlay" border="0">

## Credits
Original game developed by ALPHA Team:
* Ranmal Dewage
* Tenusha Guruge
* Vimukthi Rajapaksha
* Aravinda Kulasooriya

(C) 2017 Ranmal Dewage (ranmal.b.dewage@gmail.com) — [ranmaldewage.wordpress.com](https://ranmaldewage.wordpress.com)

Licensed under the Apache License, Version 2.0 (see `LICENSE`).
