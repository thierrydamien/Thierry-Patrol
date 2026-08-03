/*
 * ProfileStore: everything that persists between runs.
 *
 * One record per pilot in localStorage. Old saves are migrated forward on
 * load - nobody ever loses money, gear or records when the game changes
 * shape, which matters when the players are family members mid-campaign.
 */
(function(){
"use strict";
const SF = window.SF;
const { UPGRADES, UPGRADE_BY_ID, MAX_UPGRADE_LEVELS, RANKS, SHIP_COLORS,
        DIFFICULTY_BY_ID, DIFFICULTIES, ACHIEVEMENTS } = SF.config;
const { MISSIONS } = SF.missions;

const INDEX_KEY = "skyforce_profiles";
const PREFIX = "skyforce_profile_";

function listNames(){
  let names = null;
  try { names = JSON.parse(localStorage.getItem(INDEX_KEY) || "null"); } catch(e){ names = null; }
  if(!names || !names.length){
    names = ["Marc", "Charles"];
    localStorage.setItem(INDEX_KEY, JSON.stringify(names));
  }
  return names;
}

function addName(name){
  const names = listNames();
  if(!names.includes(name)){
    names.push(name);
    localStorage.setItem(INDEX_KEY, JSON.stringify(names));
  }
}

function blank(name){
  return {
    name, callsign: name, shipColor: SHIP_COLORS[0], badge: null,
    money: 0, upgrades: {},
    // missions: { [missionId]: { cleared:true, stars:{ [difficultyId]: 0..3 }, best:{ [difficultyId]: score } } }
    missions: {},
    lastMission: 1, lastDifficulty: "pilot",
    highscore: 0,
    totalKills: 0, bossesDefeated: 0, maxCombo: 0, lifetimeMoney: 0,
    rescues: 0, missionsCompleted: 0, flawlessMissions: 0, powerupsCollected: 0,
    achievements: [],
  };
}

function load(name){
  const base = blank(name);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PREFIX + name) || "null"); } catch(e){ saved = null; }
  return migrate(saved ? Object.assign(base, saved) : base);
}

function save(p){
  localStorage.setItem(PREFIX + p.name, JSON.stringify(p));
}

/**
 * Brings older saves up to date:
 *  - the original one-off purchases (hasSpread/hasRapid/...) became levelled
 *    upgrades, granted at the level that reproduces what they used to do;
 *  - the endless-waves era stored bestLevelByDiff, which becomes credit for
 *    the equivalent early missions so returning players aren't reset to zero.
 */
function migrate(p){
  if(!p.upgrades || typeof p.upgrades !== "object") p.upgrades = {};
  if(!p.missions || typeof p.missions !== "object") p.missions = {};
  if(!Array.isArray(p.achievements)) p.achievements = [];

  if(p.hasSpread && !p.upgrades.spread) p.upgrades.spread = 2; // old Spread was 3-way
  if(p.hasRapid  && !p.upgrades.rapid)  p.upgrades.rapid  = 4; // old Rapid halved the gap
  if(p.hasShield && !p.upgrades.shield) p.upgrades.shield = 1;
  if(p.extraLives > 0 && !p.upgrades.life) p.upgrades.life = Math.min(p.extraLives, UPGRADE_BY_ID.life.max);
  delete p.hasSpread; delete p.hasRapid; delete p.hasShield; delete p.extraLives;

  // Endless-mode records: one mission cleared per two levels reached, capped
  // so nobody is handed the whole campaign, and never downgrading progress.
  if(p.bestLevelByDiff){
    const reached = Math.max.apply(null, [0].concat(Object.values(p.bestLevelByDiff).map(Number)));
    const credit = Math.min(MISSIONS.length - 1, Math.floor(reached / 2));
    for(let i = 0; i < credit; i++){
      const id = MISSIONS[i].id;
      if(!p.missions[id]) p.missions[id] = { cleared: true, stars: { pilot: 1 }, best: {} };
    }
    delete p.bestLevelByDiff;
    delete p.bestScoreByDiff;
  }
  if(p.maxLevel != null) delete p.maxLevel;

  UPGRADES.forEach(u => { // clamp anything out of range (e.g. a hand-edited save)
    const lvl = p.upgrades[u.id];
    if(typeof lvl !== "number" || lvl < 0) delete p.upgrades[u.id];
    else if(lvl > u.max) p.upgrades[u.id] = u.max;
  });
  ["totalKills","bossesDefeated","maxCombo","lifetimeMoney","rescues",
   "missionsCompleted","flawlessMissions","powerupsCollected","money","highscore"].forEach(k => {
    if(typeof p[k] !== "number" || Number.isNaN(p[k])) p[k] = 0;
  });
  return p;
}

/* ---------------------------------------------------------
   DERIVED VALUES
   --------------------------------------------------------- */
function upgradeLevel(p, id){ return (p.upgrades && p.upgrades[id]) || 0; }
function gearLevel(p){ return UPGRADES.reduce((n,u) => n + upgradeLevel(p,u.id), 0); }
function nextCost(p, u){ const lvl = upgradeLevel(p,u.id); return lvl >= u.max ? null : u.costs[lvl]; }

function rankFor(p){
  const gear = gearLevel(p);
  let rank = RANKS[0];
  RANKS.forEach(r => { if(gear >= r.at) rank = r; });
  return rank;
}
function nextRank(p){
  const gear = gearLevel(p);
  return RANKS.find(r => gear < r.at) || null;
}

/** The pilot's chosen badge, falling back to whatever their rank awards. */
function badgeFor(p){ return p.badge || rankFor(p).badge; }

/** Stars are the campaign currency of pride: best stars per mission, summed. */
function starsForMission(p, missionId){
  const rec = p.missions[missionId];
  if(!rec || !rec.stars) return 0;
  return Math.max.apply(null, [0].concat(Object.values(rec.stars).map(Number)));
}
function totalStars(p){
  return MISSIONS.reduce((n,m) => n + starsForMission(p, m.id), 0);
}
/** Index of the hardest difficulty this pilot has ever completed a mission on. */
function hardestCleared(p){
  let best = -1;
  MISSIONS.forEach(m => {
    const rec = p.missions[m.id];
    if(!rec || !rec.stars) return;
    DIFFICULTIES.forEach((d, i) => { if(rec.stars[d.id] > 0 && i > best) best = i; });
  });
  return best;
}
function difficultyUnlocked(p, difficulty){
  return totalStars(p) >= difficulty.unlockStars;
}
function campaignComplete(p){
  return MISSIONS.every(m => p.missions[m.id] && p.missions[m.id].cleared);
}

/* ---------------------------------------------------------
   THE FAMILY
   Two people share this game, so the other pilots aren't just
   rows on a leaderboard - they fly with you, and they hold
   records you can take off them.
   --------------------------------------------------------- */

/** Every other pilot's profile, most-decorated first. */
function squadmates(name){
  return listNames()
    .filter(n => n !== name)
    .map(load)
    .sort((a,b) => totalStars(b) - totalStars(a));
}

/** Who in the household holds this mission, and with what. Null if nobody has flown it. */
function familyBest(missionId){
  let best = null;
  listNames().map(load).forEach(p => {
    const rec = p.missions[missionId];
    if(!rec || !rec.best) return;
    const score = Math.max.apply(null, [0].concat(Object.values(rec.best).map(Number)));
    if(score > 0 && (!best || score > best.score)){
      best = { name: p.callsign || p.name, score, stars: starsForMission(p, missionId) };
    }
  });
  return best;
}

/** Snapshot the achievement checks read - keeps their conditions declarative. */
function achievementStats(p){
  return {
    totalKills: p.totalKills, maxCombo: p.maxCombo, lifetimeMoney: p.lifetimeMoney,
    bossesDefeated: p.bossesDefeated, rescues: p.rescues,
    missionsCompleted: p.missionsCompleted, flawlessMissions: p.flawlessMissions,
    gearLevel: gearLevel(p), totalStars: totalStars(p),
    bestStarsOnAnyMission: MISSIONS.reduce((n,m) => Math.max(n, starsForMission(p,m.id)), 0),
    hardestCleared: hardestCleared(p),
    anyUpgradeMaxed: UPGRADES.some(u => upgradeLevel(p,u.id) >= u.max),
    allUpgradesMaxed: UPGRADES.every(u => upgradeLevel(p,u.id) >= u.max),
    campaignComplete: campaignComplete(p),
  };
}

/** Unlocks anything newly earned and returns the list, for the toast queue. */
function checkAchievements(p){
  const stats = achievementStats(p);
  const unlocked = [];
  ACHIEVEMENTS.forEach(a => {
    if(!p.achievements.includes(a.id) && a.check(stats)){
      p.achievements.push(a.id);
      unlocked.push(a);
    }
  });
  if(unlocked.length) save(p);
  return unlocked;
}

/** Records a finished mission attempt. Returns true if this was a new best. */
function recordMission(p, missionId, difficultyId, stars, score, cleared){
  const rec = p.missions[missionId] || (p.missions[missionId] = { cleared:false, stars:{}, best:{} });
  let improved = false;
  if(cleared && !rec.cleared){ rec.cleared = true; improved = true; }
  if(stars > (rec.stars[difficultyId] || 0)){ rec.stars[difficultyId] = stars; improved = true; }
  if(score > (rec.best[difficultyId] || 0)){ rec.best[difficultyId] = score; improved = true; }
  if(score > p.highscore) p.highscore = score;
  save(p);
  return improved;
}

SF.profile = {
  listNames, addName, load, save, blank, migrate,
  upgradeLevel, gearLevel, nextCost, rankFor, nextRank, badgeFor,
  starsForMission, totalStars, hardestCleared, difficultyUnlocked, campaignComplete,
  squadmates, familyBest,
  checkAchievements, recordMission, achievementStats,
};
})();
