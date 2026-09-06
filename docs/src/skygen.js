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
/*
 * ONE EARTH, THREE SCREENS.
 *
 * Our own planet now has to appear in the menu's backdrop, in the sky over
 * the first patrol, and on Launch Day's stop on the map - and a child has to
 * read all three as the SAME world, not as three blue planets. So the
 * palette lives here, once, and everything that draws Earth takes it from
 * this pair. The night hint and the atmosphere's rim glow are both derived
 * from `lit` inside the painter, which is why Earth's limb goes blue.
 *
 * Declared above the table on purpose: SKIES is built the moment this file
 * loads, so anything it names has to exist by then.
 */
const EARTH_LIT = "#5b9bd5", EARTH_DARK = "#0a1a30";

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
    /*
     * And the world hanging in it is HOME, because of where this mission
     * sits in the story now. Launch Day happens on Earth; First Patrol is
     * the very next thing that happens, minutes after the squadron went
     * wheels-up chasing the people who took the sky. An anonymous grey
     * crescent hung there before Earth existed in this game and read as
     * "somewhere in space" - which is the one thing this flight is not.
     * Lit rather than crescent, and low, so it is unmistakably our planet
     * and still well clear of where the first wave comes down.
     */
    /*
     * `once`, and this is the one the family actually reported: "on level 1 I
     * want earth to only appear once. Right now there are multiple earth
     * which makes no sense."
     *
     * The backdrop is a vertically TILING texture, so everything baked into
     * it comes round again - and `tiled` draws each prop at y and y-H, so a
     * planet hung this low reaches the frame from the top at the same moment
     * it is sitting at the bottom. Two Earths, in one sky, at once.
     *
     * On its own layer it goes past exactly once and is gone, which is also
     * what this mission is: minutes after wheels-up, climbing away from home.
     */
    props:[ {k:"galaxy", x:0.26, y:0.20, r:0.22},
            {k:"planet", x:0.74, y:0.78, r:0.160, lit:EARTH_LIT, dark:EARTH_DARK, earth:true, once:true},
            /*
             * The moon and the sun ride WITH Earth, and this is what the
             * once-layer's parallax costs if you forget it: "the moon goes
             * down the screen faster than earth on level 1". It did - Earth
             * had moved to the slow layer and the moon had not, so two round
             * bodies sitting side by side at the same obvious distance were
             * travelling at four times the rate of each other.
             *
             * The rule this settles: the tiling layer is the dust you fly
             * THROUGH, and the once-layer is the bodies you fly PAST. A thing
             * with an edge on it belongs on the second one. Only the galaxy
             * stays behind, because a galaxy really is at infinity and a
             * diffuse smear has no edge to catch the eye repeating.
             */
            {k:"planet", x:0.18, y:0.80, r:0.042, lit:"#a09bbd", dark:"#14121e", craters:true, once:true},
            {k:"sun",    x:0.86, y:0.15, r:0.026, color:"#e8cf86", once:true} ] },


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
    /*
     * ...and this one is Earth as well, because the paragraph above always
     * said it was - "the family's own world" - and until Launch Day existed
     * there was nothing to hold it to. A banded blue giant was a fine guess
     * at home when home was never seen up close; now that a child has flown
     * over its fields, the world on this stop has to be the same one. The
     * aurora above keeps its place: our pole is where auroras happen.
     */
    props:[ {k:"planet", x:0.50, y:0.78, r:0.34, lit:EARTH_LIT, dark:EARTH_DARK, earth:true},
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

  /*
   * OVER THE FARM - Earth, dawn, the morning the campaign starts.
   *
   * Appended at the END of the list on purpose: the campaign's sky lookup
   * goes through mission.sky now (see missions.js), and the family's saved
   * Drawing Board skies store a bare SKIES index - inserting at the front
   * would repaint every drawing they have ever made onto the wrong base.
   *
   * The one sky in the game with weather instead of space: the wash is a
   * dawn - gold low, rose through the middle, morning blue up top - and
   * `surface:true` keeps the stars and comets out of it, because this is
   * the only morning the game spends under an atmosphere. The ground is
   * the same painter as the Red Canyon floor wearing field colours, and
   * the sun sits low and heavy the way it does at six in the morning.
   */
  { name:"Over the Farm", surface:true,
    /*
     * A surface sky IS the ground seen from above (the Red Canyon set the
     * rule), so there is no horizon to hang a sun on - the dawn has to live
     * in the land itself: long-shadow gold-green fields under a warm wash,
     * bright enough that Earth reads as morning next to the Canyon's dusk.
     */
    clouds:["#f0b168","#dd8f7e","#7f9cc8"], dust:"#18220f", star:"#fff2d8",
    lum:1.3, density:0.8, stars:0, bright:0,
    // The ground tiles; home does not. See drawFarm for why the split exists.
    props:[ {k:"fields", x:0.50, y:0.50, dark:"#2a3418"},
            {k:"farm",   x:0.50, y:0.50, once:true} ] },

  /*
   * GREENFALL (Second Harvest) - the taken world. Appended at the end for
   * the same reason Earth was: the Drawing Board's saves hold bare sky
   * indices, and inserting mid-list would repaint the family's drawings
   * onto shifted bases. The empty farmstead passes once, like home does.
   */
  { name:"Greenfall", surface:true,
    clouds:["#3f7d5a","#79c9a2","#16281c"], dust:"#0a140c", star:"#eaffea",
    lum:1.0, density:0.85, stars:0, bright:0,
    props:[ {k:"wild", x:0.50, y:0.50, dark:"#101c12"},
            {k:"ruin", x:0.50, y:0.50, once:true} ] },

  /*
   * THE DROWNED SKY (The Dive) - the other side of the crack, where the sky
   * river landed as a sea. Appended at the end for the same reason the farms
   * were: the Drawing Board's saves hold bare sky indices.
   *
   * The third surface in the game and the first one that is not land: the
   * "ground seen from above" rule holds, but the ground is an ocean floor -
   * sand, kelp, coral, one trench - under a water column the live layer
   * (dive.js) fills with light shafts, fish and bubbles. The sunken flagship
   * passes once, the way home's farm does.
   */
  { name:"The Drowned Sky", surface:true,
    clouds:["#0f4a5e","#2aa5b8","#052030"], dust:"#03141c", star:"#d8fbff",
    lum:1.0, density:0.8, stars:0, bright:0,
    props:[ {k:"seabed",  x:0.50, y:0.50},
            {k:"drowned", x:0.50, y:0.50, once:true} ] },

  /*
   * EMBERFALL (The Forge World) - the world the Foundry drills its fire out
   * of, and the fourth surface. Appended at the end, same Drawing Board
   * index rule as every ground before it.
   *
   * The darkest floor in the game carrying its brightest lines: black basalt
   * veined with lava rivers (full-height and wrap-exact, like the sea's
   * trench), cinder cones, their drill rigs tapping the veins - and the
   * fortified forge-city in its caldera passes once. The eruptions are not
   * painted here: volcano.js owns everything that moves and everything that
   * hurts.
   */
  { name:"Emberfall", surface:true,
    clouds:["#8a2f0e","#ff8a3c","#2a0d06"], dust:"#0c0503", star:"#ffe4c8",
    lum:1.0, density:0.8, stars:0, bright:0,
    props:[ {k:"emberfloor", x:0.50, y:0.50},
            {k:"forgecity",  x:0.50, y:0.50, once:true} ] },

  /*
   * SUNSTRUCK (The Mirage) - the desert on the far shore of the drowned sky,
   * and the fifth surface. Appended at the end, same Drawing Board index rule
   * as every ground before it.
   *
   * The brightest floor in the game, and the only one whose LIGHT is the
   * mechanic: the sun stands high and to the upper left, every dune crest,
   * rock and tower is lit from there and shadowed down-right, and that is
   * exactly the light mirage.js throws the ships' shadows by - so a shadow
   * on the sand reads as sitting ON the sand. A dry riverbed runs the full
   * height (the trench rule: position and slope agree at the wrap), and
   * their mirror towers stand over the dunes, all tipped at the sun. The
   * once-layer is the Sun-Catcher: the mirror field that bakes the air, on
   * its salt pan. The mirages are not painted here - mirage.js owns
   * everything that shimmers.
   */
  { name:"Sunstruck", surface:true,
    clouds:["#f2cf8a","#d9a85f","#b8813f"], dust:"#f6dfae", star:"#fff3d6",
    lum:1.0, density:0.8, stars:0, bright:0,
    props:[ {k:"dunes",      x:0.50, y:0.50},
            {k:"suncatcher", x:0.50, y:0.50, once:true} ] },

  /*
   * FROSTFALL (Whiteout) - the night side of the desert world, where the
   * light the thieves took never reached and the sea froze where it stood.
   * The sixth surface, appended at the end, same Drawing Board index rule.
   *
   * The desert's opposite in every way that matters: no sun, so no hard
   * shadows - a pale blue ambient from the sky the world lost, and soft
   * pools under things instead of thrown shapes. The one thing that crosses
   * the whole floor is the FROZEN RIVER (full height, wrap-exact, the trench
   * rule), black ice with white cracks running through it. Pressure ridges
   * cross the sheet the way the dune crests crossed the sand; snow drifts
   * comb one way; and their heat drills stand over the ice, the only warm
   * colour on the world, melting a ring each. The once-layer is the Frozen
   * Fleet: a lake with their ships locked in it where the cold caught them -
   * the level's rule, written on the ground before a front ever rolls.
   */
  { name:"Frostfall", surface:true,
    clouds:["#dceaf5","#a9c4dc","#5f7f9c"], dust:"#f4f9ff", star:"#ffffff",
    lum:1.0, density:0.8, stars:0, bright:0,
    props:[ {k:"icefield",    x:0.50, y:0.50},
            {k:"frozenfleet", x:0.50, y:0.50, once:true} ] },

  /*
   * THE THRESHOLD (The Moon of Doors) - an airless moon, and the first
   * surface in the campaign that somebody BUILT on. The seventh surface,
   * appended at the end, same Drawing Board index rule.
   *
   * Airless means the light is honest: one sun low over the top-right
   * corner and no haze to soften it, so every stone throws a hard black
   * shadow down-left and every crater keeps a bright lip on the sun side
   * and a black wall on the other. That one rule - hard light, one
   * direction - is what makes the moon read as a moon and not as the
   * desert with its colour taken out. Two paved AVENUES cross the dust
   * (full height, wrap-exact, the trench rule) with rune veins still alive
   * in the joints; standing stones, fallen door-rings and dead sockets lie
   * between them. The once-layer is the Great Arch: two monoliths and a
   * cracked lintel over the dormant master door, their shadows raking the
   * plaza, one of their ships crashed at its edge - the level's rule,
   * written on the ground before the first pair of doors ever lights.
   */
  { name:"The Threshold", surface:true,
    clouds:["#8a84a3","#5f5a78","#33304a"], dust:"#dcd7ee", star:"#ffffff",
    lum:1.0, density:0.8, stars:0, bright:0,
    props:[ {k:"moonfloor", x:0.50, y:0.50},
            {k:"greatarch", x:0.50, y:0.50, once:true} ] },

  /*
   * THE GEODE (The Glow Cave) - under the moon, the whole world is hollow
   * and it glows. The eighth surface, appended at the end, same rule.
   *
   * The moon's opposite: no sun at all, so nothing throws a shadow - the
   * light comes UP, out of the things on the floor. A luminous stream
   * crosses the tile (full height, wrap-exact) and lights its own banks,
   * veins of violet mineral run through the rock, fungi glow in the
   * hollows, and where the ceiling has cracked a shaft of daylight lands
   * as a pale pool. The crystal clusters the level plays with are drawn
   * live by crystals.js over this floor, so the rock stays deep enough for
   * them to shine. The once-layer is the Great Geode: a ring of giant
   * shards around a glowing pool under one shaft of daylight, with their
   * rig on the shore and one shard already sawn off and loaded.
   */
  { name:"The Geode", surface:true,
    clouds:["#2e2546","#1f1830","#130d22"], dust:"#b48cff", star:"#8ff0ff",
    lum:1.0, density:0.8, stars:0, bright:0,
    props:[ {k:"cavefloor",  x:0.50, y:0.50},
            {k:"greatgeode", x:0.50, y:0.50, once:true} ] },
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

/*
 * How big a sprite a planet is allowed to bake into.
 *
 * The disc is drawn one pixel at a time, so this caps the loop - and it used
 * to be a flat 384, which is fine for a moon and ruinous for anything large.
 * Measured on the menu sky at 1500x860 on a 3x screen, the sprite each prop
 * got against the size it was blitted at:
 *
 *     moon          1x    crisp
 *     ringed        2.6x
 *     galaxy        5.7x
 *     amber giant   9.2x  <- a 384px disc stretched across 2838 device px
 *
 * That last one is the whole reason the big planet read as an out-of-focus
 * smudge rather than a world: every bit of surface the renderer computed was
 * being smeared nine times its own width. A galaxy survives it because a
 * galaxy IS a blur; a planet has a limb, and a limb has to be sharp.
 *
 * So the cap scales with the body instead of being flat, bounded at both
 * ends: never below the old 384, so nothing gets worse, and never above 960,
 * because the loop is O(S^2) and this is baked on the menu's critical path.
 */
function spriteCapFor(extL, dpr){
  return Math.max(384, Math.min(704, Math.ceil(extL*2*dpr)));
}
function drawPlanetHD(ctx, W, H, p, rand, lightDir, dpr){
  const rL = p.r * W;                                    // logical radius
  const extL = rL * (p.rings ? 1.95 : 1.25);             // sprite half-extent
  const cap = spriteCapFor(extL, dpr);
  const scale = Math.min(dpr, cap / (2*extL)) || 1;      // device px per logical
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
      } else if(p.earth){
        /*
         * EARTH, and only Earth.
         *
         * Every other world here takes its colours from the sky it hangs in,
         * because every other world is a mood. This one is a place the family
         * actually lives, and it has to be recognised - by a seven-year-old,
         * at a glance, in three different sizes on three different screens -
         * so it ignores the palette and paints the four cues in the order a
         * child reads them: blue ocean, white weather, green-and-tan land,
         * and ice at both ends.
         */
        const e = fbm3(qx*1.05, qy*1.05, qz*1.05, seed, 5);
        const SEA = 0.47;
        if(e < SEA){
          const t = sstep(SEA - 0.15, SEA, e);       // deep water up onto the shelf
          r = 16 + 30*t; g = 54 + 66*t; b = 108 + 62*t;
        } else {
          const t = Math.min(1, (e - SEA)/0.24);     // green lowland into dry tan
          r = 58 + 126*t; g = 108 + 54*t; b = 46 + 44*t;
          if(t > 0.86){ const s2 = (t - 0.86)/0.14;  // and bare ground up top
            r += (222-r)*s2; g += (220-g)*s2; b += (206-b)*s2; }
        }
        const ice = sstep(0.72, 0.88, Math.abs(lat));
        r += (238-r)*ice; g += (245-g)*ice; b += (252-b)*ice;
        // The weather. One layer of swirled white is the whole difference
        // between a blue marble and a blue ball.
        const cl = fbm3(qx*1.7 + 40, qy*1.7 + 40, qz*1.7 + 40, seed + 91, 4);
        const cf = sstep(0.50, 0.74, cl) * 0.9;
        r += (250-r)*cf; g += (252-g)*cf; b += (255-b)*cf;
        /*
         * ...and one knob to push the whole world back into the distance.
         * The menu's copy sits in a corner where nothing happens, at a
         * hundred times the area of anything near it, and brightness times
         * area is what pulls an eye across a frame - the amber giant it
         * replaced was hazed for exactly this reason and Earth is brighter.
         */
        if(p.haze){ const hz = p.haze;
          r += (Dk[0]-r)*hz; g += (Dk[1]-g)*hz; b += (Dk[2]-b)*hz; }
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

/*
 * The two places that are not part of a generated sky take Earth as a
 * baked sprite. The campaign map redraws every frame, so a per-pixel planet
 * render per frame is out of the question; this bakes once per size and the
 * map just blits it. Fixed seed, because this is a specific world rather
 * than a roll - Earth looks the same every time you open the map.
 */
const earthCache = {};
function earthSprite(d){
  const key = Math.max(8, Math.round(d));
  if(earthCache[key]) return earthCache[key];
  const S = Math.round(key*1.3);                 // room for the atmosphere
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c2 = cv.getContext("2d");
  if(c2) drawPlanet(c2, S, S, { x:0.5, y:0.5, r:(key*0.5)/S, earth:true,
                                lit:EARTH_LIT, dark:EARTH_DARK },
                    m32(20260817), [-0.52, -0.5], 1);
  earthCache[key] = cv;
  return cv;
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

    if(p.earth){
      /*
       * Earth without a pixel buffer. The HD painter above is the real one;
       * this is what a browser that will not hand back an ImageData gets,
       * and it still has to say "that's us" - so it draws the same four
       * cues by hand: land masses, weather over them, and both ice caps.
       */
      for(let i = 0; i < 7; i++){                       // continents
        const a = rand()*TAU, d = Math.sqrt(rand())*r*0.72;
        const bx = cx + Math.cos(a)*d, by = yy + Math.sin(a)*d*0.9;
        const br = r*(0.16 + rand()*0.20);
        ctx.fillStyle = rand() < 0.45 ? "rgba(150,138,74,0.85)" : "rgba(74,124,58,0.85)";
        ctx.beginPath();
        ctx.ellipse(bx, by, br, br*(0.55 + rand()*0.5), rand()*TAU, 0, TAU);
        ctx.fill();
      }
      for(let i = 0; i < 9; i++){                       // weather over the top
        const a = rand()*TAU, d = Math.sqrt(rand())*r*0.86;
        const bx = cx + Math.cos(a)*d, by = yy + Math.sin(a)*d*0.92;
        const br = r*(0.10 + rand()*0.17);
        const cg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        cg.addColorStop(0, "rgba(255,255,255,0.7)");
        cg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      }
      [-1, 1].forEach(s => {                            // both caps
        const g2 = ctx.createRadialGradient(cx, yy + s*r, 0, cx, yy + s*r, r*0.5);
        g2.addColorStop(0, "rgba(244,250,255,0.9)");
        g2.addColorStop(1, "rgba(244,250,255,0)");
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(cx, yy + s*r, r*0.5, 0, TAU); ctx.fill();
      });
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
/*
 * FARMLAND, from altitude - Mission 0's Earth.
 *
 * The canyon painter above makes rock; run in green it made a night swamp.
 * What sells "home" from a cockpit is the thing every child has seen from a
 * plane window: a PATCHWORK - fields in different stages of the season, some
 * cut gold, some young green, stitched with hedgerows, a dirt lane, and
 * copses of trees throwing morning shadows.
 *
 * Two facts of real farmland carry the whole picture. Nothing is surveyed
 * equal - every field is its own size, so both the row heights and each
 * row's divisions are dealt separately. And roads are STRAIGHT: a lane
 * follows a field boundary for as long as the boundary runs and turns only
 * where something makes it turn. So the road here IS a field edge, every
 * row lines its fields up against it, and the only turnings on the map are
 * a T-junction with a side lane and the short track into the farmyard -
 * where the workshop's lights are still on and the morning's ships are
 * already wheeled out beside the airstrip.
 *
 * Same two disciplines as the canyon: drawn once (never through `tiled`),
 * and periodic in H by construction - row 0 starts at 0 and the last row
 * ends exactly at H so the wrap seam lands on a hedgerow, the lane leaves
 * the top at the same x it enters the bottom, and every copse near an edge
 * is repeated at the far one. The dawn is baked in last: a warm wash from
 * the key-light side, varying only in x, so the land agrees with every lit
 * hull in the game about where the sun is.
 */
/*
 * THE LIE OF THE LAND, decided once and shared.
 *
 * The farm is leaving the tiling ground for its own pass-once layer (a
 * landmark repeating every wrap is what "you should only see the farm once"
 * is about), which means two different bakes now have to agree on where the
 * lane runs and which field is the home paddock. They cannot share the
 * paint stream - each bake only runs its own props, so the streams sit at
 * different positions - so the plan draws from its OWN fixed seed instead.
 * Same numbers in both bakes, by construction, forever.
 */
function fieldPlan(W, H, seed){
  const rand = rngFor(seed || 90400077);
  const ROWS = 12;
  const homeRow = 2 + Math.floor(rand()*3);
  const rowE = [0];
  { const raw = []; let acc = 0;
    for(let r = 0; r < ROWS; r++){
      const w = r === homeRow ? 2.0 : 0.55 + rand()*1.0;
      raw.push(w); acc += w;
    }
    let y = 0;
    for(let r = 0; r < ROWS; r++){ y += raw[r]/acc*H; rowE.push(y); }
    rowE[ROWS] = H; }
  const laneX = W*(0.34 + rand()*0.10);
  const sideY = rowE[Math.min(homeRow + 4 + Math.floor(rand()*3), ROWS - 1)];
  const padX0 = laneX, padX1 = laneX + W*0.34 < W*0.93 ? laneX + W*0.34 : W;
  // The yard's own geometry rides along: the ground pass needs it to keep
  // copses off the apron, and the farm pass needs it to build the apron.
  const y1 = rowE[homeRow];
  const ax0 = laneX + W*0.075, ay0 = y1 + 9, apW = W*0.105, apH = 40;
  const trackY = ay0 + apH*0.45;
  return { ROWS, homeRow, rowE, laneX, sideY, padX0, padX1, y1, ax0, ay0, apW, apH, trackY };
}

/*
 * One shared crown so the copses and the farm's windbreak match: dark
 * canopy, one lit arc on the key-light side, soft long shadow the other
 * way - the morning light, drawn twice so it cannot be missed. Shared
 * because the copses tile with the ground and the windbreak leaves with
 * the farm, and the two must still look planted by the same morning.
 */
function fieldTree(ctx, tx, ty, tr, pal){
  const P2 = pal || {};
  ctx.fillStyle = P2.shadow || "rgba(18,26,10,0.5)";
  ctx.beginPath(); ctx.ellipse(tx + tr*1.1, ty + tr*0.9, tr*1.15, tr*0.5, 0.6, 0, TAU); ctx.fill();
  ctx.fillStyle = P2.canopy || "#2c3d1c";
  ctx.beginPath(); ctx.arc(tx, ty, tr, 0, TAU); ctx.fill();
  ctx.strokeStyle = P2.rim || "rgba(255,214,140,0.5)";
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(tx, ty, tr - 0.8, Math.PI*1.05, Math.PI*1.75); ctx.stroke();
}

/*
 * THE FARM ITSELF - painted by the once-layer bake, not the tiling one.
 *
 * "On level 0 you should only see the farm once. It doesn't make sense to
 * see it multiple times." It didn't: the ground texture tiles (fields
 * repeating IS what countryside looks like from a cockpit), but the ground
 * carried the farmyard with it, so home came round again every wrap like a
 * carousel. The yard, the airstrip, the windbreak somebody planted and the
 * track that only exists to reach it are a LANDMARK, and a landmark is a
 * place you pass.
 *
 * It rides the once-layer at GROUND speed (see render.js: a surface sky's
 * once-layer moves with the ground, not at the far-plane crawl), glued to
 * the same paddock it was always drawn on - fieldPlan deals both bakes the
 * same land - and then it is behind you, which is what Launch Day is about.
 */
function drawFarm(ctx, W, H, p, rand){
  const { y1, ax0, ay0, apW, apH, trackY, laneX, padX1, rowE, homeRow } = fieldPlan(W, H);
  ctx.save();
  // The spur road leaves with the yard it serves - same two-pass cut as the
  // lanes it joins: dark banks first, the packed surface over them.
  const spur = (grow, col) => {
    ctx.strokeStyle = col; ctx.lineCap = "butt";
    ctx.lineWidth = W*0.007 + grow;
    ctx.beginPath(); ctx.moveTo(laneX, trackY); ctx.lineTo(ax0 + 2, trackY); ctx.stroke();
  };
  ctx.save(); ctx.translate(1.2, 0.7);
  spur(W*0.009, "rgba(26,34,15,0.8)");
  ctx.restore();
  spur(0, "#8d7f57");
  {
    ctx.fillStyle = "#8d7f57";
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.moveTo(ax0, ay0);
    ctx.lineTo(ax0 + apW, ay0 + 2 + rand()*3);
    ctx.lineTo(ax0 + apW - 2 - rand()*4, ay0 + apH);
    ctx.lineTo(ax0 + 3 + rand()*4, ay0 + apH - 2);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // A roof seen from straight above: two slopes about the ridge, the
    // north-west slope catching the dawn, the other in its own shade, and
    // a soft shadow thrown the same way the trees throw theirs.
    const roof = (bx, by, bw, bh, base, vert) => {
      ctx.fillStyle = "rgba(18,26,10,0.5)";
      ctx.beginPath(); ctx.ellipse(bx + bw*0.62, by + bh*0.72, bw*0.62, bh*0.5, 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = mixA(base, "#ffd9a0", 0.30, 1);
      if(vert) ctx.fillRect(bx, by, bw/2, bh); else ctx.fillRect(bx, by, bw, bh/2);
      ctx.fillStyle = mixA(base, "#141a0c", 0.42, 1);
      if(vert) ctx.fillRect(bx + bw/2, by, bw/2, bh); else ctx.fillRect(bx, by + bh/2, bw, bh/2);
      ctx.strokeStyle = "rgba(255,224,160,0.55)"; ctx.lineWidth = 1;
      ctx.beginPath();
      if(vert){ ctx.moveTo(bx + bw/2, by + 0.5); ctx.lineTo(bx + bw/2, by + bh - 0.5); }
      else { ctx.moveTo(bx + 0.5, by + bh/2); ctx.lineTo(bx + bw - 0.5, by + bh/2); }
      ctx.stroke();
    };
    // the workshop, south of the apron, doors facing it
    const wx = ax0 - 2, wy = ay0 + apH + 3;
    const spill = ctx.createRadialGradient(wx + 12, wy - 1, 1, wx + 12, wy - 1, 13);
    spill.addColorStop(0, "rgba(255,214,110,0.8)");
    spill.addColorStop(1, "rgba(255,214,110,0)");
    ctx.fillStyle = spill;
    ctx.beginPath(); ctx.arc(wx + 12, wy - 1, 13, 0, TAU); ctx.fill();
    roof(wx, wy, 30, 15, "#6d5a4a", false);
    ctx.fillStyle = "#ffd76e";
    ctx.fillRect(wx + 9, wy - 1.4, 7, 2.8);              // the open door
    ctx.fillRect(wx + 6, wy + 9.6, 2.2, 2.2);            // rooflights, lit
    ctx.fillRect(wx + 20, wy + 9.6, 2.2, 2.2);
    roof(ax0 + apW + 5, ay0 + 3, 15, 10, "#7a4a3a", false);   // the house
    roof(ax0 + apW + 7, ay0 + 22, 10, 7, "#5a6055", true);    // a shed
    // two of the six, wheeled out and waiting for the morning's check
    const dart = (dx, dy, s) => {
      ctx.fillStyle = "rgba(18,26,10,0.45)";
      ctx.beginPath(); ctx.ellipse(dx + s*0.5, dy + s*0.55, s*0.8, s*0.4, 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = "#cfd6da";
      ctx.beginPath();
      ctx.moveTo(dx, dy - s);
      ctx.lineTo(dx + s*0.85, dy + s*0.8);
      ctx.lineTo(dx, dy + s*0.35);
      ctx.lineTo(dx - s*0.85, dy + s*0.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#7fb0c8";
      ctx.fillRect(dx - 1, dy - s*0.45, 2, 2.6);
    };
    dart(ax0 + apW*0.30, ay0 + 16, 6);
    dart(ax0 + apW*0.62, ay0 + 24, 6);
  }
  /*
   * The airstrip: a mown pale strip down the paddock with white thresholds
   * and a windsock - Launch Day's actual runway, visible from the sky. A
   * worn footpath ties it back to the apron so the yard reads as one place.
   */
  const sx = Math.min(padX1 - 26, ax0 + apW + 34);
  const sy0 = y1 + 14, sy1 = rowE[homeRow + 1] - 12;
  {
    for(let d = sy0; d < sy1; d += 9)
      { ctx.fillStyle = "rgba(230,238,170," + (((d - sy0)/9|0) % 2 ? 0.12 : 0.26) + ")";
        ctx.fillRect(sx, d, 13, Math.min(9, sy1 - d)); }
    ctx.strokeStyle = "rgba(28,36,16,0.5)"; ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy0 + 0.5, 12, sy1 - sy0 - 1);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(sx + 2, sy0 + 2, 9, 2.4);
    ctx.fillRect(sx + 2, sy1 - 4.4, 9, 2.4);
    ctx.strokeStyle = "rgba(141,127,87,0.75)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax0 + apW - 2, ay0 + apH*0.5);
    ctx.quadraticCurveTo((ax0 + apW + sx)/2, ay0 + apH*0.72, sx + 6, sy0 + 10);
    ctx.stroke();
    ctx.strokeStyle = "rgba(240,240,240,0.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - 5, sy0 + 3); ctx.lineTo(sx - 5, sy0 + 9); ctx.stroke();
    ctx.fillStyle = "#e8823c";
    ctx.beginPath(); ctx.moveTo(sx - 5, sy0 + 3); ctx.lineTo(sx + 2, sy0 + 4.5);
    ctx.lineTo(sx - 5, sy0 + 6); ctx.closePath(); ctx.fill();
  }
  // The windbreak: a planted line on the hedgerow above the yard, sheltering
  // it from the open field - the one row of trees on this map that somebody
  // chose to put where it is. Planted, so it belongs to the farm, not to
  // the countryside that keeps rolling underneath.
  for(let i = 0; i < 5; i++){
    const tx = ax0 + 4 + (apW - 8)*(i/4) + (rand() - 0.5)*6;
    fieldTree(ctx, tx, y1 - 7 - rand()*4, 5 + rand()*3);
  }
  ctx.restore();
}

function drawFields(ctx, W, H, p, rand){
  /*
   * Rows first: irregular heights, because equal strips are the single
   * biggest tell of painted farmland. Only the two ends are sacred - the
   * first row starts at 0 and the last ends at H, so the seam still lands
   * on a hedgerow. One row is dealt a double share on purpose: that is the
   * home field, and it has to hold a farmyard and an airstrip. The deal
   * itself lives in fieldPlan (rowE[ROWS] = H; is pinned there), because the
   * farm is painted by a different bake now and both have to read the same
   * land.
   */
  const { ROWS, homeRow, rowE, laneX, sideY, padX0, padX1,
          y1, ax0, apW, trackY } = fieldPlan(W, H);
  /*
   * The roads, before the fields - because the fields have to know where
   * they are. Real country roads are STRAIGHT. A lane follows the boundary
   * between holdings for as long as the holdings run, and it turns only
   * where something makes it turn. An earlier draft jogged three times on
   * its way down the map for no reason a farmer would recognise; there are
   * three roads here now and each one is a straight line with a purpose:
   *
   *   the through-lane - dead straight down the whole map, the road that
   *     was here before the farm was. Straight is also what makes the wrap
   *     exact: it leaves the top at the very x it entered the bottom, so
   *     there is no kink and no cap anywhere near the seam.
   *   the side lane - leaves it at a T-junction, runs along a hedgerow and
   *     off the edge of the map towards wherever it goes next. It never
   *     comes back, so it never has to bend to get home.
   *   the farm track - the short spur into the yard, narrower and paler.
   *     The one reason anything would leave the road here. It is painted by
   *     drawFarm now, because the yard it serves passes ONCE and the spur
   *     must leave with it - a track to nowhere every wrap would be worse
   *     than the repeated farm it used to serve.
   */
  /*
   * Each row divides on its own - shared column lines are what made the
   * first draft read as a chessboard. The lane's x is always one of the
   * edges: fields line up against a road because the road came first.
   */
  const rowCols = [];
  for(let r = 0; r < ROWS; r++){
    const rx = laneX;
    const e = [0];
    const split = (a, b) => {
      const span = b - a;
      const n = Math.max(1, Math.round(span/(W*0.17)*(0.65 + rand()*0.8)));
      const raw2 = []; let acc2 = 0;
      for(let i = 0; i < n; i++){ const w2 = 0.55 + rand()*0.9; raw2.push(w2); acc2 += w2; }
      let x = a;
      for(let i = 0; i < n - 1; i++){ x += raw2[i]/acc2*span; e.push(x); }
    };
    split(0, rx); e.push(rx);
    if(r === homeRow){ if(padX1 < W){ e.push(padX1); split(padX1, W); } }
    else split(rx, W);
    e.push(W);
    rowCols.push(e);
  }
  // The season's palette: young green to cut gold to ploughed earth.
  const CROPS = ["#7f9a4e", "#94a75a", "#6b8a46", "#a8a55e", "#b3a765",
                 "#87975a", "#758f4a", "#9fa864", "#8a7050", "#7d6a45"];
  const wrapY = (y, r, draw) => {
    draw(y);
    if(y - r < 0) draw(y + H);
    if(y + r > H) draw(y - H);
  };
  ctx.save();
  ctx.fillStyle = p.dark || "#2a3418";
  ctx.fillRect(-2, -2, W + 4, H + 4);
  /*
   * The patches. All the variety lives in size and colour, plus a soft
   * within-patch gradient that reads as the lie of the land rather than
   * flat paint. The home paddock is mown flat and even - it has to read
   * as tended grass next to its working neighbours.
   */
  let prevCrop = null;
  for(let r = 0; r < ROWS; r++){
    const e = rowCols[r], ry0 = rowE[r], ry1 = rowE[r+1];
    for(let c = 0; c < e.length - 1; c++){
      const x0 = e[c], x1 = e[c+1], cw = x1 - x0;
      const isPaddock = r === homeRow && Math.abs(x0 - padX0) < 0.5;
      // A third of the time a field runs on into its neighbour - crops come
      // in runs, and the runs are what stop the land reading as tiles.
      const crop = isPaddock ? "#8ea15a"
                 : (prevCrop && rand() < 0.35) ? prevCrop
                 : CROPS[Math.floor(rand()*CROPS.length)];
      prevCrop = crop;
      // mixA takes HEXES and returns rgba() - never feed its output back in.
      const g = ctx.createLinearGradient(x0, ry0, x1, ry1);
      g.addColorStop(0, mixA(crop, "#ffd9a0", 0.22, 1));   // dawn-touched corner
      g.addColorStop(1, mixA(crop, "#20300f", 0.38, 1));   // the shaded end
      ctx.fillStyle = g;
      ctx.globalAlpha = isPaddock ? 1 : 0.86 + rand()*0.14;
      ctx.fillRect(x0, ry0, cw + 1, ry1 - ry0 + 1);
      // a few patches carry plough lines - thin darker rows along one axis
      if(!isPaddock && rand() < 0.3){
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = "#1e2812";
        ctx.lineWidth = 1.4;
        const horiz = rand() < 0.5, lines = 4 + Math.floor(rand()*3);
        for(let l = 1; l <= lines; l++){
          ctx.beginPath();
          if(horiz){
            const y = ry0 + ((ry1 - ry0)*l)/(lines+1);
            ctx.moveTo(x0 + 3, y); ctx.lineTo(x1 - 3, y);
          } else {
            const x = x0 + (cw*l)/(lines+1);
            ctx.moveTo(x, ry0 + 3); ctx.lineTo(x, ry1 - 3);
          }
          ctx.stroke();
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  // Hedgerows: the stitching. Full-width seams on the row lines; short
  // per-row seams between fields, so no line runs the whole map top to
  // bottom - that long line was half of what made the grid look drawn.
  ctx.strokeStyle = "rgba(24,32,14,0.85)";
  for(let r = 0; r <= ROWS; r++){
    ctx.lineWidth = 2 + rand()*2.4;
    ctx.beginPath(); ctx.moveTo(0, rowE[r]); ctx.lineTo(W, rowE[r]); ctx.stroke();
  }
  for(let r = 0; r < ROWS; r++){
    const e = rowCols[r];
    for(let c = 1; c < e.length - 1; c++){
      ctx.lineWidth = 2 + rand()*2.4;
      ctx.beginPath(); ctx.moveTo(e[c], rowE[r]); ctx.lineTo(e[c], rowE[r+1]); ctx.stroke();
    }
  }
  /*
   * The three roads, each one straight. Drawn banks-first and with the dark
   * only barely off-centre, because a country lane is a cut between two
   * hedges - dark down BOTH sides, a little heavier on the shaded one. Offset
   * far enough to read as a drop shadow and it stops looking like a road and
   * starts looking like a pale stripe someone laid on the field. The
   * through-lane is overdrawn past both edges so no cap shows at the seam,
   * and the side lane overshoots the junction so the T has no hairline in it.
   */
  {
    const paintRoads = (grow, col) => {
      ctx.strokeStyle = col; ctx.lineCap = "butt";
      ctx.lineWidth = W*0.014 + grow;             // the through-lane
      ctx.beginPath(); ctx.moveTo(laneX, -10); ctx.lineTo(laneX, H + 10); ctx.stroke();
      ctx.lineWidth = W*0.011 + grow;             // the side lane, off the map
      ctx.beginPath(); ctx.moveTo(-6, sideY); ctx.lineTo(laneX + 1, sideY); ctx.stroke();
    };
    ctx.save(); ctx.translate(1.2, 0.7);
    paintRoads(W*0.009, "rgba(26,34,15,0.8)");
    ctx.restore();
    paintRoads(0, "#8d7f57");
  }
  /*
   * Trees. One shared crown so the copses and the farm's windbreak match:
   * dark canopy, one lit arc on the key-light side, soft long shadow the
   * other way - the morning light, drawn twice so it cannot be missed.
   */
  const tree = (tx, ty, tr) => fieldTree(ctx, tx, ty, tr);
  // Copses keep clear of the roads and the paddock - trees grow anywhere
  // except where somebody drives or mows.
  const nearRoad = (bx, by) => Math.abs(bx - laneX) < 32
    || (Math.abs(by - sideY) < 24 && bx < laneX + 24)
    || (Math.abs(by - trackY) < 20 && bx > laneX - 10 && bx < ax0 + 10);
  const inPaddock = (bx, by) => by > y1 - 14 && by < rowE[homeRow + 1] + 14 &&
    bx > padX0 - 14 && bx < padX1 + 14;
  const copses = 17;
  for(let i = 0; i < copses; i++){
    const bx = rand()*W, by = rand()*H, n = 3 + Math.floor(rand()*4);
    if(nearRoad(bx, by) || inPaddock(bx, by)) continue;
    wrapY(by, 40, y => {
      for(let t = 0; t < n; t++)
        tree(bx + (rand() - 0.5)*46, y + (rand() - 0.5)*34, 6 + rand()*7);
    });
  }
  /*
   * And the dawn itself: warm on the key-light side, cool on the far side -
   * and varying ONLY in x. This texture wraps vertically, and the canyon
   * above already learned the lesson the hard way: anything baked that
   * darkens toward a horizontal edge scrolls past as a seam band, once per
   * wrap, forever. A left-to-right wash has no top or bottom to disagree.
   */
  const dawn = ctx.createLinearGradient(0, 0, W, 0);
  dawn.addColorStop(0, "rgba(255,196,120,0.26)");
  dawn.addColorStop(0.55, "rgba(255,196,120,0.06)");
  dawn.addColorStop(1, "rgba(30,44,80,0.16)");
  ctx.fillStyle = dawn;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/*
 * GREENFALL - the taken world. The campaign's second farm, and the reason
 * it looks like the first one is the whole story: somebody lived here, and
 * the people we are chasing came through. The land is dealt by the same
 * fieldPlan as Earth's (its own seed, its own lie of the land) because it
 * IS the same kind of place - fields against a lane, a paddock, a yard -
 * and every difference is what happened to it: hedgerows breached, the
 * lane cracked and going green, whole fields gone over to teal blossom
 * that nobody planted.
 */
const WILD_SEED = 51230990;
function drawWild(ctx, W, H, p, rand){
  const { ROWS, homeRow, rowE, laneX, sideY, padX0, padX1, trackY, ax0 } =
    fieldPlan(W, H, WILD_SEED);
  const rowCols = [];
  for(let r = 0; r < ROWS; r++){
    const rx = laneX;
    const e = [0];
    const split = (a, b) => {
      const span = b - a;
      const n = Math.max(1, Math.round(span/(W*0.19)*(0.65 + rand()*0.8)));
      const raw2 = []; let acc2 = 0;
      for(let i = 0; i < n; i++){ const w2 = 0.55 + rand()*0.9; raw2.push(w2); acc2 += w2; }
      let x = a;
      for(let i = 0; i < n - 1; i++){ x += raw2[i]/acc2*span; e.push(x); }
    };
    split(0, rx); e.push(rx);
    if(r === homeRow){ if(padX1 < W){ e.push(padX1); split(padX1, W); } }
    else split(rx, W);
    e.push(W);
    rowCols.push(e);
  }
  /*
   * The overgrowth palette: mosses first, then the teal bloom that has had
   * the run of the place, then the dry rust of a crop nobody brought in.
   * Cooler and darker than Earth's dawn on purpose - this world is in
   * shadow until you do something about it, and the seeds and flower-guns
   * are the brightest things on it.
   */
  const WILDS = ["#2c4630", "#35543a", "#243d28", "#2f6b5a", "#3c8a6e",
                 "#31502e", "#274433", "#57503a", "#3b5a40", "#2a4a3e"];
  const wrapY = (y, r, draw) => {
    draw(y);
    if(y - r < 0) draw(y + H);
    if(y + r > H) draw(y - H);
  };
  ctx.save();
  ctx.fillStyle = p.dark || "#101c12";
  ctx.fillRect(-2, -2, W + 4, H + 4);
  let prevCrop = null;
  for(let r = 0; r < ROWS; r++){
    const e = rowCols[r], ry0 = rowE[r], ry1 = rowE[r+1];
    for(let c = 0; c < e.length - 1; c++){
      const x0 = e[c], x1 = e[c+1], cw = x1 - x0;
      const isPaddock = r === homeRow && Math.abs(x0 - padX0) < 0.5;
      const crop = isPaddock ? "#3a5a3c"
                 : (prevCrop && rand() < 0.3) ? prevCrop
                 : WILDS[Math.floor(rand()*WILDS.length)];
      prevCrop = crop;
      const g = ctx.createLinearGradient(x0, ry0, x1, ry1);
      g.addColorStop(0, mixA(crop, "#9fe8c8", 0.10, 1));
      g.addColorStop(1, mixA(crop, "#0a140c", 0.42, 1));
      ctx.fillStyle = g;
      ctx.globalAlpha = isPaddock ? 1 : 0.85 + rand()*0.15;
      ctx.fillRect(x0, ry0, cw + 1, ry1 - ry0 + 1);
      // The bloom-fields glow faintly with their own speckle - drifts of the
      // same flowers the seeds grow, wild here, which is the level quietly
      // telling you the mechanic before the radio does.
      if(!isPaddock && (crop === "#2f6b5a" || crop === "#3c8a6e")){
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#b8f4c6";
        const n = Math.floor(cw*(ry1 - ry0)/900);
        for(let d = 0; d < n; d++){
          ctx.beginPath();
          ctx.arc(x0 + 3 + rand()*(cw - 6), ry0 + 3 + rand()*(ry1 - ry0 - 6),
                  0.8 + rand()*0.9, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  /*
   * Breached hedgerows: the stitching, with pieces missing. Earth's run
   * unbroken; here every seam is dashed - segments and gaps - because a
   * hedge stops being a wall the year nobody trims it, and a broken line
   * is the fastest way a picture says "untended".
   */
  ctx.strokeStyle = "rgba(14,24,12,0.9)";
  for(let r = 0; r <= ROWS; r++){
    ctx.lineWidth = 2 + rand()*2.4;
    let x = 0;
    while(x < W){
      const seg = 26 + rand()*70, gap = 8 + rand()*26;
      ctx.beginPath(); ctx.moveTo(x, rowE[r]); ctx.lineTo(Math.min(W, x + seg), rowE[r]); ctx.stroke();
      x += seg + gap;
    }
  }
  for(let r = 0; r < ROWS; r++){
    const e = rowCols[r];
    for(let c = 1; c < e.length - 1; c++){
      ctx.lineWidth = 2 + rand()*2;
      let y = rowE[r];
      while(y < rowE[r+1]){
        const seg = 20 + rand()*46, gap = 8 + rand()*22;
        ctx.beginPath(); ctx.moveTo(e[c], y); ctx.lineTo(e[c], Math.min(rowE[r+1], y + seg)); ctx.stroke();
        y += seg + gap;
      }
    }
  }
  /*
   * The lane, still dead straight - a road does not forget where it went -
   * but cracked and going green: painted paler and thinner than Earth's,
   * with weed-dashes across it. The side lane still leaves at its T.
   */
  const paintRoads = (grow, col, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col; ctx.lineCap = "butt";
    ctx.lineWidth = W*0.013 + grow;
    ctx.beginPath(); ctx.moveTo(laneX, -10); ctx.lineTo(laneX, H + 10); ctx.stroke();
    ctx.lineWidth = W*0.010 + grow;
    ctx.beginPath(); ctx.moveTo(-6, sideY); ctx.lineTo(laneX + 1, sideY); ctx.stroke();
    ctx.globalAlpha = 1;
  };
  ctx.save(); ctx.translate(1.2, 0.7);
  paintRoads(W*0.008, "rgba(12,20,10,0.8)", 0.8);
  ctx.restore();
  paintRoads(0, "#6f6b4e", 0.75);
  ctx.strokeStyle = "rgba(63,125,74,0.7)";                 // the weeds win
  ctx.lineWidth = 1.6;
  for(let y = 6 + rand()*10; y < H; y += 14 + rand()*26){
    ctx.beginPath();
    ctx.moveTo(laneX - W*0.006, y);
    ctx.lineTo(laneX + W*0.006, y + 2);
    ctx.stroke();
  }
  // The wild copses - denser than Earth's, because nothing has been cut
  // back in years, and they walk right over where the roads used to matter.
  const pal = { shadow:"rgba(6,14,8,0.55)", canopy:"#1d3524",
                rim:"rgba(140,240,200,0.45)" };
  const inPaddock = (bx, by) => by > rowE[homeRow] - 14 && by < rowE[homeRow + 1] + 14 &&
    bx > padX0 - 14 && bx < padX1 + 14;
  for(let i = 0; i < 24; i++){
    const bx = rand()*W, by = rand()*H, n = 3 + Math.floor(rand()*5);
    if(Math.abs(bx - laneX) < 20 || inPaddock(bx, by)) continue;
    wrapY(by, 44, y => {
      for(let t2 = 0; t2 < n; t2++)
        fieldTree(ctx, bx + (rand() - 0.5)*52, y + (rand() - 0.5)*38, 5 + rand()*8, pal);
    });
  }
  // The evening of a taken world: a cool teal wash from the key side and a
  // deep shade opposite. x-only, same as Earth's dawn, for the same reason:
  // this texture wraps vertically and must not know where its edges are.
  const dusk = ctx.createLinearGradient(0, 0, W, 0);
  dusk.addColorStop(0, "rgba(110,230,190,0.14)");
  dusk.addColorStop(0.55, "rgba(110,230,190,0.03)");
  dusk.addColorStop(1, "rgba(8,18,30,0.24)");
  ctx.fillStyle = dusk;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/*
 * THE EMPTY FARMSTEAD - Greenfall's pass-once landmark, and the mirror of
 * Launch Day's. Same bones on purpose: an apron, a workshop, a house, an
 * airstrip, a windbreak. Every light is off, the roof is holed, the ships'
 * cradles are empty, and the windsock is still flying - which is the one
 * detail the brief points at, because a windsock nobody took down is how a
 * picture says "they left in a hurry" to a seven-year-old.
 */
function drawRuin(ctx, W, H, p, rand){
  const { y1, ax0, ay0, apW, apH, trackY, laneX, padX1, rowE, homeRow } =
    fieldPlan(W, H, WILD_SEED);
  ctx.save();
  // the track in, faded to a memory of itself
  const spur = (grow, col, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col; ctx.lineCap = "butt";
    ctx.lineWidth = W*0.006 + grow;
    ctx.beginPath(); ctx.moveTo(laneX, trackY); ctx.lineTo(ax0 + 2, trackY); ctx.stroke();
    ctx.globalAlpha = 1;
  };
  ctx.save(); ctx.translate(1.2, 0.7);
  spur(W*0.008, "rgba(12,20,10,0.8)", 0.7);
  ctx.restore();
  spur(0, "#6f6b4e", 0.65);
  /*
   * Moonlight on the dead yard - the cold answer to Launch Day's warm lamp
   * spill. Without it the ruin sank into the overgrowth and the level's own
   * landmark could scroll past unnoticed; a pale glint makes the eye stop
   * exactly once, which is what a pass-once landmark is for.
   */
  { const moon = ctx.createRadialGradient(ax0 + apW*0.5, ay0 + apH*0.7, 2,
                                          ax0 + apW*0.5, ay0 + apH*0.7, apW*1.5);
    moon.addColorStop(0, "rgba(190,225,235,0.20)");
    moon.addColorStop(1, "rgba(190,225,235,0)");
    ctx.fillStyle = moon;
    ctx.beginPath(); ctx.arc(ax0 + apW*0.5, ay0 + apH*0.7, apW*1.5, 0, TAU); ctx.fill(); }
  // the apron, cracked and going green
  ctx.fillStyle = "#77735a";
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(ax0, ay0);
  ctx.lineTo(ax0 + apW, ay0 + 2 + rand()*3);
  ctx.lineTo(ax0 + apW - 2 - rand()*4, ay0 + apH);
  ctx.lineTo(ax0 + 3 + rand()*4, ay0 + apH - 2);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#3f7d4a";
  for(let i = 0; i < 14; i++){
    ctx.beginPath();
    ctx.arc(ax0 + 3 + rand()*(apW - 6), ay0 + 3 + rand()*(apH - 6),
            1 + rand()*1.6, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // a roof with the morning missing: the lit slope is torn open instead
  const deadRoof = (bx, by, bw, bh, base, holed) => {
    ctx.fillStyle = "rgba(6,12,6,0.5)";
    ctx.beginPath(); ctx.ellipse(bx + bw*0.62, by + bh*0.72, bw*0.62, bh*0.5, 0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = mixA(base, "#9fe8c8", 0.10, 1);
    ctx.fillRect(bx, by, bw, bh/2);
    ctx.fillStyle = mixA(base, "#060a06", 0.5, 1);
    ctx.fillRect(bx, by + bh/2, bw, bh/2);
    ctx.strokeStyle = "rgba(160,200,170,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx + 0.5, by + bh/2); ctx.lineTo(bx + bw - 0.5, by + bh/2); ctx.stroke();
    if(holed){
      // the hole: sky-dark, jagged, through the upper slope
      ctx.fillStyle = "#0b140d";
      ctx.beginPath();
      ctx.moveTo(bx + bw*0.32, by + 1.5);
      ctx.lineTo(bx + bw*0.58, by + 1);
      ctx.lineTo(bx + bw*0.52, by + bh*0.42);
      ctx.lineTo(bx + bw*0.40, by + bh*0.36);
      ctx.closePath(); ctx.fill();
    }
  };
  const wx = ax0 - 2, wy = ay0 + apH + 3;
  deadRoof(wx, wy, 30, 15, "#5c5c52", true);         // the workshop, holed
  ctx.fillStyle = "#0b140d";
  ctx.fillRect(wx + 9, wy - 1.4, 7, 2.8);            // the door, open on dark
  deadRoof(ax0 + apW + 5, ay0 + 3, 15, 10, "#5e4a42", false);   // the house, asleep for good
  ctx.fillStyle = "#0b140d";                          // shed: down to a smear
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.ellipse(ax0 + apW + 12, ay0 + 25, 7, 4, 0.4, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // two empty cradles where the darts were wheeled out and never came back
  const cradle = (dx, dy, s) => {
    ctx.strokeStyle = "rgba(210,230,215,0.6)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(dx, dy - s);
    ctx.lineTo(dx + s*0.85, dy + s*0.8);
    ctx.lineTo(dx, dy + s*0.35);
    ctx.lineTo(dx - s*0.85, dy + s*0.8);
    ctx.closePath(); ctx.stroke();
  };
  cradle(ax0 + apW*0.30, ay0 + 16, 6);
  cradle(ax0 + apW*0.62, ay0 + 24, 6);
  // the airstrip, nearly swallowed - thresholds just showing through
  const sx = Math.min(padX1 - 26, ax0 + apW + 34);
  const sy0 = y1 + 14, sy1 = rowE[homeRow + 1] - 12;
  ctx.globalAlpha = 0.4;
  for(let d = sy0; d < sy1; d += 9)
    { ctx.fillStyle = "rgba(220,232,200," + (((d - sy0)/9|0) % 2 ? 0.06 : 0.14) + ")";
      ctx.fillRect(sx, d, 13, Math.min(9, sy1 - d)); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(sx + 2, sy0 + 2, 9, 2.4);
  ctx.fillRect(sx + 2, sy1 - 4.4, 9, 2.4);
  // ...and the windsock, still up, still flying, torn at the tip
  ctx.strokeStyle = "rgba(240,240,240,0.85)"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(sx - 5, sy0 + 3); ctx.lineTo(sx - 5, sy0 + 9); ctx.stroke();
  ctx.fillStyle = "#f09048";
  ctx.beginPath(); ctx.moveTo(sx - 5, sy0 + 3); ctx.lineTo(sx + 1, sy0 + 4.2);
  ctx.lineTo(sx - 1.5, sy0 + 5.0); ctx.lineTo(sx + 2, sy0 + 5.6);
  ctx.lineTo(sx - 5, sy0 + 6); ctx.closePath(); ctx.fill();
  // the windbreak: five planted trees, two of them dead and grey
  const alive = { shadow:"rgba(6,14,8,0.55)", canopy:"#1d3524",
                  rim:"rgba(140,240,200,0.45)" };
  const dead  = { shadow:"rgba(6,14,8,0.45)", canopy:"#3a423c",
                  rim:"rgba(190,200,195,0.3)" };
  for(let i = 0; i < 5; i++){
    const tx = ax0 + 4 + (apW - 8)*(i/4) + (rand() - 0.5)*6;
    fieldTree(ctx, tx, y1 - 7 - rand()*4, 5 + rand()*3, (i === 1 || i === 3) ? dead : alive);
  }
  ctx.restore();
}

/* ---------------------------------------------------------
   THE DROWNED SKY - an ocean floor from above.
   ---------------------------------------------------------
   Everything below is water-filtered on purpose: there is no local colour
   down here, only what survives the column - teals, grey-greens, and the
   coral's dimmed reds. The two loud things in the level (the spilled
   starlight, the trench glow) are loud BECAUSE everything else obeys that.

   One CURRENT crosses the whole floor, the way one dawn crossed the whole
   farm: every kelp strand leans the same way and every sand ripple runs
   square to it. A floor where each clump sways to itself reads as clip-art;
   a floor that agrees on the water reads as a place. */

const CURRENT = -0.42;                  // radians off vertical; everything agrees
const SEA = {
  water:"#04222e", deep:"#021820", light:"#0d4152",
  sand:"#5d8a84", sandLit:"#7aa89b",
  rock:"#0c333c", rockLit:"#1d5c60",
  kelp:"#0d4034", kelpLit:"#1a6b4d",
  coral:["#a35a6e","#b3854e","#6b5a96","#7fbdb2"],
  glow:"#ffe9a8", trench:"#37d9bd",
};

/** One kelp strand: a ribbon leaning into the current, leaves alternating.
 *  Shared by the tile (groves) and the once-layer (growth on the wreck). */
function kelpStrand(ctx, x, y, len, rand){
  const lean = CURRENT + (rand() - 0.5)*0.3;
  const sway = 8 + rand()*14;
  const tipX = x + Math.sin(lean)*len, tipY = y - Math.cos(lean)*len;
  const midX = (x + tipX)/2 + Math.cos(lean)*sway, midY = (y + tipY)/2 + Math.sin(lean)*sway;
  ctx.strokeStyle = SEA.kelp; ctx.lineWidth = 2.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(midX, midY, tipX, tipY); ctx.stroke();
  ctx.fillStyle = SEA.kelpLit;
  for(let i = 1; i <= 4; i++){
    const t = i/5, side = i % 2 ? 1 : -1, u = 1 - t;
    const lx = u*u*x + 2*u*t*midX + t*t*tipX;
    const ly = u*u*y + 2*u*t*midY + t*t*tipY;
    ctx.beginPath(); ctx.ellipse(lx, ly, 4.5, 1.7, lean + side*0.7, 0, TAU); ctx.fill();
  }
}

/** A pinch of spilled sky: soft gold glow with a four-point glint. The
 *  campaign's own star shape, so a child recognises WHAT is on the floor. */
function starGlint(ctx, x, y, r, a){
  const g = ctx.createRadialGradient(x, y, 0, x, y, r*3.2);
  g.addColorStop(0, rgba(SEA.glow, a));
  g.addColorStop(1, rgba(SEA.glow, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r*3.2, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba("#fff6d8", Math.min(1, a*1.8));
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  ctx.stroke();
}

function drawSeabed(ctx, W, H, p, rand){
  /* The floor, in the order the sea put it there: sand, then what the sand
     buries, then what grows out of it. */
  ctx.fillStyle = SEA.water;
  ctx.fillRect(0, 0, W, H);

  // Broad light wells and deeps - the mottling sunlight leaves on a bottom.
  for(let i = 0; i < 11; i++){
    const x = rand()*W, y = rand()*H, r = (0.16 + rand()*0.30)*W;
    const col = i % 3 ? SEA.light : SEA.deep;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, i % 3 ? 0.30 : 0.34));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  // Sand flats: pale banks the rest of the furniture stands on.
  const banks = [];
  for(let i = 0; i < 6; i++){
    const x = rand()*W, y = rand()*H, r = (0.10 + rand()*0.15)*W;
    banks.push({ x, y, r });
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(SEA.sand, 0.30));
      g.addColorStop(0.7, rgba(SEA.sand, 0.16));
      g.addColorStop(1, rgba(SEA.sand, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }
  // Ripples run square to the current, everywhere sand shows.
  ctx.lineWidth = 1;
  banks.forEach(b => {
    for(let i = 0; i < 10; i++){
      const a2 = rand()*TAU, d = Math.sqrt(rand())*b.r*0.8;
      const cx = b.x + Math.cos(a2)*d, cy = b.y + Math.sin(a2)*d;
      const len = 8 + rand()*18, wob = 2 + rand()*2;
      ctx.strokeStyle = rgba(SEA.sandLit, 0.10 + rand()*0.08);
      tiled(ctx, H, cy, yy => {
        ctx.beginPath();
        // square to the current: the ripple runs along CURRENT's normal
        const nx = Math.cos(CURRENT), ny = Math.sin(CURRENT);
        ctx.moveTo(cx - nx*len, yy - ny*len);
        ctx.quadraticCurveTo(cx + ny*wob, yy - nx*wob, cx + nx*len, yy + ny*len);
        ctx.stroke();
      });
    }
  });

  /*
   * THE TRENCH - one, like the farm's through-lane, and for the same wrap
   * reason: it runs the full height and leaves the top at the exact x it
   * entered the bottom, so the seam never lands on a kink. It is the darkest
   * thing in the game's darkest-bottomed level, and the spilled light pools
   * along it - deep water finds the deepest place.
   */
  const tx0 = W*(0.62 + rand()*0.16), tW = W*0.055 + rand()*W*0.02;
  const sway1 = (rand() - 0.5)*W*0.16, sway2 = (rand() - 0.5)*W*0.16;
  // Both sway terms are whole periods of t, so position AND slope agree at
  // the wrap - the farm's through-lane got this for free by being straight.
  const edge = t => tx0 + Math.sin(t*TAU)*sway1 + Math.sin(t*TAU*2)*sway2*0.5;
  ctx.beginPath();
  for(let i = 0; i <= 24; i++){ const t = i/24; const x = edge(t) - tW/2; i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
  for(let i = 24; i >= 0; i--){ const t = i/24; ctx.lineTo(edge(t) + tW/2, t*H); }
  ctx.closePath();
  const tg = ctx.createLinearGradient(tx0 - tW, 0, tx0 + tW, 0);
  tg.addColorStop(0, rgba(SEA.deep, 0.0));
  tg.addColorStop(0.25, "#010c12");
  tg.addColorStop(0.75, "#010c12");
  tg.addColorStop(1, rgba(SEA.deep, 0.0));
  ctx.fillStyle = tg; ctx.fill();
  // The rim catches what light is left...
  ctx.strokeStyle = rgba(SEA.trench, 0.18); ctx.lineWidth = 1.6;
  ctx.beginPath();
  for(let i = 0; i <= 24; i++){ const t = i/24; const x = edge(t) - tW/2; i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
  ctx.stroke();
  // ...and the drowned stars pool in the dark below it.
  for(let i = 0; i < 7; i++){
    const t = rand(); const gx = edge(t) + (rand() - 0.5)*tW*0.5;
    tiled(ctx, H, t*H, yy => starGlint(ctx, gx, yy, 1.6 + rand()*1.4, 0.20 + rand()*0.14));
  }

  // Rock gardens: rounded stones, lit from the surface like everything else.
  for(let c = 0; c < 7; c++){
    const cx = rand()*W, cy = rand()*H, n = 4 + Math.floor(rand()*5);
    for(let i = 0; i < n; i++){
      const x = cx + (rand() - 0.5)*W*0.10, y = cy + (rand() - 0.5)*W*0.10;
      const r = 4 + rand()*9;
      tiled(ctx, H, y, yy => {
        ctx.fillStyle = SEA.rock;
        ctx.beginPath(); ctx.ellipse(x, yy, r, r*0.8, rand()*TAU, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(SEA.rockLit, 0.7);
        ctx.beginPath(); ctx.ellipse(x - r*0.2, yy - r*0.3, r*0.55, r*0.35, 0, 0, TAU); ctx.fill();
      });
    }
  }

  // Kelp groves: every strand leans into the same current.
  for(let g = 0; g < 7; g++){
    const gx = rand()*W, gy = rand()*H, n = 5 + Math.floor(rand()*5);
    for(let i = 0; i < n; i++){
      const x = gx + (rand() - 0.5)*W*0.09, y = gy + (rand() - 0.5)*W*0.07;
      const len = 26 + rand()*30;
      tiled(ctx, H, y, yy => kelpStrand(ctx, x, yy, len, rngFor(g*100 + i)));
    }
  }

  // Coral heads: the only warm colour on the floor, and even it is dimmed.
  for(let c = 0; c < 6; c++){
    const cx = rand()*W, cy = rand()*H, n = 3 + Math.floor(rand()*4);
    for(let i = 0; i < n; i++){
      const x = cx + (rand() - 0.5)*W*0.08, y = cy + (rand() - 0.5)*W*0.06;
      const col = SEA.coral[Math.floor(rand()*SEA.coral.length)];
      const kind = rand();
      tiled(ctx, H, y, yy => {
        if(kind < 0.4){
          // brain coral: a mound with wobbled growth rings
          const r = 6 + rand()*8;
          ctx.fillStyle = rgba(col, 0.7);
          ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
          ctx.strokeStyle = rgba("#031a20", 0.35); ctx.lineWidth = 1;
          for(let q = 1; q <= 2; q++){
            ctx.beginPath();
            for(let i2 = 0; i2 <= 16; i2++){
              const a3 = (i2/16)*TAU;
              const rr = r*(q/3 + 0.12) + Math.sin(a3*3 + q)*1.1;
              const px2 = x + Math.cos(a3)*rr, py2 = yy + Math.sin(a3)*rr;
              i2 ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2);
            }
            ctx.closePath(); ctx.stroke();
          }
        } else if(kind < 0.75){
          // staghorn: short forked branches reaching into the current
          ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 2; ctx.lineCap = "round";
          for(let b = 0; b < 3; b++){
            const a4 = CURRENT + (b - 1)*0.55 + (rand() - 0.5)*0.2, l2 = 8 + rand()*9;
            const ex = x + Math.sin(a4)*l2, ey = yy - Math.cos(a4)*l2;
            ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(ex, ey);
            ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.sin(a4 + 0.5)*4, ey - Math.cos(a4 + 0.5)*4);
            ctx.stroke();
          }
        } else {
          // fan coral: a webbed arc, face square to the current
          const r = 7 + rand()*7;
          ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 1.2;
          for(let b = 0; b < 5; b++){
            const a5 = CURRENT - 0.8 + (b/4)*1.6;
            ctx.beginPath(); ctx.moveTo(x, yy);
            ctx.lineTo(x + Math.sin(a5)*r, yy - Math.cos(a5)*r);
            ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(x, yy, r*0.75, CURRENT - Math.PI/2 - 0.8, CURRENT - Math.PI/2 + 0.8); ctx.stroke();
        }
      });
    }
  }

  // Loose spilled light, thinning away from the trench.
  for(let i = 0; i < 8; i++){
    const x = rand()*W, y = rand()*H;
    tiled(ctx, H, y, yy => starGlint(ctx, x, yy, 1.2 + rand(), 0.10 + rand()*0.08));
  }

  // Sediment: the fine grain that stops the floor reading as flat paint.
  for(let i = 0; i < 260; i++){
    const x = rand()*W, y = rand()*H;
    ctx.fillStyle = rgba(i % 2 ? SEA.sandLit : SEA.deep, 0.05 + rand()*0.07);
    tiled(ctx, H, y, yy => ctx.fillRect(x, yy, 1.4, 1.4));
  }
}

/*
 * THE FLAGSHIP - the once-layer. One of theirs, down long enough for the
 * reef to claim it, cracked open across the middle with the stolen light
 * still spilling out of the hold. Top-down like everything on a surface,
 * with its own sand apron so it sits ON the floor wherever the scroll has
 * carried the tile - the apron is what spares the two bakes having to agree
 * the way the farm and its fields do.
 */
function drawDrowned(ctx, W, H, p, rand){
  const cx = W*0.40, cy = H*0.52;
  const ang = -0.38 + (rand() - 0.5)*0.1;       // came down mid-turn; nothing sinks square
  const L = W*0.62, B = L*0.21;                 // length and beam

  // The sand it threw up when it hit, and the shadow it throws now.
  const apron = ctx.createRadialGradient(cx, cy, 0, cx, cy, L*0.72);
  apron.addColorStop(0, rgba(SEA.sand, 0.34));
  apron.addColorStop(0.55, rgba(SEA.sand, 0.16));
  apron.addColorStop(1, rgba(SEA.sand, 0));
  ctx.fillStyle = apron;
  ctx.beginPath(); ctx.ellipse(cx, cy, L*0.72, L*0.5, ang, 0, TAU); ctx.fill();

  const hull = "#1a3038", plate = "#24424c", plateLit = "#33565e", scar = "#0b1a20";

  /** One section of hull in local coords: x along the keel, y across it. */
  const section = (x0, x1, jagAt, taper) => {
    ctx.beginPath();
    const nose = x1 - (x1 - x0)*(taper || 0.18);
    ctx.moveTo(x0, -B*0.5);
    ctx.lineTo(nose, -B*0.5); ctx.quadraticCurveTo(x1, -B*0.15, x1, 0);
    ctx.quadraticCurveTo(x1, B*0.15, nose, B*0.5);
    ctx.lineTo(x0, B*0.5);
    if(jagAt){ // the break: a torn edge, not a cut
      for(let i = 0; i <= 6; i++)
        ctx.lineTo(x0 + (i % 2 ? -7 : 4), B*0.5 - (B/6)*i - (i % 2 ? 4 : 0));
    }
    ctx.closePath();
  };

  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(ang);

  // Shadow under both sections, sunk-side.
  ctx.fillStyle = rgba("#01090d", 0.5);
  ctx.beginPath(); ctx.ellipse(-L*0.12, B*0.42, L*0.46, B*0.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(L*0.36, B*0.44, L*0.17, B*0.36, 0, 0, TAU); ctx.fill();

  // STERN SECTION - two thirds of her, listing into the sand.
  section(-L*0.5, L*0.12, true);
  ctx.fillStyle = hull; ctx.fill();
  ctx.strokeStyle = scar; ctx.lineWidth = 2; ctx.stroke();
  // deck plates
  ctx.fillStyle = plate;
  ctx.fillRect(-L*0.47, -B*0.34, L*0.55, B*0.68);
  ctx.strokeStyle = rgba(scar, 0.8); ctx.lineWidth = 1;
  for(let i = 1; i < 6; i++){
    const x = -L*0.47 + (L*0.55)*(i/6);
    ctx.beginPath(); ctx.moveTo(x, -B*0.34); ctx.lineTo(x, B*0.34); ctx.stroke();
  }
  // the centreline stripe their carriers wear, faded
  ctx.fillStyle = rgba("#c8d4d8", 0.13);
  ctx.fillRect(-L*0.47, -B*0.045, L*0.55, B*0.09);
  // the island tower, knocked loose, leaning off-axis with its own shadow
  ctx.save();
  ctx.translate(-L*0.18, -B*0.16); ctx.rotate(0.34);
  ctx.fillStyle = rgba("#01090d", 0.45); ctx.fillRect(-9, 4, 34, 14);
  ctx.fillStyle = plateLit; ctx.fillRect(-11, -8, 30, 15);
  ctx.fillStyle = scar; ctx.fillRect(-11, -8, 30, 4);
  // three portholes still warm - somebody's lights outlasted the ship
  ctx.fillStyle = "#ffd9a0";
  for(let i = 0; i < 3; i++){ ctx.beginPath(); ctx.arc(-4 + i*8, 1.5, 1.4, 0, TAU); ctx.fill(); }
  ctx.restore();
  // sand drifted over the stern quarter - the sea is halfway through burying her
  const drift = ctx.createLinearGradient(-L*0.5, 0, -L*0.28, 0);
  drift.addColorStop(0, rgba(SEA.sand, 0.55));
  drift.addColorStop(1, rgba(SEA.sand, 0));
  ctx.fillStyle = drift;
  section(-L*0.5, L*0.12, false); ctx.fill();

  // BOW SECTION - snapped clean off, a length ahead and turned further.
  ctx.save();
  ctx.translate(L*0.36, B*0.10); ctx.rotate(0.24);
  section(-L*0.12, L*0.16, true, 0.42);
  ctx.fillStyle = hull; ctx.fill();
  ctx.strokeStyle = scar; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = plate; ctx.fillRect(-L*0.10, -B*0.30, L*0.14, B*0.60);
  ctx.strokeStyle = rgba(scar, 0.8); ctx.lineWidth = 1;
  for(let i = 1; i < 3; i++){
    const x = -L*0.10 + (L*0.14)*(i/3);
    ctx.beginPath(); ctx.moveTo(x, -B*0.30); ctx.lineTo(x, B*0.30); ctx.stroke();
  }
  // the stripe carries across the break - one ship, told in two pieces
  ctx.fillStyle = rgba("#c8d4d8", 0.13);
  ctx.fillRect(-L*0.10, -B*0.045, L*0.17, B*0.09);
  // the anchor she dropped too late: chain paying out to a half-buried fluke
  ctx.strokeStyle = rgba("#0e2228", 0.9); ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(L*0.15, 2); ctx.quadraticCurveTo(L*0.26, B*0.5, L*0.30, B*0.9); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#0e2228";
  ctx.beginPath(); ctx.arc(L*0.30, B*0.9, 3.5, Math.PI*0.1, Math.PI*1.1); ctx.fill();
  ctx.restore();

  // THE BREAK, and what it spilled: the hold was full of the river's light.
  const gx = L*0.20, gy = B*0.06;
  const burst = ctx.createRadialGradient(gx, gy, 0, gx, gy, L*0.24);
  burst.addColorStop(0, rgba(SEA.glow, 0.65));
  burst.addColorStop(0.4, rgba(SEA.glow, 0.24));
  burst.addColorStop(1, rgba(SEA.glow, 0));
  ctx.fillStyle = burst;
  ctx.beginPath(); ctx.arc(gx, gy, L*0.24, 0, TAU); ctx.fill();
  // debris between the halves, silhouetted against the spill
  ctx.fillStyle = scar;
  for(let i = 0; i < 7; i++){
    const dx = gx + (rand() - 0.5)*L*0.16, dy = gy + (rand() - 0.5)*B*0.8;
    ctx.save(); ctx.translate(dx, dy); ctx.rotate(rand()*TAU);
    ctx.fillRect(-3 - rand()*3, -1.5, 6 + rand()*6, 3);
    ctx.restore();
  }
  // the light itself, leaking out in a trail the current carries
  for(let i = 0; i < 9; i++){
    const t = i/9;
    const sx = gx + Math.sin(CURRENT - ang)*t*L*0.34 + (rand() - 0.5)*14;
    const sy = gy - Math.cos(CURRENT - ang)*t*L*0.34 + (rand() - 0.5)*14;
    starGlint(ctx, sx, sy, 1.4 + (1 - t)*1.6, 0.34*(1 - t) + 0.10);
  }

  // The reef is claiming her: coral crusts and a few kelp strands on the hull.
  for(let i = 0; i < 8; i++){
    const x = -L*0.46 + rand()*L*0.5, y = (rand() < 0.5 ? -1 : 1)*B*(0.30 + rand()*0.18);
    const col = SEA.coral[Math.floor(rand()*SEA.coral.length)];
    ctx.fillStyle = rgba(col, 0.75);
    for(let q = 0; q < 4; q++){
      ctx.beginPath(); ctx.arc(x + (rand() - 0.5)*8, y + (rand() - 0.5)*5, 1.6 + rand()*2.2, 0, TAU); ctx.fill();
    }
  }
  for(let i = 0; i < 4; i++)
    kelpStrand(ctx, -L*0.42 + rand()*L*0.36, (rand() < 0.5 ? -1 : 1)*B*0.5, 20 + rand()*16, rngFor(700 + i));

  ctx.restore();
}

/* ---------------------------------------------------------
   EMBERFALL - a volcano world from above.
   ---------------------------------------------------------
   The rule the sea set holds here too: one thing crosses the whole floor
   and everything else answers to it. Under water it was the current; here
   it is the LAVA - two rivers run the full height, every rock is rim-lit
   from whichever river is nearer, and the only bright paint on the tile is
   molten. The enemy is present even in the geology: their drill rigs stand
   over the veins, which is the whole reason the planet is angry. */

const EMBER = {
  basalt:"#120a08", basaltLit:"#241410", crust:"#050302",
  ash:"#4a4341", ashLit:"#6b615c",
  lavaCore:"#ffe9a0", lava:"#ff8a3c", lavaDeep:"#b83a10", lavaDark:"#5e1606",
  rig:"#1c1a20", rigLit:"#33303a", warn:"#ff5d73",
};

/** A molten line with a hot core - shared by rivers, cracks and the city's
 *  feed pipes, so all the fire on this world is the same fire. */
function lavaStroke(ctx, pathFn, w){
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = EMBER.lavaDark; ctx.lineWidth = w + 4;
  ctx.beginPath(); pathFn(); ctx.stroke();
  ctx.strokeStyle = EMBER.lavaDeep; ctx.lineWidth = w + 1.5;
  ctx.beginPath(); pathFn(); ctx.stroke();
  ctx.strokeStyle = EMBER.lava; ctx.lineWidth = Math.max(1.2, w*0.6);
  ctx.beginPath(); pathFn(); ctx.stroke();
  ctx.strokeStyle = EMBER.lavaCore; ctx.lineWidth = Math.max(0.8, w*0.25);
  ctx.beginPath(); pathFn(); ctx.stroke();
}

/** A cinder cone: dark slopes, radiating ridges, a hot throat. */
function cinderCone(ctx, x, y, r, rand, hot){
  const g = ctx.createRadialGradient(x, y, r*0.15, x, y, r);
  g.addColorStop(0, "#33201a");
  g.addColorStop(0.55, EMBER.basaltLit);
  g.addColorStop(1, rgba(EMBER.crust, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(EMBER.crust, 0.8); ctx.lineWidth = 1;
  for(let i = 0; i < 9; i++){
    const a = rand()*TAU;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a)*r*0.25, y + Math.sin(a)*r*0.25);
    ctx.lineTo(x + Math.cos(a)*r*(0.8 + rand()*0.15), y + Math.sin(a)*r*(0.8 + rand()*0.15));
    ctx.stroke();
  }
  const t = ctx.createRadialGradient(x, y, 0, x, y, r*0.24);
  t.addColorStop(0, rgba(hot ? EMBER.lavaCore : EMBER.lava, hot ? 0.9 : 0.5));
  t.addColorStop(1, rgba(EMBER.lavaDeep, 0));
  ctx.fillStyle = t;
  ctx.beginPath(); ctx.arc(x, y, r*0.24, 0, TAU); ctx.fill();
}

/** One of their drill rigs, feeding on a vein: a dark frame, a warning
 *  light, and a feed line running to the lava it taps. */
function drillRig(ctx, x, y, toX, toY, rand){
  lavaStroke(ctx, () => { ctx.moveTo(x, y); ctx.lineTo(toX, toY); }, 1.6);
  ctx.fillStyle = EMBER.rig;
  ctx.fillRect(x - 7, y - 7, 14, 14);
  ctx.fillStyle = EMBER.rigLit;
  ctx.fillRect(x - 7, y - 7, 14, 4);
  ctx.strokeStyle = EMBER.rig; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 9, y + 9); ctx.lineTo(x, y - 12); ctx.lineTo(x + 9, y + 9);
  ctx.stroke();
  ctx.fillStyle = EMBER.warn;
  ctx.beginPath(); ctx.arc(x, y - 12, 1.6, 0, TAU); ctx.fill();
}

function drawEmberfloor(ctx, W, H, p, rand){
  ctx.fillStyle = EMBER.basalt;
  ctx.fillRect(0, 0, W, H);

  // The floor's own relief: cooled-flow mottling, no colour yet.
  for(let i = 0; i < 12; i++){
    const x = rand()*W, y = rand()*H, r = (0.12 + rand()*0.26)*W;
    const col = i % 3 ? EMBER.crust : EMBER.basaltLit;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, i % 3 ? 0.5 : 0.3));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  /*
   * THE LAVA RIVERS - two, full height, wrap-exact: whole sine periods of t
   * so position and slope agree at the seam (the sea's trench learned this
   * the visible way). Their light is what the rest of the tile answers to.
   */
  const rivers = [];
  for(let rv = 0; rv < 2; rv++){
    const rx0 = W*(rv ? 0.70 : 0.22) + (rand() - 0.5)*W*0.08;
    const s1 = (rand() - 0.5)*W*0.14, s2 = (rand() - 0.5)*W*0.10;
    const path = t => rx0 + Math.sin(t*TAU)*s1 + Math.sin(t*TAU*2)*s2*0.5;
    rivers.push(path);
    const wdt = 5 + rand()*3;
    // the glow first, wide and soft, so the river lights its banks
    for(let i = 0; i <= 24; i++){
      const t = i/24, x = path(t);
      const g = ctx.createRadialGradient(x, t*H, 0, x, t*H, wdt*7);
      g.addColorStop(0, rgba(EMBER.lavaDeep, 0.22));
      g.addColorStop(1, rgba(EMBER.lavaDeep, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, t*H, wdt*7, 0, TAU); ctx.fill();
    }
    lavaStroke(ctx, () => {
      for(let i = 0; i <= 48; i++){ const t = i/48; const x = path(t);
        i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
    }, wdt);
  }
  const nearRiver = (x, y) => {
    const t = y/H;
    const a = rivers[0](Math.min(1, Math.max(0, t))), b = rivers[1](Math.min(1, Math.max(0, t)));
    return Math.abs(x - a) < Math.abs(x - b) ? a : b;
  };

  // Side-cracks: short glowing fissures reaching off the rivers.
  for(let i = 0; i < 14; i++){
    const t = rand(), rv = rivers[Math.floor(rand()*2)];
    const x0 = rv(t), y0 = t*H;
    const a = rand()*TAU, l = 14 + rand()*30;
    tiled(ctx, H, y0, yy =>
      lavaStroke(ctx, () => {
        ctx.moveTo(x0, yy);
        ctx.quadraticCurveTo(x0 + Math.cos(a)*l*0.6, yy + Math.sin(a)*l*0.6 + 6,
                             x0 + Math.cos(a)*l, yy + Math.sin(a)*l);
      }, 1.6));
  }

  // Cinder cones, a few of them still warm in the throat.
  for(let i = 0; i < 7; i++){
    const x = rand()*W, y = rand()*H, r = 14 + rand()*26;
    tiled(ctx, H, y, yy => cinderCone(ctx, x, yy, r, rngFor(4200 + i), i % 3 === 0));
  }

  // Boulder fields, every stone rim-lit from its nearest river.
  for(let c = 0; c < 8; c++){
    const cx = rand()*W, cy = rand()*H, n = 4 + Math.floor(rand()*5);
    for(let i = 0; i < n; i++){
      const x = cx + (rand() - 0.5)*W*0.10, y = cy + (rand() - 0.5)*W*0.10;
      const r = 3.5 + rand()*7;
      tiled(ctx, H, y, yy => {
        const lx = nearRiver(x, yy);
        const d = lx > x ? 1 : -1;                 // which side the fire is on
        ctx.fillStyle = EMBER.crust;
        ctx.beginPath(); ctx.ellipse(x, yy, r, r*0.82, rand()*TAU, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(EMBER.lava, 0.30);
        ctx.beginPath(); ctx.ellipse(x + d*r*0.45, yy, r*0.4, r*0.6, 0, 0, TAU); ctx.fill();
      });
    }
  }

  // Their rigs, drilled into the veins - the reason the world is angry.
  for(let i = 0; i < 3; i++){
    const t = 0.15 + rand()*0.7, rv = rivers[i % 2];
    const vx = rv(t), vy = t*H;
    const x = vx + (rand() < 0.5 ? -1 : 1)*(26 + rand()*20), y = vy + (rand() - 0.5)*24;
    tiled(ctx, H, y, yy => drillRig(ctx, x, yy, vx, yy + (vy - y), rngFor(6300 + i)));
  }

  // Ash streaks, combed one way like the sea's ripples were.
  ctx.lineWidth = 1;
  for(let i = 0; i < 34; i++){
    const x = rand()*W, y = rand()*H, l = 10 + rand()*24;
    ctx.strokeStyle = rgba(i % 2 ? EMBER.ash : EMBER.ashLit, 0.08 + rand()*0.07);
    tiled(ctx, H, y, yy => {
      ctx.beginPath();
      ctx.moveTo(x, yy); ctx.lineTo(x - l*0.9, yy + l*0.45);
      ctx.stroke();
    });
  }

  // Embers: the only loose sparks of colour, thin on the ground.
  for(let i = 0; i < 26; i++){
    const x = rand()*W, y = rand()*H;
    ctx.fillStyle = rgba(i % 3 ? EMBER.lava : EMBER.lavaCore, 0.25 + rand()*0.35);
    tiled(ctx, H, y, yy => ctx.fillRect(x, yy, 1.5, 1.5));
  }
}

/*
 * THE FORGE-CITY - the once-layer. Their works: a vast caldera with a lava
 * lake for a heart, the fortified city ringed around it, feed pipes drinking
 * straight from the melt. Its ash apron settles it onto the tile wherever
 * the scroll has carried the floor, the same trick the sunken flagship used.
 */
function drawForgecity(ctx, W, H, p, rand){
  const cx = W*0.52, cy = H*0.48, R = W*0.30;
  /*
   * Nothing on a volcano is a circle. The rim and the shore each get their
   * own low-frequency wobble, and every part of the picture - cliff light,
   * ridge lines, ramparts, districts - reads its radius off these, so the
   * whole caldera agrees on one irregular shape instead of being a stack of
   * concentric geometry. (The first draft WAS a stack of concentric
   * geometry, and the family called it what it was: a placeholder.)
   */
  const w1 = rand()*TAU, w2 = rand()*TAU, w3 = rand()*TAU;
  const rimR  = a => R*(1 + 0.07*Math.sin(a*3 + w1) + 0.045*Math.sin(a*5 + w2)
                          + 0.03*Math.sin(a*8 + w3));
  const lakeR = a => R*(0.52 + 0.045*Math.sin(a*4 + w2) + 0.028*Math.sin(a*7 + w1));
  const P = (fn, k) => { ctx.beginPath();
    for(let i = 0; i <= 72; i++){ const a = (i/72)*TAU;
      const r = fn(a)*(k || 1);
      const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); };

  // The wind has combed this whole tile's ash one way; the caldera's own
  // plume follows it, an ash shadow stretched downwind rather than a halo.
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(Math.atan2(0.45, -0.9));
  const plume = ctx.createRadialGradient(R*0.4, 0, R*0.3, R*0.4, 0, R*2.2);
  plume.addColorStop(0, rgba(EMBER.ash, 0.30));
  plume.addColorStop(0.6, rgba(EMBER.ash, 0.13));
  plume.addColorStop(1, rgba(EMBER.ash, 0));
  ctx.fillStyle = plume;
  ctx.beginPath(); ctx.ellipse(R*0.4, 0, R*2.2, R*1.35, 0, 0, TAU); ctx.fill();
  ctx.restore();

  // The mountain: a broad dark shield the crater sits in.
  const shield = ctx.createRadialGradient(cx, cy, R*0.4, cx, cy, R*1.5);
  shield.addColorStop(0, rgba(EMBER.basaltLit, 0.9));
  shield.addColorStop(0.55, rgba("#1b100b", 0.95));
  shield.addColorStop(0.85, rgba(EMBER.basalt, 0.6));
  shield.addColorStop(1, rgba(EMBER.basalt, 0));
  ctx.fillStyle = shield;
  P(rimR, 1.5); ctx.fill();

  // Ridges pour down the flanks from the rim, long and short, the way water
  // (or here, old lava) actually carved them. Scree specks between.
  ctx.lineWidth = 1.2;
  for(let i = 0; i < 56; i++){
    const a = rand()*TAU;
    const r0 = rimR(a)*1.01, r1 = rimR(a)*(1.12 + rand()*0.3);
    ctx.strokeStyle = rgba(i % 3 ? EMBER.crust : "#000000", 0.5 + rand()*0.3);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a)*r0, cy + Math.sin(a)*r0);
    const bend = a + (rand() - 0.5)*0.08;
    ctx.lineTo(cx + Math.cos(bend)*r1, cy + Math.sin(bend)*r1);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(EMBER.ashLit, 0.25);
  for(let i = 0; i < 60; i++){
    const a = rand()*TAU, r = rimR(a)*(1.05 + rand()*0.35);
    ctx.fillRect(cx + Math.cos(a)*r, cy + Math.sin(a)*r, 1.5, 1.5);
  }

  // The inner wall, lit by what it holds: the glow climbs the cliff, then
  // the crest cuts it as a hard dark edge - one bright ring, one black one,
  // and the eye reads a drop the geometry never has to draw.
  for(let q = 0; q < 3; q++){
    ctx.strokeStyle = rgba(EMBER.lava, [0.30, 0.16, 0.08][q]);
    ctx.lineWidth = 6 + q*8;
    P(a => lakeR(a)*(1.12 + q*0.16)); ctx.stroke();
  }
  ctx.strokeStyle = rgba("#000000", 0.75); ctx.lineWidth = 3;
  P(rimR, 0.97); ctx.stroke();
  ctx.strokeStyle = rgba(EMBER.basaltLit, 0.8); ctx.lineWidth = 1.4;
  P(rimR, 0.955); ctx.stroke();

  /* ---- THE LAKE ---- */
  const lake = ctx.createRadialGradient(cx - R*0.06, cy - R*0.05, 0, cx, cy, R*0.60);
  lake.addColorStop(0, EMBER.lavaCore);
  lake.addColorStop(0.4, EMBER.lava);
  lake.addColorStop(0.8, EMBER.lavaDeep);
  lake.addColorStop(1, EMBER.lavaDark);
  ctx.fillStyle = lake;
  P(lakeR); ctx.fill();

  ctx.save();
  P(lakeR); ctx.clip();
  // Convection cells: the melt has weather.
  ctx.globalCompositeOperation = "lighter";
  for(let i = 0; i < 14; i++){
    const a = rand()*TAU, d = Math.sqrt(rand())*R*0.42;
    const x = cx + Math.cos(a)*d, y = cy + Math.sin(a)*d, r = 8 + rand()*22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba("#fff6c8", 0.20 + rand()*0.12));
    g.addColorStop(1, rgba("#fff6c8", 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  // Flow lines: darker skin dragged around the cells.
  ctx.lineWidth = 2.2;
  for(let i = 0; i < 16; i++){
    const q = R*(0.12 + rand()*0.42), a0 = rand()*TAU, span = 0.5 + rand()*1.1;
    ctx.strokeStyle = rgba(EMBER.lavaDeep, 0.30 + rand()*0.25);
    ctx.beginPath(); ctx.arc(cx + (rand() - 0.5)*R*0.14, cy + (rand() - 0.5)*R*0.14,
                             q, a0, a0 + span); ctx.stroke();
  }
  // Two white-hot fissures where plates of skin are pulling apart.
  for(let i = 0; i < 2; i++){
    const a0 = rand()*TAU;
    let x = cx + Math.cos(a0)*R*0.30, y = cy + Math.sin(a0)*R*0.30;
    let hd = a0 + Math.PI + (rand() - 0.5)*0.6;
    ctx.strokeStyle = rgba("#fff6c8", 0.85); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, y);
    for(let k = 0; k < 5; k++){
      hd += (rand() - 0.5)*0.7;
      x += Math.cos(hd)*R*0.11; y += Math.sin(hd)*R*0.11;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Crust rafts hug the shore, where the melt is coolest - broken dark
  // plates with glow in the cracks between them.
  for(let i = 0; i < 11; i++){
    const a = rand()*TAU, r = lakeR(a)*(0.80 + rand()*0.13);
    const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
    for(let k = 0; k < 2 + Math.floor(rand()*2); k++){
      ctx.save();
      ctx.translate(x + (rand() - 0.5)*14, y + (rand() - 0.5)*10);
      ctx.rotate(rand()*TAU);
      ctx.fillStyle = rgba("#241009", 0.85);
      ctx.beginPath();
      ctx.moveTo(-7 - rand()*5, 0); ctx.lineTo(-1, -4 - rand()*3);
      ctx.lineTo(7 + rand()*5, -1); ctx.lineTo(2, 4 + rand()*3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
  // The shore itself: a chilled dark line where melt meets rock.
  ctx.strokeStyle = rgba("#1c0b05", 0.9); ctx.lineWidth = 3;
  P(lakeR); ctx.stroke();

  /* ---- THE BREACH ---- the rim failed at one point, and the lake found it.
     The spill runs downhill and feathers out in a cooling fan - the one
     place the mountain and the lake visibly touch. */
  const bA = 2.4;
  const bx0 = cx + Math.cos(bA)*lakeR(bA)*0.96, by0 = cy + Math.sin(bA)*lakeR(bA)*0.96;
  const bx1 = cx + Math.cos(bA)*rimR(bA)*1.34, by1 = cy + Math.sin(bA)*rimR(bA)*1.34;
  lavaStroke(ctx, () => {
    ctx.moveTo(bx0, by0);
    ctx.quadraticCurveTo((bx0 + bx1)/2 + 10, (by0 + by1)/2 - 8, bx1, by1);
  }, 4.5);
  const fan = ctx.createRadialGradient(bx1, by1, 0, bx1, by1, R*0.34);
  fan.addColorStop(0, rgba(EMBER.lava, 0.45));
  fan.addColorStop(0.5, rgba(EMBER.lavaDeep, 0.25));
  fan.addColorStop(1, rgba(EMBER.lavaDark, 0));
  ctx.fillStyle = fan;
  ctx.beginPath(); ctx.arc(bx1, by1, R*0.34, 0, TAU); ctx.fill();
  for(let i = 0; i < 8; i++){
    const a = bA + (rand() - 0.5)*0.9, d = R*(0.1 + rand()*0.28);
    ctx.fillStyle = rgba(i % 2 ? EMBER.lava : EMBER.lavaCore, 0.5 + rand()*0.3);
    ctx.fillRect(bx1 + Math.cos(a)*d, by1 + Math.sin(a)*d, 1.8, 1.8);
  }

  /* ---- THE CITY ---- four districts on the crest, each a huddle of real
     buildings rather than an even sprinkle of chips; ramparts follow the
     rim between them, and everything faces the heat it lives off. */
  const districts = [0.35, 1.35, 3.6, 4.9];      // radians; the breach stays clear
  const dPos = a => [cx + Math.cos(a)*rimR(a)*1.02, cy + Math.sin(a)*rimR(a)*1.02];

  // Ramparts first, under the buildings: broken wall segments riding the rim.
  ctx.strokeStyle = "#2b2530"; ctx.lineWidth = 4; ctx.lineCap = "butt";
  for(let d = 0; d < districts.length; d++){
    const a0 = districts[d], a1 = districts[(d + 1) % districts.length];
    let span = (a1 - a0 + TAU) % TAU;
    if(span > 2.2) continue;                       // the breach side stays open
    for(let t = 0.12; t < span - 0.12; t += 0.3){
      ctx.beginPath();
      for(let k = 0; k <= 6; k++){
        const a = a0 + t + (k/6)*0.18;
        const r = rimR(a)*1.02;
        const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // a watchtower where each stretch of wall begins
    const [tx, ty] = dPos(a0 + 0.12);
    ctx.fillStyle = "#2b2530"; ctx.fillRect(tx - 3, ty - 3, 6, 6);
    ctx.fillStyle = EMBER.warn;
    ctx.beginPath(); ctx.arc(tx, ty - 4, 1.4, 0, TAU); ctx.fill();
  }

  const building = (x, y, bw, bh, ang, opts) => {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = rgba("#01060a", 0.55);
    ctx.fillRect(-bw/2 + 3, -bh/2 + 3, bw, bh);                  // shadow, downwind
    ctx.fillStyle = "#26222c";
    ctx.fillRect(-bw/2, -bh/2, bw, bh);
    ctx.fillStyle = "#413a4a";
    ctx.fillRect(-bw/2, -bh/2, bw, 4);                           // the lit roof edge
    ctx.strokeStyle = rgba("#0d0b12", 0.9); ctx.lineWidth = 1;
    ctx.strokeRect(-bw/2, -bh/2, bw, bh);
    if(opts && opts.door){                                       // the forge hall
      ctx.fillStyle = EMBER.lavaCore;
      ctx.fillRect(-bw*0.28, bh/2 - 4, bw*0.56, 3);
      const dg = ctx.createRadialGradient(0, bh/2, 0, 0, bh/2, bw*0.5);
      dg.addColorStop(0, rgba(EMBER.lava, 0.55));
      dg.addColorStop(1, rgba(EMBER.lava, 0));
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(0, bh/2, bw*0.5, 0, TAU); ctx.fill();
    }
    const rows = Math.max(1, Math.floor((bh - 8)/7));
    ctx.fillStyle = EMBER.lava;
    for(let ry = 0; ry < rows; ry++)
      for(let q = 0; q < Math.floor((bw - 4)/6); q++)
        if((q + ry) % 3 !== 2)                                   // some windows dark
          ctx.fillRect(-bw/2 + 3 + q*6, -bh/2 + 7 + ry*7, 2.4, 2.4);
    if(opts && opts.stack){
      ctx.fillStyle = "#26222c";
      ctx.beginPath(); ctx.arc(bw*0.3, -bh/2 - 4, 3.6, 0, TAU); ctx.fill();
      for(let k = 1; k <= 3; k++){                               // smoke, downwind
        const sm = ctx.createRadialGradient(bw*0.3 - k*9, -bh/2 - 5 - k*7, 0,
                                            bw*0.3 - k*9, -bh/2 - 5 - k*7, 5 + k*3);
        sm.addColorStop(0, rgba(EMBER.ashLit, 0.30 - k*0.07));
        sm.addColorStop(1, rgba(EMBER.ashLit, 0));
        ctx.fillStyle = sm;
        ctx.beginPath(); ctx.arc(bw*0.3 - k*9, -bh/2 - 5 - k*7, 5 + k*3, 0, TAU); ctx.fill();
      }
    }
    if(opts && opts.warn){
      ctx.fillStyle = EMBER.warn;
      ctx.beginPath(); ctx.arc(bw/2 - 1, -bh/2 - 1, 1.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  districts.forEach((da, di) => {
    const tangent = da + Math.PI/2;
    const [hx, hy] = dPos(da);
    // the district's ground plate, so the buildings stand on something
    ctx.save();
    ctx.translate(hx, hy); ctx.rotate(tangent);
    ctx.fillStyle = rgba("#191521", 0.85);
    ctx.fillRect(-34, -18, 68, 36);
    ctx.strokeStyle = rgba("#0d0b12", 0.8); ctx.lineWidth = 1.2;
    ctx.strokeRect(-34, -18, 68, 36);
    ctx.restore();
    if(di === 0){
      // the forge hall itself: the big one, door glowing at the lake
      building(hx, hy, 34, 22, da - Math.PI/2, { door:true, stack:true, warn:true });
      building(hx + Math.cos(tangent)*26, hy + Math.sin(tangent)*26, 14, 12, da - Math.PI/2, {});
    } else {
      const n = 3 + (di % 2);
      for(let k = 0; k < n; k++){
        const off = (k - (n - 1)/2)*17;
        const bx = hx + Math.cos(tangent)*off, by = hy + Math.sin(tangent)*off;
        building(bx, by, 12 + ((k + di) % 3)*6, 10 + ((k + di + 1) % 3)*5,
                 da - Math.PI/2, { stack: k === 1, warn: k === 0 });
      }
    }
  });

  // The intakes: two thick dark pipes climbing from the shore to a district,
  // drinking at a lit mouth - machinery on a wound, same story as the rigs.
  [0.35, 3.6].forEach(a => {
    const sx = cx + Math.cos(a)*lakeR(a)*0.97, sy = cy + Math.sin(a)*lakeR(a)*0.97;
    const [ex, ey] = dPos(a);
    ctx.strokeStyle = "#26222c"; ctx.lineWidth = 5.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = "#413a4a"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    const mg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 9);
    mg.addColorStop(0, rgba(EMBER.lavaCore, 0.9));
    mg.addColorStop(1, rgba(EMBER.lava, 0));
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = "#26222c"; ctx.fillRect(sx - 3.5, sy - 3.5, 7, 7);
    // the pump house halfway up
    const px2 = (sx + ex)/2, py2 = (sy + ey)/2;
    ctx.fillStyle = "#2b2530"; ctx.fillRect(px2 - 5, py2 - 4, 10, 8);
    ctx.fillStyle = EMBER.warn;
    ctx.beginPath(); ctx.arc(px2, py2 - 5, 1.3, 0, TAU); ctx.fill();
  });

  // The landing aprons, tucked against two districts on the outside.
  [1.35, 4.9].forEach(a => {
    const r = rimR(a)*1.30;
    const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a + Math.PI/2);
    ctx.fillStyle = rgba(EMBER.ash, 0.30);
    ctx.fillRect(-14, -10, 28, 20);
    ctx.strokeStyle = rgba(EMBER.ashLit, 0.5); ctx.lineWidth = 1;
    ctx.strokeRect(-14, -10, 28, 20);
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = EMBER.warn;
    ctx.beginPath(); ctx.arc(-11, -7, 1.3, 0, TAU); ctx.fill();
    ctx.restore();
  });
}

/* ---------------------------------------------------------
   SUNSTRUCK - a desert from above.
   ---------------------------------------------------------
   The sea's rule again: one thing crosses the whole floor and everything
   else answers to it. Here the thing is the SUN. It sits high and to the
   upper left, so every crest is pale on that side and dark on the other,
   every rock and shrub and tower throws a shadow down and to the right, and
   the ships (mirage.js) throw theirs the same way - which is what makes a
   shadow on this floor read as a fact about the ground rather than a
   decoration on the sprite. A dry riverbed runs the full height, and their
   mirror towers stand in the sand: the enemy is in the geography here as
   well, and it is the reason the air lies. */

const DUNE = {
  sand:"#d9a85f", sandLit:"#f2cf8a", sandPale:"#f6dfae", sandDark:"#b8813f",
  shade:"#8a5a2b", shadow:"#2b1a0c",
  bed:"#c49257", bedDark:"#a3733a", salt:"#fbf1d6",
  rock:"#7a5a3c", rockLit:"#a8845c", scrub:"#6b6a3a", scrubLit:"#8f8d4e",
  tower:"#2b2530", towerLit:"#4a4353", mirror:"#e8fbff", glint:"#ffffff", warn:"#ff5d73",
};

/* How far a thing of height h throws its shadow, and which way: the one
 * light rule for the whole world, shared with the crest painter below. */
const SUN_DX = 0.55, SUN_DY = 1.0;

/** A stone with the sun on one side and its shadow on the sand beside it. */
function duneRock(ctx, x, y, r, rand){
  const rot = rand()*TAU;
  ctx.fillStyle = rgba(DUNE.shadow, 0.28);
  ctx.beginPath(); ctx.ellipse(x + r*0.7*SUN_DX + r*0.3, y + r*0.7*SUN_DY, r*1.05, r*0.7, rot, 0, TAU); ctx.fill();
  ctx.fillStyle = DUNE.rock;
  ctx.beginPath(); ctx.ellipse(x, y, r, r*0.8, rot, 0, TAU); ctx.fill();
  ctx.fillStyle = DUNE.rockLit;
  ctx.beginPath(); ctx.ellipse(x - r*0.3, y - r*0.32, r*0.5, r*0.36, rot, 0, TAU); ctx.fill();
}

/** A dry shrub: a few olive strokes, and the small shadow that says it
 *  stands up off the sand. */
function duneScrub(ctx, x, y, r, rand){
  ctx.fillStyle = rgba(DUNE.shadow, 0.2);
  ctx.beginPath(); ctx.ellipse(x + r*0.5, y + r*0.8, r*0.9, r*0.45, 0, 0, TAU); ctx.fill();
  ctx.lineCap = "round";
  for(let i = 0; i < 7; i++){
    const a = rand()*TAU, l = r*(0.5 + rand()*0.6);
    ctx.strokeStyle = i % 2 ? DUNE.scrub : DUNE.scrubLit; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a)*l, y + Math.sin(a)*l); ctx.stroke();
  }
}

/** One of their mirror towers, from above: a dark base with a warning eye,
 *  a bright plate tipped at the sun, and the long shadow of something tall. */
function mirrorTower(ctx, x, y, h, rand){
  // the shadow first - the tallest thing on the tile throws the longest one
  ctx.strokeStyle = rgba(DUNE.shadow, 0.34); ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + h*SUN_DX, y + h*SUN_DY); ctx.stroke();
  ctx.fillStyle = rgba(DUNE.shadow, 0.34);
  ctx.beginPath(); ctx.arc(x + h*SUN_DX, y + h*SUN_DY, 4.5, 0, TAU); ctx.fill();
  // the base: their angular dark, with the red eye every one of their works wears
  ctx.fillStyle = DUNE.tower; ctx.fillRect(x - 6, y - 6, 12, 12);
  ctx.fillStyle = DUNE.towerLit; ctx.fillRect(x - 6, y - 6, 12, 3.5);
  ctx.strokeStyle = DUNE.tower; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 8, y + 8); ctx.lineTo(x, y - 9); ctx.lineTo(x + 8, y + 8); ctx.stroke();
  // the mirror, tipped up-left at the sun, and the glint that says it is glass
  ctx.save(); ctx.translate(x - 3, y - 4); ctx.rotate(-0.6 + (rand() - 0.5)*0.2);
  ctx.fillStyle = DUNE.mirror; ctx.fillRect(-7, -4.5, 14, 9);
  ctx.strokeStyle = DUNE.tower; ctx.lineWidth = 1; ctx.strokeRect(-7, -4.5, 14, 9);
  ctx.restore();
  const g = ctx.createRadialGradient(x - 5, y - 6, 0, x - 5, y - 6, 9);
  g.addColorStop(0, rgba(DUNE.glint, 0.95)); g.addColorStop(0.35, rgba(DUNE.glint, 0.4)); g.addColorStop(1, rgba(DUNE.glint, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x - 5, y - 6, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = DUNE.warn;
  ctx.beginPath(); ctx.arc(x + 5, y + 5, 1.4, 0, TAU); ctx.fill();
}

function drawDunes(ctx, W, H, p, rand){
  ctx.fillStyle = DUNE.sand;
  ctx.fillRect(0, 0, W, H);

  // The floor's own relief: broad soft mottling, no crests yet.
  for(let i = 0; i < 12; i++){
    const x = rand()*W, y = rand()*H, r = (0.12 + rand()*0.28)*W;
    const col = i % 3 ? DUNE.sandLit : DUNE.sandDark;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, i % 3 ? 0.35 : 0.28));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  /*
   * THE DRY RIVERBED - full height, wrap-exact: whole sine periods of t so
   * position and slope agree at the seam. Water ran here once; the sky
   * river that poured into the sea never reached this far. Its floor is
   * darker and cracked, with salt where the last of it dried.
   */
  const bx0 = W*(0.28 + rand()*0.12);
  const s1 = (rand() - 0.5)*W*0.16, s2 = (rand() - 0.5)*W*0.10;
  const bed = t => bx0 + Math.sin(t*TAU)*s1 + Math.sin(t*TAU*2)*s2*0.5;
  const bedW = 22 + rand()*8;
  const bedPath = () => {
    for(let i = 0; i <= 48; i++){ const t = i/48; const x = bed(t);
      i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
  };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // the bank's shadow on the sun-away side, then the bed, then its lit bank
  ctx.strokeStyle = rgba(DUNE.shade, 0.35); ctx.lineWidth = bedW + 6;
  ctx.save(); ctx.translate(3, 4); ctx.beginPath(); bedPath(); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = DUNE.bed; ctx.lineWidth = bedW;
  ctx.beginPath(); bedPath(); ctx.stroke();
  ctx.strokeStyle = DUNE.bedDark; ctx.lineWidth = bedW*0.55;
  ctx.beginPath(); bedPath(); ctx.stroke();
  ctx.strokeStyle = rgba(DUNE.sandPale, 0.7); ctx.lineWidth = 1.5;
  ctx.save(); ctx.translate(-bedW*0.5 - 1, -1); ctx.beginPath(); bedPath(); ctx.stroke(); ctx.restore();
  // mud cracks and salt on the bed
  ctx.strokeStyle = rgba(DUNE.shade, 0.5); ctx.lineWidth = 1;
  for(let i = 0; i < 40; i++){
    const t = rand(), x = bed(t) + (rand() - 0.5)*bedW*0.8, y = t*H;
    const a = rand()*TAU, l = 4 + rand()*7;
    tiled(ctx, H, y, yy => {
      ctx.beginPath(); ctx.moveTo(x, yy);
      ctx.lineTo(x + Math.cos(a)*l, yy + Math.sin(a)*l);
      ctx.lineTo(x + Math.cos(a + 1.2)*l*0.6, yy + Math.sin(a + 1.2)*l*0.6);
      ctx.stroke();
    });
  }
  for(let i = 0; i < 9; i++){
    const t = rand(), x = bed(t) + (rand() - 0.5)*bedW*0.5, y = t*H, r = 3 + rand()*5;
    tiled(ctx, H, y, yy => {
      ctx.fillStyle = rgba(DUNE.salt, 0.55);
      ctx.beginPath(); ctx.ellipse(x, yy, r, r*0.6, rand()*TAU, 0, TAU); ctx.fill();
    });
  }

  /*
   * THE CRESTS. Long S-curves crossing the tile, each with a pale face on
   * the sun side and a dark face on the other - the same light rule as
   * every shadow on this world. Three strokes each: the shade, offset
   * down-right; the lit face, offset up-left; the knife-edge itself.
   */
  const crestAt = (x0, y0, len, a, amp) => {
    const cx = t => x0 + Math.cos(a)*t*len + Math.cos(a + Math.PI/2)*Math.sin(t*TAU)*amp;
    const cy = t => y0 + Math.sin(a)*t*len + Math.sin(a + Math.PI/2)*Math.sin(t*TAU)*amp;
    return { cx, cy };
  };
  for(let i = 0; i < 9; i++){
    const x0 = rand()*W, y0 = rand()*H;
    const a = -0.25 + rand()*0.5 + (i % 2 ? Math.PI : 0);
    const len = W*(0.35 + rand()*0.5), amp = 8 + rand()*22;
    const c = crestAt(x0, y0, len, a, amp);
    const path = (dx, dy) => {
      ctx.beginPath();
      for(let k = 0; k <= 32; k++){ const t = k/32;
        k ? ctx.lineTo(c.cx(t) + dx, c.cy(t) + dy) : ctx.moveTo(c.cx(t) + dx, c.cy(t) + dy); }
    };
    tiled(ctx, H, y0, yy => {
      const dy0 = yy - y0;
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(DUNE.sandDark, 0.55); ctx.lineWidth = 14;
      path(5, 7 + dy0); ctx.stroke();
      ctx.strokeStyle = rgba(DUNE.shade, 0.22); ctx.lineWidth = 7;
      path(4, 6 + dy0); ctx.stroke();
      ctx.strokeStyle = rgba(DUNE.sandLit, 0.8); ctx.lineWidth = 12;
      path(-4, -6 + dy0); ctx.stroke();
      ctx.strokeStyle = rgba(DUNE.sandPale, 0.9); ctx.lineWidth = 1.6;
      path(0, dy0); ctx.stroke();
    });
  }

  // Ripples: short curved strokes combed one way, the wind that built the dunes.
  ctx.lineWidth = 1;
  for(let i = 0; i < 70; i++){
    const x = rand()*W, y = rand()*H, l = 8 + rand()*16;
    ctx.strokeStyle = rgba(i % 2 ? DUNE.sandDark : DUNE.sandPale, 0.10 + rand()*0.12);
    tiled(ctx, H, y, yy => {
      ctx.beginPath(); ctx.moveTo(x, yy);
      ctx.quadraticCurveTo(x + l*0.5, yy - 3, x + l, yy + 1);
      ctx.stroke();
    });
  }

  // Rock fields, each stone shadowed the one way.
  for(let c = 0; c < 6; c++){
    const cx = rand()*W, cy = rand()*H, n = 3 + Math.floor(rand()*5);
    for(let i = 0; i < n; i++){
      const x = cx + (rand() - 0.5)*W*0.10, y = cy + (rand() - 0.5)*W*0.10;
      const r = 3 + rand()*6;
      tiled(ctx, H, y, yy => duneRock(ctx, x, yy, r, rngFor(5100 + c*16 + i)));
    }
  }

  // What still grows: a few dry shrubs along the old river, where the last water was.
  for(let i = 0; i < 9; i++){
    const t = rand(), side = rand() < 0.5 ? -1 : 1;
    const x = bed(t) + side*(bedW*0.7 + rand()*30), y = t*H, r = 4 + rand()*5;
    tiled(ctx, H, y, yy => duneScrub(ctx, x, yy, r, rngFor(5300 + i)));
  }

  // Something huge died here once: bleached ribs in the sand, and their shadows.
  {
    const x = W*(0.6 + rand()*0.25), y = rand()*H, n = 5, sp = 9;
    tiled(ctx, H, y, yy => {
      for(let i = 0; i < n; i++){
        const rx = x + i*sp, r = 10 + Math.sin(i/(n - 1)*Math.PI)*8;
        ctx.strokeStyle = rgba(DUNE.shadow, 0.22); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(rx + 3, yy + 4, r, Math.PI*0.9, Math.PI*1.9); ctx.stroke();
        ctx.strokeStyle = DUNE.salt; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(rx, yy, r, Math.PI*0.9, Math.PI*1.9); ctx.stroke();
      }
      ctx.strokeStyle = DUNE.salt; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 6, yy); ctx.lineTo(x + n*sp, yy); ctx.stroke();
    });
  }

  // Their towers, standing in the dunes - the reason the air lies.
  for(let i = 0; i < 4; i++){
    const x = 30 + rand()*(W - 60), y = rand()*H, h = 26 + rand()*14;
    // never in the riverbed: the tower is on the dune, over the water it drank
    const t = y/H;
    const tx = Math.abs(x - bed(t)) < bedW ? x + bedW*1.4 : x;
    tiled(ctx, H, y, yy => mirrorTower(ctx, tx, yy, h, rngFor(5500 + i)));
  }

  // Glare: the sun catching loose grains, a sparse scatter of white.
  for(let i = 0; i < 30; i++){
    const x = rand()*W, y = rand()*H;
    ctx.fillStyle = rgba(DUNE.glint, 0.25 + rand()*0.4);
    tiled(ctx, H, y, yy => ctx.fillRect(x, yy, 1.4, 1.4));
  }
}

/*
 * THE SUN-CATCHER - the once-layer. Their great mirror field: rings of
 * heliostats on a salt pan, every plate turned to one tower, and the tower's
 * receiver white-hot with the light they all throw at it. This is the machine
 * that cooks the sky. Its salt apron settles it onto the sand wherever the
 * scroll has carried the floor, the same trick the forge-city's ash used.
 */
function drawSuncatcher(ctx, W, H, p, rand){
  const cx = W*0.52, cy = H*0.48, R = W*0.30;

  // The salt pan it was built on: pale, flat, and cracked into plates.
  const pan = ctx.createRadialGradient(cx, cy, R*0.2, cx, cy, R*1.9);
  pan.addColorStop(0, rgba(DUNE.salt, 0.85));
  pan.addColorStop(0.55, rgba(DUNE.salt, 0.55));
  pan.addColorStop(1, rgba(DUNE.salt, 0));
  ctx.fillStyle = pan;
  ctx.beginPath(); ctx.arc(cx, cy, R*1.9, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(DUNE.sandDark, 0.35); ctx.lineWidth = 1;
  for(let i = 0; i < 60; i++){
    const a = rand()*TAU, d = rand()*R*1.6;
    const x = cx + Math.cos(a)*d, y = cy + Math.sin(a)*d;
    const b = rand()*TAU, l = 10 + rand()*22;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(b)*l, y + Math.sin(b)*l);
    ctx.lineTo(x + Math.cos(b + 1.1)*l*0.7, y + Math.sin(b + 1.1)*l*0.7);
    ctx.stroke();
  }

  // The scorch: sand baked dark in a ring around the focus.
  const burn = ctx.createRadialGradient(cx, cy, R*0.08, cx, cy, R*0.42);
  burn.addColorStop(0, rgba(DUNE.shade, 0.55));
  burn.addColorStop(0.5, rgba(DUNE.shade, 0.25));
  burn.addColorStop(1, rgba(DUNE.shade, 0));
  ctx.fillStyle = burn;
  ctx.beginPath(); ctx.arc(cx, cy, R*0.42, 0, TAU); ctx.fill();

  // The service roads: dark tracks from the wall to the tower and out to the aprons.
  ctx.strokeStyle = rgba(DUNE.sandDark, 0.55); ctx.lineWidth = 4; ctx.lineCap = "round";
  for(let i = 0; i < 3; i++){
    const a = (i/3)*TAU + 0.4;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a)*R*0.12, cy + Math.sin(a)*R*0.12);
    ctx.lineTo(cx + Math.cos(a)*R*1.3, cy + Math.sin(a)*R*1.3); ctx.stroke();
  }

  /*
   * The heliostats: three rings of plates, every one rotated to face the
   * tower, every one with its own small shadow and its own glint. Rows are
   * staggered so the field reads as a machine that was planned, not sprinkled.
   */
  for(let ring = 0; ring < 3; ring++){
    const d = R*(0.42 + ring*0.24), n = 12 + ring*8;
    for(let i = 0; i < n; i++){
      const a = (i/n)*TAU + ring*0.13;
      const x = cx + Math.cos(a)*d, y = cy + Math.sin(a)*d;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI/2);
      ctx.fillStyle = rgba(DUNE.shadow, 0.3);
      ctx.fillRect(-7 + 3, -4 + 4, 14, 8);
      ctx.fillStyle = DUNE.tower; ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.fillStyle = DUNE.mirror; ctx.fillRect(-7, -4, 14, 8);
      ctx.strokeStyle = DUNE.tower; ctx.lineWidth = 1; ctx.strokeRect(-7, -4, 14, 8);
      ctx.restore();
      if(i % 3 === 0){
        const g = ctx.createRadialGradient(x - 2, y - 2, 0, x - 2, y - 2, 7);
        g.addColorStop(0, rgba(DUNE.glint, 0.9)); g.addColorStop(1, rgba(DUNE.glint, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x - 2, y - 2, 7, 0, TAU); ctx.fill();
      }
    }
  }

  // Their cables, drinking the heat away to the compound.
  ctx.strokeStyle = DUNE.tower; ctx.lineWidth = 2.5;
  for(let i = 0; i < 4; i++){
    const a = (i/4)*TAU + 0.9;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a)*R*0.1, cy + Math.sin(a)*R*0.1);
    ctx.lineTo(cx + Math.cos(a)*R*0.95, cy + Math.sin(a)*R*0.95); ctx.stroke();
  }

  // THE TOWER. The tallest thing on the world throws the longest shadow, and
  // its receiver is the brightest thing on it - the point every plate aims at.
  const th = R*0.55;
  ctx.strokeStyle = rgba(DUNE.shadow, 0.4); ctx.lineWidth = 9; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + th*SUN_DX, cy + th*SUN_DY); ctx.stroke();
  ctx.fillStyle = rgba(DUNE.shadow, 0.4);
  ctx.beginPath(); ctx.arc(cx + th*SUN_DX, cy + th*SUN_DY, 13, 0, TAU); ctx.fill();
  ctx.fillStyle = DUNE.tower;
  ctx.beginPath(); ctx.arc(cx, cy, 15, 0, TAU); ctx.fill();
  ctx.strokeStyle = DUNE.towerLit; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 15, 0, TAU); ctx.stroke();
  for(let i = 0; i < 4; i++){
    const a = (i/4)*TAU + 0.4;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a)*22, cy + Math.sin(a)*22); ctx.stroke();
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34);
  core.addColorStop(0, rgba(DUNE.glint, 1));
  core.addColorStop(0.2, rgba("#fff3d6", 0.95));
  core.addColorStop(0.5, rgba("#ffd77a", 0.45));
  core.addColorStop(1, rgba("#ffd77a", 0));
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, 34, 0, TAU); ctx.fill();
  ctx.fillStyle = DUNE.warn;
  ctx.beginPath(); ctx.arc(cx, cy - 15, 2, 0, TAU); ctx.fill();

  /*
   * The compound, off the field on the sun-away side: their angular blocks
   * inside one wall, red eyes, stacks - the same brand the forge-city wears,
   * bleached by a hotter sun.
   */
  const kx = cx + R*1.22, ky = cy + R*0.55;
  ctx.strokeStyle = DUNE.tower; ctx.lineWidth = 3;
  ctx.strokeRect(kx - 46, ky - 30, 92, 60);
  ctx.fillStyle = DUNE.warn;
  [[-46, -30], [46, -30], [-46, 30], [46, 30]].forEach(([ox, oy]) => {
    ctx.beginPath(); ctx.arc(kx + ox, ky + oy, 1.7, 0, TAU); ctx.fill();
  });
  for(let i = 0; i < 6; i++){
    const bx = kx - 32 + (i % 3)*30, by = ky - 14 + Math.floor(i/3)*28;
    const bw = 18 + (i % 2)*6, bh = 12 + ((i + 1) % 3)*4;
    ctx.fillStyle = rgba(DUNE.shadow, 0.4);
    ctx.fillRect(bx - bw/2 + 4, by - bh/2 + 6, bw, bh);       // shadow, down-right
    ctx.fillStyle = DUNE.tower; ctx.fillRect(bx - bw/2, by - bh/2, bw, bh);
    ctx.fillStyle = DUNE.towerLit; ctx.fillRect(bx - bw/2, by - bh/2, bw, 3.5);
    ctx.fillStyle = DUNE.mirror;
    for(let q = 0; q < 2 + (i % 2); q++) ctx.fillRect(bx - bw/2 + 3 + q*6, by + 1, 2.5, 2.5);
    if(i % 3 === 0){
      ctx.fillStyle = DUNE.warn;
      ctx.beginPath(); ctx.arc(bx + bw/2 - 1, by - bh/2 - 1, 1.5, 0, TAU); ctx.fill();
    }
  }

  // The landing aprons outside the wall, where the haulers wait for the heat.
  for(let i = 0; i < 2; i++){
    const x = kx + (i ? 70 : -80), y = ky + (i ? 8 : -40);
    ctx.fillStyle = rgba(DUNE.sandDark, 0.45);
    ctx.fillRect(x - 14, y - 10, 28, 20);
    ctx.strokeStyle = rgba(DUNE.tower, 0.7); ctx.lineWidth = 1;
    ctx.strokeRect(x - 14, y - 10, 28, 20);
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = DUNE.warn;
    ctx.beginPath(); ctx.arc(x - 11, y - 7, 1.3, 0, TAU); ctx.fill();
  }
}

/* ---------------------------------------------------------
   FROSTFALL - a frozen sea from above.
   ---------------------------------------------------------
   The sea's rule for the third time: one thing crosses the whole floor and
   everything else answers to it. Here it is the FROZEN RIVER - and the cold
   itself, which has no sun to throw shadows by, so nothing on this world is
   lit from a side. Things sit in soft pools of their own shade. The only warm
   colour is theirs: the heat drills, melting a ring each into the sheet. */

const FROST = {
  ice:"#dceaf5", iceLit:"#f4f9ff", iceDeep:"#b9d2e8", iceDark:"#93b3cf",
  black:"#2c4258", blackLit:"#3f5b74", crack:"#f7fbff", shade:"#7f9db8",
  snow:"#ffffff", snowShade:"#c8dbea",
  rock:"#4d5f70", rockLit:"#6b7f92",
  rig:"#2b2530", rigLit:"#4a4353", warm:"#ff8a3c", warmCore:"#ffe9a0", warn:"#ff5d73",
};

/** A crack across the ice: a bright hairline with a darker seam under it. */
function iceCrack(ctx, x, y, a, l, rand){
  ctx.lineCap = "round";
  let px = x, py = y, aa = a;
  ctx.strokeStyle = rgba(FROST.shade, 0.55); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px, py);
  const pts = [[px, py]];
  for(let i = 0; i < 4; i++){
    aa += (rand() - 0.5)*0.9;
    px += Math.cos(aa)*l/4; py += Math.sin(aa)*l/4;
    ctx.lineTo(px, py); pts.push([px, py]);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(FROST.crack, 0.9); ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for(let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/** A stone under snow: a dark shape, a white cap, a soft pool of shade. */
function frostRock(ctx, x, y, r, rand){
  const rot = rand()*TAU;
  ctx.fillStyle = rgba(FROST.shade, 0.35);
  ctx.beginPath(); ctx.ellipse(x + 2, y + r*0.5, r*1.2, r*0.7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = FROST.rock;
  ctx.beginPath(); ctx.ellipse(x, y, r, r*0.82, rot, 0, TAU); ctx.fill();
  ctx.fillStyle = FROST.rockLit;
  ctx.beginPath(); ctx.ellipse(x - r*0.2, y - r*0.2, r*0.55, r*0.4, rot, 0, TAU); ctx.fill();
  ctx.fillStyle = FROST.snow;
  ctx.beginPath(); ctx.ellipse(x - r*0.1, y - r*0.45, r*0.7, r*0.3, rot*0.3, 0, TAU); ctx.fill();
}

/** One of their heat drills: dark frame, warning eye, and the ring of melt
 *  it has made in the sheet - the only warm thing on the world. */
function heatDrill(ctx, x, y, rand){
  const melt = ctx.createRadialGradient(x, y, 4, x, y, 34);
  melt.addColorStop(0, rgba(FROST.warm, 0.55));
  melt.addColorStop(0.45, rgba(FROST.warm, 0.18));
  melt.addColorStop(1, rgba(FROST.warm, 0));
  ctx.fillStyle = melt;
  ctx.beginPath(); ctx.arc(x, y, 34, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(FROST.black, 0.7);
  ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();          // open water under it
  ctx.fillStyle = FROST.rig; ctx.fillRect(x - 6, y - 6, 12, 12);
  ctx.fillStyle = FROST.rigLit; ctx.fillRect(x - 6, y - 6, 12, 3.5);
  ctx.strokeStyle = FROST.rig; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 8, y + 8); ctx.lineTo(x, y - 10); ctx.lineTo(x + 8, y + 8); ctx.stroke();
  ctx.fillStyle = FROST.warmCore;
  ctx.beginPath(); ctx.arc(x, y + 2, 2, 0, TAU); ctx.fill();
  ctx.fillStyle = FROST.warn;
  ctx.beginPath(); ctx.arc(x, y - 10, 1.4, 0, TAU); ctx.fill();
}

function drawIcefield(ctx, W, H, p, rand){
  ctx.fillStyle = FROST.ice;
  ctx.fillRect(0, 0, W, H);

  // The sheet's own relief: broad soft mottling, blue in the hollows.
  for(let i = 0; i < 12; i++){
    const x = rand()*W, y = rand()*H, r = (0.12 + rand()*0.28)*W;
    const col = i % 3 ? FROST.iceLit : FROST.iceDeep;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, i % 3 ? 0.55 : 0.5));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  /*
   * THE FROZEN RIVER - full height, wrap-exact: whole sine periods of t so
   * position and slope agree at the seam. Black ice, the cold's own colour,
   * with the cracks that say how deep it goes.
   */
  const rx0 = W*(0.30 + rand()*0.12);
  const s1 = (rand() - 0.5)*W*0.16, s2 = (rand() - 0.5)*W*0.10;
  const river = t => rx0 + Math.sin(t*TAU)*s1 + Math.sin(t*TAU*2)*s2*0.5;
  const rw = 30 + rand()*10;
  const riverPath = () => {
    for(let i = 0; i <= 48; i++){ const t = i/48; const x = river(t);
      i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
  };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(FROST.iceDark, 0.7); ctx.lineWidth = rw + 10;
  ctx.beginPath(); riverPath(); ctx.stroke();                     // the bank
  ctx.strokeStyle = FROST.black; ctx.lineWidth = rw;
  ctx.beginPath(); riverPath(); ctx.stroke();
  ctx.strokeStyle = FROST.blackLit; ctx.lineWidth = rw*0.4;
  ctx.beginPath(); riverPath(); ctx.stroke();
  // long cracks down the black ice, and a few windows of paler ice
  for(let i = 0; i < 22; i++){
    const t = rand(), x = river(t) + (rand() - 0.5)*rw*0.8, y = t*H;
    tiled(ctx, H, y, yy => iceCrack(ctx, x, yy, rand()*TAU, 18 + rand()*30, rngFor(7100 + i)));
  }
  for(let i = 0; i < 7; i++){
    const t = rand(), x = river(t) + (rand() - 0.5)*rw*0.5, y = t*H, r = 4 + rand()*6;
    tiled(ctx, H, y, yy => {
      ctx.fillStyle = rgba(FROST.iceDeep, 0.6);
      ctx.beginPath(); ctx.ellipse(x, yy, r, r*0.6, rand()*TAU, 0, TAU); ctx.fill();
    });
  }

  /*
   * PRESSURE RIDGES - the ice sheet's crests, crossing the tile the way the
   * dune crests crossed the sand, but lit by nothing: a pale rise and a soft
   * blue fall, and a hairline of white along the break.
   */
  const ridgeAt = (x0, y0, len, a, amp) => {
    const cx = t => x0 + Math.cos(a)*t*len + Math.cos(a + Math.PI/2)*Math.sin(t*TAU)*amp;
    const cy = t => y0 + Math.sin(a)*t*len + Math.sin(a + Math.PI/2)*Math.sin(t*TAU)*amp;
    return { cx, cy };
  };
  for(let i = 0; i < 8; i++){
    const x0 = rand()*W, y0 = rand()*H;
    const a = -0.3 + rand()*0.6 + (i % 2 ? Math.PI : 0);
    const len = W*(0.3 + rand()*0.5), amp = 6 + rand()*18;
    const c = ridgeAt(x0, y0, len, a, amp);
    const path = (dx, dy) => {
      ctx.beginPath();
      for(let k = 0; k <= 32; k++){ const t = k/32;
        k ? ctx.lineTo(c.cx(t) + dx, c.cy(t) + dy) : ctx.moveTo(c.cx(t) + dx, c.cy(t) + dy); }
    };
    tiled(ctx, H, y0, yy => {
      const dy0 = yy - y0;
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(FROST.shade, 0.35); ctx.lineWidth = 12;
      path(0, 5 + dy0); ctx.stroke();
      ctx.strokeStyle = rgba(FROST.iceLit, 0.9); ctx.lineWidth = 9;
      path(0, -3 + dy0); ctx.stroke();
      ctx.strokeStyle = rgba(FROST.snow, 0.95); ctx.lineWidth = 1.4;
      path(0, dy0); ctx.stroke();
    });
  }

  // Snow drifts, combed one way - the wind the fronts ride.
  ctx.lineWidth = 1;
  for(let i = 0; i < 60; i++){
    const x = rand()*W, y = rand()*H, l = 10 + rand()*22;
    ctx.strokeStyle = rgba(i % 2 ? FROST.snowShade : FROST.snow, 0.18 + rand()*0.2);
    tiled(ctx, H, y, yy => {
      ctx.beginPath(); ctx.moveTo(x, yy);
      ctx.quadraticCurveTo(x - l*0.5, yy + 3, x - l, yy - 1);
      ctx.stroke();
    });
  }

  // Crack networks on the open sheet, thinner than the river's.
  for(let i = 0; i < 16; i++){
    const x = rand()*W, y = rand()*H;
    tiled(ctx, H, y, yy => iceCrack(ctx, x, yy, rand()*TAU, 14 + rand()*22, rngFor(7300 + i)));
  }

  // Stones under snow, in soft pools of shade.
  for(let c = 0; c < 6; c++){
    const cx = rand()*W, cy = rand()*H, n = 3 + Math.floor(rand()*4);
    for(let i = 0; i < n; i++){
      const x = cx + (rand() - 0.5)*W*0.10, y = cy + (rand() - 0.5)*W*0.10;
      const r = 3 + rand()*6;
      tiled(ctx, H, y, yy => frostRock(ctx, x, yy, r, rngFor(7500 + c*16 + i)));
    }
  }

  // Their heat drills, over the river where the ice is thinnest.
  for(let i = 0; i < 3; i++){
    const t = 0.15 + rand()*0.7;
    const x = river(t) + (rand() < 0.5 ? -1 : 1)*(rw*0.9 + rand()*20), y = t*H;
    tiled(ctx, H, y, yy => heatDrill(ctx, x, yy, rngFor(7700 + i)));
  }

  // Glints: the sheet catching a light that is not there.
  for(let i = 0; i < 34; i++){
    const x = rand()*W, y = rand()*H;
    ctx.fillStyle = rgba(FROST.snow, 0.35 + rand()*0.5);
    tiled(ctx, H, y, yy => ctx.fillRect(x, yy, 1.4, 1.4));
  }
}

/*
 * THE FROZEN FLEET - the once-layer. A lake of black ice with their ships
 * locked in it where the cold caught them: hulls half sunk, each under its
 * own block, one hauler with a cabin light still burning. The level's rule,
 * written on the ground before the first front ever rolls. Its snow apron
 * settles it onto the sheet wherever the scroll has carried the floor.
 */
function drawFrozenfleet(ctx, W, H, p, rand){
  const cx = W*0.50, cy = H*0.48, R = W*0.31;

  // The snow it has drifted into, downwind.
  const apron = ctx.createRadialGradient(cx, cy, R*0.5, cx, cy, R*2.0);
  apron.addColorStop(0, rgba(FROST.snow, 0.5));
  apron.addColorStop(0.6, rgba(FROST.snow, 0.22));
  apron.addColorStop(1, rgba(FROST.snow, 0));
  ctx.fillStyle = apron;
  ctx.beginPath(); ctx.arc(cx, cy, R*2.0, 0, TAU); ctx.fill();

  // The lake: an irregular shore, black ice inside, a pale rim.
  const shore = a => R*(1 + Math.sin(a*3 + 0.7)*0.08 + Math.sin(a*5 + 2.1)*0.05);
  const lakePath = k => {
    ctx.beginPath();
    for(let i = 0; i <= 40; i++){
      const a = (i/40)*TAU, r = shore(a)*k;
      const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = rgba(FROST.iceDark, 0.8); lakePath(1.06); ctx.fill();
  ctx.fillStyle = FROST.black; lakePath(1.0); ctx.fill();
  const deep = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  deep.addColorStop(0, rgba("#1a2a3c", 0.9)); deep.addColorStop(1, rgba("#1a2a3c", 0));
  ctx.fillStyle = deep; lakePath(1.0); ctx.fill();
  // the cracks that run from the shore toward the middle
  for(let i = 0; i < 18; i++){
    const a = rand()*TAU, r0 = shore(a)*0.96;
    const x = cx + Math.cos(a)*r0, y = cy + Math.sin(a)*r0;
    iceCrack(ctx, x, y, a + Math.PI + (rand() - 0.5)*0.5, R*(0.25 + rand()*0.35), rngFor(7900 + i));
  }

  /*
   * Their ships, where the cold found them: dark darts tilted in the ice,
   * each under a pale block with a crack in it. Eight of them, none lined
   * up, because a formation that froze mid-turn is not a formation.
   */
  for(let i = 0; i < 8; i++){
    const a = rand()*TAU, d = rand()*R*0.75;
    const x = cx + Math.cos(a)*d, y = cy + Math.sin(a)*d, rot = rand()*TAU, s = 12 + rand()*8;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = rgba("#0d1520", 0.9);
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s*0.75, s*0.7); ctx.lineTo(0, s*0.35); ctx.lineTo(-s*0.75, s*0.7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(FROST.warn, 0.7);
    ctx.beginPath(); ctx.arc(0, -s*0.3, 1.6, 0, TAU); ctx.fill();
    // the block over it
    const bg = ctx.createLinearGradient(-s, -s, s, s);
    bg.addColorStop(0, rgba(FROST.iceLit, 0.55)); bg.addColorStop(1, rgba(FROST.iceDeep, 0.45));
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(-s*1.1, -s*1.2); ctx.lineTo(s*1.1, -s*1.05); ctx.lineTo(s*1.0, s*1.1); ctx.lineTo(-s*1.0, s*1.0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(FROST.snow, 0.85); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-s*1.1, -s*1.2); ctx.lineTo(s*1.1, -s*1.05); ctx.lineTo(s*1.0, s*1.1); ctx.lineTo(-s*1.0, s*1.0); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = rgba(FROST.shade, 0.8); ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-s*0.4, -s*1.1); ctx.lineTo(-s*0.1, -s*0.2); ctx.lineTo(s*0.5, s*0.6); ctx.stroke();
    ctx.restore();
  }

  // The hauler that did not make it: a big dark hull, half through the ice,
  // and one cabin light still burning - somebody is keeping it lit.
  {
    const x = cx - R*0.35, y = cy + R*0.2;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.4);
    ctx.fillStyle = rgba("#0d1520", 0.95);
    ctx.beginPath(); ctx.moveTo(-34, -12); ctx.lineTo(30, -16); ctx.lineTo(38, 0); ctx.lineTo(30, 16); ctx.lineTo(-34, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(FROST.iceLit, 0.5);
    ctx.beginPath(); ctx.moveTo(-40, -6); ctx.lineTo(10, -20); ctx.lineTo(44, -4); ctx.lineTo(20, 8); ctx.closePath(); ctx.fill();
    const lamp = ctx.createRadialGradient(22, 2, 0, 22, 2, 16);
    lamp.addColorStop(0, rgba(FROST.warmCore, 0.95)); lamp.addColorStop(0.3, rgba(FROST.warm, 0.5)); lamp.addColorStop(1, rgba(FROST.warm, 0));
    ctx.fillStyle = lamp;
    ctx.beginPath(); ctx.arc(22, 2, 16, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Their camp on the shore: two huts with warm windows, a red eye, and the
  // tracks in the snow that lead out onto the ice.
  {
    const kx = cx + R*1.25, ky = cy - R*0.45;
    ctx.strokeStyle = rgba(FROST.shade, 0.5); ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(kx - 20, ky + 14); ctx.quadraticCurveTo(cx + R*0.9, cy - R*0.1, cx + R*0.5, cy); ctx.stroke();
    for(let i = 0; i < 2; i++){
      const bx = kx + i*34, by = ky + i*10, bw = 24, bh = 16;
      ctx.fillStyle = rgba(FROST.shade, 0.4);
      ctx.fillRect(bx - bw/2 + 3, by - bh/2 + 5, bw, bh);
      ctx.fillStyle = FROST.rig; ctx.fillRect(bx - bw/2, by - bh/2, bw, bh);
      ctx.fillStyle = FROST.snow; ctx.fillRect(bx - bw/2, by - bh/2, bw, 4);
      ctx.fillStyle = FROST.warm;
      ctx.fillRect(bx - bw/2 + 4, by + 1, 3, 3); ctx.fillRect(bx + bw/2 - 7, by + 1, 3, 3);
    }
    ctx.fillStyle = FROST.warn;
    ctx.beginPath(); ctx.arc(kx + 44, ky - 4, 1.8, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(FROST.shade, 0.4);
    ctx.fillRect(kx + 24, ky + 30, 28, 20);
    ctx.strokeStyle = rgba(FROST.rig, 0.7); ctx.lineWidth = 1;
    ctx.strokeRect(kx + 24, ky + 30, 28, 20);
    ctx.beginPath(); ctx.arc(kx + 38, ky + 40, 5.5, 0, TAU); ctx.stroke();
  }
}

/* ---------------------------------------------------------
   THE THRESHOLD - the moon of doors
   ---------------------------------------------------------
 * An airless moon, and the first surface in the campaign somebody BUILT
 * on. Airless means the light is honest: one sun, low over the top-right
 * corner, no haze to soften it - so every stone throws a hard black shadow
 * down-left, every crater keeps a bright lip on the sun side and a black
 * wall on the other, and the dust between them is flat and grey-violet.
 * That single rule (hard light, one direction) is what makes the moon read
 * as a moon instead of as the desert with its colour taken out.
 *
 * The builders' work runs through it: two paved avenues cross the tile
 * (full height, wrap-exact - the trench rule) with rune veins still glowing
 * teal and rose in the joints, standing stones line them, fallen door-rings
 * lie half buried, and the sockets where doors once stood are dark rings in
 * the dust. The once-layer is the Great Arch, the plaza the avenues lead to.
 */
const MOON = {
  dust:"#8a84a3", lit:"#b3adc9", dark:"#5f5a78", shade:"#33304a", black:"#161425",
  rim:"#dcd7ee", warm:"#f0c58a",
  stone:"#4a4560", stoneLit:"#6e6889", stoneEdge:"#a39dc4",
  teal:"#48e5c2", rose:"#ff5dbb", wreck:"#1e1524", warn:"#ff5d73", lamp:"#ffe9a0",
};
/* The sun sits over the top-right corner; every shadow on the moon falls
 * this way. One vector, shared, so nothing on the floor disagrees. */
const MOON_SX = -0.62, MOON_SY = 0.78;
const MOON_SA = Math.atan2(MOON_SY, MOON_SX);

/** A crater: an ejecta apron, a rim lit on the sun side, a bowl whose far
 *  wall is black, and the rim's own shadow thrown down-left. */
function moonCrater(ctx, x, y, r){
  const ej = ctx.createRadialGradient(x, y, r*0.95, x, y, r*2.1);
  ej.addColorStop(0, rgba(MOON.lit, 0.4)); ej.addColorStop(1, rgba(MOON.lit, 0));
  ctx.fillStyle = ej; ctx.beginPath(); ctx.arc(x, y, r*2.1, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(MOON.shade, 0.6);
  ctx.beginPath(); ctx.ellipse(x + MOON_SX*r*0.3, y + MOON_SY*r*0.3, r*1.12, r*1.04, 0, 0, TAU); ctx.fill();
  const rg = ctx.createLinearGradient(x + r*0.75, y - r*0.75, x - r*0.75, y + r*0.75);
  rg.addColorStop(0, MOON.rim); rg.addColorStop(0.55, MOON.dust); rg.addColorStop(1, MOON.dark);
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r*1.06, 0, TAU); ctx.fill();
  const bg = ctx.createLinearGradient(x + r*0.8, y - r*0.8, x - r*0.8, y + r*0.8);
  bg.addColorStop(0, MOON.black); bg.addColorStop(0.5, MOON.shade); bg.addColorStop(1, MOON.dust);
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, r*0.86, 0, TAU); ctx.fill();
  if(r > 14){
    ctx.fillStyle = rgba(MOON.dark, 0.75);
    ctx.beginPath(); ctx.ellipse(x - r*0.12, y + r*0.14, r*0.5, r*0.4, 0, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = rgba(MOON.warm, 0.8); ctx.lineWidth = Math.max(1, r*0.07);
  ctx.beginPath(); ctx.arc(x, y, r*0.99, -Math.PI*0.72, Math.PI*0.2); ctx.stroke();
}

/** A standing stone seen from above: a footprint with the sun on its
 *  top-right edges and `tall` pixels of hard shadow down-left. */
function moonStone(ctx, x, y, w, tall, rot, rand){
  const h = w*(1.3 + rand()*0.6);
  ctx.save(); ctx.translate(x, y); ctx.rotate(MOON_SA);
  ctx.fillStyle = rgba(MOON.black, 0.72);
  ctx.beginPath(); ctx.moveTo(0, -h*0.5); ctx.lineTo(tall, -h*0.3); ctx.lineTo(tall, h*0.3); ctx.lineTo(0, h*0.5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = MOON.stoneLit;
  ctx.beginPath(); ctx.moveTo(-w*0.5, -h*0.5); ctx.lineTo(w*0.45, -h*0.55); ctx.lineTo(w*0.5, h*0.5); ctx.lineTo(-w*0.45, h*0.45); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = MOON.stoneEdge; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-w*0.5, -h*0.5); ctx.lineTo(w*0.45, -h*0.55); ctx.lineTo(w*0.5, h*0.5); ctx.stroke();
  ctx.strokeStyle = MOON.shade; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w*0.5, h*0.5); ctx.lineTo(-w*0.45, h*0.45); ctx.lineTo(-w*0.5, -h*0.5); ctx.stroke();
  ctx.restore();
}

/** A plinth: a square block, sun on two edges, a short hard shadow. */
function moonPlinth(ctx, x, y, s){
  ctx.fillStyle = rgba(MOON.black, 0.7);
  ctx.beginPath();
  ctx.moveTo(x - s*0.5, y + s*0.5); ctx.lineTo(x - s*0.5 + MOON_SX*s*1.1, y + s*0.5 + MOON_SY*s*1.1);
  ctx.lineTo(x + s*0.5 + MOON_SX*s*1.1, y + s*0.5 + MOON_SY*s*1.1); ctx.lineTo(x + s*0.5, y + s*0.5);
  ctx.lineTo(x + s*0.5, y - s*0.5); ctx.lineTo(x - s*0.5, y - s*0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = MOON.stoneLit; ctx.fillRect(x - s*0.5, y - s*0.5, s, s);
  ctx.strokeStyle = MOON.stoneEdge; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x - s*0.5, y - s*0.5); ctx.lineTo(x + s*0.5, y - s*0.5); ctx.lineTo(x + s*0.5, y + s*0.5); ctx.stroke();
  ctx.strokeStyle = MOON.shade; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + s*0.5, y + s*0.5); ctx.lineTo(x - s*0.5, y + s*0.5); ctx.lineTo(x - s*0.5, y - s*0.5); ctx.stroke();
}

/** A fallen door-ring, part of one: an arc of stone with its rune ticks,
 *  a few of them still lit, and its shadow beside it. */
function moonRing(ctx, x, y, R, a0, a1, rune, rand){
  ctx.lineCap = "round";
  ctx.strokeStyle = rgba(MOON.black, 0.65); ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(x + MOON_SX*8, y + MOON_SY*8, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = MOON.stone; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(x, y, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = MOON.stoneLit; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(x, y, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = rgba(MOON.stoneEdge, 0.9); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(x, y, R + 3.5, a0, a1); ctx.stroke();
  for(let a = a0 + 0.12; a < a1 - 0.06; a += 0.24){
    const lit = rand() < 0.4;
    const x0 = x + Math.cos(a)*(R - 2.5), y0 = y + Math.sin(a)*(R - 2.5);
    const x1 = x + Math.cos(a)*(R + 2.5), y1 = y + Math.sin(a)*(R + 2.5);
    if(lit){
      ctx.strokeStyle = rgba(rune, 0.35); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.strokeStyle = lit ? rune : rgba(MOON.shade, 0.9); ctx.lineWidth = lit ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
}

/** The socket a door once stood in: a dark ring worn into the dust, the
 *  disc inside it a shade darker, one dead rune at its rim. */
function moonSocket(ctx, x, y, r){
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(MOON.shade, 0.55)); g.addColorStop(0.8, rgba(MOON.shade, 0.35)); g.addColorStop(1, rgba(MOON.shade, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(MOON.black, 0.55); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, r*0.8, 0, TAU); ctx.stroke();
  ctx.strokeStyle = rgba(MOON.rim, 0.5); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r*0.8 + 2, -Math.PI*0.7, Math.PI*0.15); ctx.stroke();
}

/** One of the builders' avenues: a bed with a sunlit kerb, slabs laid along
 *  a wrap-exact curve, and a rune vein still alive in every third joint. */
function moonAvenue(ctx, W, H, road, rw, rune, rand){
  const n = Math.round(H/26), len = H/n;
  const path = () => {
    ctx.beginPath();
    for(let i = 0; i <= 48; i++){ const t = i/48, x = road(t); i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
  };
  ctx.lineCap = "butt"; ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(MOON.black, 0.55); ctx.lineWidth = rw + 14;
  ctx.save(); ctx.translate(MOON_SX*4, MOON_SY*4); path(); ctx.stroke(); ctx.restore();   // the kerb's shadow
  ctx.strokeStyle = MOON.stone; ctx.lineWidth = rw + 8; path(); ctx.stroke();
  ctx.strokeStyle = MOON.stoneEdge; ctx.lineWidth = rw + 8;
  ctx.save(); ctx.translate(-MOON_SX*1.2, -MOON_SY*1.2); path(); ctx.stroke(); ctx.restore(); // the kerb's sun side
  ctx.strokeStyle = MOON.stone; ctx.lineWidth = rw + 5; path(); ctx.stroke();
  for(let i = 0; i < n; i++){
    const t = (i + 0.5)/n, y = t*H, x = road(t);
    const dx = (road(t + 0.002) - road(t - 0.002))/(0.004*H);
    const a = -Math.atan(dx);
    const broken = rand() < 0.07;
    const tone = i % 2 ? MOON.stoneLit : mixHexHex(MOON.stoneLit, MOON.stone, 0.35);
    const vein = i % 3 === 0, dead = rand() < 0.3;
    tiled(ctx, H, y, yy => {
      ctx.save(); ctx.translate(x, yy); ctx.rotate(a);
      if(broken){
        ctx.fillStyle = MOON.black; ctx.fillRect(-rw*0.5, -len*0.5 + 1, rw, len - 2);
        ctx.fillStyle = rgba(MOON.dust, 0.85); ctx.fillRect(-rw*0.5, len*0.5 - 4, rw, 3);
      } else {
        ctx.fillStyle = tone; ctx.fillRect(-rw*0.5, -len*0.5 + 1, rw, len - 2);
        ctx.strokeStyle = rgba(MOON.stoneEdge, 0.85); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-rw*0.5, -len*0.5 + 1.5); ctx.lineTo(rw*0.5, -len*0.5 + 1.5); ctx.lineTo(rw*0.5, len*0.5 - 1); ctx.stroke();
        ctx.strokeStyle = rgba(MOON.shade, 0.9); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(rw*0.5, len*0.5 - 1); ctx.lineTo(-rw*0.5, len*0.5 - 1); ctx.lineTo(-rw*0.5, -len*0.5 + 1.5); ctx.stroke();
      }
      if(vein){
        const yv = -len*0.5;
        if(!dead){
          ctx.strokeStyle = rgba(rune, 0.3); ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(-rw*0.5, yv); ctx.lineTo(rw*0.5, yv); ctx.stroke();
          ctx.strokeStyle = rgba(rune, 0.95); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(-rw*0.5, yv); ctx.lineTo(rw*0.5, yv); ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-rw*0.5 + 4, yv - 0.8, 3, 1.6); ctx.fillRect(rw*0.5 - 7, yv - 0.8, 3, 1.6);
        } else {
          ctx.strokeStyle = rgba(MOON.black, 0.8); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(-rw*0.5, yv); ctx.lineTo(rw*0.5, yv); ctx.stroke();
        }
      }
      ctx.restore();
    });
  }
}

function drawMoonfloor(ctx, W, H, p, rand){
  ctx.fillStyle = MOON.dust;
  ctx.fillRect(0, 0, W, H);

  // Mare and highland: broad patches of darker and paler regolith.
  for(let i = 0; i < 12; i++){
    const x = rand()*W, y = rand()*H, r = (0.14 + rand()*0.3)*W;
    const col = i % 3 ? MOON.dark : MOON.lit;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, i % 3 ? 0.4 : 0.5)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }
  // The grain of the dust: fine, half of it catching the sun.
  for(let i = 0; i < 300; i++){
    const x = rand()*W, y = rand()*H;
    ctx.fillStyle = rgba(i % 2 ? MOON.rim : MOON.shade, 0.22 + rand()*0.35);
    tiled(ctx, H, y, yy => ctx.fillRect(x, yy, 1.2, 1.2));
  }

  // Old craters, the ones the avenues were built across.
  for(let i = 0; i < 12; i++){
    const x = rand()*W, y = rand()*H, r = 4 + rand()*rand()*26;
    tiled(ctx, H, y, yy => moonCrater(ctx, x, yy, r));
  }

  /*
   * THE AVENUES - two of them, teal and rose, running the height of the
   * tile on whole sine periods so position and slope agree at the seam.
   */
  const av0 = W*(0.22 + rand()*0.10), av1 = W*(0.66 + rand()*0.10);
  const road0 = t => av0 + Math.sin(t*TAU)*W*0.05 + Math.sin(t*TAU*2 + 1.3)*W*0.025;
  const road1 = t => av1 + Math.sin(t*TAU + 2.0)*W*0.06 + Math.sin(t*TAU*3)*W*0.02;
  moonAvenue(ctx, W, H, road0, 34, MOON.teal, rand);
  moonAvenue(ctx, W, H, road1, 28, MOON.rose, rand);

  // Standing stones along both, every one throwing its shadow the same way.
  [[road0, 34], [road1, 28]].forEach(([road, rw]) => {
    for(let i = 0; i < 7; i++){
      const t = rand(), side = rand() < 0.5 ? -1 : 1;
      const x = road(t) + side*(rw*0.5 + 16 + rand()*26), y = t*H;
      const w = 6 + rand()*6, tall = 24 + rand()*44, rot = (rand() - 0.5)*0.5;
      tiled(ctx, H, y, yy => moonStone(ctx, x, yy, w, tall, rot, rngFor(8100 + i*7 + Math.round(t*100))));
    }
  });

  // Fallen door-rings, part buried; the sockets they stood in; plinths.
  for(let i = 0; i < 5; i++){
    const x = rand()*W, y = rand()*H, R = 22 + rand()*22;
    const a0 = rand()*TAU, a1 = a0 + 0.9 + rand()*2.4;
    const rune = i % 2 ? MOON.rose : MOON.teal;
    tiled(ctx, H, y, yy => moonRing(ctx, x, yy, R, a0, a1, rune, rngFor(8300 + i)));
  }
  for(let i = 0; i < 4; i++){
    const x = rand()*W, y = rand()*H, r = 16 + rand()*10;
    tiled(ctx, H, y, yy => moonSocket(ctx, x, yy, r));
  }
  for(let i = 0; i < 6; i++){
    const x = rand()*W, y = rand()*H, s = 8 + rand()*8;
    tiled(ctx, H, y, yy => moonPlinth(ctx, x, yy, s));
  }

  // Fresh craters, the ones that hit AFTER the builders left: they punch
  // through avenue and stone alike.
  for(let i = 0; i < 3; i++){
    const road = i % 2 ? road1 : road0, t = rand();
    const x = road(t) + (rand() - 0.5)*30, y = t*H, r = 16 + rand()*14;
    tiled(ctx, H, y, yy => moonCrater(ctx, x, yy, r));
  }

  // Their rover tracks: paired dashes wandering between the avenues.
  ctx.setLineDash([5, 6]); ctx.lineCap = "butt";
  for(let i = 0; i < 3; i++){
    const x0 = rand()*W, y0 = rand()*H, x1 = x0 + (rand() - 0.5)*W*0.6, y1 = y0 + 120 + rand()*140;
    const cx = (x0 + x1)/2 + (rand() - 0.5)*120, cy = (y0 + y1)/2;
    tiled(ctx, H, y0, yy => {
      const d = yy - y0;
      [-4, 4].forEach(off => {
        ctx.strokeStyle = rgba(MOON.shade, 0.6); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0 + off, yy); ctx.quadraticCurveTo(cx + off, cy + d, x1 + off, y1 + d); ctx.stroke();
      });
    });
  }
  ctx.setLineDash([]);

  // Glints: the sun catching glass in the dust.
  for(let i = 0; i < 26; i++){
    const x = rand()*W, y = rand()*H;
    ctx.fillStyle = rgba("#ffffff", 0.45 + rand()*0.5);
    tiled(ctx, H, y, yy => ctx.fillRect(x, yy, 1.5, 1.5));
  }
}

/*
 * THE GREAT ARCH - the once-layer. The plaza the avenues lead to: rings of
 * paving around the dormant master door, two colossal monoliths with a
 * cracked lintel between them, and the sun raking their shadows across the
 * whole floor. One of their ships lies crashed at the edge with its lamp
 * still on. The level's rule - doors, and something on the other side of
 * them - written on the ground before the first pair ever lights.
 */
function drawGreatarch(ctx, W, H, p, rand){
  const cx = W*0.50, cy = H*0.46, R = W*0.30;

  // Dust trodden dark around the plaza; the paving itself.
  const worn = ctx.createRadialGradient(cx, cy, R*0.9, cx, cy, R*1.9);
  worn.addColorStop(0, rgba(MOON.dark, 0.45)); worn.addColorStop(1, rgba(MOON.dark, 0));
  ctx.fillStyle = worn; ctx.beginPath(); ctx.arc(cx, cy, R*1.9, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(MOON.black, 0.5);
  ctx.beginPath(); ctx.arc(cx + MOON_SX*3, cy + MOON_SY*3, R*1.02, 0, TAU); ctx.fill();   // the plaza's own lip
  const RINGS = 6;
  const ringR = k => R*(0.42 + k*0.1), ringW = R*0.1 - 2;
  for(let k = 0; k < RINGS; k++){
    const r0 = ringR(k), nj = 14 + k*6;
    ctx.strokeStyle = k % 2 ? MOON.stoneLit : mixHexHex(MOON.stoneLit, MOON.stone, 0.35);
    ctx.lineWidth = ringW;
    ctx.beginPath(); ctx.arc(cx, cy, r0 + ringW/2, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(MOON.shade, 0.85); ctx.lineWidth = 1.2;
    for(let j = 0; j < nj; j++){
      const a = (j/nj)*TAU + k*0.11;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a)*r0, cy + Math.sin(a)*r0);
      ctx.lineTo(cx + Math.cos(a)*(r0 + ringW), cy + Math.sin(a)*(r0 + ringW)); ctx.stroke();
    }
    ctx.strokeStyle = rgba(MOON.shade, 0.9); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(MOON.stoneEdge, 0.7); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r0 + 1.2, -Math.PI*0.75, Math.PI*0.25); ctx.stroke();
  }
  // Missing slabs: black gaps where the paving has gone.
  for(let i = 0; i < 9; i++){
    const k = Math.floor(rand()*RINGS), r0 = ringR(k), nj = 14 + k*6;
    const j = Math.floor(rand()*nj), a0 = (j/nj)*TAU + k*0.11, a1 = a0 + TAU/nj;
    ctx.fillStyle = MOON.black;
    ctx.beginPath(); ctx.arc(cx, cy, r0 + ringW, a0, a1); ctx.arc(cx, cy, r0, a1, a0, true); ctx.closePath(); ctx.fill();
  }
  // The rune circle inscribed in the paving: teal and rose, turn and turn about.
  const rr = ringR(3) - 1;
  for(let j = 0; j < 36; j++){
    const a0 = (j/36)*TAU + 0.02, a1 = a0 + (TAU/36)*0.6;
    const col = j % 2 ? MOON.teal : MOON.rose;
    ctx.strokeStyle = rgba(col, 0.3); ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.stroke();
  }

  // The master door, dormant: a stone collar, a black disc, dead runes
  // around it, and one hairline of teal that says it is not quite dead.
  const dr = ringR(0) - 4;
  ctx.fillStyle = rgba(MOON.black, 0.6);
  ctx.beginPath(); ctx.arc(cx + MOON_SX*5, cy + MOON_SY*5, dr + 8, 0, TAU); ctx.fill();
  const collar = ctx.createLinearGradient(cx + dr, cy - dr, cx - dr, cy + dr);
  collar.addColorStop(0, MOON.stoneEdge); collar.addColorStop(0.5, MOON.stoneLit); collar.addColorStop(1, MOON.stone);
  ctx.fillStyle = collar; ctx.beginPath(); ctx.arc(cx, cy, dr + 8, 0, TAU); ctx.fill();
  const disc = ctx.createRadialGradient(cx - dr*0.2, cy + dr*0.2, 0, cx, cy, dr);
  disc.addColorStop(0, "#0b0a16"); disc.addColorStop(0.7, MOON.black); disc.addColorStop(1, MOON.shade);
  ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(cx, cy, dr, 0, TAU); ctx.fill();
  for(let j = 0; j < 24; j++){
    const a = (j/24)*TAU, live = j % 6 === 0;
    ctx.strokeStyle = live ? rgba(MOON.teal, 0.8) : rgba(MOON.stoneLit, 0.5); ctx.lineWidth = live ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a)*(dr - 6), cy + Math.sin(a)*(dr - 6));
    ctx.lineTo(cx + Math.cos(a)*(dr - 1), cy + Math.sin(a)*(dr - 1)); ctx.stroke();
  }
  ctx.strokeStyle = rgba(MOON.teal, 0.25); ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(cx - dr*0.7, cy + dr*0.15); ctx.lineTo(cx + dr*0.6, cy - dr*0.2); ctx.stroke();
  ctx.strokeStyle = rgba(MOON.teal, 0.85); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx - dr*0.7, cy + dr*0.15); ctx.lineTo(cx - dr*0.2, cy + dr*0.05); ctx.lineTo(cx + dr*0.1, cy - dr*0.12); ctx.lineTo(cx + dr*0.6, cy - dr*0.2); ctx.stroke();

  /*
   * THE ARCH. Two monoliths and the lintel across them, and - this is the
   * picture - their shadows: the lintel's a long dark band raked across the
   * plaza, each monolith's a black blade beside it. Shadows first, so the
   * stone lands on top of them.
   */
  const ml = { x: cx - R*0.6, y: cy - R*0.1 }, mr = { x: cx + R*0.6, y: cy - R*0.1 };
  const mw = R*0.15, mh = R*0.3, tall = R*1.1;
  const ly = cy - R*0.34, lw = R*0.11;
  const shadowQuad = (x, y, w, h, len) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(MOON_SA);
    const half = (Math.abs(w*Math.sin(MOON_SA)) + Math.abs(h*Math.cos(MOON_SA)))*0.5;
    ctx.beginPath(); ctx.moveTo(0, -half); ctx.lineTo(len, -half*0.8); ctx.lineTo(len, half*0.8); ctx.lineTo(0, half); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  ctx.fillStyle = rgba(MOON.black, 0.55);
  shadowQuad(ml.x, ml.y, mw, mh, tall);
  shadowQuad(mr.x, mr.y, mw, mh, tall);
  // the lintel's shadow: the whole span, shifted by the arch's height, with
  // the gap where the middle has fallen out
  const sx = MOON_SX*tall, sy = MOON_SY*tall;
  const gapL = cx - R*0.14, gapR = cx + R*0.1;
  [[ml.x - mw*0.5, gapL], [gapR, mr.x + mw*0.5]].forEach(([x0, x1]) => {
    ctx.beginPath();
    ctx.moveTo(x0 + sx, ly - lw*0.5 + sy); ctx.lineTo(x1 + sx, ly - lw*0.5 + sy);
    ctx.lineTo(x1 + sx, ly + lw*0.5 + sy); ctx.lineTo(x0 + sx, ly + lw*0.5 + sy); ctx.closePath(); ctx.fill();
  });
  // the fallen piece, flat on the plaza, its own short shadow
  {
    const fx = cx - R*0.12, fy = cy + R*0.36, fl = R*0.22;
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(0.35);
    ctx.fillStyle = rgba(MOON.black, 0.7); ctx.fillRect(-fl*0.5 + MOON_SX*5, -lw*0.5 + MOON_SY*5, fl, lw);
    ctx.fillStyle = MOON.stoneLit; ctx.fillRect(-fl*0.5, -lw*0.5, fl, lw);
    ctx.strokeStyle = MOON.stoneEdge; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-fl*0.5, -lw*0.5); ctx.lineTo(fl*0.5, -lw*0.5); ctx.lineTo(fl*0.5, lw*0.5); ctx.stroke();
    ctx.strokeStyle = rgba(MOON.rose, 0.8); ctx.lineWidth = 1.4;
    for(let j = 0; j < 4; j++){ ctx.beginPath(); ctx.moveTo(-fl*0.35 + j*fl*0.22, -lw*0.3); ctx.lineTo(-fl*0.35 + j*fl*0.22, lw*0.3); ctx.stroke(); }
    ctx.restore();
  }
  // the monoliths' tops, sun on the top-right edges, a warm line where it catches
  [ml, mr].forEach((m, i) => {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(i ? 0.08 : -0.06);
    const g = ctx.createLinearGradient(mw*0.5, -mh*0.5, -mw*0.5, mh*0.5);
    g.addColorStop(0, MOON.stoneEdge); g.addColorStop(0.5, MOON.stoneLit); g.addColorStop(1, MOON.stone);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-mw*0.5, -mh*0.5); ctx.lineTo(mw*0.5, -mh*0.52); ctx.lineTo(mw*0.5, mh*0.5); ctx.lineTo(-mw*0.5, mh*0.48); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = MOON.warm; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-mw*0.5, -mh*0.5); ctx.lineTo(mw*0.5, -mh*0.52); ctx.lineTo(mw*0.5, mh*0.5); ctx.stroke();
    ctx.strokeStyle = MOON.shade; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(mw*0.5, mh*0.5); ctx.lineTo(-mw*0.5, mh*0.48); ctx.lineTo(-mw*0.5, -mh*0.5); ctx.stroke();
    // the runes carved down its length
    ctx.strokeStyle = rgba(i ? MOON.rose : MOON.teal, 0.85); ctx.lineWidth = 1.3;
    for(let j = 0; j < 5; j++){
      const yy = -mh*0.35 + j*mh*0.17;
      ctx.beginPath(); ctx.moveTo(-mw*0.25, yy); ctx.lineTo(mw*0.25, yy); ctx.stroke();
      if(j % 2) { ctx.beginPath(); ctx.moveTo(0, yy - 3); ctx.lineTo(0, yy + 3); ctx.stroke(); }
    }
    ctx.restore();
  });
  // the lintel, in its two pieces
  [[ml.x - mw*0.5, gapL], [gapR, mr.x + mw*0.5]].forEach(([x0, x1], i) => {
    const g = ctx.createLinearGradient(0, ly - lw*0.5, 0, ly + lw*0.5);
    g.addColorStop(0, MOON.stoneEdge); g.addColorStop(0.4, MOON.stoneLit); g.addColorStop(1, MOON.stone);
    ctx.fillStyle = g;
    ctx.beginPath();
    if(i === 0){ ctx.moveTo(x0, ly - lw*0.5); ctx.lineTo(x1, ly - lw*0.5); ctx.lineTo(x1 - lw*0.3, ly); ctx.lineTo(x1 + lw*0.1, ly + lw*0.5); ctx.lineTo(x0, ly + lw*0.5); }
    else { ctx.moveTo(x0 + lw*0.2, ly - lw*0.5); ctx.lineTo(x1, ly - lw*0.5); ctx.lineTo(x1, ly + lw*0.5); ctx.lineTo(x0 - lw*0.2, ly + lw*0.5); ctx.lineTo(x0 + lw*0.3, ly); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = MOON.warm; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x0, ly - lw*0.5); ctx.lineTo(x1, ly - lw*0.5); ctx.stroke();
    ctx.strokeStyle = MOON.shade; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, ly + lw*0.5); ctx.lineTo(x1, ly + lw*0.5); ctx.stroke();
    // the vein along it, alive on the teal side, dead past the break
    ctx.strokeStyle = i ? rgba(MOON.black, 0.7) : rgba(MOON.teal, 0.9); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0 + 6, ly); ctx.lineTo(x1 - 6, ly); ctx.stroke();
  });

  /*
   * THE AVENUE OF LAMPS, running from the plaza's foot off the bottom of the
   * frame: paired posts, teal on the left, rose on the right, each with the
   * same hard shadow, and the paving between them.
   */
  {
    const pw = R*0.5, top = cy + R*1.0;
    const g = ctx.createLinearGradient(0, top, 0, H + 40);
    g.addColorStop(0, rgba(MOON.stoneLit, 0.9)); g.addColorStop(1, rgba(MOON.stoneLit, 0.3));
    ctx.fillStyle = g; ctx.fillRect(cx - pw*0.5, top, pw, H + 40 - top);
    ctx.strokeStyle = rgba(MOON.shade, 0.8); ctx.lineWidth = 1.2;
    for(let y = top; y < H + 40; y += 22){ ctx.beginPath(); ctx.moveTo(cx - pw*0.5, y); ctx.lineTo(cx + pw*0.5, y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, H + 40); ctx.stroke();
    for(let i = 0; i < 8; i++){
      const y = top + 14 + i*R*0.27;
      if(y > H + 30) break;
      [-1, 1].forEach(side => {
        const x = cx + side*(pw*0.5 + 12), col = side < 0 ? MOON.teal : MOON.rose;
        ctx.strokeStyle = rgba(MOON.black, 0.7); ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + MOON_SX*26, y + MOON_SY*26); ctx.stroke();
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 20);
        halo.addColorStop(0, rgba(col, 0.55)); halo.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
        ctx.fillStyle = MOON.stoneLit; ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x - 0.5, y - 0.5, 0.9, 0, TAU); ctx.fill();
      });
    }
  }

  /*
   * ONE OF THEIRS, crashed at the plaza's edge: the trench it dug coming in
   * from the top-right, the hull at the end of it on its side, debris, and
   * the cabin lamp still burning - somebody is still in there.
   */
  {
    const x = cx + R*0.95, y = cy + R*0.55;
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(MOON.black, 0.8); ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(x + R*0.5, y - R*0.55); ctx.quadraticCurveTo(x + R*0.2, y - R*0.2, x, y); ctx.stroke();
    ctx.strokeStyle = rgba(MOON.rim, 0.75); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + R*0.5 + 6, y - R*0.55 - 6); ctx.quadraticCurveTo(x + R*0.2 + 6, y - R*0.2 - 6, x + 6, y - 7); ctx.stroke();
    for(let i = 0; i < 10; i++){
      const dx = (rand() - 0.5)*70, dy = (rand() - 0.5)*50;
      ctx.fillStyle = rgba(MOON.wreck, 0.9); ctx.fillRect(x + dx, y + dy, 2 + rand()*3, 2 + rand()*2);
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(2.4);
    ctx.fillStyle = rgba(MOON.black, 0.7);
    ctx.beginPath(); ctx.moveTo(MOON_SX*10, -22 + MOON_SY*10); ctx.lineTo(16 + MOON_SX*10, 16 + MOON_SY*10); ctx.lineTo(MOON_SX*10, 8 + MOON_SY*10); ctx.lineTo(-16 + MOON_SX*10, 16 + MOON_SY*10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = MOON.wreck;
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(16, 16); ctx.lineTo(0, 8); ctx.lineTo(-16, 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(MOON.stoneEdge, 0.45);
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(16, 16); ctx.lineTo(6, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = MOON.wreck;                                         // the wing that came off
    ctx.beginPath(); ctx.moveTo(-30, 30); ctx.lineTo(-18, 22); ctx.lineTo(-24, 40); ctx.closePath(); ctx.fill();
    ctx.restore();
    const lamp = ctx.createRadialGradient(x - 2, y - 6, 0, x - 2, y - 6, 18);
    lamp.addColorStop(0, rgba(MOON.lamp, 0.95)); lamp.addColorStop(0.3, rgba("#ff8a3c", 0.5)); lamp.addColorStop(1, rgba("#ff8a3c", 0));
    ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(x - 2, y - 6, 18, 0, TAU); ctx.fill();
    ctx.fillStyle = MOON.warn; ctx.beginPath(); ctx.arc(x + 9, y + 4, 1.8, 0, TAU); ctx.fill();
  }
}

/* ---------------------------------------------------------
   THE GEODE - the glow cave
   ---------------------------------------------------------
 * Under the moon, the whole world is hollow and it glows. The moon's
 * opposite in the one way that matters: there is no sun down here, so
 * nothing throws a shadow - the light comes UP, out of the things on the
 * floor. A luminous stream crosses the tile (full height, wrap-exact) and
 * lights its own banks; veins of violet mineral run through the rock;
 * fungi glow in the hollows; and where the ceiling has cracked, a shaft of
 * daylight falls and lands as a pale pool. The crystal clusters the level
 * plays with are drawn live by crystals.js over this floor, so the rock
 * stays deep enough for them to shine. The once-layer is the Great Geode.
 */
const CAVE = {
  rock:"#1f1830", rockLit:"#2e2546", rockDeep:"#130d22", black:"#0a0716",
  stream:"#4fe3ff", streamDeep:"#1c7fa0", streamLit:"#8ff0ff", streamGlow:"#2fb8e8",
  vein:"#8f6bff", veinLit:"#d2bdff",
  fungi:"#7ef0d0", fungiCore:"#e8fff6",
  shaft:"#cfe6ff", mist:"#8fa3c8",
  rail:"#3a3150", railLit:"#5f5580", warn:"#ff5d73", lamp:"#ffd166",
  hues:[ ["#ff60c4","#ffd6f1"], ["#5ef2ff","#dffcff"], ["#ffd166","#fff3c4"], ["#b48cff","#ece0ff"] ],
};

/** A vein of the mineral: a branching hairline that glows. */
function caveVein(ctx, x, y, a, l, rand){
  const pts = [[x, y]];
  let px = x, py = y, aa = a;
  for(let i = 0; i < 5; i++){
    aa += (rand() - 0.5)*1.0;
    px += Math.cos(aa)*l/5; py += Math.sin(aa)*l/5;
    pts.push([px, py]);
  }
  const trace = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for(let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(CAVE.vein, 0.22); ctx.lineWidth = 7; trace(); ctx.stroke();
  ctx.strokeStyle = rgba(CAVE.vein, 0.9); ctx.lineWidth = 1.8; trace(); ctx.stroke();
  ctx.strokeStyle = rgba(CAVE.veinLit, 0.9); ctx.lineWidth = 0.7; trace(); ctx.stroke();
  // a side branch off the middle
  const m = pts[2];
  ctx.strokeStyle = rgba(CAVE.vein, 0.8); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(m[0] + Math.cos(aa + 1.4)*l*0.3, m[1] + Math.sin(aa + 1.4)*l*0.3); ctx.stroke();
}

/** A stalagmite seen from above: a bump, its tip catching the glow. */
function caveStump(ctx, x, y, r){
  ctx.fillStyle = rgba(CAVE.black, 0.7);
  ctx.beginPath(); ctx.ellipse(x, y + r*0.2, r*1.35, r*1.1, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(x - r*0.15, y - r*0.15, 0, x, y, r);
  g.addColorStop(0, "#4a3f6a"); g.addColorStop(0.45, CAVE.rockLit); g.addColorStop(1, CAVE.rockDeep);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(CAVE.streamLit, 0.55);
  ctx.beginPath(); ctx.arc(x - r*0.15, y - r*0.15, Math.max(1, r*0.16), 0, TAU); ctx.fill();
}

/** A clump of glowing fungi: a halo, the caps, a bright point on each. */
function caveFungi(ctx, x, y, n, rand){
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 16 + n*2);
  halo.addColorStop(0, rgba(CAVE.fungi, 0.35)); halo.addColorStop(1, rgba(CAVE.fungi, 0));
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, 16 + n*2, 0, TAU); ctx.fill();
  for(let i = 0; i < n; i++){
    const a = rand()*TAU, d = rand()*(6 + n*1.5), r = 1.4 + rand()*2.2;
    const fx = x + Math.cos(a)*d, fy = y + Math.sin(a)*d;
    ctx.fillStyle = rgba(CAVE.fungi, 0.85); ctx.beginPath(); ctx.arc(fx, fy, r, 0, TAU); ctx.fill();
    ctx.fillStyle = CAVE.fungiCore; ctx.beginPath(); ctx.arc(fx - r*0.3, fy - r*0.3, r*0.4, 0, TAU); ctx.fill();
  }
}

/** A small crystal in the floor, in one of the four colours: a halo, a
 *  glassy shard, a bright edge. `s` is its size. */
function caveShard(ctx, x, y, s, rot, hue){
  const halo = ctx.createRadialGradient(x, y, 0, x, y, s*2.4);
  halo.addColorStop(0, rgba(hue[0], 0.35)); halo.addColorStop(1, rgba(hue[0], 0));
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, s*2.4, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  const g = ctx.createLinearGradient(0, -s, 0, s*0.6);
  g.addColorStop(0, rgba(hue[1], 0.95)); g.addColorStop(1, rgba(hue[0], 0.8));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s*0.55, s*0.3); ctx.lineTo(0, s*0.6); ctx.lineTo(-s*0.55, s*0.3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = rgba("#ffffff", 0.85); ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s*0.55, s*0.3); ctx.stroke();
  ctx.restore();
}

/** Where a shaft of daylight lands: a pale pool with dust hanging in it. */
function caveShaftPool(ctx, x, y, rx, ry, rot, rand){
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, ry/rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(CAVE.shaft, 0.34)); g.addColorStop(0.5, rgba(CAVE.shaft, 0.16)); g.addColorStop(1, rgba(CAVE.shaft, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.restore();
  for(let i = 0; i < 14; i++){
    const a = rand()*TAU, d = rand()*rx*0.8;
    ctx.fillStyle = rgba("#ffffff", 0.3 + rand()*0.5);
    ctx.fillRect(x + Math.cos(a)*d, y + Math.sin(a)*d*(ry/rx), 1.2, 1.2);
  }
}

/** One of their ore carts on the rail: a dark box with the cargo glowing in it. */
function caveCart(ctx, x, y, a, hue){
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = CAVE.black; ctx.fillRect(-9, -6, 18, 12);
  ctx.fillStyle = CAVE.rail; ctx.fillRect(-8, -5, 16, 10);
  ctx.strokeStyle = CAVE.railLit; ctx.lineWidth = 1; ctx.strokeRect(-8, -5, 16, 10);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
  g.addColorStop(0, rgba(hue[1], 0.95)); g.addColorStop(0.5, rgba(hue[0], 0.7)); g.addColorStop(1, rgba(hue[0], 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawCavefloor(ctx, W, H, p, rand){
  ctx.fillStyle = CAVE.rock;
  ctx.fillRect(0, 0, W, H);

  // The rock's own relief: paler bosses and deeper hollows, soft-edged.
  for(let i = 0; i < 14; i++){
    const x = rand()*W, y = rand()*H, r = (0.10 + rand()*0.26)*W;
    const col = i % 3 ? CAVE.rockDeep : CAVE.rockLit;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(col, i % 3 ? 0.7 : 0.6)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }
  // Grit: the floor is not smooth.
  for(let i = 0; i < 220; i++){
    const x = rand()*W, y = rand()*H;
    ctx.fillStyle = rgba(i % 2 ? "#5a4f7a" : CAVE.black, 0.3 + rand()*0.35);
    tiled(ctx, H, y, yy => ctx.fillRect(x, yy, 1.3, 1.3));
  }

  // Mist, lying in the low places.
  for(let i = 0; i < 5; i++){
    const x = rand()*W, y = rand()*H, r = (0.16 + rand()*0.2)*W;
    tiled(ctx, H, y, yy => {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, rgba(CAVE.mist, 0.09)); g.addColorStop(1, rgba(CAVE.mist, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    });
  }

  /*
   * THE STREAM - full height, wrap-exact (whole sine periods of t), and the
   * brightest thing on the floor: a glow on both banks, a dark bed, the
   * water, a lit core, and ripples down its middle.
   */
  const sx0 = W*(0.30 + rand()*0.14);
  const s1 = (rand() - 0.5)*W*0.2, s2 = (rand() - 0.5)*W*0.1;
  const stream = t => sx0 + Math.sin(t*TAU)*s1 + Math.sin(t*TAU*2 + 0.8)*s2;
  const sw = 34 + rand()*12;
  const streamPath = () => {
    ctx.beginPath();
    for(let i = 0; i <= 56; i++){ const t = i/56, x = stream(t); i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
  };
  ctx.lineCap = "butt"; ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(CAVE.streamGlow, 0.16); ctx.lineWidth = sw*3.6; streamPath(); ctx.stroke();
  ctx.strokeStyle = rgba(CAVE.streamGlow, 0.22); ctx.lineWidth = sw*2.2; streamPath(); ctx.stroke();
  ctx.strokeStyle = CAVE.black; ctx.lineWidth = sw + 12; streamPath(); ctx.stroke();
  ctx.strokeStyle = CAVE.streamDeep; ctx.lineWidth = sw; streamPath(); ctx.stroke();
  ctx.strokeStyle = rgba(CAVE.stream, 0.9); ctx.lineWidth = sw*0.55; streamPath(); ctx.stroke();
  ctx.setLineDash([16, 30]);
  ctx.strokeStyle = rgba(CAVE.streamLit, 0.85); ctx.lineWidth = sw*0.16; streamPath(); ctx.stroke();
  ctx.setLineDash([]);
  // the bank's wet edge, and stones in the water
  ctx.strokeStyle = rgba(CAVE.streamLit, 0.5); ctx.lineWidth = 1.2;
  ctx.save(); ctx.translate(-sw*0.5 - 6, 0); streamPath(); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(sw*0.5 + 6, 0); streamPath(); ctx.stroke(); ctx.restore();
  for(let i = 0; i < 9; i++){
    const t = rand(), x = stream(t) + (rand() - 0.5)*sw*0.7, y = t*H, r = 3 + rand()*5;
    tiled(ctx, H, y, yy => {
      ctx.fillStyle = CAVE.rockDeep; ctx.beginPath(); ctx.ellipse(x, yy, r, r*0.7, rand()*TAU, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(CAVE.streamLit, 0.7); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, yy + 1.5, r + 2, (r + 2)*0.7, 0, 0, TAU); ctx.stroke();
    });
  }

  // Veins of the mineral, glowing violet through the rock.
  for(let i = 0; i < 16; i++){
    const x = rand()*W, y = rand()*H, a = rand()*TAU, l = 40 + rand()*70;
    tiled(ctx, H, y, yy => caveVein(ctx, x, yy, a, l, rngFor(8500 + i)));
  }

  // Stalagmites, in families.
  for(let c = 0; c < 6; c++){
    const cx = rand()*W, cy = rand()*H, n = 3 + Math.floor(rand()*4);
    for(let i = 0; i < n; i++){
      const x = cx + (rand() - 0.5)*W*0.14, y = cy + (rand() - 0.5)*W*0.14, r = 4 + rand()*9;
      tiled(ctx, H, y, yy => caveStump(ctx, x, yy, r));
    }
  }

  // Where the ceiling has cracked: daylight lands in pale pools.
  for(let i = 0; i < 3; i++){
    const x = rand()*W, y = rand()*H, rx = 50 + rand()*50, ry = rx*(0.5 + rand()*0.3), rot = rand()*TAU;
    tiled(ctx, H, y, yy => caveShaftPool(ctx, x, yy, rx, ry, rot, rngFor(8700 + i)));
  }

  // Fungi in the hollows, and small crystals grown into the floor.
  for(let i = 0; i < 9; i++){
    const x = rand()*W, y = rand()*H, n = 4 + Math.floor(rand()*6);
    tiled(ctx, H, y, yy => caveFungi(ctx, x, yy, n, rngFor(8900 + i)));
  }
  for(let i = 0; i < 18; i++){
    const x = rand()*W, y = rand()*H, s = 4 + rand()*6, rot = rand()*TAU;
    const hue = CAVE.hues[i % CAVE.hues.length];
    tiled(ctx, H, y, yy => caveShard(ctx, x, yy, s, rot, hue));
  }

  /*
   * THEIR RAIL - a narrow-gauge track running the height of the tile (wrap-
   * exact like the stream), sleepers under it, cut blocks stacked beside it,
   * and two carts with what they cut still glowing in them.
   */
  const rx0 = W*(0.72 + rand()*0.12);
  const rail = t => rx0 + Math.sin(t*TAU + 1.1)*W*0.035;
  const railPath = off => {
    ctx.beginPath();
    for(let i = 0; i <= 56; i++){ const t = i/56, x = rail(t) + off; i ? ctx.lineTo(x, t*H) : ctx.moveTo(x, t*H); }
  };
  const nS = Math.round(H/14);
  ctx.strokeStyle = rgba(CAVE.black, 0.8); ctx.lineWidth = 2.2;
  for(let i = 0; i < nS; i++){
    const t = (i + 0.5)/nS, x = rail(t), y = t*H;
    tiled(ctx, H, y, yy => { ctx.beginPath(); ctx.moveTo(x - 8, yy); ctx.lineTo(x + 8, yy); ctx.stroke(); });
  }
  ctx.strokeStyle = CAVE.railLit; ctx.lineWidth = 1.5;
  railPath(-4.5); ctx.stroke(); railPath(4.5); ctx.stroke();
  for(let i = 0; i < 5; i++){
    const t = rand(), side = rand() < 0.5 ? -1 : 1;
    const x = rail(t) + side*(16 + rand()*14), y = t*H, bw = 10 + rand()*8, bh = 7 + rand()*5;
    tiled(ctx, H, y, yy => {
      ctx.fillStyle = CAVE.black; ctx.fillRect(x - bw*0.5 - 1, yy - bh*0.5 + 2, bw + 2, bh + 1);
      ctx.fillStyle = CAVE.rockLit; ctx.fillRect(x - bw*0.5, yy - bh*0.5, bw, bh);
      ctx.strokeStyle = CAVE.railLit; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - bw*0.5, yy + bh*0.5); ctx.lineTo(x - bw*0.5, yy - bh*0.5); ctx.lineTo(x + bw*0.5, yy - bh*0.5); ctx.stroke();
    });
  }
  for(let i = 0; i < 2; i++){
    const t = 0.2 + rand()*0.6, y = t*H, x = rail(t);
    const dx = (rail(t + 0.002) - rail(t - 0.002))/(0.004*H);
    tiled(ctx, H, y, yy => caveCart(ctx, x, yy, -Math.atan(dx), CAVE.hues[(i + 1) % 4]));
  }

  // Rubble, everywhere.
  for(let i = 0; i < 40; i++){
    const x = rand()*W, y = rand()*H, r = 1.2 + rand()*2.4;
    ctx.fillStyle = rgba(i % 3 ? CAVE.black : "#4a3f6a", 0.8);
    tiled(ctx, H, y, yy => { ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill(); });
  }
}

/*
 * THE GREAT GEODE - the once-layer. A ring of giant crystals around a pool
 * of the glowing water, one shaft of daylight falling through the broken
 * ceiling onto it, and their rig on the far shore with a crystal already
 * sawn off and loaded. The level's rule - light you fly through, that a
 * shot cannot - as a place.
 */
function drawGreatgeode(ctx, W, H, p, rand){
  const cx = W*0.50, cy = H*0.47, R = W*0.30;

  // The floor around it, lit by it.
  const lit = ctx.createRadialGradient(cx, cy, R*0.6, cx, cy, R*1.9);
  lit.addColorStop(0, rgba(CAVE.streamGlow, 0.26)); lit.addColorStop(0.5, rgba(CAVE.vein, 0.12)); lit.addColorStop(1, rgba(CAVE.vein, 0));
  ctx.fillStyle = lit; ctx.beginPath(); ctx.arc(cx, cy, R*1.9, 0, TAU); ctx.fill();

  // The pool: an irregular shore, a bright wet rim, water deepening to the middle.
  const shore = a => R*0.62*(1 + Math.sin(a*3 + 0.4)*0.09 + Math.sin(a*5 + 1.9)*0.05);
  const poolPath = k => {
    ctx.beginPath();
    for(let i = 0; i <= 44; i++){
      const a = (i/44)*TAU, r = shore(a)*k;
      const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = rgba(CAVE.streamLit, 0.5); poolPath(1.08); ctx.fill();
  ctx.fillStyle = CAVE.black; poolPath(1.0); ctx.fill();
  const water = ctx.createRadialGradient(cx, cy, 0, cx, cy, R*0.66);
  water.addColorStop(0, "#062a44"); water.addColorStop(0.55, CAVE.streamDeep); water.addColorStop(0.9, CAVE.stream); water.addColorStop(1, CAVE.streamLit);
  ctx.fillStyle = water; poolPath(1.0); ctx.fill();
  ctx.strokeStyle = rgba(CAVE.streamLit, 0.35); ctx.lineWidth = 1.2;
  for(let i = 1; i <= 4; i++){ poolPath(0.2*i); ctx.stroke(); }

  // The shaft: a column of daylight, tilted, landing on the pool.
  ctx.save(); ctx.translate(cx + R*0.08, cy - R*0.05); ctx.rotate(-0.5); ctx.scale(1, 0.55);
  const shaft = ctx.createRadialGradient(0, 0, 0, 0, 0, R*0.7);
  shaft.addColorStop(0, rgba(CAVE.shaft, 0.55)); shaft.addColorStop(0.4, rgba(CAVE.shaft, 0.25)); shaft.addColorStop(1, rgba(CAVE.shaft, 0));
  ctx.fillStyle = shaft; ctx.beginPath(); ctx.arc(0, 0, R*0.7, 0, TAU); ctx.fill();
  ctx.restore();
  for(let i = 0; i < 26; i++){
    const a = rand()*TAU, d = rand()*R*0.5;
    ctx.fillStyle = rgba("#ffffff", 0.35 + rand()*0.55);
    ctx.fillRect(cx + R*0.08 + Math.cos(a)*d, cy - R*0.05 + Math.sin(a)*d*0.6, 1.3, 1.3);
  }

  /*
   * THE RING OF SHARDS - eleven giants growing outward from the shore, each
   * in one of the four colours, glassy from a bright root to a darker tip,
   * with the light they throw on the rock around them. And the gap in the
   * ring on the far shore, where one has been cut away.
   */
  const N = 11, cut = 2;
  const giants = [];
  for(let i = 0; i < N; i++){
    const a = (i/N)*TAU + 0.3 + (rand() - 0.5)*0.2;
    const base = shore(a)*1.02, len = R*(0.36 + rand()*0.3), wid = R*(0.09 + rand()*0.06);
    giants.push({ a, base, len, wid, hue: CAVE.hues[i % 4], lean: (rand() - 0.5)*0.25 });
  }
  giants.forEach((g, i) => {
    if(i === cut) return;
    const ux = Math.cos(g.a + g.lean), uy = Math.sin(g.a + g.lean);
    const bx = cx + Math.cos(g.a)*g.base, by = cy + Math.sin(g.a)*g.base;
    const tx = bx + ux*g.len, ty = by + uy*g.len;
    const halo = ctx.createRadialGradient(bx + ux*g.len*0.5, by + uy*g.len*0.5, 0, bx + ux*g.len*0.5, by + uy*g.len*0.5, g.len*0.9);
    halo.addColorStop(0, rgba(g.hue[0], 0.3)); halo.addColorStop(1, rgba(g.hue[0], 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(bx + ux*g.len*0.5, by + uy*g.len*0.5, g.len*0.9, 0, TAU); ctx.fill();
  });
  giants.forEach((g, i) => {
    const ux = Math.cos(g.a + g.lean), uy = Math.sin(g.a + g.lean);
    const px = -uy, py = ux;
    const bx = cx + Math.cos(g.a)*g.base, by = cy + Math.sin(g.a)*g.base;
    if(i === cut){
      // the stump: a flat sawn face, ringed, with the cut still bright
      ctx.fillStyle = rgba(CAVE.black, 0.7);
      ctx.beginPath(); ctx.ellipse(bx + ux*8, by + uy*8, g.wid*0.8, g.wid*0.55, g.a, 0, TAU); ctx.fill();
      const face = ctx.createRadialGradient(bx + ux*6, by + uy*6, 0, bx + ux*6, by + uy*6, g.wid*0.7);
      face.addColorStop(0, rgba(g.hue[1], 0.95)); face.addColorStop(1, rgba(g.hue[0], 0.8));
      ctx.fillStyle = face; ctx.beginPath(); ctx.ellipse(bx + ux*6, by + uy*6, g.wid*0.7, g.wid*0.48, g.a, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(bx + ux*6, by + uy*6, g.wid*0.7, g.wid*0.48, g.a, 0, TAU); ctx.stroke();
      return;
    }
    const tx = bx + ux*g.len, ty = by + uy*g.len;
    const grad = ctx.createLinearGradient(bx, by, tx, ty);
    grad.addColorStop(0, rgba(g.hue[1], 0.95)); grad.addColorStop(0.35, rgba(g.hue[0], 0.85)); grad.addColorStop(1, rgba(g.hue[0], 0.55));
    // the root it grows from
    ctx.fillStyle = rgba(CAVE.black, 0.75);
    ctx.beginPath(); ctx.ellipse(bx, by, g.wid*0.9, g.wid*0.6, g.a, 0, TAU); ctx.fill();
    // the shard: base corners, a shoulder, the tip
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(bx + px*g.wid*0.5, by + py*g.wid*0.5);
    ctx.lineTo(bx + ux*g.len*0.55 + px*g.wid*0.62, by + uy*g.len*0.55 + py*g.wid*0.62);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx + ux*g.len*0.55 - px*g.wid*0.62, by + uy*g.len*0.55 - py*g.wid*0.62);
    ctx.lineTo(bx - px*g.wid*0.5, by - py*g.wid*0.5);
    ctx.closePath(); ctx.fill();
    // the facet line down its spine, and the bright edge on one side
    ctx.strokeStyle = rgba("#ffffff", 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.9); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(bx + px*g.wid*0.5, by + py*g.wid*0.5);
    ctx.lineTo(bx + ux*g.len*0.55 + px*g.wid*0.62, by + uy*g.len*0.55 + py*g.wid*0.62); ctx.lineTo(tx, ty); ctx.stroke();
    // the heart of it, a bright seed near the root
    const heart = ctx.createRadialGradient(bx + ux*g.len*0.22, by + uy*g.len*0.22, 0, bx + ux*g.len*0.22, by + uy*g.len*0.22, g.wid*0.6);
    heart.addColorStop(0, rgba("#ffffff", 0.9)); heart.addColorStop(1, rgba(g.hue[1], 0));
    ctx.fillStyle = heart; ctx.beginPath(); ctx.arc(bx + ux*g.len*0.22, by + uy*g.len*0.22, g.wid*0.6, 0, TAU); ctx.fill();
  });
  // small crystals between the giants, and fungi along the shore
  for(let i = 0; i < 16; i++){
    const a = rand()*TAU, d = shore(a)*(1.1 + rand()*0.5);
    caveShard(ctx, cx + Math.cos(a)*d, cy + Math.sin(a)*d, 3 + rand()*5, rand()*TAU, CAVE.hues[i % 4]);
  }
  for(let i = 0; i < 6; i++){
    const a = rand()*TAU, d = shore(a)*(1.04 + rand()*0.12);
    caveFungi(ctx, cx + Math.cos(a)*d, cy + Math.sin(a)*d, 4 + Math.floor(rand()*4), rngFor(9100 + i));
  }
  for(let i = 0; i < 7; i++){
    const a = rand()*TAU, d = shore(a)*(1.3 + rand()*0.7);
    caveStump(ctx, cx + Math.cos(a)*d, cy + Math.sin(a)*d, 5 + rand()*8);
  }

  /*
   * THEIR RIG, on the shore by the stump: a dark platform, a boom out over
   * the water with the saw hanging off it, two lamps, the red eye, a spur of
   * rail with a cart on it, and the piece they cut lying beside it.
   */
  {
    const g = giants[cut];
    const kx = cx + Math.cos(g.a)*g.base*1.5, ky = cy + Math.sin(g.a)*g.base*1.5;
    ctx.fillStyle = rgba(CAVE.black, 0.8); ctx.fillRect(kx - 26, ky - 14, 52, 30);
    ctx.fillStyle = CAVE.rail; ctx.fillRect(kx - 24, ky - 12, 48, 26);
    ctx.strokeStyle = CAVE.railLit; ctx.lineWidth = 1; ctx.strokeRect(kx - 24, ky - 12, 48, 26);
    for(let i = 0; i < 4; i++){ ctx.beginPath(); ctx.moveTo(kx - 24, ky - 12 + i*7); ctx.lineTo(kx + 24, ky - 12 + i*7); ctx.stroke(); }
    // the boom, from the platform to a claw over the stump
    ctx.strokeStyle = CAVE.railLit; ctx.lineWidth = 3; ctx.lineCap = "round";
    const bx = cx + Math.cos(g.a)*g.base + Math.cos(g.a)*6, by = cy + Math.sin(g.a)*g.base + Math.sin(g.a)*6;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = CAVE.black; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = CAVE.rail; ctx.beginPath(); ctx.arc(bx, by, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = CAVE.railLit; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, by, 5, 0, TAU); ctx.stroke();
    // lamps and the eye
    [[-14, -4], [14, -4]].forEach(([dx, dy]) => {
      const lamp = ctx.createRadialGradient(kx + dx, ky + dy, 0, kx + dx, ky + dy, 16);
      lamp.addColorStop(0, rgba(CAVE.lamp, 0.9)); lamp.addColorStop(1, rgba(CAVE.lamp, 0));
      ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(kx + dx, ky + dy, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(kx + dx, ky + dy, 1.6, 0, TAU); ctx.fill();
    });
    ctx.fillStyle = CAVE.warn; ctx.beginPath(); ctx.arc(kx + 20, ky + 10, 2, 0, TAU); ctx.fill();
    // the spur, and the cart with the cut piece in it
    ctx.strokeStyle = rgba(CAVE.black, 0.8); ctx.lineWidth = 2.2;
    for(let i = 0; i < 6; i++){ ctx.beginPath(); ctx.moveTo(kx + 30 + i*12, ky - 6); ctx.lineTo(kx + 30 + i*12, ky + 10); ctx.stroke(); }
    ctx.strokeStyle = CAVE.railLit; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(kx + 26, ky - 3); ctx.lineTo(kx + 100, ky - 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kx + 26, ky + 6); ctx.lineTo(kx + 100, ky + 6); ctx.stroke();
    caveCart(ctx, kx + 60, ky + 1.5, 0, g.hue);
    // the piece itself, lying by the rig: a slab of the giant, glassy
    ctx.save(); ctx.translate(kx - 10, ky + 34); ctx.rotate(0.5);
    const slab = ctx.createLinearGradient(-22, 0, 22, 0);
    slab.addColorStop(0, rgba(g.hue[1], 0.95)); slab.addColorStop(1, rgba(g.hue[0], 0.8));
    ctx.fillStyle = rgba(CAVE.black, 0.7); ctx.fillRect(-22, -6, 46, 16);
    ctx.fillStyle = slab; ctx.fillRect(-22, -8, 44, 14);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.strokeRect(-22, -8, 44, 14);
    ctx.restore();
  }
}

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
function build(missionIndex, W, H, dpr = 1, still){
  const sky = SKIES[missionIndex % SKIES.length];
  if(sky.photo) return null;                       // the renderer uses the artwork
  // `still` for anything that never scrolls: it wants the whole sky in one
  // picture, once-props included. See paint's three modes.
  return paint(sky, missionIndex*137 + 7, W, H, dpr, true, still ? "all" : "tile");
}

/*
 * THE THINGS YOU ONLY PASS ONCE.
 *
 * A transparent layer holding this sky's `once` props, or null if it has
 * none - which is all but one of them. The backdrop tiles, so anything baked
 * into it comes round again, and a planet two thirds of a screen across shows
 * both of its wrap copies at the same moment. Earth over the first patrol has
 * to be a place you leave, not wallpaper.
 *
 * It is painted by the same function, from the same seed, and the sky under
 * it is thrown away at the last moment rather than skipped - so Earth is lit
 * by the same nebula core it has always been lit by, instead of by a second
 * guess at where the light was. One wasted bake at mission start buys that.
 */
function buildOnce(missionIndex, W, H, dpr = 1){
  const sky = SKIES[missionIndex % SKIES.length];
  if(sky.photo) return null;
  if(!(sky.props || []).some(pr => pr.once)) return null;
  return paint(sky, missionIndex*137 + 7, W, H, dpr, false, "once");
}

/**
 * One painter, two customers: the scrolling mission skies (wrap:true) and the
 * menu's still frame (wrap:false). Splitting this out is what lets the title
 * screen use the game's OWN planets - banded, ringed, limb-lit - instead of
 * the hand-rolled sphere it used to draw for itself.
 */
/*
 * THE PROP DISPATCH, in one place because there are now two bakes that need
 * it: the tiling backdrop, and the once-only layer that drifts past the
 * camera a single time (see paintOnce).
 */
function drawPropList(px, W, H, list, rand, coreDir, sky, dpr){
  list.forEach(pr => {
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
    else if(pr.k === "fields") drawFields(px, W, H, pr, rand);
    else if(pr.k === "farm") drawFarm(px, W, H, pr, rand);
    else if(pr.k === "wild") drawWild(px, W, H, pr, rand);
    else if(pr.k === "ruin") drawRuin(px, W, H, pr, rand);
    else if(pr.k === "seabed") drawSeabed(px, W, H, pr, rand);
    else if(pr.k === "drowned") drawDrowned(px, W, H, pr, rand);
    else if(pr.k === "emberfloor") drawEmberfloor(px, W, H, pr, rand);
    else if(pr.k === "forgecity") drawForgecity(px, W, H, pr, rand);
    else if(pr.k === "dunes") drawDunes(px, W, H, pr, rand);
    else if(pr.k === "suncatcher") drawSuncatcher(px, W, H, pr, rand);
    else if(pr.k === "icefield") drawIcefield(px, W, H, pr, rand);
    else if(pr.k === "frozenfleet") drawFrozenfleet(px, W, H, pr, rand);
    else if(pr.k === "moonfloor") drawMoonfloor(px, W, H, pr, rand);
    else if(pr.k === "greatarch") drawGreatarch(px, W, H, pr, rand);
    else if(pr.k === "cavefloor") drawCavefloor(px, W, H, pr, rand);
    else if(pr.k === "greatgeode") drawGreatgeode(px, W, H, pr, rand);
  });
}

function paint(sky, seed, W, H, dpr, wrap, mode){
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

  /*
   * PROPS THAT ONLY HAPPEN ONCE.
   *
   * The backdrop is a vertically tiling texture, so everything baked into it
   * comes round again - and a big enough prop shows BOTH its copies at the
   * same moment, because `tiled` draws it at y and y-H and a planet 0.68H
   * across spans far enough to reach the frame from either side. That is
   * fine for a nebula and wrong for a planet: "on level 1 I want earth to
   * only appear once. Right now there are multiple earth which makes no
   * sense."
   *
   * So a prop can opt out of the loop. `once` props are baked into their own
   * transparent layer instead, which the renderer drifts past the camera a
   * single time and then never draws again - you leave Earth behind on the
   * first patrol, which is also what the mission is about.
   */
  /*
   * The once-layer wants the props and nothing else. Everything above is
   * painted anyway and cleared HERE, at the last possible moment, because
   * `cores` - which decides where each planet's light comes from - is a
   * product of painting the nebula. Skipping the sky would mean re-deriving
   * that, and a second derivation is a second answer.
   */
  if(mode === "once") ctx.clearRect(0, 0, W, H);
  /*
   * Three customers, three answers. "tile" is the scrolling backdrop and
   * leaves the once-props out; "once" is their own layer; "all" is a STILL -
   * a briefing hero, a map preview, the workshop's thumbnail - where nothing
   * ever scrolls, so a planet cannot come round twice and leaving it out
   * would just make the picture emptier for no reason.
   */
  const props = (sky.props || []).filter(pr =>
    mode === "all" ? true : (!!pr.once === (mode === "once")));
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
      drawPropList(px, W, H, props, rand, coreDir, sky, dpr);
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
    /*
     * SMALLER, AND ACTUALLY A SPHERE.
     *
     * At r=0.55 with its centre a third of a screen below the bottom edge,
     * the only part of this you ever saw was a very shallow arc - and a
     * shallow arc does not read as a ball, it reads as a wall across the
     * corner. It was also the single worst victim of the flat sprite cap
     * above, stretched nine times its own resolution, so what the wall was
     * made of was mush.
     *
     * Half the radius and a much smaller drop, so a real curved limb shows
     * with the terminator running across it, and a band of weather to look
     * at now that there is enough resolution to see any.
     */
    /*
     * ...and the world below is OURS. It was an anonymous amber giant, which
     * made the home screen a view of nowhere in particular; the campaign now
     * opens on Earth and ends up flying home, so the planet the last buttons
     * sit on should be the one the family took off from. Hazed a quarter of
     * the way back into the sky's own deep tone for the reason the amber one
     * was: it is the largest thing on the menu and it lives in a corner where
     * nothing happens, so it must not be the brightest thing there too.
     */
    { k:"planet", x:0.13, y:(H + 0.07*u)/H, r:rx(0.24),
      lit:EARTH_LIT, dark:EARTH_DARK, earth:true, haze:0.26 },
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

SF.skygen = { build, buildOnce, buildTitle, photoFor, isSurface, SKIES, earthSprite, EARTH_LIT };
})();
