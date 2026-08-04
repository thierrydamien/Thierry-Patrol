/*
 * Story beats. Three or four comic panels, each with a caption and a ship
 * drawn from the pilot's *actual* upgrade levels - so the story literally
 * shows how far they've come rather than using stock art.
 *
 * `art` picks what the panel draws:
 *   "stock"   - the ship as it left the factory (no parts)
 *   "now"     - their ship exactly as it is
 *   "crew"    - their ship with the squadmate's alongside
 *   "sky"     - their ship small against the horizon (an establishing shot)
 *
 * A beat fires once, is recorded in the profile, and never fires again.
 */
(function(){
"use strict";
const SF = window.SF;

const STORY = {
  /* Fires the first time they own a part - the moment the hangar means something. */
  firstPart: {
    title: "SHE'S CHANGING",
    panels: [
      { art:"stock", text:"This is the ship they gave you, {you}. Stock hull, one gun, and a lot of sky." },
      { art:"now",   text:"This is the ship you built. Every bolt on it, you paid for." },
      { art:"sky",   text:"The mechanics have started asking what you're going to add next." },
    ],
    button:"BACK TO THE HANGAR",
  },

  /* The real "ending": gear level 20. The campaign carries on afterwards, and
     the last panel says so on purpose - it's a chapter close, not a stop. */
  ace: {
    title: "SQUADRON ACE",
    panels: [
      { art:"stock", text:"Twenty upgrades ago this was all you had, {you}." },
      { art:"crew",  text:"They said the two of you wouldn't last a week up here." },
      { art:"now",   text:"Command has stopped calling you a cadet. You're the squadron's ace now - the pilot the others form up on." },
      { art:"sky",   text:"That's the end of the beginning. The sky's still full of them. Go and see how far this thing can really go." },
    ],
    button:"FLY ON",
  },

  /* Act one down. Not a curtain - a door opening, so the map above mission 8
     reads as the point rather than as leftovers. */
  actTwo: {
    title: "THEY'RE RUNNING",
    panels: [
      { art:"sky",  text:"The Sentinel is scrap. Home space is quiet for the first time in months - and the rest of their fleet is running for the lane they came in by." },
      { art:"crew", text:"Command wants to know if you'll follow them, {you}. Nobody would think less of you for saying no." },
      { art:"now",  text:"You already know the answer. Eight more stops, all of them theirs - one flown dark, one their own treasure house, and one of them is the last one." },
    ],
    button:"GO AFTER THEM",
  },

  /* Why the guns don't work on Silent Running - shown the first time the
     briefing for a no-guns mission opens, so nobody launches confused. */
  silent: {
    title: "GUNS DOWN",
    panels: [
      { art:"now",  text:"That last blast from the Sentinel fried every cannon on your ship, {you}. The crew can fix them - but not out here." },
      { art:"sky",  text:"The repair yard is on the far side of their blockade. Fly dark, stay quiet, and dodge EVERYTHING - most of them can't even see you, so the shots are few. The traffic won't move out of your way, though." },
      { art:"crew", text:"No guns means no mistakes, {you}. Catch the coins, catch our drifting pilots, and bring the ship home in one piece." },
    ],
    button:"FLY DARK",
  },

  /* Campaign cleared: a proper curtain, still not a full stop. */
  campaign: {
    title: "THE STAR CAME BACK",
    panels: [
      { art:"sky",  text:"The Devourer came apart in a light so bright that every pilot in the sector saw it from home. Where it was, there is nothing now - just the dark, and then, slowly, stars again." },
      { art:"crew", text:"They all came, {you}. Every pilot you ever pulled out of a cell or caught drifting - they turned up at the end and flew the last minute with you. That's the part they'll tell." },
      { art:"now",  text:"Command's calling it the day the war ended. Down there they're calling it something else: the day the Thierrys went out to the last star and came back." },
      { art:"sky",  text:"The sky is yours, {you}. Take it anywhere - the missions are still up there on the harder tiers, and nobody has ever flown the Daily Patrol as far as you're about to." },
    ],
    button:"COME HOME",
  },
};

SF.storyData = { STORY };
})();
