/*
 * Radio chatter. The game already shouted about combat; this is everything
 * else - the pick-up you grabbed, the shot that nearly had you, the last life,
 * the record you just took off your brother.
 *
 * Every line is a template. {you} is the pilot flying, {mate} is a squadmate
 * (their sibling), {n} is whatever number the event carries. Lines are picked
 * at random from the bucket so the same event doesn't say the same thing.
 *
 * Speakers: "control" is mission control, "mate" is the other pilot in the
 * house (only used when there actually is one).
 */
(function(){
"use strict";
const SF = window.SF;

const COMMS = {
  missionStart: { speaker:"control", cooldown:999, lines:[
    "You're clear for launch, {you}.",
    "Skies are yours, {you}. Show them.",
    "Good hunting, {you}.",
  ]},
  pickupShield: { speaker:"control", cooldown:9, lines:[
    "Shield online!", "Shields back up, {you}.", "That's a fresh shield.",
  ]},
  pickupGun: { speaker:"control", cooldown:9, lines:[
    "Guns hot!", "Weapons boosted!", "That's more firepower, {you}.",
  ]},
  pickupScore: { speaker:"control", cooldown:12, lines:[
    "Double points - go get them!", "Score doubled, make it count.",
  ]},
  closeCall: { speaker:"mate", cooldown:11, lines:[
    "That was close, {you}!",
    "Whoa! Nearly had you.",
    "Careful - that one had your name on it.",
    "Nice dodge, {you}.",
  ]},
  // "Life", because that is what the shop, the HUD and the star objectives all
  // call it. This bucket was the only place in the game that said "ship".
  lowLives: { speaker:"control", cooldown:25, lines:[
    "Last life, {you}. Make it count.",
    "You're down to your last life - fly smart.",
    "One life left. Take your time out there.",
  ]},
  lifeLost: { speaker:"mate", cooldown:14, lines:[
    "You okay? Keep going, {you}.",
    "Shake it off, {you}.",
    "Still with you. Get back in there.",
  ]},
  comboBreak: { speaker:"control", cooldown:16, lines:[
    "Combo broken at x{n} - rebuild it.",
    "Lost the chain at x{n}. Again!",
  ]},
  bigCombo: { speaker:"mate", cooldown:14, lines:[
    "x{n}! How are you doing that?!",
    "x{n} combo - that's a streak, {you}!",
    "Don't stop, {you}, that's x{n}!",
  ]},
  guardian: { speaker:"control", cooldown:20, lines:[
    "Your shots are bouncing - kill the Guardian first!",
    "That blue one is shielding them. Take it out.",
    "Nothing gets through while the Guardian is up, {you}.",
  ]},
  thiefSpotted: { speaker:"mate", cooldown:20, lines:[
    "It's going for your coins, {you}!",
    "Hey! That one's stealing your money.",
  ]},
  thiefDown: { speaker:"control", cooldown:6, lines:[
    "Got your money back.",
    "Cash recovered, {you}.",
  ]},
  // Pounds, like every other number in this game. This bucket said "$120"
  // while the banner two inches above it said "£120".
  thiefEscaped: { speaker:"mate", cooldown:8, lines:[
    "It got away with £{n}! Get the next one.",
    "There goes £{n}. Faster next time, {you}.",
  ]},
  sniper: { speaker:"control", cooldown:22, lines:[
    "Marksman locking on - get out of that line!",
    "See the pink line? Don't be standing in it.",
  ]},
  mender: { speaker:"mate", cooldown:22, lines:[
    "The green one is fixing them! Shoot that first.",
    "They're healing each other, {you}.",
  ]},
  hive: { speaker:"control", cooldown:22, lines:[
    "That Hive keeps making more - kill it, {you}.",
    "More of them every second. Take out the big purple one.",
  ]},
  bomber: { speaker:"mate", cooldown:22, lines:[
    "Mines! Don't fly into those.",
    "It's dropping mines, {you} - go round.",
  ]},
  interceptor: { speaker:"mate", cooldown:22, lines:[
    "Those ones are following you!",
    "It's matching you, {you} - swerve hard.",
  ]},
  boulders: { speaker:"control", cooldown:40, lines:[
    "Those big ones take a beating, {you} - keep on them.",
    "Boulder field. Break them up and collect, or fly around.",
    "A couple of shots won't dent that one, {you}. Keep firing.",
  ]},
  asteroids: { speaker:"control", cooldown:30, lines:[
    "Rocks ahead - fly around them or break them up.",
    "Asteroid field, {you}. Mind the big ones.",
  ]},
  splitter: { speaker:"mate", cooldown:22, lines:[
    "It split! Watch out, {you}.",
    "They come apart when you shoot them!",
  ]},
  rescue: { speaker:"control", cooldown:8, lines:[
    "Pilot aboard. Good work, {you}.",
    "That's one of ours home safe.",
    "Rescue confirmed - thank you, {you}.",
  ]},
  // Said as the fight starts, right after the arrival cinematic has already
  // NAMED the boss - so no line here may claim what the boss is. "Flagship"
  // used to play over the Marauder.
  bossIncoming: { speaker:"control", cooldown:999, lines:[
    "Watch its wind-ups, {you} - it always tells you first.",
    "Steady, {you}. You've got this.",
  ]},
  armoured: { speaker:"control", cooldown:999, lines:[
    "Your shots are bouncing off, {you} - shoot the PARTS, not the middle!",
    "It's sealed. Knock the bits off it first!",
  ]},
  coreExposed: { speaker:"mate", cooldown:999, lines:[
    "Armour's off - HIT THE MIDDLE, {you}!",
    "The core's wide open. Now!",
  ]},
  bossWeakPoint: { speaker:"mate", cooldown:10, lines:[
    "You knocked a gun off it!",
    "It's coming apart, {you}!",
  ]},
  halfway: { speaker:"control", cooldown:999, lines:[
    "Halfway, {you}. Holding up well.",
    "That's the midpoint - keep it together.",
  ]},
  stormStart: { speaker:"control", cooldown:999, lines:[
    "Squall ahead, {you}. Watch the streaks - the wind hits right after them.",
    "It's blowing hard out there. Lean AGAINST the gusts, {you}.",
  ]},
  convoyStart: { speaker:"control", cooldown:999, lines:[
    "That hauler can't dodge or shoot back, {you}. Stay near it and kill what comes.",
    "They're going straight for our hauler, {you}. Don't let them reach it.",
  ]},
  haulerHurt: { speaker:"mate", cooldown:20, lines:[
    "The hauler's in a bad way, {you} - get them off it!",
    "It can't take much more! Clear them out, {you}!",
  ]},
  trenchStart: { speaker:"control", cooldown:999, lines:[
    "Walls ahead, {you}. Read each gate, find the gap, thread it.",
    "It's a trench, {you} - weave the gaps or blast your own door.",
  ]},
  blackoutStart: { speaker:"control", cooldown:999, lines:[
    "The lights are gone, {you}. Your glow is the only lamp out here.",
    "Fly by your own light, {you} - and look for the ones drifting in the dark.",
  ]},
  haulerDown: { speaker:"mate", cooldown:8, lines:[
    "We lost a hauler! Guard the others, {you}!",
    "Hauler's gone... don't let that happen again.",
  ]},
  haulerSafe: { speaker:"control", cooldown:8, lines:[
    "Hauler's through! Well flown, {you}.",
    "That's one home safe. Keep it up.",
  ]},
  rivalStart: { speaker:"control", cooldown:999, lines:[
    "Vesper is out here somewhere, {you}. She's as good as you are.",
    "Watch for Vesper, {you}. She'll copy everything you do.",
  ]},
  rivalArrives: { speaker:"mate", cooldown:999, lines:[
    "That's her! She's mirroring you, {you} — make her move first!",
    "Vesper! Don't chase her, {you} — shoot where she's GOING.",
  ]},
  rivalReturns: { speaker:"mate", cooldown:999, lines:[
    "It's Vesper again! She's faster than last time, {you}!",
    "She came back for you, {you}. Same trick — make her commit!",
  ]},
  rivalDown: { speaker:"mate", cooldown:999, lines:[
    "You got Vesper! Nobody has ever done that, {you}.",
    "She's down! That was proper flying, {you}.",
  ]},
  /*
   * THE EARLY MISSIONS TEACH THEIR RULE TOO.
   *
   * Eleven mission mechanics have a bespoke opener that says, in one sentence,
   * what today is about - and the four newest had none, so they fell through to
   * "You're clear for launch". Those four sit on missions 1, 2, 3, 5 and 12:
   * the very first flights, where a seven-year-old is least able to work a rule
   * out from the sky alone and most likely to decide the game is just confusing.
   */
  dronesStart: { speaker:"mate", cooldown:999, lines:[
    "I've lent you two of my drones, {you} - they shoot when you shoot.",
    "Borrowed drones on your wing, {you}. Free guns. Use them.",
  ]},
  bountyStart: { speaker:"control", cooldown:999, lines:[
    "One ship out there is worth FIVE times the rest, {you}. Look for the gold ring.",
    "Bounty flight: find the one with the gold ring round it and take it down.",
  ]},
  coverStart: { speaker:"control", cooldown:999, lines:[
    "Those rocks will eat their bullets, {you}. Hide behind them.",
    "Use the rocks as cover, {you} - nothing gets through them.",
  ]},
  nearMissStart: { speaker:"mate", cooldown:999, lines:[
    "Fly CLOSE to the divers today, {you} - a near miss pays.",
    "Points for nerve on this one, {you}. Let them get close, then slip past.",
  ]},

  /* --- Act 4 openers and beats --- */
  wellsStart: { speaker:"control", cooldown:999, lines:[
    "Gravity's broken out here, {you}. Your shots will CURVE - swing them.",
    "See the whirlpools? They pull in everything loose - including YOU.",
  ]},
  chorusStart: { speaker:"control", cooldown:999, lines:[
    "Listen, {you} - they fire on the beat. Move BETWEEN the drums.",
    "The whole fleet is one big song. Dance in the gaps, {you}.",
  ]},
  foundryStart: { speaker:"control", cooldown:999, lines:[
    "They're BUILDING ships on those belts, {you}. Pop the parts first!",
    "Every part you stop is a fight you never have. Starve the machine.",
  ]},
  foundryBuilt: { speaker:"control", cooldown:20, lines:[
    "One got through the assembler - heads up, it's coming down MEAN.",
    "That's what happens when a part gets home. Don't let the next one.",
  ]},
  serpentStart: { speaker:"control", cooldown:999, lines:[
    "Something's alive in this garden, {you}. Keep an eye on your coins.",
    "Old miners' story says a serpent lives here. It's not a story.",
  ]},
  serpentSeen: { speaker:"control", cooldown:999, lines:[
    "THERE - the Tithe Serpent! It eats coins. Your coins. Hit the glowing ring!",
  ]},
  serpentDown: { speaker:"control", cooldown:999, lines:[
    "It coughed up every penny! Beautiful flying, {you}.",
  ]},
  backstageStart: { speaker:"control", cooldown:999, lines:[
    "{you}... the charts stop here. This is behind the sky. Fly careful.",
    "Nothing out here is finished, {you}. I don't think we're meant to see this.",
  ]},
  backstageNo: { speaker:"control", cooldown:999, lines:[
    "That... wasn't me on the radio, {you}. Stay sharp.",
  ]},
  mirrorSeen: { speaker:"control", cooldown:999, lines:[
    "{you} - that ship. That's YOUR ship. It's flying your moves!",
  ]},
  mirrorBomb: { speaker:"control", cooldown:14, lines:[
    "It has your bombs too?! That's cheating. Probably.",
  ]},
  brushSeen: { speaker:"control", cooldown:999, lines:[
    "It's... a paintbrush, {you}. The one that draws the skies. RESPECTFULLY: shoot it.",
  ]},
  // Said once, the first time the brush draws a squadron: the last rule the
  // game teaches, and the one the whole act turns on.
  paintSketch: { speaker:"control", cooldown:999, lines:[
    "Those aren't real yet, {you} - they're still drawings! FLY THROUGH THEM. Your paint gets there first and they come out on OUR side.",
  ]},
  brushDown: { speaker:"control", cooldown:999, lines:[
    "You painted the sky, {you}. Every star out here is one of yours now.",
  ]},
  sky29Start: { speaker:"control", cooldown:999, lines:[
    "This is the one, {you}. Papa sketched it and never got to paint it. Every star you earned is a colour - fly, and use them all.",
  ]},
  sky29Half: { speaker:"mate", cooldown:999, lines:[
    "{you}, look at it. It's really happening - keep painting!",
  ]},
  sky29Photo: { speaker:"mate", cooldown:999, lines:[
    "Everyone in close. Wings level. SMILE, {you}!",
  ]},
  silentStart: { speaker:"control", cooldown:999, lines:[
    "Guns are dead, {you}. Don't fight - FLY.",
    "No cannons this run, {you}. Slip through quiet and don't get touched.",
    "The crew's working on the guns. Until then: dodge everything.",
  ]},
  devourerStart: { speaker:"control", cooldown:999, lines:[
    "That's it, {you}. That's the thing that ate their sun.",
    "Everything you've got, {you}. Right now.",
  ]},
  fleetArrives: { speaker:"mate", cooldown:999, lines:[
    "{you} - look behind you. EVERYONE came.",
    "You brought us all home. Our turn.",
    "You're not doing this one alone, {you}.",
  ]},
  headHome: { speaker:"control", cooldown:999, lines:[
    "Sky's clear, {you}. Come on home.",
    "That's all of them. Bring it back, {you}.",
    "Clean sweep. Set course for home.",
  ]},
  personalBest: { speaker:"mate", cooldown:999, lines:[
    "That's a new record, {you}!",
    "You just beat it. Nice flying.",
  ]},
  recordTaken: { speaker:"mate", cooldown:999, lines:[
    "You took my record, {you}. I want it back.",
    "Okay, that's mine no more. Well flown.",
  ]},
  flawless: { speaker:"control", cooldown:999, lines:[
    "Not a scratch on you, {you}.",
  ]},
  /*
   * Two moments that had a picture and a sound but no voice. Both are RULES,
   * so both are said once and then trusted - the long cooldown is what keeps a
   * rule from becoming nagging.
   */
  shieldRefill: { speaker:"control", cooldown:999, lines:[
    "Sky's clear - and your shield charged back up. It does that every wave, {you}.",
    "Wave down, shield full again. That's what you paid for, {you}.",
  ]},
  oneGotAway: { speaker:"mate", cooldown:999, lines:[
    "One slipped past us, {you} - no clean sweep this time.",
    "That one got by. Clean sweep's gone, but finish the job, {you}.",
  ]},
};

/** Fills {you} / {mate} / {n} in a line. */
function fill(line, vars){
  return line.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null) ? vars[k] : "");
}

SF.commsData = { COMMS, fill };
})();
