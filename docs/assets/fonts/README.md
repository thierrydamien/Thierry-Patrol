# Typefaces

Two, with one job each.

- **Rajdhani** (500/600/700) — the game's voice. Headings, labels, counters,
  prices, buttons, the HUD. Condensed and technical, which is right on an
  instrument panel.
- **Nunito** (400/600) — running text only: story captions, upgrade
  descriptions, card blurbs, hints. Rounded and humanist, with a tall
  x-height that survives being set at eleven pixels.

The rule for anything added later: if it is a **sentence**, it takes
`var(--prose)`. If it is a label, a number or a button, it does not.

Both are SIL Open Font Licence 1.1, bundled here rather than fetched from a
CDN so the game keeps working with no network — which is the whole point of a
static site the family flies in the car.
