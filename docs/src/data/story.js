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

  /* Campaign cleared: a proper curtain, still not a full stop. */
  campaign: {
    title: "SKIES CLEAR",
    panels: [
      { art:"sky",  text:"Their flagship is scrap and the lanes are quiet for the first time in months." },
      { art:"crew", text:"Every pilot you pulled out of the dark got home, {you}. They know your name down there." },
      { art:"now",  text:"There are harder skies than these - fly the missions again on the tiers that used to be impossible, and find out." },
    ],
    button:"FINISH",
  },
};

SF.storyData = { STORY };
})();
