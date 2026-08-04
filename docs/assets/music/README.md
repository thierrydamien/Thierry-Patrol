# Music

Copyright-free tracks supplied by the family, converted from OGG to MP3
because Safari on the iPads cannot play OGG, and MP3 plays everywhere
(AAC would have been silent in codec-free Chromium builds).

Slot mapping (see `MUSIC` in `src/audio.js`):

| file | plays on | source track |
|---|---|---|
| `title.mp3` | pilot picker | SkyFire Title Screen |
| `menu.mp3` | every other menu screen | Brave Pilots Menu Screen |
| `combat-1.mp3` | missions (rotates) | Space Heroes |
| `combat-2.mp3` | missions (rotates) | Battle in the Stars |
| `combat-3.mp3` | missions (rotates) | Alone Against Enemy |
| `boss.mp3` | boss fights | DeathMatch Boss Theme |
| `defeat.mp3` | failed mission (once, then menu) | Defeated Game Over Tune |

To add more: convert with
`ffmpeg -i in.ogg -c:a libmp3lame -b:a 160k out.mp3`,
drop the file here, and add its key to the `MUSIC` table - extra combat
tracks just extend the rotation.
