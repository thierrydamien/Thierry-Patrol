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

const INDEX_KEY = "patrol_profiles";
const PREFIX = "patrol_profile_";

/*
 * The game has been renamed twice - SkyForce, then Novawing - and saves are
 * keyed by pilot name under a prefix. Renaming the keys without this would
 * strand every pilot's money, gear and records under a prefix nothing reads
 * any more. So: on first load under a new name, copy the newest surviving set
 * of old records across. The originals are left alone, so opening an older
 * build still finds its save intact.
 *
 * The prefix is deliberately generic now, so a third rename costs nothing.
 */
const LEGACY = [
  { index: "novawing_profiles", prefix: "novawing_profile_" },
  { index: "skyforce_profiles", prefix: "skyforce_profile_" },
];

function adoptOldSaves(){
  try {
    if(localStorage.getItem(INDEX_KEY)) return;          // already on the new keys
    for(const era of LEGACY){
      const old = localStorage.getItem(era.index);
      if(!old) continue;
      const names = JSON.parse(old);
      if(!Array.isArray(names) || !names.length) continue;
      names.forEach(n => {
        const rec = localStorage.getItem(era.prefix + n);
        if(rec != null && localStorage.getItem(PREFIX + n) == null){
          localStorage.setItem(PREFIX + n, rec);
        }
      });
      localStorage.setItem(INDEX_KEY, old);
      return;                                            // newest era wins
    }
  } catch(e){ /* a corrupt or unavailable store just means a fresh start */ }
}
adoptOldSaves();

/*
 * EVERY WRITE TO THE STORE GOES THROUGH HERE.
 *
 * Every read in this file was already wrapped; the writes were not, and the
 * writes are the dangerous half. `save()` is called from inside endMission,
 * before the results screen is built - so on a full store, in Safari private
 * browsing, or with site data blocked, the throw took the rest of endMission
 * with it: no payout, no results card, an apparently frozen game. On a shared
 * family iPad with three pilots, saved workshop skies and a stack of cloud
 * backups, a full store is not a hypothetical.
 *
 * On a quota error we shed what is sheddable - the cloud backup list first,
 * then the oldest saved skies - and try once more. Whatever happens, a failed
 * save reports false and never throws into the caller.
 */
function writeKey(key, value){
  try {
    localStorage.setItem(key, value);
    return true;
  } catch(e){
    try {
      localStorage.removeItem("patrol_backups");   // cloud.js's BACKUP_KEY
      localStorage.setItem(key, value);
      return true;
    } catch(e2){
      try {
        listNames().forEach(n => {
          const raw = JSON.parse(localStorage.getItem(PREFIX + n) || "null");
          if(raw && raw.workshopSkies && raw.workshopSkies.length > 2){
            raw.workshopSkies.length = 2;
            localStorage.setItem(PREFIX + n, JSON.stringify(raw));
          }
        });
        localStorage.setItem(key, value);
        return true;
      } catch(e3){ return false; }
    }
  }
}

function listNames(){
  let names = null;
  try { names = JSON.parse(localStorage.getItem(INDEX_KEY) || "null"); } catch(e){ names = null; }
  if(!names || !names.length){
    names = ["Marc", "Charles"];
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(names)); } catch(e){}
  }
  return names;
}

function addName(name){
  const names = listNames();
  if(!names.includes(name)){
    names.push(name);
    writeKey(INDEX_KEY, JSON.stringify(names));
  }
}

function blank(name){
  return {
    name, callsign: name, shipColor: SHIP_COLORS[0], badge: null,
    money: 0, upgrades: {},
    tune: "vanguard",   // flight tuning (MY SHIP) - stats trade, never art
    // The Paint Shop: owned cosmetics, and the trail currently burning.
    // (Applied paint just becomes shipColor - one pipeline colours it all.)
    cosmetics: { paints: [], trails: [], decals: [], fireworks: [] },
    trail: null,
    decal: null,
    fireworks: "classic",
    vaultDone: false,   // true once SOLAR GOLD is won - the mission itself replays freely
    sky29Done: false,   // true once Sky 29 is painted - its paint pays out once
    // missions: { [missionId]: { cleared:true, stars:{ [difficultyId]: 0..3 }, best:{ [difficultyId]: score } } }
    missions: {},
    lastMission: 1, lastDifficulty: "pilot",
    highscore: 0,
    totalKills: 0, bossesDefeated: 0, maxCombo: 0, lifetimeMoney: 0,
    rescues: 0, missionsCompleted: 0, flawlessMissions: 0, powerupsCollected: 0,
    achievements: [],
    // Medal cash rewards collected (see the Medals screen). Absent = owed.
    medalsClaimed: {},
    // Story beats already seen, so a chapter close only lands once.
    stories: {},
  };
}

function load(name){
  const base = blank(name);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PREFIX + name) || "null"); } catch(e){ saved = null; }
  return migrate(saved ? Object.assign(base, saved) : base);
}

/**
 * Every save is stamped, because that timestamp is the whole conflict
 * resolution story for cloud sync: when the same pilot exists on two devices,
 * the newer record wins. Without it a stale tab could overwrite a real run.
 */
function save(p){
  p.savedAt = Date.now();
  saveRaw(p);
  if(SF.cloud) SF.cloud.touch();
  return p;
}

/** Writes a record exactly as given - used when applying a record from sync. */
function saveRaw(p){
  const ok = writeKey(PREFIX + p.name, JSON.stringify(p));
  addName(p.name);
  return ok;
}

/** Every pilot on this device, as a plain { name: record } map. */
function snapshot(){
  const out = {};
  listNames().forEach(n => {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PREFIX + n) || "null"); } catch(e){ raw = null; }
    if(raw) out[n] = raw;
  });
  return out;
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
  if(!p.tune || !SF.config.TUNE_BY_ID[p.tune]) p.tune = "vanguard";
  // NOTE: the earned-tune check (a tune whose boss hasn't been beaten falls
  // back to vanguard) lives BELOW the mission-id shifts - it reads mission
  // records, so it must see them at their final ids.

  /*
   * v2: Silent Running was inserted as mission 9, pushing the old 9-14 up to
   * 10-15. Records are keyed by mission id, so without this shift every act
   * two record would point one mission early. Descending order so nothing
   * overwrites; the flag makes it run exactly once per save, everywhere -
   * cloud sync just carries the migrated record like any other.
   */
  // NOTE: the flag must never appear in blank() - load() assigns the saved
  // record over a blank, so a preset flag would mark every old save as
  // already-migrated and the shift would never run.
  if((p.missionsVer || 1) < 2){
    for(let id = 14; id >= 9; id--){
      if(p.missions[id]){ p.missions[id + 1] = p.missions[id]; delete p.missions[id]; }
    }
    if(typeof p.lastMission === "number" && p.lastMission >= 9) p.lastMission += 1;
    p.missionsVer = 2;
  }
  /*
   * v3: Their Treasury was inserted as mission 13 (the customer's rule:
   * never two boss missions in a row - the Warden at 12 and the Phantom sat
   * adjacent), pushing the old 13-15 up to 14-16. Same shape as v2:
   * descending so nothing overwrites, one-shot, synced like any record.
   */
  if((p.missionsVer || 1) < 3){
    for(let id = 15; id >= 13; id--){
      if(p.missions[id]){ p.missions[id + 1] = p.missions[id]; delete p.missions[id]; }
    }
    if(typeof p.lastMission === "number" && p.lastMission >= 13) p.lastMission += 1;
    p.missionsVer = 3;
  }
  /*
   * v4: four new levels landed at once - The Storm (6), The Convoy (9), The
   * Trench Run (17) and The Searchlight (20) - so this shift is a map, not a
   * single offset. Highest old id first, and every new id is above its old
   * one, so nothing is ever overwritten before it moves.
   */
  if((p.missionsVer || 1) < 4){
    const SHIFT = [[18,22],[17,21],[16,19],[15,18],[14,16],[13,15],[12,14],
                   [11,13],[10,12],[9,11],[8,10],[7,8],[6,7]];
    SHIFT.forEach(([oldId, newId]) => {
      if(p.missions[oldId]){ p.missions[newId] = p.missions[oldId]; delete p.missions[oldId]; }
    });
    if(typeof p.lastMission === "number"){
      const hit = SHIFT.find(([oldId]) => oldId === p.lastMission);
      if(hit) p.lastMission = hit[1];
    }
    p.missionsVer = 4;
  }
  /*
   * v5: The Rival landed as mission 13, pushing the old 13-22 up one. A
   * single offset again, but expressed as the same map as v4 so the two read
   * alike - and descending, so nothing is overwritten before it moves.
   */
  if((p.missionsVer || 1) < 5){
    for(let id = 22; id >= 13; id--){
      if(p.missions[id]){ p.missions[id + 1] = p.missions[id]; delete p.missions[id]; }
    }
    if(typeof p.lastMission === "number" && p.lastMission >= 13) p.lastMission += 1;
    p.missionsVer = 5;
  }
  // Tunes are boss trophies now: a fitted tune whose boss this pilot hasn't
  // actually beaten (old save, or a copied one) reverts to the baseline.
  {
    const td = SF.config.TUNE_BY_ID[p.tune];
    if(td && td.unlockMission && !((p.missions[td.unlockMission] || {}).cleared))
      p.tune = "vanguard";
  }
  if(!Array.isArray(p.achievements)) p.achievements = [];
  /*
   * Only medals that still EXIST count. An early build shipped a medal that
   * was later cut, and a save that had earned it read "28 of 27" forever -
   * a scoreboard that can exceed its own maximum teaches a kid the numbers
   * are lies. Deduped for the same reason.
   */
  p.achievements = [...new Set(p.achievements)]
    .filter(id => ACHIEVEMENTS.some(a => a.id === id));
  // Old saves predate the Paint Shop; give them the empty garage.
  if(!p.cosmetics || typeof p.cosmetics !== "object") p.cosmetics = {};
  if(!Array.isArray(p.cosmetics.paints)) p.cosmetics.paints = [];
  if(!Array.isArray(p.cosmetics.trails)) p.cosmetics.trails = [];
  if(!Array.isArray(p.cosmetics.decals)) p.cosmetics.decals = [];
  if(!Array.isArray(p.cosmetics.fireworks)) p.cosmetics.fireworks = [];
  if(!p.fireworks) p.fireworks = "classic";
  if(!p.medalsClaimed || typeof p.medalsClaimed !== "object") p.medalsClaimed = {};

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
   "missionsCompleted","flawlessMissions","powerupsCollected","money","highscore",
   "endlessBest","endlessLongest","bossRushBest"].forEach(k => {
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

/**
 * The pilot's chosen insignia, falling back to whatever their rank awards.
 * Old saves stored an emoji here; anything that isn't a known design is
 * treated as unset so those profiles quietly pick up their rank patch.
 */
function badgeFor(p){
  const known = SF.insignia && SF.insignia.DESIGNS.indexOf(p.badge) >= 0;
  return known ? p.badge : rankFor(p).badge;
}

/** Stars are the campaign currency of pride: best stars per mission, summed. */
function starsForMission(p, missionId){
  const rec = p.missions[missionId];
  if(!rec || !rec.stars) return 0;
  return Math.max.apply(null, [0].concat(Object.values(rec.stars).map(Number)));
}
/*
 * Gift missions (Sky 29) stay OUT of the star ledger: the whole campaign is
 * "84 stars", the gift is what 84 unlocks, and letting it mint three more
 * would turn "every star" into a number that changes the moment you reach it.
 */
function totalStars(p){
  return MISSIONS.reduce((n,m) => n + (m.gift ? 0 : starsForMission(p, m.id)), 0);
}
/** The bar the gift stop asks for: three per real mission. */
function maxStars(){
  return MISSIONS.filter(m => !m.gift).length * 3;
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
  // The gift stop is a bonus ON completion, not part of it: the workshop
  // curtain must fall when Behind the Sky does, whether or not Sky 29 is done.
  return MISSIONS.every(m => m.gift || (p.missions[m.id] && p.missions[m.id].cleared));
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
      best = { name: p.callsign || p.name, score, stars: starsForMission(p, missionId),
               color: p.shipColor, owner: p.name };
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
    endlessBest: p.endlessBest || 0,
    endlessLongest: p.endlessLongest || 0,
    bossRushBest: p.bossRushBest || 0,
    // 23, not 18: act 3 renumbered the Devourer and this check never moved -
    // the medal was quietly awarded for clearing the Trench Run instead.
    devourerDown: !!(p.missions[23] && p.missions[23].cleared),
  };
}

/** Earned medals whose cash reward hasn't been collected yet. */
function unclaimedMedals(p){
  return ACHIEVEMENTS.filter(a => p.achievements.includes(a.id) && !p.medalsClaimed[a.id]);
}

/** Collects one medal's reward. Returns the payout, or 0 if not collectable. */
function claimMedal(p, id){
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if(!a || !p.achievements.includes(id) || p.medalsClaimed[id]) return 0;
  p.medalsClaimed[id] = true;
  p.money += a.pay || 0;
  p.lifetimeMoney += a.pay || 0;
  save(p);
  return a.pay || 0;
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
function recordMission(p, missionId, difficultyId, stars, score, cleared, metIds){
  const rec = p.missions[missionId] || (p.missions[missionId] = { cleared:false, stars:{}, best:{} });
  let improved = false;
  if(cleared && !rec.cleared){ rec.cleared = true; improved = true; }
  if(stars > (rec.stars[difficultyId] || 0)){
    rec.stars[difficultyId] = stars;
    improved = true;
  }
  /*
   * WHICH objectives were met, not just how many. The map's star-hunt mode
   * needs to name the one you are missing ("missing: rescue every pilot"),
   * and a count can't do that. Kept per difficulty and only replaced when
   * that tier does better, so it always agrees with rec.stars beside it.
   * Old saves simply have no `met` and fall back to the count.
   */
  if(metIds && stars >= (rec.stars[difficultyId] || 0)){
    rec.met = rec.met || {};
    rec.met[difficultyId] = metIds.slice();
  }
  /*
   * A SCORE IS ONLY A RECORD IF YOU FINISHED THE MISSION.
   *
   * endMission calls in here on failed campaign runs too (it has to - the fail
   * streak and the ledger both need to know), and score accrues all through a
   * run regardless of how it ends. So dying on the last wave with a big number
   * used to book a personal best, a family best and the highscore. The record
   * chips are what Marc and Charles actually compete over; "best" has to mean
   * a run somebody won, or losing on purpose is a strategy.
   */
  if(cleared){
    if(score > (rec.best[difficultyId] || 0)){ rec.best[difficultyId] = score; improved = true; }
    if(score > p.highscore) p.highscore = score;
  }
  save(p);
  return improved;
}

/**
 * The objectives this pilot has NOT yet ticked on a mission, as objective ids.
 * Reads the best-scoring tier's record so it agrees with starsForMission.
 * Returns null when the save predates per-objective tracking - the caller
 * then shows a count instead of naming names.
 */
function missingObjectives(p, mission){
  const rec = p.missions && p.missions[mission.id];
  const all = mission.objectives || [];
  if(!rec || !rec.stars) return all.slice();
  let bestDiff = null, bestN = -1;
  Object.keys(rec.stars).forEach(d => {
    const n = Number(rec.stars[d]) || 0;
    if(n > bestN){ bestN = n; bestDiff = d; }
  });
  if(bestN >= all.length) return [];
  const met = rec.met && bestDiff && rec.met[bestDiff];
  if(!met) return null;                       // known incomplete, unknown which
  return all.filter(id => met.indexOf(id) === -1);
}

SF.profile = {
  listNames, addName, load, save, saveRaw, snapshot, blank, migrate, adoptOldSaves,
  upgradeLevel, gearLevel, nextCost, rankFor, nextRank, badgeFor,
  starsForMission, totalStars, maxStars, missingObjectives, hardestCleared, difficultyUnlocked, campaignComplete,
  squadmates, familyBest,
  checkAchievements, recordMission, achievementStats, unclaimedMedals, claimMedal,
};
})();
