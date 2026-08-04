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
  lowLives: { speaker:"control", cooldown:25, lines:[
    "Last ship, {you}. Make it count.",
    "You're down to your last one - fly smart.",
    "One left. Take your time out there.",
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
  thiefEscaped: { speaker:"mate", cooldown:8, lines:[
    "It got away with ${n}! Get the next one.",
    "There goes ${n}. Faster next time, {you}.",
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
    "That rock won't budge for a couple of shots, {you}.",
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
  bossIncoming: { speaker:"control", cooldown:999, lines:[
    "Something big on the scope, {you}.",
    "Heads up - that's their flagship.",
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
};

/** Fills {you} / {mate} / {n} in a line. */
function fill(line, vars){
  return line.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null) ? vars[k] : "");
}

SF.commsData = { COMMS, fill };
})();
