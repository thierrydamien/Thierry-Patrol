/*
 * Procedural deep-space backdrops - one per mission.
 *
 * Every level used to share a single JPG, so flying mission 8 looked exactly
 * like flying mission 1. These are generated instead: a palette and a seed per
 * mission produce a nebula with its own colour, structure and star density, so
 * the campaign visibly travels somewhere.
 *
 * Two properties make it work in a scrolling shooter:
 *
 *  - **Vertically tileable.** Every element is drawn three times (at y, y-H
 *    and y+H), so the image wraps seamlessly and the playfield can scroll
 *    through it forever without a seam. The old art was pan-only for exactly
 *    this reason - it could not be scrolled.
 *  - **Built once.** A backdrop is rendered into an offscreen canvas at
 *    mission start and then blitted, so hundreds of gradients cost nothing per
 *    frame.
 */
(function(){
"use strict";
const SF = window.SF;
const TAU = Math.PI*2;

/* ---------------------------------------------------------
   PALETTES - one per mission, in campaign order.
   `clouds` are the emission colours, `dust` the dark lanes
   that give a nebula its structure, `star` tints the suns.
   --------------------------------------------------------- */
const SKIES = [
  /*
   * THE WORKSHOP, AND THE CAMPAIGN'S OLDEST SECRET.
   *
   * The first sky anybody ever flies is the same sky as the LAST one but two:
   * the workshop's own twilight, graphite and one warm lamp, which mission 34
   * finally gives a name to. You are behind the sky on your very first patrol
   * and nobody tells you for thirty-three missions. A campaign that finishes
   * somewhere you have already been finishes somewhere, instead of stopping.
   *
   * It earns the slot on its own merits too, which is what makes the trick
   * affordable rather than clever: this is the quietest palette in the table -
   * half the usual cloud, barely any stars, one lamp - and the tutorial's
   * backdrop must never compete with the first enemy a seven-year-old ever
   * sees.
   *
   * Deliberately not unique, and the smoke test knows about this ONE pair by
   * name; any other repeat is still a failure.
   */
  { name:"Lamplight",    clouds:["#3d3a55","#c9b458","#15131f"], dust:"#0a0a12", star:"#e2e8f0",
    lum:1.0, density:0.5, stars:0.55, bright:1,
    /*
     * Its own corner of the same room, though. The finale's version is nearly
     * bare because the finale overpaints it live - blueprint flashes, act
     * repaints - while this one has to stand up as a picture on its own, so it
     * gets the far wall, the lamp, and a moon low enough to fly over. Nothing
     * sits where the first wave will come down.
     */
    props:[ {k:"galaxy", x:0.26, y:0.20, r:0.22},
            {k:"planet", x:0.74, y:0.72, r:0.150, lit:"#6b6787", dark:"#191627", crescent:true},
            {k:"planet", x:0.18, y:0.80, r:0.042, lit:"#a09bbd", dark:"#14121e", craters:true},
            {k:"sun",    x:0.86, y:0.15, r:0.026, color:"#e8cf86"} ] },


  { name:"Violet Drift", clouds:["#7c3aed","#a855f7","#4c1d95"], dust:"#0a0518", star:"#f3e8ff",
    lum:1.15, density:1.0, stars:1.0, bright:3,
    props:[ {k:"planet", x:0.20, y:0.30, r:0.177, lit:"#8b6bd8", dark:"#241245", rings:true},
            {k:"planet", x:0.82, y:0.70, r:0.047, lit:"#c9b6f0", dark:"#3a2a5c", craters:true},
            {k:"galaxy", x:0.78, y:0.16, r:0.22} ] },

  /*
   * HOME, which is now stop three rather than stop one.
   *
   * The family's own world, close and low, so the flight reads as a patrol
   * just above home rather than a drift through empty space. It carries the
   * biggest planet in the campaign (The Deep's was 0.322) with a weather-banded
   * surface, an aurora over the pole, and dawn coming up behind it - the only
   * warm-over-cool sky in the table. Everything after this gets stranger,
   * emptier and colder, which is the whole arc; you have to have seen home for
   * that to mean anything.
   *
   * It reads even better here than it did at the front, because now you have
   * flown twice to get to it: the opening sky is a room with no windows, and
   * this is the first time the game shows you what is outside.
   */
  { name:"Home Reach",   clouds:["#2563eb","#7dd3fc","#061027"], dust:"#02050e", star:"#eaf4ff",
    lum:1.0, density:0.9, stars:1.2, bright:4,
    /*
     * The planet sits where its whole disc fits on one screen. Every element
     * in a sky is drawn three times so the backdrop can scroll forever
     * (see build), and a world this size parked at the bottom edge put a
     * second copy of itself across the TOP of the frame - two home planets at
     * once, which reads as a mistake rather than as scrolling.
     */
    props:[ {k:"planet", x:0.50, y:0.78, r:0.34, lit:"#8cc7f2", dark:"#04101f", bands:true},
            // Tucked down onto the world's shoulder rather than hung in open
            // sky: at full size the curtains read as grey bars floating in the
            // middle of the frame, and what sells them is being ATTACHED to
            // something with an atmosphere.
            {k:"aurora", x:0.50, y:0.56, r:0.15},
            {k:"planet", x:0.78, y:0.22, r:0.050, lit:"#dbeafe", dark:"#1b2740", craters:true},
            {k:"sun",    x:0.17, y:0.15, r:0.030, color:"#ffe9a8"} ] },

  { name:"Emerald Veil", clouds:["#059669","#14b8a6","#065f46"], dust:"#02100c", star:"#d1fae5",
    lum:1.2, density:0.95, stars:0.9, bright:3,
    props:[ {k:"planet", x:0.80, y:0.24, r:0.146, lit:"#3fbf95", dark:"#0a3b2c", bands:true},
            {k:"rocks",  x:0.22, y:0.62, r:0.156, n:16},
            {k:"planet", x:0.14, y:0.14, r:0.036, lit:"#9ad9c4", dark:"#1d3a32", craters:true} ] },

  /*
   * FOUR ORANGES, AND THEY WERE ALL THE SAME ORANGE.
   *
   * Rust Belt, The Treasury, Their Star and The Foundry sat inside a hue of
   * each other, so a quarter of the campaign opened on the same picture. They
   * are separated now by what each PLACE is rather than by nudging hues apart:
   * rust is brown and dusty, a treasury is gold and not orange at all, a star
   * is red and white-hot, and a foundry is black iron with the fire showing
   * through the cracks. Different colour, different value, different density.
   *
   * This one is the archetype and stays closest to where it was - dull, dusty,
   * brown-orange, the colour of something that has been left outside.
   */
  { name:"Rust Belt",    clouds:["#b45309","#d9a63f","#241003"], dust:"#160a02", star:"#ffe9cc",
    lum:0.95, density:1.3, stars:0.8, bright:3,
    props:[ {k:"planet", x:0.74, y:0.62, r:0.239, lit:"#d2703a", dark:"#2f1105", bands:true, crescent:true},
            {k:"rocks",  x:0.25, y:0.30, r:0.177, n:22},
            {k:"sun",    x:0.10, y:0.82, r:0.026, color:"#ffd9a0"} ] },

  /*
   * ICE FIELDS.
   *
   * The last photograph in the campaign, and once Home Reach was repainted it
   * became the new odd-one-out: thirty-four painted skies and one JPG sitting
   * in the middle of them. It was also a purple-pink astrophotograph, which is
   * not what "Ice Fields" is called, and the busiest ground in the game to
   * pick a pink bullet out of.
   *
   * It is a PLACE now rather than a haze. Nearly empty and nearly colourless -
   * the lowest density in the table - so that the one thing in it is the belt
   * of ice across the middle, lit hard by a small white sun up in the corner.
   * Every other sky in the campaign is bright cloud with dark scenery in front
   * of it; this is the only one that inverts that, and it is what makes the
   * mission memorable without needing a photograph to do the work.
   *
   * Value, not hue, keeps it clear of its cyan cousins: Squall Line is dense
   * and stormy, Warden's Watch is saturated teal, The Relief Line is pale over
   * near-white. This one is a dark, thin, cold void with brilliant chips in it.
   */
  { name:"Ice Fields",   clouds:["#155e75","#a5f3fc","#04121b"], dust:"#010810", star:"#ecfeff",
    lum:0.72, density:0.45, stars:1.5, bright:5,
    props:[ {k:"sun",   x:0.80, y:0.13, r:0.021, color:"#ffffff"},
            // The belt. Wide enough to cross the whole frame, offset from
            // centre so it is a drift the ship flies THROUGH rather than a
            // stripe painted across the middle of the picture.
            {k:"rocks", x:0.46, y:0.50, r:0.40, n:38, ice:true},
            {k:"rocks", x:0.14, y:0.15, r:0.15, n:11, ice:true},
            {k:"rocks", x:0.88, y:0.82, r:0.13, n:9,  ice:true},
            {k:"planet", x:0.26, y:0.86, r:0.10, lit:"#8fc4dd", dark:"#040d16", craters:true} ] },

  { name:"Squall Line",  clouds:["#0891b2","#67e8f9","#164e63"], dust:"#03090c", star:"#cffafe",
    lum:0.9, density:1.5, stars:0.7, bright:2,
    props:[ {k:"planet", x:0.16, y:0.22, r:0.09, lit:"#5eead4", dark:"#134e4a", bands:true},
            {k:"rocks",  x:0.78, y:0.66, r:0.14, n:10} ] },

  { name:"Crimson Run",  clouds:["#be123c","#f43f5e","#881337"], dust:"#12030a", star:"#ffe4e6",
    lum:1.05, density:1.05, stars:0.85, bright:2,
    props:[ {k:"sun",    x:0.78, y:0.22, r:0.083, color:"#ff8a6b"},
            {k:"planet", x:0.24, y:0.66, r:0.156, lit:"#8d3550", dark:"#210711", craters:true},
            {k:"planet", x:0.60, y:0.88, r:0.052, lit:"#c96b80", dark:"#2b0d18"} ] },

  { name:"Gold Reach",   clouds:["#b45309","#fbbf24","#78350f"], dust:"#120b02", star:"#fef3c7",
    lum:1.3, density:1.1, stars:0.9, bright:3,
    props:[ {k:"planet", x:0.26, y:0.26, r:0.198, lit:"#e0a13e", dark:"#3a1f04", bands:true, rings:true},
            {k:"planet", x:0.80, y:0.74, r:0.068, lit:"#f2d79a", dark:"#4a3410", craters:true},
            {k:"rocks",  x:0.72, y:0.34, r:0.114, n:12} ] },

  /* Magenta, which nothing else in the table owns - and it has to, because it
     follows Gold Reach. Measured against every other backdrop, the old amber
     Trade Lane was the second-closest NEIGHBOURING pair in the campaign: mean
     colour 8.9 apart from the sky immediately before it, so two missions in a
     row opened on the same picture. Gold, then magenta, then the ice-blue
     Relief Line is three beats a child can tell apart from the doorway. */
  { name:"The Trade Lane", clouds:["#be185d","#f9a8d4","#4a1d3f"], dust:"#0d0410", star:"#fce7f3",
    lum:1.15, density:0.9, stars:1.0, bright:3,
    props:[ {k:"planet", x:0.82, y:0.30, r:0.13, lit:"#e0709f", dark:"#40122c", rings:true},
            {k:"planet", x:0.14, y:0.72, r:0.05, lit:"#f7cede", dark:"#5c2340", craters:true},
            {k:"galaxy", x:0.24, y:0.14, r:0.18} ] },

  /* Cold, clean and medical - the only pale ice-blue-over-near-white in the
     table, dropped between the gold Trade Lane and the purple Deep so the
     contrast lands. First sky to fly the aurora painter. */
  { name:"The Relief Line", clouds:["#7dd3fc","#e0f2fe","#1e3a5f"], dust:"#040a12", star:"#f0f9ff",
    lum:1.25, density:0.7, stars:1.15, bright:4,
    props:[ {k:"aurora", x:0.50, y:0.28, r:0.34},
            {k:"planet", x:0.16, y:0.70, r:0.13, lit:"#bcd9f2", dark:"#0d1a2e", craters:true},
            {k:"sun",    x:0.86, y:0.16, r:0.024, color:"#eaf6ff"} ] },

  { name:"The Deep",     clouds:["#6d28d9","#db2777","#1e1b4b"], dust:"#05030f", star:"#ede9fe",
    lum:0.8, density:1.3, stars:1.0, bright:4,
    props:[ {k:"planet", x:0.66, y:0.52, r:0.322, lit:"#4b3a7a", dark:"#07040f", crescent:true},
            {k:"galaxy", x:0.18, y:0.20, r:0.26},
            {k:"planet", x:0.14, y:0.80, r:0.047, lit:"#a78bfa", dark:"#1b1436"} ] },

  /* --- Act 2. Colder and emptier heading out, hotter as you close on their
     home star, so the run has a direction you can see. --- */

  { name:"The Blockade", clouds:["#0b1d3a","#173a6b","#050c1c"], dust:"#020409", star:"#9fc0e8",
    lum:0.62, density:0.65, stars:0.55, bright:1,
    props:[ {k:"planet", x:0.78, y:0.80, r:0.20, lit:"#20406e", dark:"#040914", crescent:true},
            {k:"rocks",  x:0.22, y:0.24, r:0.15, n:12} ] },

  /*
   * SPOTLIGHT's sky, and it is dark on purpose: the level is about not being
   * seen, so the dark has to be somewhere you can actually be. Grey-green
   * rather than navy, because The Blockade is the navy void two stops back and
   * these are close enough together to be told apart by hue as well as value.
   *
   * Two watchposts, cold and barely lit. They are not the searchlight - that
   * swings from off the top of the screen - they are the reason there is one.
   */
  { name:"The Sentry Line", clouds:["#1f3a34","#4b7f70","#040c0a"], dust:"#020705", star:"#d7efe4",
    lum:0.6, density:0.7, stars:0.5, bright:1,
    props:[ {k:"station", x:0.22, y:0.30, r:0.10, n:1,
             lit:"#bfe8da", dark:"#04100c", beacon:"#ff8a6b"},
            {k:"station", x:0.80, y:0.72, r:0.075, n:1,
             lit:"#bfe8da", dark:"#04100c", beacon:"#ff8a6b"},
            {k:"rocks",   x:0.52, y:0.50, r:0.20, n:16} ] },


  /* Separated from The Blockade by VALUE rather than hue, because they are
     neighbours and were the closest pair in the campaign: both dark, both
     desaturated, 25 apart in mean colour. The Blockade is a navy void you
     sneak across with no guns; this is the glare off a million pieces of
     broken metal, bright enough that the debris you are meant to hide behind
     can actually be seen. Same grey family, opposite end of the scale. */
  { name:"The Wreck Line", clouds:["#94a3b8","#e2e8f0","#334155"], dust:"#0a0d14", star:"#f8fafc",
    lum:1.2, density:0.8, stars:1.1, bright:3,
    props:[ {k:"rocks",  x:0.50, y:0.42, r:0.30, n:34},
            {k:"planet", x:0.16, y:0.76, r:0.104, lit:"#6b7c94", dark:"#0d131f", craters:true},
            {k:"rocks",  x:0.80, y:0.14, r:0.14, n:14} ] },

  /* Jade and brass, which the table does not own. The composition teaches the
     level before the ship ever touches an edge: the SAME planet placed twice,
     hard against both edges at the same height, so the backdrop is left-right
     continuous and the eye reads "this place joins up". */
  { name:"The Ring",     clouds:["#0f766e","#f59e0b","#04211f"], dust:"#020c0b", star:"#ccfbf1",
    lum:1, density:1.1, stars:0.8, bright:3,
    props:[ {k:"planet", x:0.02, y:0.44, r:0.17, lit:"#3fbf95", dark:"#07302a", bands:true},
            {k:"planet", x:0.98, y:0.44, r:0.17, lit:"#3fbf95", dark:"#07302a", bands:true},
            // The composition already said "this place joins up"; this is what
            // joins it. Set below the twin worlds so it passes in FRONT of the
            // lower half of both, which is the only cue that says you are
            // inside it rather than looking at a picture of it.
            {k:"ring",   x:0.50, y:0.60, r:0.95, thick:0.055, tilt:0.12, n:44,
             lit:"#9beacd", glow:"#ffe0a0"},
            {k:"galaxy", x:0.50, y:0.16, r:0.20} ] },

  { name:"Duelling Ground", clouds:["#9d174d","#f472b6","#4a044e"], dust:"#12030c", star:"#fce7f3",
    lum:1.1, density:0.85, stars:1.1, bright:3,
    /*
     * Two dead hulls, small and far apart, tilted against each other. This is
     * where the Rival meets you, and a duelling ground with nothing on it is
     * just a field: the ones who lost are the reason the place has a name.
     * Deliberately at a third the Breaker's Yard scale, so the same painter
     * reads as wreckage adrift here and as a shipbreaker's prize there.
     */
    props:[ {k:"wreck",  x:0.24, y:0.30, r:0.42, thick:0.30, tilt:-0.42},
            {k:"planet", x:0.82, y:0.20, r:0.10, lit:"#e879b0", dark:"#4a0d33", crescent:true},
            {k:"wreck",  x:0.74, y:0.72, r:0.34, thick:0.26, tilt:0.55},
            {k:"planet", x:0.14, y:0.80, r:0.042, lit:"#f9c9e4", dark:"#54173c", craters:true} ] },

  { name:"Hatchery",     clouds:["#4d7c0f","#84cc16","#1a2e05"], dust:"#050b02", star:"#ecfccb",
    lum:0.95, density:1.2, stars:0.75, bright:2,
    props:[ {k:"planet", x:0.80, y:0.30, r:0.185, lit:"#7fa83c", dark:"#16250a", bands:true},
            // The clutch, big and low and slightly off centre so the ship
            // flies through it rather than past it. This level is about things
            // that make more things; now the sky says so before wave one.
            {k:"eggs",   x:0.36, y:0.62, r:0.26, n:17, lit:"#c6f75a", dark:"#122605"},
            {k:"eggs",   x:0.80, y:0.86, r:0.11, n:7,  lit:"#a8e04a", dark:"#0f2004"},
            {k:"planet", x:0.14, y:0.16, r:0.055, lit:"#b6dd6e", dark:"#2b3d13", craters:true} ] },

  { name:"Warden's Watch", clouds:["#0e7490","#22d3ee","#083344"], dust:"#020a0e", star:"#cffafe",
    lum:0.85, density:1.0, stars:0.9, bright:3,
    props:[ {k:"planet", x:0.22, y:0.26, r:0.215, lit:"#2f8ba3", dark:"#04202b", rings:true},
            // The watch itself: one lit hull with a mast and a beacon, hung in
            // clear sky on the far side from his world. A silhouette is
            // scenery; a silhouette with windows in it is somebody's post.
            {k:"station",x:0.74, y:0.62, r:0.165, n:1,
             lit:"#cffafe", dark:"#04141c", beacon:"#ff8a6b"},
            {k:"rocks",  x:0.68, y:0.24, r:0.13, n:12},
            {k:"sun",    x:0.14, y:0.84, r:0.031, color:"#a5f3fc"} ] },

  /* Gold, not orange. It is the coin level, and its sky should be the colour
     of the thing you are there to take. */
  { name:"The Treasury", clouds:["#d97706","#fbd24a","#573a0c"], dust:"#140c02", star:"#fffbe0",
    lum:1.3, density:1.0, stars:0.9, bright:4,
    props:[ {k:"planet", x:0.76, y:0.30, r:0.21, lit:"#d9a441", dark:"#33200a", rings:true},
            {k:"rocks",  x:0.24, y:0.60, r:0.17, n:18},
            {k:"sun",    x:0.14, y:0.16, r:0.03, color:"#ffe9a8"} ] },

  /* A yard where they cut up captured hulls, and the barnacles that strip
     them. The only deep-indigo-over-near-white in the table, and deliberately
     NOT green: limpet lime has to pop off it. First sky to fly the wreck. */
  { name:"The Breaker's Yard", clouds:["#1e1b4b","#e0e7ff","#050414"], dust:"#02020c", star:"#c7d2fe",
    lum:0.8, density:0.85, stars:0.7, bright:2,
    props:[ {k:"wreck",  x:0.44, y:0.52, r:1.15, thick:0.26, tilt:0.08},
            {k:"rocks",  x:0.78, y:0.24, r:0.18, n:22},
            {k:"sun",    x:0.12, y:0.84, r:0.03, color:"#dbeafe"} ] },

  { name:"Cold Approach", clouds:["#1e3a8a","#3b82f6","#0c1836"], dust:"#020510", star:"#dbeafe",
    lum:0.7, density:0.75, stars:1.15, bright:4,
    props:[ {k:"planet", x:0.72, y:0.66, r:0.26, lit:"#3f6fc4", dark:"#050d21", crescent:true},
            {k:"planet", x:0.22, y:0.20, r:0.057, lit:"#93b8f5", dark:"#152540", craters:true} ] },

  /*
   * THE NARROWS, and the only backdrop in the game that is GROUND.
   *
   * `surface:true` is read by the renderer, not by the painter: it switches off
   * the star layer, the comets and the streaming dust. Stars over a canyon
   * floor is the one detail that would put the whole level back in space, and
   * no amount of good rock survives it.
   *
   * Rust and bone, lit from the same corner as every other sky so the canyon
   * walls drawn over it agree about where the sun is.
   */
  { name:"Red Canyon", surface:true,
    clouds:["#7c2d12","#c2703a","#1a0a04"], dust:"#160802", star:"#ffe0c0",
    lum:1.0, density:0.9, stars:0, bright:0,
    /* Darker than the first cut by a full stop: the floor is the QUIET under
       a fight, and the old mid-brown fought every bullet on it. */
    props:[ {k:"ground", x:0.50, y:0.50, n:40, lit:"#a97a48", dark:"#20100a"} ] },


  { name:"The Fortress Wall", clouds:["#7f1d1d","#57534e","#1c1917"], dust:"#0a0505", star:"#e7e5e4",
    lum:0.9, density:1.3, stars:0.5, bright:1,
    props:[ {k:"rocks", x:0.12, y:0.30, r:0.17, n:18},
            {k:"rocks", x:0.88, y:0.62, r:0.17, n:18} ] },

  { name:"Last Harbour", clouds:["#7e22ce","#e879f9","#2e1065"], dust:"#0a0316", star:"#fae8ff",
    lum:1, density:1.15, stars:0.95, bright:3,
    props:[ {k:"galaxy", x:0.28, y:0.22, r:0.24},
            {k:"planet", x:0.80, y:0.66, r:0.165, lit:"#a855c9", dark:"#2a0a3c", bands:true, rings:true},
            // A harbour: the same painter as the Warden's watchtower, told to
            // draw five instead of one. It is the last place in the campaign
            // where anybody is pleased to see you, and every lit window in it
            // is doing that job.
            {k:"station",x:0.32, y:0.56, r:0.115, n:5,
             lit:"#ffe9a8", dark:"#150726", beacon:"#f0abfc"},
            {k:"planet", x:0.12, y:0.88, r:0.042, lit:"#f0abfc", dark:"#3b1049"} ] },

  /* The only WHITE sky in the campaign, and the photographic negative of The
     Long Dark three stops later. stars 0.12 because you cannot see stars from
     inside a star's glare, and bright 0 - the first sky with no spiked suns
     at all. The pillars are rooted at the very bottom edge and rim-lit, so
     they read as prominences arching off the surface. */
  /*
   * It never blazed. It was written as "the only WHITE sky in the campaign" and
   * it rendered BEIGE - a tan haze with orange columns standing in it at almost
   * no contrast, which read less like a star and more like a dust storm.
   *
   * Two things were wrong, and they were fighting each other. The dark third
   * colour and the dark dust lanes are what give every other sky its depth, and
   * on a white ground they are simply mud - so here the lanes are WARM AND
   * LIGHT, and the depth comes from the star's own limb instead. And the
   * prominences were filled with orange at nearly full alpha, so the brightest
   * thing on screen had lumpy tangerine columns standing in front of it. They
   * are dark now, which is both what a filament actually looks like against the
   * disc and the only way anything reads against a white sky at all.
   *
   * The star fills the bottom edge and floods upward. stars 0.06 because you
   * cannot see stars from inside a star's glare, and bright 0 - still the one
   * sky in the game with no spiked suns hanging in it.
   */
  { name:"The Bright Side", clouds:["#ffd98a","#fff2d0","#ffa63c"], dust:"#f0c076", star:"#fffdf6",
    lum:1.45, density:0.5, stars:0.06, bright:0,
    /*
     * The star sits WHOLLY inside the frame, low. Every element of a sky is
     * drawn three times so the backdrop can scroll forever, and the first cut
     * put a 0.70-wide star on the bottom edge - which hung a second copy of it
     * across the top and turned the composition into a fog bank with no
     * direction in it. Small enough to fit is what makes the light come from
     * somewhere.
     */
    props:[ {k:"sun",     x:0.50, y:0.80, r:0.30, color:"#ffffff"},
            {k:"pillars", x:0.33, y:1.00, h:0.62, n:3, w:0.46,
             hi:"#ffe3ae", lo:"#5c2205", knots:false},
            {k:"pillars", x:0.80, y:1.00, h:0.48, n:2, w:0.28,
             hi:"#ffe3ae", lo:"#6d2b07", knots:false},
            {k:"planet",  x:0.15, y:0.26, r:0.058, lit:"#8a4318", dark:"#200800", craters:true} ] },

  /* Red and white-hot, because you are over their sun. The hottest sky in the
     campaign, and the only one that is properly RED rather than orange. */
  { name:"Their Star",   clouds:["#991b1b","#ff4d3a","#230303"], dust:"#0d0101", star:"#ffdcd2",
    lum:1.45, density:1.45, stars:0.55, bright:4,
    props:[ {k:"sun",    x:0.70, y:0.26, r:0.125, color:"#ffb46b"},
            {k:"planet", x:0.26, y:0.68, r:0.244, lit:"#b8501f", dark:"#280702", bands:true, crescent:true},
            {k:"rocks",  x:0.68, y:0.82, r:0.14, n:16} ] },

  /* --- Act 3. Their star is out. The first of these two skies is the
     approach: near-black, almost starless, and the Devourer itself sitting
     in it. The second is the fight - the dead star's last embers. --- */
  { name:"Lights Out",   clouds:["#111827","#1e2a4a","#05070f"], dust:"#010207", star:"#7d8bb0",
    lum:0.6, density:0.7, stars:0.45, bright:1,
    props:[ {k:"planet", x:0.80, y:0.20, r:0.10, lit:"#26324e", dark:"#0a0e1c", crescent:true},
            {k:"rocks",  x:0.18, y:0.68, r:0.12, n:8} ] },

  /*
   * NIGHTFALL's sky. It has to start LIT - the level's whole idea is losing
   * the light, and you cannot lose what you never had, so this is the warmest
   * dusk in the campaign and the veil takes it down from there.
   *
   * Amber over indigo, with the sun already on the floor of the frame: a sky
   * that is visibly most of the way through its own evening before the first
   * wave arrives.
   */
  { name:"Last Light", clouds:["#b45309","#fbbf24","#1e1b4b"], dust:"#0a0714", star:"#ffedd5",
    lum:1.2, density:1.0, stars:0.7, bright:2,
    props:[ {k:"sun",    x:0.72, y:0.86, r:0.16, color:"#ffb46b"},
            {k:"planet", x:0.24, y:0.34, r:0.16, lit:"#6b5a8a", dark:"#0d0a1c", crescent:true},
            {k:"planet", x:0.86, y:0.20, r:0.048, lit:"#e8d3a8", dark:"#2a1f14", craters:true} ] },


  { name:"The Long Dark", clouds:["#0a0a16","#141430","#03030a"], dust:"#010104", star:"#9aa8c8",
    lum:0.55, density:0.4, stars:0.45, bright:1,
    props:[ {k:"devourer", x:0.52, y:0.30, r:0.30},
            {k:"planet", x:0.16, y:0.86, r:0.10, lit:"#1b2136", dark:"#02030a", crescent:true} ] },

  { name:"The Last Star", clouds:["#7f1d1d","#dc2626","#1c0505"], dust:"#0d0202", star:"#ffd9d9",
    lum:0.7, density:1.4, stars:0.6, bright:4,
    props:[ {k:"sun",    x:0.50, y:0.30, r:0.20, color:"#ff6b4a"},
            {k:"rocks",  x:0.22, y:0.70, r:0.20, n:24},
            {k:"rocks",  x:0.80, y:0.62, r:0.16, n:18} ] },

  /*
   * THE SKY RIVER's sky. Indigo and cornflower, which nothing else in act four
   * owns - The Undertow next door is teal and The Devourer before it is red,
   * so the three stops in a row are three colours.
   *
   * It flies the aurora, and that is the whole reason it exists: curtains are
   * the only thing in the vocabulary that read as FLOW, and this is the level
   * where the sky is visibly going somewhere - draining toward the crack.
   */
  { name:"The Sky River", clouds:["#312e81","#818cf8","#080620"], dust:"#040318", star:"#e0e7ff",
    lum:1.05, density:0.95, stars:1.0, bright:3,
    props:[ {k:"aurora", x:0.50, y:0.44, r:0.30, w:1.0, n:6,
             hi:"#a5b4fc", lo:"#4338ca"},
            {k:"planet", x:0.80, y:0.78, r:0.14, lit:"#6f7bd8", dark:"#151132", bands:true},
            {k:"planet", x:0.16, y:0.18, r:0.045, lit:"#c7d2fe", dark:"#2a2550", craters:true} ] },


  /* --- Act 4. Through the crack the Devourer left. Not "more space":
     somewhere space doesn't quite work - and, at the end, the place where
     space gets MADE. --- */

  { name:"The Undertow",  clouds:["#155e75","#2dd4bf","#0b1c3c"], dust:"#020810", star:"#ccfbf1",
    lum:0.85, density:0.95, stars:0.85, bright:2,
    props:[ {k:"planet", x:0.80, y:0.24, r:0.15, lit:"#2a9db0", dark:"#062030", crescent:true},
            // The level's rule, made visible: a hole with everything behind it
            // wound into it. Low and left of centre, so the pull has a
            // direction and the ship is never sitting in the middle of it.
            {k:"vortex", x:0.36, y:0.66, r:0.15, lit:"#8fe6dc"},
            {k:"planet", x:0.16, y:0.16, r:0.045, lit:"#7fd8d0", dark:"#0e3a3a", craters:true} ] },

  /* The only brown-and-bone sky on the route, and the only one with no
     coloured emission in it at all - so the herd's country reads as somewhere
     organic and old the instant it loads, between the teal Undertow and the
     magenta Chorus. */
  { name:"Bonefields",   clouds:["#78350f","#e7d8c9","#0c0a09"], dust:"#080604", star:"#fef3c7",
    lum:1, density:0.7, stars:1.0, bright:2,
    props:[ {k:"planet", x:0.22, y:0.36, r:0.28, lit:"#8c7a68", dark:"#0b0907", craters:true},
            {k:"rocks",  x:0.76, y:0.66, r:0.22, n:26},
            {k:"planet", x:0.86, y:0.16, r:0.04, lit:"#d6c3ad", dark:"#2a2018"} ] },

  { name:"The Chorus",    clouds:["#c026d3","#f59e0b","#4a0450"], dust:"#0e0312", star:"#fdf4ff",
    lum:1.15, density:1.05, stars:0.9, bright:4,
    /*
     * Pipes. The same painter The Bright Side flies as solar prominences, on a
     * magenta sky at a bigger spread and a colder rim - and it reads as an
     * organ, which is exactly what a level built on a beat wants behind it.
     * The oldest trick in this file: a new place out of a word it already had.
     */
    props:[ {k:"galaxy",  x:0.74, y:0.18, r:0.24},
            {k:"pillars", x:0.44, y:1.00, h:0.46, n:5, w:0.86,
             hi:"#fbe6ff", lo:"#2a0630"},
            {k:"planet",  x:0.16, y:0.70, r:0.10, lit:"#d879e8", dark:"#3a0d44", rings:true},
            {k:"sun",     x:0.86, y:0.60, r:0.028, color:"#ffd9f4"} ] },

  /* Perfectly left-right symmetric, which matters technically as well as
     aesthetically: tiled() wraps on Y ONLY, so a vertical axis of symmetry
     survives the scroll where a horizon mirror would break on the first wrap.
     Every prop paired at x and 1-x. Free bonus - drawPlanet lights each
     sphere from the NEARER nebula core, so the twins come out lit from
     opposite sides, exactly as a reflection should be. */
  { name:"The Glass Sea", clouds:["#0e7490","#e2e8f0","#1e1b4b"], dust:"#04060f", star:"#f0f9ff",
    lum:1.05, density:0.8, stars:1.1, bright:4,
    props:[ {k:"comet",  x:0.16, y:0.30, r:0.018, len:0.66, angle:-0.5, color:"#e0f2fe"},
            {k:"comet",  x:0.84, y:0.30, r:0.018, len:0.66, angle:Math.PI+0.5, color:"#e0f2fe"},
            {k:"planet", x:0.22, y:0.70, r:0.16, lit:"#a9c8de", dark:"#0b1220", rings:true},
            {k:"planet", x:0.78, y:0.70, r:0.16, lit:"#a9c8de", dark:"#0b1220", rings:true},
            {k:"galaxy", x:0.30, y:0.14, r:0.20},
            {k:"galaxy", x:0.70, y:0.14, r:0.20} ] },

  /* Black iron with the fire showing through it. The inversion of the other
     three: a dark, heavy ground where the orange only appears in the seams,
     which is also the only one of the four you could pick out in a thumbnail. */
  { name:"The Foundry",   clouds:["#2f1408","#ff7a18","#080301"], dust:"#050201", star:"#ffcf9e",
    lum:0.70, density:1.4, stars:0.4, bright:2,
    props:[ {k:"planet", x:0.80, y:0.66, r:0.21, lit:"#c96a2a", dark:"#2a1004", bands:true},
            {k:"rocks",  x:0.24, y:0.28, r:0.19, n:20},
            {k:"sun",    x:0.68, y:0.16, r:0.04, color:"#ffb46b"} ] },

  { name:"The Serpent's Garden", clouds:["#047857","#22d3ee","#032f2b"], dust:"#02100b", star:"#d1fae5",
    lum:0.9, density:1.0, stars:0.95, bright:3,
    props:[ {k:"planet", x:0.24, y:0.30, r:0.15, lit:"#2fbf9a", dark:"#083328", rings:true},
            {k:"galaxy", x:0.78, y:0.70, r:0.22},
            {k:"planet", x:0.86, y:0.18, r:0.05, lit:"#9fe8cf", dark:"#1d4038", craters:true} ] },

  /* The workshop's own twilight: graphite, one warm lamp, almost no stars.
     The finale overpaints it live (blueprint flashes, act-palette repaints),
     so the base sky stays deliberately quiet - it is the canvas, not the
     painting. */
  { name:"Behind the Sky", clouds:["#3d3a55","#c9b458","#15131f"], dust:"#0a0a12", star:"#e2e8f0",
    lum:1.2, density:0.5, stars:0.55, bright:1,
    props:[ {k:"galaxy", x:0.30, y:0.24, r:0.20},
            {k:"planet", x:0.80, y:0.76, r:0.09, lit:"#6b6787", dark:"#191627", crescent:true} ] },

  /* Sky 29 - the gift. Papa's unfinished canvas, finally painted: a dawn with
     every act's colour in it - Act 1's violet, Act 3's gold, Act 4's teal -
     and the busiest, brightest sky in the game, because it took every star to
     earn. The mission starts it under a pencil veil (see sky29.js); THIS is
     what the flying reveals. */
  { name:"Sky 40", clouds:["#ff7a59","#ffd23f","#8b5cf6"], dust:"#160a14", star:"#fff3e0",
    lum:1.35, density:1.3, stars:1.25, bright:5,
    props:[ {k:"planet", x:0.74, y:0.68, r:0.24, lit:"#e8b45a", dark:"#3a2008", bands:true, rings:true},
            {k:"galaxy", x:0.20, y:0.18, r:0.26},
            {k:"planet", x:0.16, y:0.62, r:0.06, lit:"#ffb6a3", dark:"#4a1d2e", craters:true},
            {k:"sun",    x:0.86, y:0.14, r:0.03, color:"#ffe9a8"} ] },
];

/* Deterministic RNG, so a mission's sky is elaborate but always the same sky. */
function rngFor(seed){
  let s = seed*9301 + 49297;
  return function(){
    s = (s*9301 + 49297) % 233280;
    return s/233280;
  };
}

function hexToRgb(hex){
  const v = parseInt(hex.replace("#",""), 16);
  return [(v>>16)&255, (v>>8)&255, v&255];
}
function rgba(hex, a){
  const c = hexToRgb(hex);
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}
/** Blend two hexes, t=0 gives a, t=1 gives b. Used for gradient mid-stops so a
 *  planet ramps through its own material instead of jumping lit->dark. */
function mixHex(a, b, t){
  const x = hexToRgb(a), y = hexToRgb(b);
  return "rgb(" + Math.round(x[0] + (y[0]-x[0])*t) + "," +
                  Math.round(x[1] + (y[1]-x[1])*t) + "," +
                  Math.round(x[2] + (y[2]-x[2])*t) + ")";
}
/** The same blend, with an alpha. `rgba()` only parses hex, and `mixHex`
 *  hands back an rgb() string, so the two do not compose - the rock painter
 *  needs a blended colour and a transparency in the same stop. */
function mixA(a, b, t, alpha){
  const x = hexToRgb(a), y = hexToRgb(b);
  return "rgba(" + Math.round(x[0] + (y[0]-x[0])*t) + "," +
                   Math.round(x[1] + (y[1]-x[1])*t) + "," +
                   Math.round(x[2] + (y[2]-x[2])*t) + "," + alpha + ")";
}
/** ...and again as a hex, for the places that pass a colour on to something
 *  which will blend it further. */
function mixHexHex(a, b, t){
  const x = hexToRgb(a), y = hexToRgb(b);
  const h = v => ("0" + Math.round(v).toString(16)).slice(-2);
  return "#" + h(x[0] + (y[0]-x[0])*t) + h(x[1] + (y[1]-x[1])*t) + h(x[2] + (y[2]-x[2])*t);
}

/**
 * Draws `fn` three times - at y, y-H and y+H - so anything crossing an edge
 * appears on the other one. This is the whole trick behind the seamless wrap.
 *
 * The menu sky is the one customer that must NOT wrap: it is a still frame,
 * never scrolled, so a prop hanging off the bottom would have its twin come
 * back in at the top as a second planet in the same picture. `wrapTiles` is
 * set for the duration of one synchronous paint() and read only here.
 */
let wrapTiles = true;
function tiled(ctx, H, y, fn){
  fn(y);
  if(!wrapTiles) return;
  if(y > H*0.6) fn(y - H);
  if(y < H*0.4) fn(y + H);
}

/* ---------------------------------------------------------
   BACKGROUND FURNITURE
   Planets, suns, galaxies and rock fields. Without something
   with an edge in it, every generated sky reads as the same
   coloured haze - the difference between "a nebula" and
   "somewhere".
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   PLANETS, PER PIXEL
   ---------------------------------------------------------
 * The old painter (kept below as drawPlanetInk, the fallback) built a planet
 * out of canvas gradients: a radial base, 26 soft blobs, wobbling band
 * rectangles. Measured, the result had 2-3% local contrast - an airbrushed
 * ball - and its brightest point sat at the CENTRE of the disc, decaying
 * symmetrically, which is how a snooker ball photographs under a camera
 * flash. A world lit by a distant star keeps its bright point pushed toward
 * the light, a crisp terminator, and texture that forshortens into the limb.
 * None of that is reachable with stacked gradients, so this renderer computes
 * every pixel instead:
 *
 *  - the NORMAL of the sphere at each pixel, so brightness comes from the
 *    actual surface direction (a real terminator, limb darkening, and the
 *    highlight where it belongs);
 *  - 3D value noise sampled AT THE POINT ON THE BALL, so terrain and weather
 *    compress toward the limb exactly the way a globe's features do - the
 *    single strongest cue that you are looking at a sphere and not a circle;
 *  - bands as a function of LATITUDE, so they bend into the limb for free
 *    instead of being clipped rectangles;
 *  - crescents as ordinary lighting with the sun mostly behind the body -
 *    the same code path, no special-case cut, so the sliver curves correctly
 *    and the night side keeps a faint body instead of reading as a hole;
 *  - craters as 3D stamps (lit rim toward the sun, shadowed rim away), which
 *    also foreshorten at the limb for free;
 *  - rings that cast a shadow band on the disc, and a disc that casts its
 *    shadow bite on the rings.
 *
 * COST. This runs once per mission, at bake time, into a sprite - the sky is
 * already baked once for the same reason. The sprite is capped at ~520 device
 * pixels and blitted into the wrap copies, which also fixes a real bug the
 * old painter had: its mottles drew fresh random numbers inside `tiled`, so
 * the wrap copies of a planet were not even the same planet.
 *
 * Everything random comes from ONE draw off the mission's seeded stream,
 * expanded locally - the same sky builds the same planet forever.
 */
const m32 = a => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* Integer lattice hash -> [0,1). The whole texture stands on this. */
function latticeH(ix, iy, iz, seed){
  let n = (ix*374761393 + iy*668265263 + iz*1274126177 + seed*69069) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
/* Trilinear value noise on that lattice. */
function vnoise3(x, y, z, seed){
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx*fx*(3 - 2*fx); fy = fy*fy*(3 - 2*fy); fz = fz*fz*(3 - 2*fz);
  const c000 = latticeH(ix, iy, iz, seed),     c100 = latticeH(ix+1, iy, iz, seed);
  const c010 = latticeH(ix, iy+1, iz, seed),   c110 = latticeH(ix+1, iy+1, iz, seed);
  const c001 = latticeH(ix, iy, iz+1, seed),   c101 = latticeH(ix+1, iy, iz+1, seed);
  const c011 = latticeH(ix, iy+1, iz+1, seed), c111 = latticeH(ix+1, iy+1, iz+1, seed);
  const x00 = c000 + (c100-c000)*fx, x10 = c010 + (c110-c010)*fx;
  const x01 = c001 + (c101-c001)*fx, x11 = c011 + (c111-c011)*fx;
  const y0 = x00 + (x10-x00)*fy, y1 = x01 + (x11-x01)*fy;
  return y0 + (y1-y0)*fz;
}
/* Fractal sum: each octave doubles the frequency and halves the say. */
function fbm3(x, y, z, seed, oct){
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for(let o = 0; o < oct; o++){
    v += vnoise3(x*f, y*f, z*f, seed + o*101) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

/* Can this context do per-pixel work at all? Write-side ImageData is nearly
   universal, but a fallback that costs one try/catch is cheap insurance. */
let hdOK = null;
function pixelsWritable(){
  if(hdOK !== null) return hdOK;
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 2;
    const x = cv.getContext("2d");
    x.putImageData(x.createImageData(2, 2), 0, 0);
    hdOK = true;
  } catch(e){ hdOK = false; }
  return hdOK;
}

function drawPlanet(ctx, W, H, p, rand, lightDir, dpr){
  if(!pixelsWritable()) return drawPlanetInk(ctx, W, H, p, rand, lightDir);
  drawPlanetHD(ctx, W, H, p, rand, lightDir, dpr || 1);
}

function drawPlanetHD(ctx, W, H, p, rand, lightDir, dpr){
  const rL = p.r * W;                                    // logical radius
  const extL = rL * (p.rings ? 1.95 : 1.25);             // sprite half-extent
  const scale = Math.min(dpr, 384 / (2*extL)) || 1;      // device px per logical
  const S = Math.max(8, Math.ceil(extL * 2 * scale));    // sprite size, device px
  const R = rL * scale;                                  // disc radius, device px
  const c = S / 2;
  const rng = m32((rand() * 2147483646 + 1) | 0);
  const seed = (rng() * 1e9) | 0;

  /* The sun. 2D direction from the sky's own bright core, given a Z: in
     front of the body for a lit world, mostly BEHIND it for a crescent -
     which is all a crescent is. */
  let Lx = lightDir[0], Ly = lightDir[1];
  let Lz = p.crescent ? -0.62 : 0.52;
  { const il = 1 / Math.hypot(Lx, Ly, Lz); Lx *= il; Ly *= il; Lz *= il; }

  /* The spin axis, tilted a little and leaning slightly out of the screen,
     so no two planets wear their stripes at the same angle. */
  const tilt = (rng() - 0.5) * 0.9;
  let ax = Math.sin(tilt), ay = -Math.cos(tilt), az = (rng() - 0.5) * 0.55;
  { const il = 1 / Math.hypot(ax, ay, az); ax *= il; ay *= il; az *= il; }

  const hex = h => { const v = parseInt(h.slice(1), 16);
    return [(v>>16)&255, (v>>8)&255, v&255]; };
  const Dk = hex(p.dark || "#0a0f1c"), Lt = hex(p.lit || "#8899bb");
  const deep = [Dk[0]*0.55, Dk[1]*0.55, Dk[2]*0.55];
  const hi   = [Lt[0] + (255-Lt[0])*0.35, Lt[1] + (255-Lt[1])*0.35, Lt[2] + (255-Lt[2])*0.35];
  const atm  = [Lt[0] + (255-Lt[0])*0.5,  Lt[1] + (255-Lt[1])*0.5,  Lt[2] + (255-Lt[2])*0.5];

  // Texture-space offset: each planet samples its own neighbourhood of the
  // noise field, so two planets in one sky never share weather.
  const ox = rng()*61, oy = rng()*67, oz = rng()*71;

  /* Material knobs, all drawn before the loop so the loop stays hot. */
  const gas = !!p.bands;
  const bandN = 4.5 + rng()*4;              // stripe count
  const twist = 1.1 + rng()*1.4;            // how hard weather bends them
  const sea = 0.40 + rng()*0.16;            // rocky: where lowlands end
  const hasCaps = !gas && rng() < 0.4;
  const capLat = 0.62 + rng()*0.16;

  // The storm every gas giant earns - placed on the visible hemisphere.
  let stx = 0, sty = 0, stz = 0, stS = 0, st1x=0,st1y=0,st1z=0, st2x=0,st2y=0,st2z=0;
  if(gas && rng() < 0.8){
    const phi = (rng() - 0.5) * 1.0, psi = (rng() - 0.5) * 1.6;
    // Basis on the sphere: b1 along the bands, b2 completing it.
    let b1x = -ay, b1y = ax, b1z = 0;
    { const il = 1/Math.hypot(b1x,b1y,b1z); b1x*=il; b1y*=il; b1z*=il; }
    const b2x = ay*b1z - az*b1y, b2y = az*b1x - ax*b1z, b2z = ax*b1y - ay*b1x;
    const cp = Math.cos(phi), sp = Math.sin(phi), cs = Math.cos(psi), ss = Math.sin(psi);
    stx = b1x*cp*cs + b2x*cp*ss + ax*sp;
    sty = b1y*cp*cs + b2y*cp*ss + ay*sp;
    stz = b1z*cp*cs + b2z*cp*ss + az*sp;
    if(stz < 0.15){ stx -= 2*b2x*cp*ss; sty -= 2*b2y*cp*ss; stz -= 2*b2z*cp*ss; }
    stS = 0.05 + rng()*0.06;                // in 1-cos(angle) units
    // Storm-local frame: st1 along the band, st2 across it.
    st1x = ay*stz - az*sty; st1y = az*stx - ax*stz; st1z = ax*sty - ay*stx;
    { const il = 1/(Math.hypot(st1x,st1y,st1z)||1); st1x*=il; st1y*=il; st1z*=il; }
    st2x = sty*st1z - stz*st1y; st2y = stz*st1x - stx*st1z; st2z = stx*st1y - sty*st1x;
  }

  // Craters, as 3D points with sizes. Biased to the visible hemisphere.
  const CR = [];
  if(p.craters){
    const n = 7 + (rng()*4 | 0);
    for(let k = 0; k < n; k++){
      const z = 0.05 + rng()*0.92, a = rng()*TAU, s = Math.sqrt(1 - z*z);
      CR.push({ x: Math.cos(a)*s, y: Math.sin(a)*s, z,
                s: 0.015 + rng()*0.06 });
    }
  }

  // Ring geometry, needed both for the shadow band on the disc and the
  // ring draw itself.
  const ringRoll = -0.38 + (rng() - 0.5)*0.3;
  const squash = 0.17 + rng()*0.09;
  // Where the ring's shadow lies on the body: a band of latitude on the
  // sun's side of the equator.
  const shLat = -(Lx*ax + Ly*ay + Lz*az) * 0.55;

  /* ---- the disc, one pixel at a time ---- */
  const disc = document.createElement("canvas");
  disc.width = disc.height = S;
  const dx2 = disc.getContext("2d");
  const img = dx2.createImageData(S, S);
  const px = img.data;
  const sstep = (e0, e1, v) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t*t*(3 - 2*t);
  };
  for(let j = 0; j < S; j++){
    const ny = (j - c) / R;
    if(ny < -1.05 || ny > 1.05) continue;
    // Only the columns this row of the disc actually crosses.
    const half = R * Math.sqrt(Math.max(0, 1.1 - ny*ny)) + 1;
    const i0 = Math.max(0, Math.floor(c - half)), i1 = Math.min(S - 1, Math.ceil(c + half));
    for(let i = i0; i <= i1; i++){
      const nx = (i - c) / R;
      const d2 = nx*nx + ny*ny;
      if(d2 > 1.10) continue;
      const d = Math.sqrt(d2);
      const cov = Math.min(1, Math.max(0, (1 - d) * R + 0.5));   // 1px AA edge
      if(cov <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d2)));
      const lat = nx*ax + ny*ay + nz*az;
      const ndlEarly = nx*Lx + ny*Ly + nz*Lz;

      // ---- material ----
      let r, g, b;
      const qx = nx*2.2 + ox, qy = ny*2.2 + oy, qz = nz*2.2 + oz;
      if(ndlEarly <= -0.05){
        // Full night: 0.11 x material under the prop layer's dim is a hint of
        // a colour, not a landscape - so the landscape is not computed. This
        // is most of a crescent's disc, and most of the old cost.
        r = (Dk[0] + Lt[0]) * 0.5; g = (Dk[1] + Lt[1]) * 0.5; b = (Dk[2] + Lt[2]) * 0.5;
      } else if(gas){
        const warp = fbm3(qx*0.9, qy*0.9, qz*0.9, seed, 2) - 0.5;
        let tt = lat*bandN*Math.PI + warp*twist*1.7;
        // The storm bends the stripes around itself before it paints itself.
        let stormW = 0, collarW = 0;
        if(stS){
          const ex = nx - stx, ey = ny - sty, ez = nz - stz;
          const du = (ex*st1x + ey*st1y + ez*st1z) / 1.9;
          const dv = ex*st2x + ey*st2y + ez*st2z;
          const ell = Math.sqrt(du*du + dv*dv) / stS;
          if(ell < 1.5){
            stormW = Math.max(0, 1 - ell);
            collarW = Math.max(0, 1 - Math.abs(ell - 1.05)*4);
            tt += stormW*stormW * 5.2;
          }
        }
        let v = Math.sin(tt)*0.5 + 0.5 + Math.sin(tt*2 + 1.7)*0.15;
        // Contrast, then grain: soft sine stripes read as watercolour.
        v = 0.5 + (v - 0.5)*1.75;
        v += (fbm3(qx*3.4, qy*3.4, qz*3.4, seed + 7, 2) - 0.5)*0.22;
        v = Math.min(1, Math.max(0, v));
        r = Dk[0] + (Lt[0]-Dk[0])*v; g = Dk[1] + (Lt[1]-Dk[1])*v; b = Dk[2] + (Lt[2]-Dk[2])*v;
        if(stS && stormW > 0){
          const k1 = stormW*stormW*0.72;
          r += (deep[0]-r)*k1; g += (deep[1]-g)*k1; b += (deep[2]-b)*k1;
          const k2 = collarW*0.38;
          r += (hi[0]-r)*k2; g += (hi[1]-g)*k2; b += (hi[2]-b)*k2;
        }
      } else {
        // Rocky: elevation ramp deep -> dark -> lit -> high, with a low-
        // frequency tint so a whole face is never one material.
        const e = fbm3(qx*1.35, qy*1.35, qz*1.35, seed, 5);
        const macro = fbm3(qx*0.5 + 13, qy*0.5 + 13, qz*0.5 + 13, seed + 31, 2) - 0.5;
        let v;
        if(e < sea){ const t = e/sea; r = deep[0]+(Dk[0]-deep[0])*t; g = deep[1]+(Dk[1]-deep[1])*t; b = deep[2]+(Dk[2]-deep[2])*t; }
        else if(e < sea + 0.3){ const t = (e-sea)/0.3; r = Dk[0]+(Lt[0]-Dk[0])*t; g = Dk[1]+(Lt[1]-Dk[1])*t; b = Dk[2]+(Lt[2]-Dk[2])*t; }
        else { const t = Math.min(1, (e-sea-0.3)/0.25); r = Lt[0]+(hi[0]-Lt[0])*t; g = Lt[1]+(hi[1]-Lt[1])*t; b = Lt[2]+(hi[2]-Lt[2])*t; }
        r *= 1 + macro*0.3; g *= 1 + macro*0.3; b *= 1 + macro*0.3;
        // Craters: shadowed floor, rim lit toward the sun, dark away from it.
        for(let k = 0; k < CR.length; k++){
          const cr = CR[k];
          const dd = 1 - (nx*cr.x + ny*cr.y + nz*cr.z);
          if(dd > cr.s) continue;
          const rel = dd / cr.s;
          if(rel < 0.62){
            const fw = (1 - rel/0.62) * 0.5;
            r += (deep[0]-r)*fw; g += (deep[1]-g)*fw; b += (deep[2]-b)*fw;
          } else {
            const rimw = Math.max(0, 1 - Math.abs(rel - 0.81)*5.2);
            const ex = nx - cr.x, ey = ny - cr.y, ez = nz - cr.z;
            const sn = Math.min(1, Math.max(-1, (ex*Lx + ey*Ly + ez*Lz) / (cr.s*1.6)));
            const t = rimw * 0.5 * Math.abs(sn);
            const tc = sn > 0 ? hi : deep;
            r += (tc[0]-r)*t; g += (tc[1]-g)*t; b += (tc[2]-b)*t;
          }
        }
        if(hasCaps){
          const cw = sstep(capLat, capLat + 0.08, Math.abs(lat)) * 0.85;
          r += (255-r)*cw*0.55; g += (255-g)*cw*0.55; b += (255-b)*cw*0.58;
        }
      }

      // ---- light ----
      const ndl = ndlEarly;
      const day = sstep(-0.045, 0.13, ndl);
      const limbd = 0.78 + 0.22*nz;                     // limb darkening, gentle
      let light = 0.11 + 1.0 * day * limbd;
      if(p.rings){
        const q = (lat - shLat) / 0.10;
        if(q > -1 && q < 1) light *= 1 - 0.62 * day * (1 - q*q);
      }
      // Atmosphere in-scatter: the lit limb glows in the sky's own colour.
      const rim = (1 - nz);
      const rimw = rim*rim*rim * (0.14 + 0.6*day);
      let rr = r*light + atm[0]*rimw;
      let gg = g*light + atm[1]*rimw;
      let bb = b*light + atm[2]*rimw;

      const o = (j*S + i) * 4;
      px[o]   = rr > 255 ? 255 : rr;
      px[o+1] = gg > 255 ? 255 : gg;
      px[o+2] = bb > 255 ? 255 : bb;
      px[o+3] = cov * 255;
    }
  }
  dx2.putImageData(img, 0, 0);

  /* ---- the sprite: back rings, disc, halo, front rings ---- */
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = S;
  const sx = sprite.getContext("2d");

  const ringPass = front => {
    if(!p.rings) return;
    const bands = [
      { rr: R*1.30, w: R*0.070, a: 0.46 },
      { rr: R*1.42, w: R*0.110, a: 0.26 },
      { rr: R*1.56, w: R*0.050, a: 0.44 },   // then the gap
      { rr: R*1.70, w: R*0.040, a: 0.24 },
    ];
    const cosR = Math.cos(ringRoll), sinR = Math.sin(ringRoll);
    sx.save();
    sx.lineCap = "round";
    const STEPS = 150;
    for(const bd of bands){
      for(let k = 0; k < STEPS; k++){
        const t0 = (k / STEPS) * TAU, t1 = ((k + 1.35) / STEPS) * TAU;
        const my = Math.sin((t0 + t1)/2);
        const isFront = my >= 0;                 // near half dips below centre
        if(isFront !== front) continue;
        const pt = t => {
          const ux = Math.cos(t) * bd.rr, uy = Math.sin(t) * bd.rr * squash;
          return [c + ux*cosR - uy*sinR, c + ux*sinR + uy*cosR];
        };
        const [x0, y0] = pt(t0), [x1, y1] = pt(t1);
        // The planet's shadow bites the ring on the far side from the sun.
        const mx = (x0+x1)/2 - c, myy = (y0+y1)/2 - c;
        const along = mx*Lx + myy*Ly;
        const perp = Math.abs(mx*Ly - myy*Lx);
        const shade = (along < -R*0.2 && perp < R*0.95) ? 0.12 : 1;
        sx.strokeStyle = "rgba(" + ((Lt[0]+hi[0])/2|0) + "," + ((Lt[1]+hi[1])/2|0) + "," +
                         ((Lt[2]+hi[2])/2|0) + "," + (bd.a * shade).toFixed(3) + ")";
        sx.lineWidth = bd.w;
        sx.beginPath(); sx.moveTo(x0, y0); sx.lineTo(x1, y1); sx.stroke();
      }
    }
    sx.restore();
  };

  ringPass(false);                    // the far half, behind the body
  sx.drawImage(disc, 0, 0);
  if(!p.crescent){
    // Atmosphere halo just outside the lit limb. Offset toward the sun and
    // kept tight: a halo drawn all the way round reads as a grey donut.
    const gx = c + Lx*R*0.28, gy = c + Ly*R*0.28;
    const g = sx.createRadialGradient(gx, gy, R*0.90, gx, gy, R*1.075);
    g.addColorStop(0, "rgba(" + atm[0] + "," + atm[1] + "," + atm[2] + ",0)");
    g.addColorStop(0.5, "rgba(" + atm[0] + "," + atm[1] + "," + atm[2] + ",0.15)");
    g.addColorStop(1, "rgba(" + atm[0] + "," + atm[1] + "," + atm[2] + ",0)");
    sx.save();
    sx.globalCompositeOperation = "lighter";
    sx.fillStyle = g;
    sx.beginPath(); sx.arc(gx, gy, R*1.075, 0, TAU); sx.fill();
    sx.restore();
  }
  ringPass(true);                     // the near half, over the body

  /* ---- blit into the sky, wrapped. One sprite, identical copies. ---- */
  const cxL = p.x * W, cyL = p.y * H;
  tiled(ctx, H, cyL, yy => {
    ctx.drawImage(sprite, cxL - extL, yy - extL, extL*2, extL*2);
  });
}

function drawPlanetInk(ctx, W, H, p, rand, lightDir){
  const cx = p.x*W, cy = p.y*H, r = p.r*W;
  // Unit vector toward the sky's bright core - the nebula is the light source,
  // so the lit limb agrees with the brightest sky behind it.
  const lx = lightDir[0], ly = lightDir[1], lang = Math.atan2(ly, lx);
  /*
   * The first version of this painter was one radial gradient, flat rectangles
   * for bands and flat discs for craters - and it read as exactly that, "hand
   * drawn", as the review from the cockpit put it. What sells a sphere is four
   * cheap things: mottled surface NOISE so the material looks like rock or gas
   * instead of vinyl; bands that WAVE and fade toward the limb the way weather
   * wraps a ball; craters with a lit rim and a sunken floor instead of dark
   * stains; and a hard TERMINATOR with a whisker of atmosphere outside the lit
   * edge. Every roll comes off the mission's seeded `rand`, so it is the same
   * planet every visit, and the whole sky is baked once - the cost is zero.
   */
  const paint = yy => {
    ctx.save();
    if(p.rings){                                   // back half of the ring
      ctx.save();
      ctx.translate(cx, yy); ctx.rotate(-0.42); ctx.scale(1, 0.22);
      ctx.strokeStyle = rgba(p.lit, 0.30);
      ctx.lineWidth = r*0.18;
      ctx.beginPath(); ctx.arc(0, 0, r*1.48, Math.PI, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(p.lit, 0.16);
      ctx.lineWidth = r*0.08;
      ctx.beginPath(); ctx.arc(0, 0, r*1.68, Math.PI, TAU); ctx.stroke();
      ctx.restore();
    }

    // Base sphere. A longer ramp through a blended mid-tone, so the falloff
    // reads as a curving surface rather than a spotlight on a flat circle.
    const g = ctx.createRadialGradient(cx + lx*r*0.55, yy + ly*r*0.55, r*0.05, cx, yy, r*1.02);
    g.addColorStop(0, p.lit);
    g.addColorStop(0.38, mixHex(p.lit, p.dark, 0.45));
    g.addColorStop(0.72, p.dark);
    g.addColorStop(1, "#01020a");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, yy, r, 0, TAU); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, yy, r, 0, TAU); ctx.clip();

    // Surface mottling: soft seeded blotches, pale where they face the light
    // and dark where they do not, sized to read as terrain or weather systems.
    for(let i = 0; i < 26; i++){
      const a = rand()*TAU, d = Math.sqrt(rand())*r*0.96;
      const bx = cx + Math.cos(a)*d, by = yy + Math.sin(a)*d;
      const br = r*(0.10 + rand()*0.22);
      const towardLight = Math.cos(a)*lx + Math.sin(a)*ly;
      const ng = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      if(towardLight > 0 && rand() < 0.6){
        ng.addColorStop(0, rgba(p.lit, 0.10 + rand()*0.08));
        ng.addColorStop(1, rgba(p.lit, 0));
      } else {
        ng.addColorStop(0, rgba(p.dark, 0.16 + rand()*0.12));
        ng.addColorStop(1, rgba(p.dark, 0));
      }
      ctx.fillStyle = ng;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    }

    if(p.bands){
      /*
       * Gas bands with weather in them: full-width ribbons whose edges wander
       * on a seeded sine, alternating pale and dark. Straight rectangles read
       * as wallpaper; a wobble of a few pixels reads as wind.
       */
      [-0.62, -0.38, -0.14, 0.10, 0.34, 0.58].forEach((o, ri) => {
        const bh = r*(0.07 + rand()*0.09);
        const wob = r*(0.02 + rand()*0.03), ph = rand()*TAU, freq = 2 + rand()*2.5;
        const light = ri % 2 === 0;
        ctx.fillStyle = rgba(light ? p.lit : p.dark, light ? 0.16 : 0.22);
        ctx.beginPath();
        for(let x = -r; x <= r; x += r/14)
          ctx.lineTo(cx + x, yy + o*r + Math.sin(ph + x/r*freq)*wob);
        for(let x = r; x >= -r; x -= r/14)
          ctx.lineTo(cx + x, yy + o*r + bh + Math.sin(ph + 1.7 + x/r*freq)*wob);
        ctx.closePath(); ctx.fill();
      });
      // The storm every gas giant earns: a stretched eye of dark in a pale
      // collar, sitting off-centre like the famous one.
      const sa = rand()*TAU, sd = Math.sqrt(rand())*r*0.5;
      ctx.save();
      ctx.translate(cx + Math.cos(sa)*sd, yy + Math.sin(sa)*sd*0.6 + r*0.2);
      ctx.scale(1.5, 1);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r*0.14);
      sg.addColorStop(0, rgba(p.dark, 0.5));
      sg.addColorStop(0.55, rgba(p.lit, 0.32));
      sg.addColorStop(1, rgba(p.lit, 0));
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, r*0.14, 0, TAU); ctx.fill();
      ctx.restore();
    }

    if(p.craters){
      for(let i = 0; i < 9; i++){
        const a = rand()*TAU, d = Math.sqrt(rand())*r*0.78, cr = r*(0.05 + rand()*0.11);
        const px = cx + Math.cos(a)*d, py = yy + Math.sin(a)*d;
        // Floor first, deepest away from the sun...
        const fg = ctx.createRadialGradient(px + lx*cr*0.25, py + ly*cr*0.25, cr*0.1, px, py, cr);
        fg.addColorStop(0, rgba(p.dark, 0.65));
        fg.addColorStop(1, rgba(p.dark, 0.25));
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(px, py, cr, 0, TAU); ctx.fill();
        // ...then the rim, lit on the sunward arc and shadowed opposite. That
        // pair is the whole difference between a hole and a stain.
        ctx.lineWidth = Math.max(0.8, cr*0.22);
        ctx.strokeStyle = rgba(p.lit, 0.5);
        ctx.beginPath(); ctx.arc(px, py, cr, lang - 2.2, lang - 0.9); ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath(); ctx.arc(px, py, cr, lang + 0.9, lang + 2.2); ctx.stroke();
      }
    }

    /*
     * Shading, ONE pass only. `crescent` and the terminator are two ways of
     * saying the same thing - which side faces the sun - and running both is
     * what turned the big crescent bodies into black holes punched in the
     * nebula. Crescents get the harder linear cut; everyone else gets the
     * radial terminator, which also curves the bands into the limb for free.
     */
    if(p.crescent){
      const sg = ctx.createLinearGradient(cx + lx*r, yy + ly*r, cx - lx*r, yy - ly*r);
      sg.addColorStop(0, "rgba(0,0,0,0)");
      sg.addColorStop(0.42, "rgba(0,0,0,0.62)");
      sg.addColorStop(1, "rgba(0,0,0,0.88)");
      ctx.fillStyle = sg;
      ctx.fillRect(cx - r, yy - r, r*2, r*2);
      // Earthshine: the night side lifted a hair off pure black, so the disc
      // still has a body in it instead of reading as a hole in the sky.
      ctx.fillStyle = rgba(p.lit, 0.05);
      ctx.beginPath(); ctx.arc(cx, yy, r, 0, TAU); ctx.fill();
    } else {
      const tg = ctx.createRadialGradient(cx + lx*r*0.55, yy + ly*r*0.55, r*0.35, cx, yy, r*1.35);
      tg.addColorStop(0, "rgba(0,0,0,0)");
      tg.addColorStop(0.62, "rgba(2,3,9,0.3)");
      tg.addColorStop(1, "rgba(1,2,7,0.8)");
      ctx.fillStyle = tg;
      ctx.fillRect(cx - r, yy - r, r*2, r*2);
    }

    // Soft limb glow on the core-facing edge. Drawn after the shading so a
    // mostly-dark body still keeps a lit rim - the cue that says "sphere",
    // not "hole". Kept faint: scenery must never compete with bullets.
    const lg = ctx.createRadialGradient(cx + lx*r, yy + ly*r, r*0.15, cx + lx*r, yy + ly*r, r*1.05);
    lg.addColorStop(0, rgba(p.lit, 0.30));
    lg.addColorStop(1, rgba(p.lit, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(cx - r, yy - r, r*2, r*2);

    // Rim light: the nebula wrapping the edge of the disc. It is a gradient
    // that ramps from nothing at 0.8r to bright at the limb, NOT a stroked arc
    // and not a clipped band - both of those end somewhere, and the seam reads
    // as a scratch or a second circle drawn inside the planet.
    const rl = ctx.createRadialGradient(cx, yy, r*0.8, cx, yy, r);
    rl.addColorStop(0, rgba(p.lit, 0));
    rl.addColorStop(0.72, rgba(p.lit, 0.06));
    rl.addColorStop(1, rgba(p.lit, 0.34));
    ctx.fillStyle = rl;
    ctx.fillRect(cx - r, yy - r, r*2, r*2);
    ctx.restore();

    // Atmosphere: a whisker of lit haze OUTSIDE the disc on the sunward side.
    // Photographs of planets always have it; drawings never do.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, yy, r*1.06, 0, TAU);
    ctx.arc(cx, yy, r*0.985, 0, TAU, true);
    ctx.clip();
    const ag = ctx.createRadialGradient(cx + lx*r, yy + ly*r, r*0.3, cx, yy, r*1.06);
    ag.addColorStop(0, rgba(p.lit, 0.34));
    ag.addColorStop(0.7, rgba(p.lit, 0.08));
    ag.addColorStop(1, rgba(p.lit, 0));
    ctx.fillStyle = ag;
    ctx.fillRect(cx - r*1.1, yy - r*1.1, r*2.2, r*2.2);
    ctx.restore();

    if(p.rings){                                   // front half, over the disc
      ctx.save();
      ctx.translate(cx, yy); ctx.rotate(-0.42); ctx.scale(1, 0.22);
      // Two tones and a gap, like a real ring system's light and dark lanes.
      ctx.strokeStyle = rgba(p.lit, 0.55);
      ctx.lineWidth = r*0.18;
      ctx.beginPath(); ctx.arc(0, 0, r*1.48, 0, Math.PI); ctx.stroke();
      ctx.strokeStyle = rgba(p.lit, 0.30);
      ctx.lineWidth = r*0.08;
      ctx.beginPath(); ctx.arc(0, 0, r*1.68, 0, Math.PI); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };
  tiled(ctx, H, cy, paint);
}

function drawSun(ctx, W, H, p){
  const cx = p.x*W, r = p.r*W;
  tiled(ctx, H, p.y*H, yy => {
    const g = ctx.createRadialGradient(cx, yy, 0, cx, yy, r*4.5);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.08, rgba(p.color, 0.8));
    g.addColorStop(0.3, rgba(p.color, 0.25));
    g.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, yy, r*4.5, 0, TAU); ctx.fill();
  });
}

function drawGalaxy(ctx, W, H, p, rand){
  const cx = p.x*W, r = p.r*W;
  tiled(ctx, H, p.y*H, yy => {
    ctx.save();
    ctx.translate(cx, yy); ctx.rotate(-0.6); ctx.scale(1, 0.38);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, "rgba(255,246,222,0.42)");
    g.addColorStop(0.3, "rgba(200,180,255,0.12)");
    g.addColorStop(1, "rgba(140,110,220,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    for(let i=0;i<120;i++){
      const a = rand()*TAU, d = Math.pow(rand(), 0.6)*r;
      ctx.globalAlpha = 0.45*(1 - d/r);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(Math.cos(a + d*0.018)*d, Math.sin(a + d*0.018)*d, 1.3, 1.3);
    }
    ctx.restore();
  });
}

/*
 * MORE THAN PLANETS.
 *
 * For a long time the whole vocabulary was planet / sun / galaxy / rocks, and
 * with 29 skies to fill that meant most of them were "a coloured haze with a
 * planet in it" - the campaign changed hue as it went but it never changed
 * PLACE. These four give a sky something else to be about. Each follows the
 * same contract as the others: draw around `p.y*H`, wrap through `tiled`, take
 * the shared seeded `rand` so a sky is identical every time it is built.
 */

/*
 * Curtains of light. The first pass drew evenly spaced straight columns and
 * came out as a barcode - the thing that makes an aurora an aurora is that no
 * two folds are alike, so every curtain now varies in width, height, lean and
 * brightness, and each is drawn as two offset sheets so the fold has an edge.
 */
function drawAurora(ctx, W, H, p, rand){
  const cy = p.y*H, hgt = (p.h || 0.34)*H, cols = p.n || 5;
  tiled(ctx, H, cy, yy => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for(let i = 0; i < cols; i++){
      const t = cols === 1 ? 0.5 : i/(cols - 1);
      const jitter = (rand() - 0.5)*0.16;
      const x = (p.x + (t - 0.5 + jitter)*(p.w || 0.9))*W;
      const wide = W*(0.05 + rand()*0.11);
      const tall = hgt*(0.55 + rand()*0.9);
      const lean = (rand() - 0.5)*W*0.16;
      const lift = (rand() - 0.5)*hgt*0.3;
      const amp  = 0.55 + rand()*0.65;
      // Two sheets per fold, the back one offset and dimmer: that overlap is
      // what stops a curtain reading as a painted stripe.
      for(let s = 0; s < 2; s++){
        const off = s ? wide*0.42 : 0, dim = s ? 0.45 : 1;
        const top = yy + lift - tall*0.5, bot = yy + lift + tall*0.5;
        const g = ctx.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0,    rgba(p.hi || "#7ef0cf", 0));
        g.addColorStop(0.30, rgba(p.hi || "#7ef0cf", 0.26*amp*dim));
        g.addColorStop(0.70, rgba(p.lo || "#4f7ce0", 0.13*amp*dim));
        g.addColorStop(1,    rgba(p.lo || "#4f7ce0", 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + off - wide*0.5, top);
        ctx.bezierCurveTo(x + off + lean*0.7, top + tall*0.35,
                          x + off - lean*0.5, bot - tall*0.35,
                          x + off + lean - wide*0.15, bot);
        ctx.lineTo(x + off + lean + wide*0.55, bot);
        ctx.bezierCurveTo(x + off - lean*0.5 + wide, bot - tall*0.35,
                          x + off + lean*0.7 + wide, top + tall*0.35,
                          x + off + wide*0.5, top);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  });
}

/*
 * A dead hull, and it has to be BIG - the first pass drew it at a third of the
 * frame in a fill barely darker than the sky, so all that showed was a thin
 * outline and it read as a paper aeroplane. It is a black bulk now, wider than
 * the playfield, with plating, a torn stern trailing debris, and one lit
 * window: a dead ship with nobody in it is scenery, a dead ship with somebody
 * in it is a story.
 */
function drawWreck(ctx, W, H, p, rand){
  const cx = p.x*W, L = (p.r || 0.95)*W, T = L*(p.thick || 0.22);
  tiled(ctx, H, p.y*H, yy => {
    ctx.save();
    ctx.translate(cx, yy); ctx.rotate(p.tilt == null ? -0.20 : p.tilt);
    // Sits in front of the haze, so it is drawn nearly black rather than tinted.
    ctx.fillStyle = "rgba(6,8,14,0.96)";
    ctx.beginPath();
    ctx.moveTo(-L*0.52, -T*0.05);
    ctx.lineTo(-L*0.40, -T*0.40);
    ctx.lineTo(-L*0.05, -T*0.52);
    ctx.lineTo( L*0.14, -T*0.44);
    ctx.lineTo( L*0.22, -T*0.92);      // the dorsal fin
    ctx.lineTo( L*0.31, -T*0.88);
    ctx.lineTo( L*0.34, -T*0.36);
    ctx.lineTo( L*0.46,  T*0.02);      // torn stern
    ctx.lineTo( L*0.30,  T*0.16);
    ctx.lineTo( L*0.38,  T*0.40);
    ctx.lineTo( L*0.08,  T*0.62);
    ctx.lineTo(-L*0.34,  T*0.50);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(150,170,205,0.16)"; ctx.lineWidth = 1.3; ctx.stroke();
    // Plating: long lines down the body, so the scale reads.
    ctx.strokeStyle = "rgba(150,170,205,0.10)"; ctx.lineWidth = 1;
    for(let i = 0; i < 4; i++){
      const ly = -T*0.30 + i*T*0.26;
      ctx.beginPath(); ctx.moveTo(-L*0.44, ly); ctx.lineTo(L*0.28, ly*0.9); ctx.stroke();
    }
    for(let i = 0; i < 7; i++){
      const rx = -L*0.30 + i*L*0.10;
      ctx.beginPath(); ctx.moveTo(rx, -T*0.40); ctx.lineTo(rx, T*0.44); ctx.stroke();
    }
    // Debris drifting off the tear.
    for(let i = 0; i < 14; i++){
      const dx = L*(0.42 + rand()*0.30), dy = (rand() - 0.5)*T*1.5;
      const ds = L*0.004*(0.6 + rand());
      ctx.fillStyle = "rgba(12,15,24,0.9)";
      ctx.fillRect(dx, dy, ds*(1 + rand()*2), ds);
    }
    /*
     * THE LIGHTS STILL ON. One hard gold rectangle, no glow, nothing near
     * it - which is a lovely idea drawn so plainly that the customer asked
     * whether it was a rendering bug. It is not: it is the last power in a
     * dead ship, and it has to look like it.
     *
     * So: a short row of windows of uneven brightness with a warm bloom
     * behind them. A lit window at this size is mostly its glow - that is
     * what separates "a light" from "a rectangle" - and unevenness is what
     * separates a hulk with a few compartments still live from a fitting.
     */
    const wx = -L*0.16, wy = -T*0.12, ww = L*0.009, wh = T*0.13;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const bloom = ctx.createRadialGradient(wx + ww/2, wy + wh/2, 0,
                                           wx + ww/2, wy + wh/2, wh*2.6);
    bloom.addColorStop(0, "rgba(255,206,120,0.5)");
    bloom.addColorStop(0.45, "rgba(255,190,96,0.16)");
    bloom.addColorStop(1, "rgba(255,190,96,0)");
    ctx.fillStyle = bloom;
    ctx.beginPath(); ctx.arc(wx + ww/2, wy + wh/2, wh*2.6, 0, TAU); ctx.fill();
    ctx.restore();
    for(let i = 0; i < 4; i++){
      const a = [0.85, 0.30, 0.62, 0.16][i];
      ctx.fillStyle = "rgba(255,222,150," + a + ")";
      ctx.fillRect(wx + i*ww*2.1, wy + (i % 2)*wh*0.22, ww, wh*(i % 2 ? 0.62 : 1));
    }
    ctx.restore();
  });
}

/*
 * Backlit columns of gas. The first pass produced three smooth cones, which is
 * a mountain range, not a nebula - so the silhouette is now built from a run of
 * jittered segments down each side, and the rim light only touches the side
 * facing the core. Small dark knots ride the flanks to break the outline again.
 */
function drawPillars(ctx, W, H, p, rand){
  const base = p.y*H, hgt = (p.h || 0.42)*H, n = p.n || 3;
  tiled(ctx, H, base, yy => {
    ctx.save();
    for(let i = 0; i < n; i++){
      const t = n === 1 ? 0.5 : i/(n - 1);
      const x = (p.x + (t - 0.5)*(p.w || 0.34))*W + (rand() - 0.5)*W*0.03;
      const wide = W*(0.05 + rand()*0.06);
      const tall = hgt*(0.6 + rand()*0.6);
      const lean = (rand() - 0.5)*wide*1.6;
      const STEPS = 9;
      const left = [], right = [];
      for(let k = 0; k <= STEPS; k++){
        const u = k/STEPS;                       // 0 at the base, 1 at the tip
        const y = yy - tall*u;
        const taper = wide*(1 - u*0.72);
        const wob = (rand() - 0.5)*wide*0.42;
        left.push([x + lean*u - taper + wob, y]);
        right.push([x + lean*u + taper + (rand() - 0.5)*wide*0.42, y]);
      }
      const g = ctx.createLinearGradient(0, yy, 0, yy - tall);
      g.addColorStop(0,   rgba(p.lo || "#080410", 0.97));
      g.addColorStop(0.55, rgba(p.lo || "#080410", 0.82));
      g.addColorStop(1,   rgba(p.hi || "#c58cff", 0.12));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      left.forEach(pt => ctx.lineTo(pt[0], pt[1]));
      for(let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
      ctx.closePath(); ctx.fill();
      // Rim light down the lit flank only.
      ctx.strokeStyle = rgba(p.hi || "#c58cff", 0.26);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      right.forEach((pt, k) => k ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
      ctx.stroke();
      // Knots: darker lumps clinging to the column. They read as the bolts on
      // an organ pipe and as fruit on a solar prominence, so the sky that flies
      // these as filaments turns them off.
      for(let k = 0; p.knots !== false && k < 4; k++){
        const u = 0.15 + rand()*0.7, idx = Math.round(u*STEPS);
        const pt = (rand() < 0.5 ? left : right)[idx];
        ctx.fillStyle = rgba(p.lo || "#080410", 0.92);
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], wide*(0.14 + rand()*0.18), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  });
}

/*
 * FOUR MORE PLACES.
 *
 * Seven skies were still "a coloured haze with a planet in it" - the campaign
 * changed hue as it went, but seven stops in a row did not change PLACE. The
 * fix is not more planets; it is that each of those levels is ABOUT something,
 * and the backdrop should be able to say what. Three of the seven could be
 * answered by re-dealing the existing vocabulary (a duelling ground is
 * littered with the losers, so it gets wrecks; a chorus gets pillars, which
 * read as organ pipes on a purple sky). The other four needed words the
 * painter did not have.
 *
 * Each follows the same contract as everything above: draw around p.y*H, wrap
 * through `tiled`, take the shared seeded `rand` so a sky is identical on
 * every visit, and cost nothing at runtime because the whole thing is baked
 * once at mission start.
 */

/*
 * THE RING: the only piece of ENGINEERING in any sky.
 *
 * A band of structure crossing the entire frame, near enough edge-on to read
 * as something enormous seen from inside its own orbit. It goes on the level
 * whose composition already says "this place joins up" - the same planet
 * against both edges at the same height - and finishes the sentence: the thing
 * that joins up is a ring, and you are flying through it.
 *
 * Dark body, lit top edge, and lights along it at a spacing that stays even as
 * the ellipse foreshortens toward the sides. The lights are what make it read
 * as built rather than as a geological band.
 */
function drawRing(ctx, W, H, p, rand){
  const cy = p.y*H, rx = (p.r || 0.95)*W, ry = rx*(p.tilt == null ? 0.13 : p.tilt);
  const band = rx*(p.thick || 0.055);
  tiled(ctx, H, cy, yy => {
    ctx.save();
    ctx.translate(p.x*W, yy);
    ctx.rotate(p.roll || -0.06);
    // The body: an ellipse stroked wide, so both the near and the far side of
    // the ring are there and the far one passes behind the world.
    ctx.strokeStyle = "rgba(7,10,16,0.94)";
    ctx.lineWidth = band;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.stroke();
    // The lit edge, on the near (lower) half only: a uniform outline round the
    // whole ellipse reads as a drawn oval, and a lit underside reads as metal.
    ctx.strokeStyle = rgba(p.lit || "#8fe3d0", 0.34);
    ctx.lineWidth = Math.max(1.2, band*0.16);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry + band*0.42, 0, 0, Math.PI); ctx.stroke();
    ctx.strokeStyle = rgba(p.lit || "#8fe3d0", 0.10);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry - band*0.42, 0, Math.PI, TAU); ctx.stroke();
    // Windows. Spaced by ANGLE, so they crowd toward the sides exactly the way
    // an evenly built ring does when you see it foreshortened.
    const n = p.n || 42;
    for(let i = 0; i < n; i++){
      const a = (i/n)*TAU;
      const x = Math.cos(a)*rx, y = Math.sin(a)*ry;
      const near = (Math.sin(a) + 1)/2;                 // 1 on the near side
      ctx.fillStyle = rgba(p.glow || "#ffe9a8", 0.10 + near*0.5);
      const s = band*(0.10 + near*0.09);
      ctx.fillRect(x - s/2, y - s/2, s, s*1.7);
    }
    ctx.restore();
  });
}

/*
 * THE NEST: egg sacs, for the Hatchery.
 *
 * The level is about things that make more things, and it was flying a green
 * haze with two planets in it. A clutch reads instantly at any size and needs
 * no explanation to a seven-year-old.
 *
 * The trick that makes them look alive rather than like bubbles is that the
 * light is INSIDE: each sac is a dark shell with a bright core off-centre, so
 * it looks full rather than blown. They cluster and overlap, biggest in the
 * middle, and a few small ones drift off the edge of the clutch.
 */
function drawEggs(ctx, W, H, p, rand){
  const cx = p.x*W, r = (p.r || 0.16)*W, n = p.n || 14;
  const shell = p.dark || "#132a06";
  const core = p.lit || "#b6f04a";
  tiled(ctx, H, p.y*H, yy => {
    for(let i = 0; i < n; i++){
      const a = rand()*TAU, d = Math.pow(rand(), 0.7)*r;
      const x = cx + Math.cos(a)*d, y = yy + Math.sin(a)*d*0.8;
      // Big in the middle, small at the fringe: a clutch has a heart.
      const near = 1 - d/(r || 1);
      const rr = r*(0.07 + near*0.16 + rand()*0.05);
      const tall = rr*(1.12 + rand()*0.22);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rand() - 0.5)*0.5);
      ctx.scale(1, tall/rr);
      // The shell.
      const g = ctx.createRadialGradient(-rr*0.28, -rr*0.3, rr*0.05, 0, 0, rr);
      g.addColorStop(0,    rgba(core, 0.55));
      g.addColorStop(0.42, mixA(core, shell, 0.72, 0.9));
      g.addColorStop(1,    rgba(shell, 0.96));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill();
      // The thing inside, lighting its own wall.
      ctx.globalCompositeOperation = "lighter";
      const k = ctx.createRadialGradient(-rr*0.22, -rr*0.24, 0, -rr*0.22, -rr*0.24, rr*0.62);
      k.addColorStop(0, rgba(core, 0.42));
      k.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = k;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = rgba(core, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, rr, tall, 0, 0, TAU); ctx.stroke();
    }
  });
}

/*
 * SOMEBODY LIVES HERE: a station, or a whole harbour of them.
 *
 * One painter, two readings, which is why it is worth having: `n:1` is a
 * watchtower - a single lit hull with a mast, for the Warden's nest - and
 * `n:5` is a harbour, a huddle of them at different sizes and heights, for the
 * last friendly port before the dark.
 *
 * Lit WINDOWS are the whole effect. A silhouette is scenery; a silhouette with
 * windows in it is somewhere people are, and the campaign has never had one.
 */
function drawStation(ctx, W, H, p, rand){
  const cx = p.x*W, R = (p.r || 0.09)*W, n = p.n || 1;
  const hull = p.dark || "#0a0e18";
  const lamp = p.lit || "#ffe9a8";
  tiled(ctx, H, p.y*H, yy => {
    for(let i = 0; i < n; i++){
      // The first is the one the prop is placed at; the rest scatter around it,
      // smaller, so a harbour has a biggest ship rather than a row of clones.
      const off = i === 0 ? 0 : (rand() - 0.5)*R*7.2;
      const offY = i === 0 ? 0 : (rand() - 0.5)*R*4.0;
      const s = i === 0 ? R : R*(0.32 + rand()*0.42);
      const x = cx + off, y = yy + offY;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rand() - 0.5)*0.22);
      ctx.fillStyle = rgba(hull, 0.96);
      // A drum with a spine through it - enough silhouette to read as built,
      // few enough points to stay a shape at 40px.
      ctx.beginPath();
      ctx.moveTo(-s*0.9,  s*0.16); ctx.lineTo(-s*0.66, -s*0.30);
      ctx.lineTo( s*0.66, -s*0.30); ctx.lineTo( s*0.9,   s*0.16);
      ctx.lineTo( s*0.5,   s*0.40); ctx.lineTo(-s*0.5,   s*0.40);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(-s*0.10, -s*0.72, s*0.20, s*0.46);     // the mast
      ctx.fillRect(-s*0.34, -s*0.78, s*0.68, s*0.11);     // and its yard
      // Windows: two rows, unevenly lit, because a station where every light
      // is on reads as a texture rather than as a place with people in it.
      const cols = Math.max(3, Math.round(s/6));
      for(let c = 0; c < cols; c++){
        for(let rw = 0; rw < 2; rw++){
          if(rand() < 0.32) continue;
          const wx = -s*0.62 + (c + 0.5)*(s*1.24/cols);
          const wy = -s*0.16 + rw*s*0.26;
          ctx.fillStyle = rgba(lamp, 0.35 + rand()*0.5);
          ctx.fillRect(wx - s*0.045, wy - s*0.05, s*0.09, s*0.1);
        }
      }
      // One beacon on the mast, and its halo.
      ctx.globalCompositeOperation = "lighter";
      const bg = ctx.createRadialGradient(0, -s*0.80, 0, 0, -s*0.80, s*0.42);
      bg.addColorStop(0, rgba(p.beacon || "#ff8a6b", 0.7));
      bg.addColorStop(1, rgba(p.beacon || "#ff8a6b", 0));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(0, -s*0.80, s*0.42, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });
}

/*
 * THE UNDERTOW: a gravity well you can see.
 *
 * The level's rule is that the sky pulls you, and its backdrop said nothing
 * about that at all. This is the one prop in the game that is mostly NOT
 * there: a disc of pure dark, and around it the light of everything behind it
 * dragged into arcs. Nothing is drawn inside the hole, which is what makes the
 * hole read as a hole.
 */
function drawVortex(ctx, W, H, p, rand){
  const cx = p.x*W, r = (p.r || 0.14)*W;
  const tint = p.lit || "#7fd8d0";
  tiled(ctx, H, p.y*H, yy => {
    ctx.save();
    ctx.translate(cx, yy);
    // The drag: arcs that tighten and brighten as they wind in.
    ctx.globalCompositeOperation = "lighter";
    for(let i = 0; i < 26; i++){
      const a0 = rand()*TAU;
      const rad = r*(1.15 + Math.pow(rand(), 0.6)*2.5);
      const span = 0.5 + rand()*1.5;
      const close = 1 - (rad/(r*3.65));            // 1 at the lip, 0 far out
      ctx.strokeStyle = rgba(tint, 0.035 + close*0.16);
      ctx.lineWidth = 1 + close*2.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, rad, rad*0.72, 0.35, a0, a0 + span);
      ctx.stroke();
    }
    // The rim: where the light piles up before it goes over.
    const lip = ctx.createRadialGradient(0, 0, r*0.86, 0, 0, r*1.5);
    lip.addColorStop(0, rgba(tint, 0));
    lip.addColorStop(0.30, rgba(tint, 0.30));
    lip.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = lip;
    ctx.beginPath(); ctx.arc(0, 0, r*1.5, 0, TAU); ctx.fill();
    // ...and the hole itself, last and opaque, over everything it swallowed.
    ctx.globalCompositeOperation = "source-over";
    const hole = ctx.createRadialGradient(0, 0, r*0.6, 0, 0, r);
    hole.addColorStop(0, "rgba(0,0,0,1)");
    hole.addColorStop(0.82, "rgba(0,0,0,0.98)");
    hole.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hole;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.restore();
  });
}

/*
 * GROUND. The one backdrop in the game that is not sky.
 *
 * The Narrows is flown below the clouds, down a canyon, and a canyon needs a
 * floor. Everything above paints things hanging in a void; this paints the
 * void's opposite - a surface, seen from directly overhead, scrolling past.
 *
 * What sells it in one glance is not the rock, it is the WATERCOURSE. A field
 * of stones reads as an asteroid belt seen close up; a stone field with a
 * braided channel wandering down it reads as a place with weather, which is to
 * say a planet. So the channel is drawn first and everything else is arranged
 * around it.
 *
 * The mission that flies this also switches off the star layer (see
 * render.js): stars streaming over a canyon floor is the one detail that would
 * put the whole thing back in space.
 */
function drawGround(ctx, W, H, p, rand){
  const base = p.dark || "#1c0d05";
  const pale = p.lit || "#a97a48";
  /*
   * NOT drawn through `tiled`, and that is the whole trick.
   *
   * `tiled` calls its body up to three times so a prop can straddle the wrap,
   * and each call draws fresh random numbers - which is right for a planet or
   * a rock field, where the copies are the same OBJECT seen at three scroll
   * positions, and catastrophic for a texture that fills the frame, where the
   * three copies came out as three different pieces of ground with a visible
   * join between them.
   *
   * So this one is drawn once, and made periodic in H by construction: the
   * channel uses frequencies that complete a whole number of cycles over the
   * height, and every blotch and boulder near an edge is drawn again at the
   * far one. Scroll it forever and the seam never arrives.
   *
   * SECOND PASS ON THE LOOKS. The first cut braided three PALE riverbeds
   * across a mid-brown floor and the customer's verdict was "extremely ugly" -
   * fair, because pale-on-brown reads as worms, not water. A dry channel is a
   * SHADOW: it sits lower than the floor, so it is darker than the floor, with
   * one thin lit line where the sun catches its far bank. One channel, dark,
   * on a darker floor, and the floor's job is to stay quiet under a fight.
   */
  const wrapY = (y, r, draw) => {
    draw(y);
    if(y - r < 0) draw(y + H);
    if(y + r > H) draw(y - H);
  };
  ctx.save();
  // The bedrock, and a slow shading across it so the floor is not a flat wash.
  ctx.fillStyle = base;
  ctx.fillRect(-2, -2, W + 4, H + 4);
  for(let i = 0; i < 22; i++){
    const bx = rand()*W, by = rand()*H, br = W*(0.14 + rand()*0.3);
    const up = rand() < 0.45;
    const c0 = mixA(pale, base, up ? 0.55 : 0.92, up ? 0.20 : 0.45);
    const c1 = mixA(pale, base, 1, 0);
    wrapY(by, br, y => {
      const g = ctx.createRadialGradient(bx, y, 0, bx, y, br);
      g.addColorStop(0, c0); g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, y, br, 0, TAU); ctx.fill();
    });
  }
  /*
   * The channel: ONE dry watercourse wandering down the frame - the thing
   * that makes this read as a planet with weather rather than an asteroid
   * seen close up. Whole cycles over H (TAU/H), so its top meets its own
   * bottom exactly and the scroll never shows a seam.
   */
  {
    const wide = W*0.13;
    const phase = rand()*TAU, wob = W*(0.11 + rand()*0.08);
    const mid = W*(0.36 + rand()*0.28);
    const k1 = (TAU/H) * 1;
    const k2 = (TAU/H) * (3 + Math.floor(rand()*2));
    const xAt = y => mid + Math.sin(y*k1 + phase)*wob + Math.sin(y*k2 + phase*2)*wob*0.28;
    const path = off => {
      ctx.beginPath();
      for(let y = -20; y <= H + 20; y += 12){
        const x = xAt(y) + off;
        if(y <= -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    };
    // The bed, sunken: darker than the floor it is cut into.
    ctx.strokeStyle = mixA(base, "#000000", 0.45, 0.62);
    ctx.lineWidth = wide;
    ctx.lineCap = "round";
    path(0); ctx.stroke();
    // Its own deeper heart.
    ctx.strokeStyle = mixA(base, "#000000", 0.7, 0.5);
    ctx.lineWidth = wide*0.42;
    path(wide*0.06); ctx.stroke();
    // And the one lit line: the sun catching the far bank.
    ctx.strokeStyle = mixA(pale, "#ffffff", 0.18, 0.30);
    ctx.lineWidth = 1.6;
    path(-wide*0.52); ctx.stroke();
  }
  // Cracks: a few thin dark lines, because rock that has been in the sun for
  // a million years is not smooth. Short, sparse, and quiet.
  for(let i = 0; i < 7; i++){
    const cx0 = rand()*W, cy0 = rand()*H, len = H*(0.04 + rand()*0.07);
    const ang = rand()*TAU, bend = (rand() - 0.5)*0.8;
    wrapY(cy0, len, y0 => {
      ctx.strokeStyle = mixA(base, "#000000", 0.55, 0.4);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx0, y0);
      ctx.quadraticCurveTo(cx0 + Math.cos(ang + bend)*len*0.5, y0 + Math.sin(ang + bend)*len*0.5,
                           cx0 + Math.cos(ang)*len, y0 + Math.sin(ang)*len);
      ctx.stroke();
    });
  }
  // Boulders lying on it, lit from the same corner as everything else, each
  // with the shadow that puts it ON the ground rather than above it.
  for(let i = 0; i < (p.n || 40); i++){
    const bx = rand()*W, by = rand()*H, r = W*(0.008 + rand()*0.022);
    const N = 6 + Math.floor(rand()*3);
    const va = [], vr = [];
    for(let k = 0; k < N; k++){ va.push(k/N*TAU + rand()*0.3); vr.push(r*(0.7 + rand()*0.5)); }
    wrapY(by, r*2, y => {
      // Shadow first, so the rock sits on top of its own darkness.
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.ellipse(bx + r*0.55, y + r*0.6, r*1.0, r*0.55, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      for(let k = 0; k < N; k++){
        const px = bx + Math.cos(va[k])*vr[k], py = y + Math.sin(va[k])*vr[k]*0.8;
        if(k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(bx - r, y - r, bx + r, y + r);
      g.addColorStop(0, mixA(pale, base, 0.28, 0.95));
      g.addColorStop(1, mixA(pale, base, 1, 0.95));
      ctx.fillStyle = g;
      ctx.fill();
    });
  }
  ctx.restore();
}

/** One long visitor, head and tail, crossing the whole frame. */
function drawComet(ctx, W, H, p){
  const cx = p.x*W, head = (p.r || 0.014)*W, len = (p.len || 0.7)*W;
  const ang = p.angle == null ? -0.42 : p.angle;
  tiled(ctx, H, p.y*H, yy => {
    ctx.save();
    ctx.translate(cx, yy); ctx.rotate(ang);
    ctx.globalCompositeOperation = "lighter";
    // Two tails: a broad diffuse one and a tight bright one inside it. A single
    // hard-edged wedge read as a drawn triangle rather than as dust.
    for(let s = 0; s < 2; s++){
      const spread = s ? 8.5 : 3.2, alpha = s ? 0.13 : 0.5, ln = s ? len : len*0.72;
      const g = ctx.createLinearGradient(0, 0, -ln, 0);
      g.addColorStop(0, rgba(p.color || "#cfe9ff", alpha));
      g.addColorStop(0.22, rgba(p.color || "#cfe9ff", alpha*0.32));
      g.addColorStop(1, rgba(p.color || "#cfe9ff", 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -head*0.8);
      ctx.quadraticCurveTo(-ln*0.5, -head*spread*0.5, -ln, -head*spread);
      ctx.lineTo(-ln, head*spread);
      ctx.quadraticCurveTo(-ln*0.5, head*spread*0.5, 0, head*0.8);
      ctx.closePath(); ctx.fill();
    }
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, head*4.2);
    hg.addColorStop(0, "rgba(255,255,255,0.98)");
    hg.addColorStop(0.28, rgba(p.color || "#cfe9ff", 0.6));
    hg.addColorStop(1, rgba(p.color || "#cfe9ff", 0));
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, head*4.2, 0, TAU); ctx.fill();
    ctx.restore();
  });
}

/*
 * The Devourer, seen from a long way off. Painted into the SKY of the
 * approach mission - a black bulk with a ring of cold running lights and one
 * red eye, too big to fight, hanging where their star used to be. Nothing
 * else in the game is drawn into the backdrop like this; it exists so the
 * mission before the finale is spent looking at what is coming.
 */
function drawDevourerSilhouette(ctx, W, H, p){
  const cx = W*p.x, R = W*p.r;
  // Tiled like every other prop: the 2.4R eclipse shade reaches past the
  // canvas edge, and an untiled clip there put a hard shadow line on the wrap.
  tiled(ctx, H, H*p.y, cy => {
    ctx.save();
    // The eclipse it casts: everything behind it goes darker.
    const shade = ctx.createRadialGradient(cx, cy, R*0.4, cx, cy, R*2.4);
    shade.addColorStop(0, "rgba(0,0,0,0.85)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(cx - R*2.4, cy - R*2.4, R*4.8, R*4.8);

    // Hull: a squat hexagonal bulk with shoulder arms.
    ctx.fillStyle = "#05060e";
    ctx.beginPath();
    ctx.moveTo(cx - R,       cy - R*0.28);
    ctx.lineTo(cx - R*0.52,  cy - R*0.78);
    ctx.lineTo(cx + R*0.52,  cy - R*0.78);
    ctx.lineTo(cx + R,       cy - R*0.28);
    ctx.lineTo(cx + R*0.66,  cy + R*0.72);
    ctx.lineTo(cx - R*0.66,  cy + R*0.72);
    ctx.closePath(); ctx.fill();
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(cx + s*R*0.88, cy - R*0.34);
      ctx.lineTo(cx + s*R*1.5,  cy - R*0.10);
      ctx.lineTo(cx + s*R*1.42, cy + R*0.30);
      ctx.lineTo(cx + s*R*0.80, cy + R*0.34);
      ctx.closePath(); ctx.fill();
    });

    // Cold running lights along the shoulders, and the eye.
    ctx.fillStyle = "rgba(120,180,255,0.5)";
    for(let i = 0; i < 9; i++){
      const t = i/8;
      ctx.fillRect(cx - R*0.52 + t*R*1.04, cy - R*0.74, R*0.03, R*0.03);
    }
    ctx.globalCompositeOperation = "lighter";
    const eye = ctx.createRadialGradient(cx, cy + R*0.02, 0, cx, cy + R*0.02, R*0.42);
    eye.addColorStop(0, "rgba(255,70,90,0.85)");
    eye.addColorStop(0.4, "rgba(255,40,70,0.25)");
    eye.addColorStop(1, "rgba(255,0,40,0)");
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(cx, cy + R*0.02, R*0.42, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

/*
 * A rock field, LIT.
 *
 * The old painter filled every chunk with one flat slate and ran one flat line
 * round it, so a field came out as a scatter of paper cutouts - black holes
 * punched in the sky rather than things floating in front of it. That painter
 * is used by eighteen props across thirteen missions, which made it the single
 * most hand-made thing left in the backdrop.
 *
 * Four cheap things make a lump into a stone:
 *  - a FILL that ramps lit-to-dark along the sky's own light vector, the same
 *    one the planets use, so a field and the planet beside it agree about
 *    where the light is coming from;
 *  - a RIM lit per edge by how squarely that edge faces the light, so the
 *    bright line wraps the lit limb and dies on the far side, instead of a
 *    uniform outline that reads as ink;
 *  - DEPTH from size: small chunks are far chunks, so they lose contrast
 *    against the sky rather than staying as black as the big ones;
 *  - a few BOULDERS. A field of identical gravel is a texture; a field with
 *    some big pieces in it is a place.
 *
 * `ice:true` swaps the material for something that catches light instead of
 * swallowing it - pale, harder-edged, with a glint on the biggest faces. It
 * is what makes Ice Fields an ice field.
 */
function drawRocks(ctx, W, H, p, rand, light, sky){
  const cx = p.x*W, r = p.r*W;
  const lx = light ? light[0] : -0.55, ly = light ? light[1] : -0.84;
  const ice = !!p.ice;
  /* Both ends of the material come out of the SKY, not out of this function:
     stone lit by an orange nebula is warm, and its shadow is the same dark the
     sky's own dust lanes are. A fixed slate made every field in the campaign
     look like it had been cut from the same grey card and pasted in - which,
     until now, it had. */
  const star = (sky && sky.star) || "#aebfd6";
  const soil = (sky && sky.dust) || "#0b0f1a";
  // The light itself is the sky's star colour carrying some of the nebula it
  // shines through - grey stone under an amber cloud comes back tan, and grey
  // stone under a silver one comes back silver. Then desaturated hard, because
  // rock is rock.
  const glow = (sky && sky.clouds && sky.clouds[1]) || star;
  const lit  = p.lit  || (ice ? "#e2f6ff" : mixHexHex(mixHexHex(star, glow, 0.35), "#5d6b82", 0.42));
  const dark = p.dark || (ice ? "#0a2231" : mixHexHex(soil, "#0b0f1a", 0.45));
  tiled(ctx, H, p.y*H, yy => {
    for(let i=0;i<p.n;i++){
      const a = rand()*TAU, d = Math.sqrt(rand())*r;
      const x = cx + Math.cos(a)*d, y = yy + Math.sin(a)*d*0.7;
      const big = rand() < 0.18;
      const rr = r*(big ? 0.085 + rand()*0.085 : 0.026 + rand()*0.048);
      // How near this chunk reads, from its size alone. Distant gravel keeps
      // only a third of the contrast, which is what stops a dense field from
      // turning into a black stain.
      const near = Math.max(0, Math.min(1, (rr/r - 0.026) / 0.13));
      const face = 0.34 + near*0.66;

      // Built once into arrays: the fill wants the path, and so does the
      // per-edge rim, and tracing it twice doubles the cost of the whole sky.
      const N = 6 + Math.floor(rand()*4);
      const vx = [], vy = [];
      for(let k=0;k<N;k++){
        const ka = k/N*TAU + rand()*0.22;
        // Ice fractures into flatter, straighter faces than rock crumbles into.
        const kr = rr*(ice ? 0.80 + rand()*0.34 : 0.66 + rand()*0.54);
        vx.push(x + Math.cos(ka)*kr); vy.push(y + Math.sin(ka)*kr);
      }
      ctx.beginPath();
      ctx.moveTo(vx[0], vy[0]);
      for(let k=1;k<N;k++) ctx.lineTo(vx[k], vy[k]);
      ctx.closePath();

      const g = ctx.createLinearGradient(x + lx*rr, y + ly*rr, x - lx*rr*1.15, y - ly*rr*1.15);
      g.addColorStop(0,    mixA(lit, dark, ice ? 0.04 : 0.22, 0.90*face + 0.06));
      g.addColorStop(0.42, mixA(lit, dark, ice ? 0.46 : 0.66, 0.93));
      g.addColorStop(1,    mixA(lit, dark, 1, 0.95));
      ctx.fillStyle = g;
      ctx.fill();

      /* The rim, edge by edge. `t` is the outward normal dotted with the light
         vector: +1 square on, 0 at the terminator, negative round the back. */
      ctx.lineWidth = big ? 1.4 : 1;
      for(let k=0;k<N;k++){
        const x1 = vx[k], y1 = vy[k], x2 = vx[(k+1)%N], y2 = vy[(k+1)%N];
        const nx = (x1+x2)*0.5 - x, ny = (y1+y2)*0.5 - y;
        const nl = Math.hypot(nx, ny) || 1;
        const t = (nx/nl)*lx + (ny/nl)*ly;
        if(t <= 0.03) continue;
        ctx.strokeStyle = rgba(lit, (ice ? 0.30 : 0.16) * t * face + 0.05*t);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }

      // Ice glints. Only on the boulders, and only on the lit shoulder - a
      // field where every chip sparkles reads as glitter, not as ice.
      if(ice && big){
        const sx = x + lx*rr*0.45, sy = y + ly*rr*0.45, sr = rr*0.42;
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        sg.addColorStop(0, rgba("#ffffff", 0.42*face));
        sg.addColorStop(1, rgba("#ffffff", 0));
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();
      }
    }
  });
}

// One scratch canvas shared by every build(): props composite here at full
// alpha before being dimmed and blitted. Reused, not per-prop - at dpr 2 a
// throwaway canvas per prop would dominate the ~170ms build budget.
let propLayer = null;

/*
 * Contract: returns null for a photo-backed mission (the renderer pans the
 * painted artwork instead). Otherwise the canvas is W*dpr x H*dpr device
 * pixels, drawn in logical W x H coordinates via ctx.scale(dpr, dpr) - the
 * vertical wrap is seamless at logical H whatever the dpr. Callers keep
 * their tiling math in logical units and blit with an explicit destination
 * size: drawImage(sky, 0, y, W, H), and again at y - H.
 */
function build(missionIndex, W, H, dpr = 1){
  const sky = SKIES[missionIndex % SKIES.length];
  if(sky.photo) return null;                       // the renderer uses the artwork
  return paint(sky, missionIndex*137 + 7, W, H, dpr, true);
}

/**
 * One painter, two customers: the scrolling mission skies (wrap:true) and the
 * menu's still frame (wrap:false). Splitting this out is what lets the title
 * screen use the game's OWN planets - banded, ringed, limb-lit - instead of
 * the hand-rolled sphere it used to draw for itself.
 */
function paint(sky, seed, W, H, dpr, wrap){
  wrapTiles = !!wrap;
  const rand = rngFor(seed);
  const cv = document.createElement("canvas");
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
  const ctx = cv.getContext("2d");
  if(!ctx) return cv;
  ctx.scale(dpr, dpr);

  // Base: essentially black. Real deep-space photographs are mostly empty and
  // the nebula is an event in the frame - filling the whole canvas with colour
  // is what made the first attempt look like wallpaper. The tints peak just
  // inside the edges, not at them: row 0 must equal row H or the wrap carries
  // a hard colour step through every scroll.
  /*
   * The sky's own colour used to appear at 0.22 and 0.14 alpha in two narrow
   * edge bands with hardcoded near-black everywhere between, so 27 of the
   * skies landed inside a 20-point luminance band and the campaign never
   * visibly travelled anywhere - every stop was the same dark room with a
   * different tint in the corners.
   *
   * Stops 0 and 1 stay black on purpose: row 0 must equal row H or the
   * vertical wrap carries a hard colour step through every scroll. The four
   * skies whose whole point is darkness carry lum:0.6 and stay where they
   * were, so they finally read as a deliberate contrast beat rather than as
   * the house style.
   */
  const lum = sky.lum === undefined ? 1 : sky.lum;
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, "#03030a");
  base.addColorStop(0.06, rgba(sky.clouds[2], 0.45 * lum));
  base.addColorStop(0.5, rgba(sky.clouds[1], 0.14 * lum));
  base.addColorStop(0.94, rgba(sky.clouds[0], 0.30 * lum));
  base.addColorStop(1, "#03030a");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Two bright regions the gas clusters around, so each sky has somewhere to
  // look rather than being uniformly lit.
  const cores = [
    { x: (0.2 + rand()*0.6)*W, y: (0.15 + rand()*0.3)*H, r: (0.3 + rand()*0.2)*W },
    { x: (0.2 + rand()*0.6)*W, y: (0.55 + rand()*0.3)*H, r: (0.25 + rand()*0.2)*W },
  ];

  /* --- emission clouds ---------------------------------------------------
     Many overlapping soft blobs in "lighter" build up structure the way a
     single gradient never can: where they pile up you get bright cores, where
     they thin out you get wisps. */
  ctx.globalCompositeOperation = "lighter";
  const blobs = Math.round(150 * sky.density);
  for(let i=0;i<blobs;i++){
    // Most gas clusters around a core; the rest drifts loose.
    let x, y;
    if(rand() < 0.68){
      const c = cores[rand() < 0.5 ? 0 : 1];
      const a2 = rand()*TAU, d = Math.pow(rand(), 1.7)*c.r;
      x = c.x + Math.cos(a2)*d; y = c.y + Math.sin(a2)*d*0.8;
    } else { x = rand()*W; y = rand()*H; }
    const r = (0.03 + Math.pow(rand(), 1.6)*0.26) * W;
    const col = sky.clouds[Math.floor(rand()*sky.clouds.length)];
    const a = (0.05 + rand()*0.09) * lum;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(0.45, rgba(col, a*0.35));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  // Filaments: stretched blobs that read as gas being pulled into strands.
  for(let i=0;i<Math.round(34*sky.density);i++){
    const c = cores[rand() < 0.5 ? 0 : 1];
    const x = c.x + (rand()-0.5)*c.r*2.2, y = c.y + (rand()-0.5)*c.r*2.2;
    const rx = (0.02 + rand()*0.07)*W, ry = rx*(2.5 + rand()*4);
    const ang = rand()*Math.PI;
    const col = sky.clouds[Math.floor(rand()*sky.clouds.length)];
    tiled(ctx, H, y, yy => {
      ctx.save();
      ctx.translate(x, yy); ctx.rotate(ang);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgba(col, 0.10));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.scale(1, ry/rx);
      ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
      ctx.restore();
    });
  }
  ctx.globalCompositeOperation = "source-over";

  /* --- dust lanes --------------------------------------------------------
     Dark blobs carved back out of the glow. Without these a nebula is just a
     coloured smear; the silhouettes are what make it look photographed. */
  for(let i=0;i<Math.round(60*sky.density);i++){
    const x = rand()*W, y = rand()*H;
    const r = (0.04 + rand()*0.22)*W;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(sky.dust, 0.72 + rand()*0.24));
      g.addColorStop(0.6, rgba(sky.dust, 0.34));
      g.addColorStop(1, rgba(sky.dust, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  /* --- stars -------------------------------------------------------------
     Three grades: a dense field of specks, a middle grade with a halo, and a
     handful of suns with diffraction spikes. The spikes are what sell it -
     real astrophotography has them, and they cost four lines. */
  /*
   * The counts were absolute - 165 specks whatever the field size - while the
   * live parallax layers in render.js scale by area off the same frame. So
   * the two star systems on screen disagreed about whether the sky was big,
   * and the generated backdrops came out about a tenth the density of the two
   * photographic ones sitting next to them in the campaign.
   *
   * Everything scales by area now, and a micro grade goes down FIRST so the
   * brighter grades land on top of it. sky.stars still gates the whole thing,
   * so the deliberately empty skies - The Long Dark at 0.45, The Bright Side
   * at 0.12 - stay empty and keep working as a contrast beat.
   */
  const areaK = (W*H) / (390*620);
  /*
   * TWO WAYS FOR A SKY TO GROW.
   *
   * Every star class used to be multiplied by areaK, which is right for dust
   * and wrong for feature stars. Dust IS a field: twice the sky, twice the
   * grains, or the big screen looks thin. But the handful of bright spiked
   * stars are COMPOSITION - they are the ones the eye picks out - and scaling
   * those with area turns a picture into confetti.
   *
   * Measured on the menu sky, which is the only one composed against the real
   * window: areaK is 1.4 on a phone and 8.6 on a 1920x1080 desktop. At 4 per
   * areaK that is 5 spiked stars on the phone, which is what the composition
   * was tuned for, and 34 on the desktop, which is what it actually looked
   * like. Under a square root the phone keeps its 5 and the desktop gets 12 -
   * a wider sky, not a busier one.
   *
   * The campaign skies build against the portrait playfield, so their areaK
   * barely moves and this changes them by about one star.
   */
  const featureK = Math.sqrt(areaK);
  const micro = Math.round(1400 * sky.stars * areaK);
  for(let i=0;i<micro;i++){
    ctx.globalAlpha = 0.05 + rand()*0.13;
    ctx.fillStyle = sky.star;
    ctx.fillRect(rand()*W, rand()*H, 1, 1);
  }
  ctx.globalAlpha = 1;

  const small = Math.round(700 * sky.stars * areaK);
  for(let i=0;i<small;i++){
    const x = rand()*W, y = rand()*H;
    const s = 0.6 + rand()*1.5;
    ctx.globalAlpha = 0.25 + rand()*0.6;
    ctx.fillStyle = rand() < 0.16 ? sky.star : "#ffffff";
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;

  // A star is a hard point with a tight glow. The first pass used a wide pale
  // halo and every one of them read as a grey bubble.
  const mid = Math.round(22 * sky.stars * areaK);
  for(let i=0;i<mid;i++){
    const x = rand()*W, y = rand()*H, r = 0.9 + rand()*1.1;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r*4);
      g.addColorStop(0, rgba(sky.star, 0.45));
      g.addColorStop(1, rgba(sky.star, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r*4, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(x, yy, r*0.75, 0, TAU); ctx.fill();
    });
  }

  /*
   * The suns' spikes TAPER. They were constant-width fillRects fading only
   * by gradient, and parallel silhouette edges read as drawn bars - every
   * bright star in the game was a plus sign. A diffraction spike is widest
   * at the core and thins to nothing, so each is a long four-point diamond.
   *
   * One spider angle per SKY, not per star: in a real photograph the spikes
   * come from the telescope, so every star in frame wears the same cross.
   * Per-star angles read as scattered sparkles; one shared tilt reads as a
   * camera. The vertical arm runs longer than the horizontal for the same
   * reason - a perfectly even plus is a symbol, an uneven cross is a flare.
   */
  const spiderTilt = (rand() - 0.5)*0.5;
  const spike = (len, wide, alpha) => {
    const sg = ctx.createLinearGradient(-len, 0, len, 0);
    sg.addColorStop(0,   rgba(sky.star, 0));
    sg.addColorStop(0.5, "rgba(255,255,255," + alpha + ")");
    sg.addColorStop(1,   rgba(sky.star, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-len, 0); ctx.lineTo(0, -wide); ctx.lineTo(len, 0); ctx.lineTo(0, wide);
    ctx.closePath(); ctx.fill();
  };
  for(let i=0;i<Math.round(sky.bright * featureK);i++){
    const x = rand()*W, y = rand()*H;
    const r = 1.6 + rand()*1.6, reach = r*(5 + rand()*4);
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, reach);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.10, rgba(sky.star, 0.42));
      g.addColorStop(1, rgba(sky.star, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, reach, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(x, yy);
      ctx.rotate(spiderTilt);
      ctx.globalCompositeOperation = "lighter";
      ctx.save(); ctx.rotate(Math.PI/2); spike(reach*1.9, r*0.34, 0.8); ctx.restore();
      spike(reach*1.35, r*0.30, 0.7);
      // The biggest suns earn a short faint diagonal pair - the "eight-point"
      // look the brightest star in an astrophoto has.
      if(r > 2.4){
        ctx.rotate(Math.PI/4);
        spike(reach*0.6, r*0.2, 0.35);
        ctx.rotate(Math.PI/2);
        spike(reach*0.6, r*0.2, 0.35);
      }
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    });
  }
  /* --- furniture ---------------------------------------------------------
     Drawn after the stars, because a planet is much nearer than they are.
     Props render at FULL alpha into the shared scratch layer, get pulled
     down in place (source-atop black keeps coverage, cuts brightness ~35%),
     then blit over the sky opaquely. The old way - 62% globalAlpha on the
     whole pass - kept scenery dim but let stars and nebula shine straight
     through solid bodies, and every planet read as a ghost hologram. Same
     dimness, real occlusion; scenery still never competes with bullets. */
  /* --- GOD RAYS -----------------------------------------------------------
   *
   * Shafts fanning out of the brighter core. The skies have had a light
   * DIRECTION for a while - the planets, the rocks and the ring all obey it -
   * and this is the first thing that makes that direction visible: you can
   * see where the light in this place is coming from.
   *
   * Baked, so they cost nothing forever. Anchored ON the core and fading out
   * along their length, because the lesson from the aurora's first draft is
   * that a shaft floating in open sky reads as a grey bar, and what sells it
   * is being visibly attached to something bright.
   *
   * Skipped on the surface sky (a canyon floor has no shafts across it) and
   * on the near-black ones, where any addition is just fog.
   */
  if(!sky.surface && (sky.lum || 1) >= 0.75){
    const core = cores[0].r >= cores[1].r ? cores[0] : cores[1];
    const rays = 7;
    // A shaft has to END somewhere the eye can see it end. The first draft ran
    // to 1.6x the sky's width, so every ray left the frame still lit and went
    // back to reading as a grey bar laid across the picture - the exact
    // failure this was written to avoid.
    const reach = Math.min(W, H) * 0.9;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(core.x, core.y);
    const spin = rand()*TAU;
    for(let i = 0; i < rays; i++){
      // Wide angular jitter and a skewed alpha spread: evenly spaced arms of
      // equal brightness read as a clock face, not as light. Most shafts
      // should be faint and one or two should carry the frame.
      const a2 = spin + (i/rays)*TAU + (rand() - 0.5)*(TAU/rays)*0.8;
      const len = Math.min(reach, core.r*(1.1 + rand()*1.3));
      const wide = 0.05 + rand()*0.075;                 // half-angle, radians
      const al = (0.035 + Math.pow(rand(), 1.7)*0.085) * Math.min(1.2, sky.lum || 1);
      /*
       * Soft SIDES, the cheap way. A single gradient-filled wedge fades along
       * its length but its two long edges stay razor-straight, so it reads as
       * a triangle someone cut out and laid down rather than as a shaft of
       * light. Three nested wedges - widest faintest, narrowest brightest -
       * build a falloff ACROSS the shaft instead of a step. Three is enough:
       * at these alphas, over nebula noise, the banding is invisible.
       */
      for(let L = 0; L < 3; L++){
        const w = wide * (1 - L*0.32);
        const g = ctx.createLinearGradient(0, 0, Math.cos(a2)*len, Math.sin(a2)*len);
        g.addColorStop(0,    rgba(sky.star, 0));
        g.addColorStop(0.14, rgba(sky.star, al*0.36));
        g.addColorStop(0.55, rgba(sky.star, al*0.20));
        g.addColorStop(1,    rgba(sky.star, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a2 - w)*len, Math.sin(a2 - w)*len);
        ctx.lineTo(Math.cos(a2 + w)*len, Math.sin(a2 + w)*len);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  const props = sky.props || [];
  if(props.length){
    if(!propLayer) propLayer = document.createElement("canvas");
    if(propLayer.width !== cv.width) propLayer.width = cv.width;
    if(propLayer.height !== cv.height) propLayer.height = cv.height;
    const px = propLayer.getContext("2d");
    if(px){
      px.setTransform(dpr, 0, 0, dpr, 0, 0);       // reused canvas: reset, then logical coords
      px.clearRect(0, 0, W, H);
      // Planets light from the nearer nebula core (computed from the base
      // position, not per wrap copy, so the tiled copies match).
      const coreDir = (x, y) => {
        const c = (cores[0].x-x)*(cores[0].x-x) + (cores[0].y-y)*(cores[0].y-y) <=
                  (cores[1].x-x)*(cores[1].x-x) + (cores[1].y-y)*(cores[1].y-y) ? cores[0] : cores[1];
        const dx = c.x - x, dy = c.y - y, d = Math.hypot(dx, dy) || 1;
        return [dx/d, dy/d];
      };
      props.forEach(pr => {
        if(pr.k === "planet") drawPlanet(px, W, H, pr, rand, coreDir(pr.x*W, pr.y*H), dpr);
        else if(pr.k === "sun") drawSun(px, W, H, pr);
        else if(pr.k === "galaxy") drawGalaxy(px, W, H, pr, rand);
        // Rocks light from the same core the planets do, and borrow the sky's
        // own star tint, so a field belongs to the sky it is floating in
        // instead of being the same slate grey in all thirteen of them.
        else if(pr.k === "rocks") drawRocks(px, W, H, pr, rand, coreDir(pr.x*W, pr.y*H), sky);
        else if(pr.k === "aurora") drawAurora(px, W, H, pr, rand);
        else if(pr.k === "wreck") drawWreck(px, W, H, pr, rand);
        else if(pr.k === "pillars") drawPillars(px, W, H, pr, rand);
        else if(pr.k === "comet") drawComet(px, W, H, pr);
        else if(pr.k === "devourer") drawDevourerSilhouette(px, W, H, pr);
        else if(pr.k === "ring") drawRing(px, W, H, pr, rand);
        else if(pr.k === "eggs") drawEggs(px, W, H, pr, rand);
        else if(pr.k === "station") drawStation(px, W, H, pr, rand);
        else if(pr.k === "vortex") drawVortex(px, W, H, pr, rand);
        else if(pr.k === "ground") drawGround(px, W, H, pr, rand);
      });
      px.globalCompositeOperation = "source-atop";
      px.fillStyle = "rgba(0,0,0,0.35)";
      px.fillRect(0, 0, W, H);
      px.globalCompositeOperation = "source-over";
      ctx.drawImage(propLayer, 0, 0, W, H);
    }
  }

  // No baked vignette: this texture tiles vertically, and baked-in dark
  // corners scrolled past as a seam band. The live screen-space vignette in
  // render.js does the job in the coordinate space a vignette belongs in.
  return cv;
}

/*
 * THE MENU SKY.
 *
 * Not a SKIES entry on purpose: the campaign list is a contract (one sky per
 * stop, all distinct) and the menu is not a stop. It is also the only sky
 * composed against the REAL window shape rather than a fixed portrait frame -
 * every distance is a fraction of u, the short side, so the same picture
 * reads on a phone held upright and on a laptop in landscape instead of
 * being cropped to whichever third happened to fit.
 */
const TITLE_SKY = {
  name:"The Home Sky", clouds:["#3b2a7a","#1e6aa8","#7c3aed"], dust:"#05061a",
  star:"#dbeafe", density:0.9, stars:1.15, bright:4,
};
function buildTitle(W, H, dpr = 1, topH = 0){
  // topH is the first screenful. The canvas covers the menu's whole SCROLL
  // now, so composing in fractions of H would drop the good furniture below
  // the fold; the show anchors to the viewport, the giant anchors to the
  // very bottom (where SETTINGS and FULLSCREEN live), and the road between
  // gets its own quiet props.
  const vh = Math.min(H, topH || H);
  const u = Math.min(W, vh);
  const rx = k => (k*u)/W;                     // a radius in units of the short side
  const props = [
    // Depth first: a galaxy high on the left, so the corner the wordmark sits
    // over has something behind it other than black.
    { k:"galaxy", x:0.17, y:(0.20*vh)/H, r:rx(0.34) },
    /*
     * The world below - an amber giant off the bottom of the whole scroll, so
     * the LAST buttons sit on a lit planet limb rather than on page ground.
     *
     * Hazed back from #d9a441/#33200a. Its tone was never extreme - 169
     * against the little moon's 178 - but it is drawn at r=0.55 where the
     * moon is r=0.055, so it covers a HUNDRED times the area, and what pulls
     * an eye across a frame is brightness times area. It was the brightest
     * thing on the menu after the wordmark, sitting in a corner where nothing
     * happens. Mixed 30% toward the sky's own deep tone, which drops it to
     * 120 - just under the ringed planet, which is the right order for the
     * furthest thing in the picture - and cools it slightly on the way, so
     * the distance reads as distance rather than as dimming.
     */
    { k:"planet", x:0.12, y:(H + 0.31*u)/H, r:rx(0.55),
      lit:"#997535", dark:"#25180f" },
    // A ringed neighbour, small and high right: the "designed" note that says
    // somebody chose this view.
    { k:"planet", x:0.87, y:(0.21*vh)/H, r:rx(0.10),
      lit:"#8b6bd8", dark:"#241245", rings:true },
    // A cratered moon low right, balancing the giant across the frame.
    { k:"planet", x:0.82, y:(0.63*vh)/H, r:rx(0.055),
      lit:"#9fb4d8", dark:"#161d2e", craters:true },
    // A far sun near the bottom - the warm accent by the last buttons.
    { k:"sun", x:0.93, y:(H - 0.14*vh)/H, r:rx(0.018), color:"#ffd9a0" },
  ];
  if(H > vh*1.35){                             // the scroll's middle third
    props.push({ k:"planet", x:0.20, y:(vh*1.05 + (H - vh)*0.45)/H, r:rx(0.07),
                 lit:"#5eead4", dark:"#134e4a", crescent:true });
    props.push({ k:"galaxy", x:0.78, y:(vh*1.0 + (H - vh)*0.7)/H, r:rx(0.22) });
  }
  const sky = Object.assign({}, TITLE_SKY, { props });
  return paint(sky, 4242, W, H, dpr, false);
}

/** Which asset a photo-backed mission uses, or null when it's generated. */
function photoFor(missionIndex){
  return (SKIES[missionIndex % SKIES.length] || {}).photo || null;
}

/** True when this mission is flown over a surface rather than through space.
 *  The renderer switches off the star field, the comets and the streaming dust
 *  for it - stars over a canyon floor is the one detail that would undo the
 *  whole illusion. */
function isSurface(missionIndex){
  return !!(SKIES[missionIndex % SKIES.length] || {}).surface;
}

SF.skygen = { build, buildTitle, photoFor, isSurface, SKIES };
})();
