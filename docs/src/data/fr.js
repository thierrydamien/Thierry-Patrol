/*
 * FRANÇAIS.
 *
 * One flat map, English on the left. The three mechanisms in i18n.js - the
 * t() helper, the DOM sweep and the data-table rewrite - all read this same
 * object, so a string translated once is translated everywhere it appears.
 *
 * House style, kept deliberately consistent:
 *  - The game speaks TO the pilot, in the "tu" form. These are two boys and
 *    their dad; "vous" would put a uniform on a family game.
 *  - Terminology is fixed: mission, étoile, pièce, vaisseau, Arsenal,
 *    Surrégime, Bouclier, Crampon. Never a synonym for variety's sake - a
 *    seven-year-old is learning these words as game vocabulary.
 *  - French typographic spacing (espace insécable before ! ? : and inside
 *    guillemets) is used where the text is prose. UI chrome that has to fit
 *    a chip or a pill is kept short first and pretty second.
 *  - Where English is punchier than French can be at the same length, the
 *    line is rewritten rather than padded. "LAUNCH" is DÉCOLLAGE, not
 *    "LANCER LA MISSION".
 */
(function(){
"use strict";
const SF = window.SF;
if(!SF.i18n) return;

SF.i18n.register("fr", { name: "Français", s: {

/* ---------------- shell, menus, buttons ---------------- */
"A FAMILY SQUADRON": "UN ESCADRON DE FAMILLE",
"Who's flying today?": "Qui vole aujourd'hui ?",
"+ Add Pilot": "+ Ajouter un pilote",
"Settings": "Réglages",
"SETTINGS": "RÉGLAGES",
"FLY A MISSION": "EN MISSION",
"WACKY SKY": "CIEL FARFELU",
"BOSS RUSH": "MARATHON DE BOSS",
"DRAWING BOARD": "ATELIER DE DESSIN",
"ARMORY": "ARSENAL",
"MEDALS": "MÉDAILLES",
"CHAMPIONSHIP": "CHAMPIONNAT",
"Switch Pilot": "Changer de pilote",
"Fullscreen": "Plein écran",
"MENU": "MENU",
"THE CAMPAIGN": "LA CAMPAGNE",
"★ FIND MY STARS": "★ TROUVER MES ÉTOILES",
"Back to Menu": "Retour au menu",
"Back to Missions": "Retour aux missions",
"MISSION": "MISSION",
"BOSS": "BOSS",
"STAR OBJECTIVES": "OBJECTIFS ÉTOILES",
"WHAT'S OUT THERE": "CE QUI T'ATTEND",
"CHOOSE DIFFICULTY": "DIFFICULTÉ",
"PRE-FLIGHT KIT": "ÉQUIPEMENT",
"LAUNCH": "DÉCOLLAGE",
"PAUSED": "PAUSE",
"RESUME": "REPRENDRE",
"Restart Mission": "Recommencer la mission",
"Quit to Menu": "Quitter",
"MISSION COMPLETE": "MISSION RÉUSSIE",
"NEXT MISSION": "MISSION SUIVANTE",
"TRY ON ROOKIE": "ESSAYER EN RECRUE",
"RETRY": "RÉESSAYER",
"LOADING": "CHARGEMENT",
"CONTINUE": "CONTINUER",
"Close": "Fermer",
"Cancel": "Annuler",
"OK": "OK",
"TURN YOUR PHONE": "TOURNE TON TÉLÉPHONE",
"Patrol flies the tall way up": "Patrol se joue à la verticale",
"MEDAL UNLOCKED": "MÉDAILLE DÉBLOQUÉE",
"Made with ❤ for Marc & Charles": "Fait avec ❤ pour Marc et Charles",

/* ---------------- settings ---------------- */
"All sound": "Tous les sons",
"Music": "Musique",
"Sound effects": "Effets sonores",
"Screen shake": "Secousses de l'écran",
"Calmer visuals": "Visuels apaisés",
"Glow": "Halo lumineux",
"Rumble": "Vibrations",
"Language": "Langue",
"ON": "OUI",
"OFF": "NON",
"Off": "Désactivée",
"Squad Sync": "Synchro Escadron",
"SQUAD SYNC": "SYNCHRO ESCADRON",
"Reset this pilot": "Réinitialiser ce pilote",
"SYNC NOW": "SYNCHRONISER",
"Copy code": "Copier le code",
"Restore backup": "Restaurer une sauvegarde",
"Join another squad": "Rejoindre un autre escadron",
"Rumble needs an Android phone or tablet. iPhones and iPads don't let a web app buzz — that's Apple's rule, not the game's.":
  "Les vibrations demandent un téléphone ou une tablette Android. Les iPhone et les iPad n'autorisent pas une appli web à vibrer — c'est la règle d'Apple, pas celle du jeu.",
"Glow is on, but this device couldn't draw it and keep a smooth 60 frames a second, so the game switched it off to stay fast. Turn Glow off and on again to try once more.":
  "Le halo est activé, mais cet appareil n'arrivait pas à l'afficher tout en gardant 60 images par seconde : le jeu l'a donc coupé pour rester fluide. Désactive puis réactive le halo pour réessayer.",

/* ---------------- armory, paint, championship, easel ---------------- */
"MIX YOUR OWN": "MÉLANGE MAISON",
"COLOUR": "COULEUR",
"NAME IT": "DONNE-LUI UN NOM",
"STOCK": "D'ORIGINE",
"YOURS": "LE TIEN",
"COMPARE": "COMPARER",
"TEST RANGE": "BANC D'ESSAI",
"CALLSIGN": "INDICATIF",
"SAVE": "ENREGISTRER",
"YOUR BADGE": "TON INSIGNE",
"PAINT YOUR SHIP": "PEINS TON VAISSEAU",
"UNDO": "ANNULER",
"WIPE IT": "TOUT EFFACER",
"CANCEL": "QUITTER",
"PUT IT ON MY SHIP": "SUR MON VAISSEAU !",
"THE CHAMPIONSHIP": "LE CHAMPIONNAT",
"most ★ across all missions wins": "le plus d'★ toutes missions confondues l'emporte",
"WHO HOLDS WHAT": "QUI DÉTIENT QUOI",
"draw a sky — the family flies it": "dessine un ciel — la famille le survole",
"MY SKY": "MON CIEL",
"RENAME": "RENOMMER",
"YOUR SKY, BOTTOM TO TOP": "TON CIEL, DE BAS EN HAUT",
"THE SKY": "LE CIEL",
"HOUSE RULE": "RÈGLE MAISON",
"THE SILLY BITS": "LES TRUCS RIGOLOS",
"THE WAVES": "LES VAGUES",
"THE BOSS": "LE BOSS",
"▶ TEST FLY IT": "▶ L'ESSAYER",
"PIN IT TO THE FAMILY BOARD": "L'AFFICHER SUR LE TABLEAU DE FAMILLE",
"THE FAMILY'S SKIES": "LES CIELS DE LA FAMILLE",

/* ---------------- ranks ----------------
   Short on purpose: these sit under a name on a pilot card and in the menu
   header, where the English they replace is 12-14 characters. */
"ROOKIE CADET": "RECRUE",
"WING CADET": "CADET",
"SQUADRON PILOT": "PILOTE",
"FLIGHT LEADER": "CHEF DE VOL",
"STAR ACE": "AS DES ÉTOILES",
"WING COMMANDER": "COMMANDANT",
"SPACE LEGEND": "LÉGENDE SPATIALE",
"THIERRY LEGEND": "LÉGENDE THIERRY",

/* ---------------- difficulty ---------------- */
"ROOKIE": "RECRUE",
"PILOT": "PILOTE",
"ACE": "AS",
"VETERAN": "VÉTÉRAN",
"NIGHTMARE": "CAUCHEMAR",
"Easy": "Facile",
"Normal": "Normal",
"Hard": "Difficile",
"Brutal": "Brutal",
"Insane": "Dément",
"Slow enemies, hardly any shooting, and a free extra life.":
  "Des ennemis lents, presque aucun tir, et une vie offerte.",
"The normal mission. Fair fight, normal pay.":
  "La mission normale. Combat équitable, paie normale.",
"Tougher enemies that aim right at you. Pays 1.8x.":
  "Des ennemis plus coriaces qui te visent droit dessus. Paie x1,8.",
"Thick armour, clever attackers, bullets everywhere. Pays 2.8x.":
  "Blindage épais, assaillants malins, des tirs partout. Paie x2,8.",
"All of it at once. Bring your very best gear. Pays 4.5x.":
  "Tout ça d'un coup. Amène ton meilleur équipement. Paie x4,5.",

/* ---------------- shop categories, hulls, paints ---------------- */
"GUNS": "ARMES",
"STAYING ALIVE": "SURVIE",
"SHIP": "VAISSEAU",
"SPECIALS": "SPÉCIAUX",
"THE DART": "LA FLÈCHE",
"THE ANVIL": "L'ENCLUME",
"The ship the family has always flown. Slim, quick, and a small thing to hit.":
  "Le vaisseau que la famille a toujours piloté. Fin, rapide, et tout petit à toucher.",
"Twice the shoulders and a plate for a nose. Slower, and a much easier thing to hit - but it takes a beating and gets straight back up.":
  "Deux fois plus large, avec une plaque en guise de nez. Plus lent et bien plus facile à toucher — mais il encaisse et repart aussitôt.",
"HOT PINK": "ROSE VIF",
"ICE WHITE": "BLANC GIVRE",
"LASER LIME": "VERT LASER",
"DEEP AQUA": "BLEU LAGON",
"TANGERINE": "MANDARINE",
"ULTRAVIOLET": "ULTRAVIOLET",
"MIDNIGHT": "MINUIT",
"MINT": "MENTHE",
"SOLAR GOLD": "OR SOLAIRE",
"EMBER TRAIL": "TRAÎNÉE DE BRAISE",
"ION STREAM": "FLUX D'IONS",
"STARDUST": "POUSSIÈRE D'ÉTOILES",
"RAINBOW BURN": "ARC-EN-CIEL",
"RACING STRIPES": "BANDES DE COURSE",
"FLAME JOB": "FLAMMES",
"LIGHTNING": "ÉCLAIRS",
"CHEQUERED": "DAMIER",
"CLASSIC": "CLASSIQUE",
"GOLD RAIN": "PLUIE D'OR",
"EMERALD SKY": "CIEL ÉMERAUDE",
"RAINBOW SALUTE": "SALUT ARC-EN-CIEL",

/* ---------------- enemies ---------------- */
"Grunt": "Sbire",
"Weaver": "Slalomeur",
"Striker": "Frappeur",
"Swooper": "Piqueur",
"Kamikaze": "Kamikaze",
"Gun Platform": "Tourelle",
"Brute": "Brute",
"Prison Hauler": "Fourgon",
"Guardian": "Gardien",
"Splitter": "Diviseur",
"Shard": "Éclat",
"Coin Thief": "Pickpocket",
"Asteroid": "Astéroïde",
"Marksman": "Tireur d'élite",
"Interceptor": "Intercepteur",
"Minelayer": "Poseur de mines",
"Mine": "Mine",
"Hive": "Ruche",
"Mender": "Réparateur",
"Boulder": "Rocher",
"Tithe Serpent": "Serpent à Dîme",
"Serpent Ring": "Anneau du Serpent",
"Ship Part": "Pièce de vaisseau",
"Limpet": "Crampon",
"Sky Ox": "Bœuf du Ciel",

/* ---------------- star objectives ---------------- */
"Complete the mission": "Terminer la mission",
"Destroy 80% of enemies": "Détruire 80 % des ennemis",
"Destroy every enemy": "Détruire tous les ennemis",
"Rescue every stranded pilot": "Sauver tous les pilotes en perdition",
"Take no damage at all": "Ne subir aucun dégât",
"Grab 60 coins": "Ramasser 60 pièces",
"Bag 10 WANTED ships": "Abattre 10 vaisseaux RECHERCHÉS",
"Cut 20 near misses": "Frôler 20 ennemis",
"Destroy 15 unseen": "Détruire 15 ennemis sans être vu",
"Destroy 10 in the squeeze": "Détruire 10 ennemis dans le goulet",
"Destroy 20 after dark": "Détruire 20 ennemis dans le noir",
"Cut 6 ropes": "Couper 6 câbles",
"Destroy 8 elites": "Détruire 8 élites",
"Shoot off every weak point": "Détruire tous les points faibles",
"Don't lose a single life": "Ne perdre aucune vie",
"Bring the hauler home": "Ramener le cargo à bon port",
"Deliver all 4 crates": "Livrer les 4 caisses",
"Go round the back 6 times": "Faire 6 fois le tour",
"Shake off 10 limpets": "Décrocher 10 crampons",
"Never get caught by the flare": "Ne jamais se faire brûler par l'éruption",
"Flatten 15 ships with the herd": "Écraser 15 vaisseaux avec le troupeau",
"Let your reflection get 100 kills": "Laisser ton reflet faire 100 victimes",
"Stop 10 parts on the belts": "Bloquer 10 pièces sur les tapis",
"Slay the Tithe Serpent": "Terrasser le Serpent à Dîme",
"Paint 6 sketches to your side": "Rallier 6 croquis à ta cause",

/* ---------------- sectors ---------------- */
"HOME PATROL": "PATROUILLE LOCALE",
"THE BELT": "LA CEINTURE",
"THE STORM": "LA TEMPÊTE",
"THE SUPPLY ROAD": "LA ROUTE DU RAVITAILLEMENT",
"ENEMY SPACE": "TERRITOIRE ENNEMI",
"WARDEN'S REACH": "LE DOMAINE DU GEÔLIER",
"THE TRENCHES": "LES TRANCHÉES",
"THEIR STAR": "LEUR ÉTOILE",
"THE DARK": "LES TÉNÈBRES",
"THE CRACK": "LA FAILLE",
"THE WORKSHOP": "L'ATELIER",
"THE EASEL": "LE CHEVALET",

/* ---------------- mission names ---------------- */
"First Patrol": "Première Patrouille",
"Weaving Through": "Slalom",
"The Anchor": "L'Ancre",
"Return Fire": "Riposte",
"Heavy Metal": "Grosse Ferraille",
"Kamikaze Run": "Vol Kamikaze",
"The Storm": "La Tempête",
"Prison Break": "Évasion",
"The Gauntlet": "Le Gant de Fer",
"The Convoy": "Le Convoi",
"The Lifeline": "Le Cordon",
"Sky Sentinel": "Sentinelle du Ciel",
"Silent Running": "Silence Radio",
"Spotlight": "Projecteur",
"The Wreck Line": "Le Cimetière d'Épaves",
"The Ring": "L'Anneau",
"The Rival": "La Rivale",
"The Hatchery": "La Couveuse",
"The Warden": "Le Geôlier",
"Their Treasury": "Leur Trésor",
"Shake Them Off": "Décroche-les !",
"Cold Approach": "Approche Glacée",
"The Narrows": "Le Goulet",
"The Trench Run": "La Tranchée",
"All Hands": "Tout le Monde sur le Pont",
"The Bright Side": "Le Côté Éclairé",
"The Leviathan": "Le Léviathan",
"The Searchlight": "Le Phare",
"Nightfall": "Tombée de la Nuit",
"The Long Dark": "La Longue Nuit",
"The Devourer": "Le Dévoreur",
"The Sky River": "Le Fleuve Céleste",
"The Undertow": "Le Ressac",
"The Stampede": "La Ruée",
"The Chorus": "Le Chœur",
"The Glass Sea": "La Mer de Verre",
"The Foundry": "La Fonderie",
"The Serpent's Garden": "Le Jardin du Serpent",
"Behind the Sky": "Derrière le Ciel",
"Sky 40": "Ciel 40",
"SKY 40": "CIEL 40",

/* ---------------- mission subtitles ---------------- */
"Learn the ropes": "Prise en main",
"Moving targets": "Cibles mouvantes",
"Mind the gap": "Attention à l'écart",
"They shoot back": "Ils ripostent",
"First boss": "Premier boss",
"Dodge or die": "Esquive ou meurs",
"Fly the wind": "Dompte le vent",
"Rescue mission": "Mission de sauvetage",
"Elites inbound": "Élites en approche",
"Bring them home": "Ramène-les à la maison",
"you are the delivery": "c'est toi, la livraison",
"Their flagship": "Leur vaisseau amiral",
"Guns down. Just fly.": "Canons éteints. Vole, c'est tout.",
"Don't be seen": "Ne te fais pas repérer",
"Through the debris": "À travers les débris",
"this sky has no edges": "ce ciel n'a pas de bords",
"One of them is good": "L'une d'elles est douée",
"It keeps growing": "Ça n'arrête pas de grossir",
"Their jailer": "Leur gardien de prison",
"Rob the robbers": "Vole les voleurs",
"they don't shoot — they cling": "ils ne tirent pas — ils s'accrochent",
"Line up the shot": "Aligne ton tir",
"Under their guns": "Sous leurs canons",
"Thread the walls": "Faufile-toi entre les murs",
"Everyone who is left": "Tous ceux qui restent",
"standing on their sun": "debout sur leur soleil",
"The last one": "Le dernier",
"Your glow is the only light": "Ta lueur est la seule lumière",
"While the light lasts": "Tant qu'il fait jour",
"Something is out there": "Quelque chose rôde",
"The last star": "La dernière étoile",
"The sky is draining": "Le ciel se vide",
"Gravity gone wrong": "La gravité déraille",
"you can't shoot them — push them": "ne leur tire pas dessus — pousse-les",
"They fire on the beat": "Ils tirent en rythme",
"two of you": "vous êtes deux",
"Stop the production line": "Arrête la chaîne",
"It eats your coins": "Il mange tes pièces",
"Where the game is made": "Là où le jeu se fabrique",
"the one Papa never finished": "celui que Papa n'a jamais fini",

/* ---------------- in-flight goal banners ----------------
   These flash over the playfield for a couple of seconds, so they are short,
   imperative and front-load the verb the way the English does. */
"Fly with your finger. Shoot!": "Vole avec ton doigt. Tire !",
"Ringed one pays x5 — hunt it down!": "Le cerclé rapporte x5 — à la chasse !",
"Fly the gaps — or cut the rope!": "Passe dans les trous — ou coupe le câble !",
"They shoot back — hide behind rocks!": "Ils ripostent — cache-toi derrière les rochers !",
"BOSS! Shoot the guns off its arms": "BOSS ! Arrache-lui les canons",
"Cut it fine — near misses pay!": "Frôle-les — ça rapporte !",
"WIND! Watch the streaks, then lean": "VENT ! Regarde les traînées, puis penche-toi",
"Free our friends from the ships!": "Libère nos amis de leurs vaisseaux !",
"Gold ones are tough — and rich!": "Les dorés sont coriaces — et généreux !",
"GUARD our hauler — keep it alive!": "PROTÈGE notre cargo — garde-le en vie !",
"CARRY 4 crates to the green door": "PORTE 4 caisses jusqu'à la porte verte",
"BOSS! Knock its parts off": "BOSS ! Fais-lui sauter les pièces",
"Guns broken — just DODGE!": "Canons en panne — ESQUIVE !",
"Only the beam shows the sky": "Seul le faisceau éclaire le ciel",
"Fly the scrap — it stops their shots": "Utilise la ferraille — elle arrête leurs tirs",
"GO ROUND THE BACK — the sky joins up": "FAIS LE TOUR — le ciel se referme",
"VESPER copies you — trick her!": "VESPER te copie — piège-la !",
"Kill the big purple one first!": "Détruis le gros violet en premier !",
"BOSS! Don't touch the mines": "BOSS ! Ne touche pas aux mines",
"Coins in the WIND — catch them!": "Des pièces dans le VENT — attrape-les !",
"WAGGLE hard to shake them off": "SECOUE fort pour les décrocher",
"BOSS! It goes invisible — watch": "BOSS ! Il devient invisible — observe",
"The canyon SQUEEZES — fly the middle": "Le canyon SE RESSERRE — reste au milieu",
"WALLS! Find the gap and fly through": "DES MURS ! Trouve le trou et passe",
"Save every last pilot!": "Sauve-les tous jusqu'au dernier !",
"CLIMB when the star flares": "MONTE quand l'étoile s'embrase",
"BOSS! Break off all four parts": "BOSS ! Casse les quatre pièces",
"DARK! Find the lost pilots": "NOIR ! Retrouve les pilotes perdus",
"It gets DARKER. Learn them early": "Il fait de plus en plus SOMBRE. Apprends vite",
"Something is out there. Watch out!": "Quelque chose rôde. Méfie-toi !",
"THE LAST BOSS. Everything you have!": "LE DERNIER BOSS. Donne tout !",
"The sky is DRAINING — ride it!": "Le ciel SE VIDE — laisse-toi porter !",
"Whirlpools bend your shots!": "Les tourbillons courbent tes tirs !",
"STEER the herd into their ships": "DIRIGE le troupeau sur leurs vaisseaux",
"They fire ON THE BEAT — weave!": "Ils tirent EN RYTHME — slalome !",
"USE your reflection — it shoots too": "SERS-TOI de ton reflet — il tire aussi",
"Shoot the parts on the belts!": "Détruis les pièces sur les tapis !",
"It EATS coins — hit the glow ring!": "Il MANGE les pièces — vise l'anneau lumineux !",
"The workshop is awake. Fly!": "L'atelier s'est réveillé. Vole !",
"Paint Papa's last sky!": "Peins le dernier ciel de Papa !",


/* ---------------- navigation, kit, difficulty detail ---------------- */
"CAMPAIGN": "CAMPAGNE",
"MY SHIP": "MON VAISSEAU",
"SMART BOMB +1": "BOMBE +1",
"OVERDRIVE +1": "SURRÉGIME +1",
"SHIELDS FULL": "BOUCLIERS PLEINS",
"EXTRA LIFE": "VIE EN PLUS",
"a thinner crowd": "moins de monde",
"the normal crowd": "foule normale",
"twice the enemies": "deux fois plus d'ennemis",
"almost three times the enemies": "presque trois fois plus d'ennemis",
"a sky full of enemies": "un ciel plein d'ennemis",
"paper armour": "blindage en papier",
"normal armour": "blindage normal",
"tougher armour": "blindage renforcé",
"much tougher armour": "blindage très renforcé",
"monster armour": "blindage monstrueux",
"normal pay": "paie normale",
"smaller pay": "paie réduite",
"pays {n}× the money": "rapporte {n}× plus",

/* ---------------- the shop ----------------
   Part names read as kit, not as jargon: a seven-year-old should be able to
   say what they just bought. The effect lines below carry numbers in named
   slots, because French puts the figure where English does not. */
"Spread Shot": "Tir en Éventail",
"Rapid Fire": "Tir Rapide",
"Plasma Rounds": "Munitions Plasma",
"Piercing Rounds": "Munitions Perforantes",
"Seeker Rounds": "Munitions à Tête Chercheuse",
"Energy Shield": "Bouclier d'Énergie",
"Extra Life": "Vie Supplémentaire",
"Hull Plating": "Blindage de Coque",
"Ion Thrusters": "Propulseurs Ioniques",
"Tractor Beam": "Rayon Tracteur",
"Salvage Rig": "Récupérateur",
"Wingman Drone": "Drone Ailier",
"Smart Bombs": "Bombes",
"Overdrive": "Surrégime",
"Shoot more bullets at once, in a wider fan":
  "Tire plus de projectiles à la fois, en éventail plus large",
"Your guns shoot way faster": "Tes canons tirent bien plus vite",
"Every bullet hits much harder": "Chaque tir frappe beaucoup plus fort",
"Bullets punch straight through anything they blow up":
  "Tes tirs transpercent tout ce qu'ils font exploser",
"Your bullets bend through the air to chase enemies":
  "Tes tirs s'incurvent en vol pour poursuivre les ennemis",
"A bubble that eats a hit for you. It refills when you clear a wave":
  "Une bulle qui encaisse un coup à ta place. Elle se recharge quand tu nettoies une vague",
"Start every mission with extra lives": "Commence chaque mission avec des vies en plus",
"After a hit you flash and nothing can hurt you - this makes it last longer":
  "Après un coup tu clignotes et rien ne peut te toucher — ça dure plus longtemps",
"Zoom around faster and turn on a dime": "File plus vite et tourne au quart de tour",
"Coins, power-ups and rescue pods fly straight to you":
  "Les pièces, les bonus et les capsules de sauvetage volent droit vers toi",
"Everything you blow up drops more money. Get this early!":
  "Tout ce que tu fais exploser rapporte plus. À prendre tôt !",
"Little robot buddies fly next to you and shoot too":
  "De petits copains robots volent à tes côtés et tirent aussi",
"BOOM - wipes out the whole screen. Tap 💣 or press B":
  "BOUM — nettoie tout l'écran. Touche 💣 ou appuie sur B",
"Super mode: double speed guns and double damage. Tap 🔥 or press V":
  "Mode super : cadence doublée et dégâts doublés. Touche 🔥 ou appuie sur V",
"{n}-way fire": "tir en {n} directions",
"+{n}% fire rate": "+{n} % de cadence",
"{n} damage per hit": "{n} dégâts par tir",
"blasts through {n} and keeps going": "traverse {n} et continue",
"1 enemy": "1 ennemi",
"{n} enemies": "{n} ennemis",
"tracking {n}/3": "guidage {n}/3",
"{n} charge": "{n} charge",
"{n} charges": "{n} charges",
"{n} starting lives": "{n} vies au départ",
"+{n}s recovery": "+{n} s d'invincibilité",
"+{n}% speed": "+{n} % de vitesse",
"{n}px pull range": "portée d'attraction {n} px",
"+{n}% money": "+{n} % d'argent",
"{n} drone": "{n} drone",
"{n} drones": "{n} drones",
"{n} bomb per mission": "{n} bombe par mission",
"{n} bombs per mission": "{n} bombes par mission",
"{n} use · {s}s each": "{n} utilisation · {s} s chacune",
"{n} uses · {s}s each": "{n} utilisations · {s} s chacune",

/* ---------------- medals ----------------
   Titles stay short and boastful - they are worn, not read. */
"First Blood": "Premier Sang",
"Sharpshooter": "Fine Gâchette",
"Combo Master": "Maître du Combo",
"Mission Complete": "Mission Accomplie",
"Full Marks": "Sans Faute",
"Star Collector": "Collectionneur d'Étoiles",
"Search & Rescue": "Recherche et Sauvetage",
"Boss Slayer": "Tueur de Boss",
"Boss Hunter": "Chasseur de Boss",
"Untouchable": "Intouchable",
"Century Club": "Club des Cent",
"Sky Sweeper": "Balayeur du Ciel",
"High Roller": "Gros Joueur",
"War Chest": "Trésor de Guerre",
"Kitted Out": "Bien Équipé",
"Specialist": "Spécialiste",
"Quartermaster": "Intendant",
"Fully Loaded": "Armé jusqu'aux Dents",
"Ace Pilot": "Pilote As",
"Veteran Wings": "Ailes de Vétéran",
"Nightmare Fuel": "Carburant de Cauchemar",
"Sky Spinner": "Acrobate du Ciel",
"Iron Wings": "Ailes de Fer",
"Gauntlet Runner": "Traverseur du Gant",
"The Last Star": "La Dernière Étoile",
"Rush Master": "Maître du Marathon",
"Destroy your first enemy": "Détruis ton premier ennemi",
"Reach a x5 combo": "Atteins un combo x5",
"Reach a x10 combo": "Atteins un combo x10",
"Finish your first mission": "Termine ta première mission",
"Earn 3 stars on any mission": "Gagne 3 étoiles sur une mission",
"Collect 15 stars in total": "Récolte 15 étoiles en tout",
"Rescue 25 stranded pilots": "Sauve 25 pilotes en perdition",
"Defeat a boss": "Bats un boss",
"Defeat 5 bosses": "Bats 5 boss",
"Finish a mission without a scratch": "Termine une mission sans une égratignure",
"Destroy 100 enemies (lifetime)": "Détruis 100 ennemis (au total)",
"Destroy 1000 enemies (lifetime)": "Détruis 1000 ennemis (au total)",
"Earn £1,000 (lifetime)": "Gagne 1 000 £ (au total)",
"Earn £25,000 (lifetime)": "Gagne 25 000 £ (au total)",
"Buy your first Armory upgrade": "Achète ta première amélioration à l'Arsenal",
"Max out any single upgrade": "Pousse une amélioration au maximum",
"Buy 20 upgrade levels in total": "Achète 20 niveaux d'amélioration en tout",
"Max out every Armory upgrade": "Pousse toutes les améliorations au maximum",
"Complete a mission on ACE": "Termine une mission en AS",
"Complete a mission on VETERAN": "Termine une mission en VÉTÉRAN",
"Complete a mission on NIGHTMARE": "Termine une mission en CAUCHEMAR",
"Complete every mission": "Termine toutes les missions",
"Score 3,000 in the Wacky Sky": "Marque 3 000 points dans le Ciel Farfelu",
"Last 4 minutes in the Wacky Sky": "Tiens 4 minutes dans le Ciel Farfelu",
"Beat 3 bosses in one Boss Rush": "Bats 3 boss en un seul Marathon",
"Destroy the Devourer": "Détruis le Dévoreur",
"Beat 5 bosses in one Boss Rush": "Bats 5 boss en un seul Marathon",

/* ---------------- mission briefings ----------------
   The longest prose in the game. {you} is the pilot's own name and has to
   survive intact; the tone stays a grown-up talking straight to a child. */
"Fly with your finger or the arrow keys. Your guns shoot all by themselves - and the squadron is flying this one with you. Watch out for rocks, and for the pink one: it draws a line at you before it shoots, so just move off the line.":
  "Vole avec ton doigt ou les flèches du clavier. Tes canons tirent tout seuls — et l'escadron t'accompagne pour celle-ci. Attention aux rochers, et au rose : il trace un trait vers toi avant de tirer, alors sors simplement du trait.",
"These ones slide left and right. Shoot where they are going, not where they are - and every wave has one WANTED ship in a gold ring that pays five times as much.":
  "Ceux-là glissent de gauche à droite. Tire là où ils vont, pas là où ils sont — et chaque vague cache un vaisseau RECHERCHÉ cerclé d'or qui rapporte cinq fois plus.",
"They fly in PAIRS, roped together with a live cable. The cable hurts - go round it, or shoot one end and watch it snap.":
  "Ils volent par PAIRES, reliés par un câble sous tension. Le câble fait mal — contourne-le, ou détruis une extrémité et regarde-le claquer.",
"These ones stop and aim at you. Keep moving and they will miss - and out here the rocks are on your side: their shots cannot get through one.":
  "Ceux-là s'arrêtent et te visent. Bouge sans arrêt et ils te rateront — et ici les rochers sont de ton côté : aucun de leurs tirs ne les traverse.",
"Brutes wear thick armour - Plasma Rounds chew through it. Then something HUGE shows up.":
  "Les Brutes portent un blindage épais — les Munitions Plasma le rongent. Et puis quelque chose d'ÉNORME débarque.",
"Kamikazes pick a spot and rocket at it. Let them come close, THEN swerve - the closer you cut it, the more they pay. Every near miss is money.":
  "Les Kamikazes choisissent un point et foncent dessus. Laisse-les approcher, PUIS esquive — plus tu frôles, plus ça rapporte. Chaque frôlement, c'est de l'argent.",
"A nebula squall is tearing through the Belt. The wind comes in gusts - watch for the streaks, lean against the push, and don't let it shove you into a rock.":
  "Une bourrasque de nébuleuse traverse la Ceinture. Le vent souffle par rafales — surveille les traînées, penche-toi contre la poussée, et ne le laisse pas te jeter sur un rocher.",
"Those big ships have our friends locked inside. Blast them before they get away!":
  "Ces gros vaisseaux gardent nos amis enfermés à l'intérieur. Détruis-les avant qu'ils ne filent !",
"The gold glowing ones are elites. Really tough, but they pay FOUR times as much.":
  "Ceux qui brillent en doré sont des élites. Vraiment coriaces, mais ils rapportent QUATRE fois plus.",
"One supply hauler is crossing to the front with everything the squadron needs. It can't dodge and it can't shoot back, and they are coming straight for it. Stay close and keep it alive all the way home.":
  "Un cargo de ravitaillement rejoint le front avec tout ce dont l'escadron a besoin. Il ne peut ni esquiver ni riposter, et ils foncent droit dessus. Reste près de lui et ramène-le entier jusqu'au bout.",
"The forward squadron is out of everything. There is no hauler left to send, so you are the hauler: grab each crate, fly it up to the green door, and let go. Take a hit and you will drop the load — it will hang there a moment before it starts to sink, so go back for it.":
  "L'escadron avancé n'a plus rien. Il ne reste aucun cargo à envoyer : c'est donc toi, le cargo. Attrape chaque caisse, monte-la jusqu'à la porte verte, et lâche. Si tu prends un coup tu lâcheras la caisse — elle flottera un instant avant de couler, alors retourne la chercher.",
"Everything they have in this sector, plus their giant flagship. You have got this.":
  "Tout ce qu'ils ont dans ce secteur, plus leur gigantesque vaisseau amiral. Tu vas y arriver.",
"The Sentinel's last blast broke your guns! Sneak through the blockade while the crew fixes them - dodge everything, catch coins and drifting pilots.":
  "La dernière salve de la Sentinelle a détruit tes canons ! Faufile-toi à travers le blocus pendant que l'équipe les répare — esquive tout, attrape les pièces et les pilotes à la dérive.",
"Their searchlight is the only light out here, {you} - what it sweeps, you see, and everything else is black. But standing in it means they can see YOU, and they all shoot at once. Read the sky it just lit, then get out of the way.":
  "Leur projecteur est la seule lumière ici, {you} — tu ne vois que ce qu'il balaie, tout le reste est noir. Mais rester dedans, c'est se faire voir, et là ils tirent tous en même temps. Lis le ciel qu'il vient d'éclairer, puis dégage.",
"The Sentinel left a whole field of scrap behind. Rocks do not shoot, and they do not move - but nothing they fire gets through one either. Put the scrap between you and their guns.":
  "La Sentinelle a laissé derrière elle tout un champ de ferraille. Les rochers ne tirent pas et ne bougent pas — mais aucun de leurs projectiles ne les traverse. Mets la ferraille entre toi et leurs canons.",
"Nobody has ever found the edge of this place. Fly out one side and you come straight back in the other, same height, still going. They cannot do it — their ships are built to hold a lane. You are not.":
  "Personne n'a jamais trouvé le bord de cet endroit. Sors d'un côté et tu reviens aussitôt par l'autre, à la même hauteur, sans ralentir. Eux n'y arrivent pas — leurs vaisseaux sont faits pour tenir un couloir. Pas toi.",
"One of their pilots has been shadowing us for weeks. She calls herself VESPER, she flies as well as you do, and today she is waiting. She copies whatever you do - so don't just chase her. Make her move, then shoot where she is GOING.":
  "L'une de leurs pilotes nous file depuis des semaines. Elle se fait appeler VESPER, elle vole aussi bien que toi, et aujourd'hui elle t'attend. Elle copie tout ce que tu fais — alors ne te contente pas de la poursuivre. Force-la à bouger, puis tire là où elle VA.",
"Hives spit out new ships forever. Kill the hive first and the rest stops coming.":
  "Les Ruches recrachent des vaisseaux sans fin. Détruis la ruche d'abord et le reste s'arrête.",
"This one lays mines instead of shooting. Blow the hatches off its sides and it runs out of them.":
  "Celui-ci pose des mines au lieu de tirer. Fais sauter les trappes sur ses flancs et il n'en aura plus.",
"This is where they keep everything they stole - and a storm is tearing the vaults open! Chase every coin the wind throws loose, and watch the thieves who want them back.":
  "C'est ici qu'ils gardent tout ce qu'ils ont volé — et une tempête est en train d'éventrer les coffres ! Cours après chaque pièce que le vent libère, et méfie-toi des voleurs qui veulent les reprendre.",
"The yard where they cut up captured hulls has its own vermin, and it has noticed you. These ones carry no guns at all — and shooting them off does not work, they just shrug it off on the way in. They grab hold, and every one that sticks makes you heavier and slower. WAGGLE to throw them off.":
  "Le chantier où ils découpent les coques capturées a sa propre vermine, et elle t'a repéré. Ceux-là n'ont aucune arme — et leur tirer dessus ne sert à rien, ils encaissent sans broncher pendant l'approche. Ils s'agrippent, et chacun d'eux te rend plus lourd et plus lent. SECOUE-TOI pour les décrocher.",
"Snipers draw a line before they fire. If the line is on you, move - simple as that.":
  "Les tireurs d'élite tracent un trait avant de tirer. Si le trait est sur toi, bouge — c'est aussi simple que ça.",
"Their fortress guns watch every road in the sky, {you} - so we go UNDER the sky. Down their own canyon, below the radar. The walls breathe in and out; fly the middle when they squeeze.":
  "Les canons de leur forteresse surveillent toutes les routes du ciel, {you} — alors on passe SOUS le ciel. Par leur propre canyon, sous le radar. Les parois respirent ; reste au milieu quand elles se resserrent.",
"Straight down the supply trench of their star fortress. The walls come in waves - read each gate, find the gap, and thread it. Or blast your own door through, if your guns are up to it.":
  "Droit dans la tranchée de ravitaillement de leur forteresse stellaire. Les murs arrivent par vagues — lis chaque porte, trouve l'ouverture, et faufile-toi. Ou ouvre-toi un passage au canon, si tes armes en sont capables.",
"Every prisoner they still hold is on these ships. Bring all of them home.":
  "Tous les prisonniers qu'ils détiennent encore sont à bord de ces vaisseaux. Ramène-les tous à la maison.",
"We are flying over the surface of their star. Every minute or so it throws a sheet of fire up at us — it burns them as happily as it burns you, so anything you were saving for later will be gone. When the warning line lights, climb.":
  "On survole la surface de leur étoile. Environ toutes les minutes, elle projette une nappe de feu vers nous — elle les brûle aussi volontiers que toi, donc tout ce que tu gardais pour plus tard partira en fumée. Quand la ligne d'alerte s'allume, MONTE.",
"Their biggest ship, and the last thing between us and home. Four weak points. Take your time.":
  "Leur plus gros vaisseau, et le dernier obstacle avant la maison. Quatre points faibles. Prends ton temps.",
"They cut the power to this whole sector. Your ship's glow is the only lamp left - and there are stranded pilots drifting out there in the dark, waiting for somebody to come looking.":
  "Ils ont coupé le courant dans tout le secteur. La lueur de ton vaisseau est la seule lampe qui reste — et des pilotes en perdition dérivent là-dehors dans le noir, en attendant que quelqu'un vienne les chercher.",
"Their sun is going out, {you}, and it's going out WHILE we're in here. Everything you can see now, you'll be flying blind against by the end. Learn them early.":
  "Leur soleil s'éteint, {you}, et il s'éteint PENDANT qu'on est dedans. Tout ce que tu vois maintenant, tu l'affronteras à l'aveugle avant la fin. Apprends-les tant qu'il fait jour.",
"Their star went out last night. Fly quiet, keep your eyes open - and look at what is sitting where the light used to be.":
  "Leur étoile s'est éteinte cette nuit. Vole en silence, ouvre l'œil — et regarde bien ce qui se tient là où était la lumière.",
"This is the one, {you}. It ate their sun and it is coming for ours. Everything you have learned, everything you have built - all of it, right now.":
  "C'est lui, {you}. Il a dévoré leur soleil et il vient chercher le nôtre. Tout ce que tu as appris, tout ce que tu as construit — tout, maintenant.",
"See that bright band, {you}? That's the sky itself, pouring toward the crack the Devourer left. Drop in and it carries you - and their shots, and the money. Ride it to travel. Climb out to aim.":
  "Tu vois cette bande lumineuse, {you} ? C'est le ciel lui-même qui se déverse vers la faille laissée par le Dévoreur. Plonge dedans et il t'emporte — avec leurs tirs et l'argent. Laisse-toi porter pour avancer. Ressors pour viser.",
"The Devourer's fall tore a hole in the sky, {you}. On the other side gravity runs in whirlpools - YOUR shots curve, THEIR shots curve, even the coins swim. Bend your aim around the wells!":
  "La chute du Dévoreur a déchiré le ciel, {you}. De l'autre côté, la gravité tourne en tourbillons — TES tirs s'incurvent, LEURS tirs s'incurvent, même les pièces nagent. Courbe ta visée autour des puits !",
"Something lives out here, and it is bigger than anything either side flies. Nothing you have will get through that hide — but your rounds still SHOVE. Line one up, push it across the sky, and let it walk through their formation.":
  "Quelque chose vit ici, et c'est plus gros que tout ce que les deux camps pilotent. Rien de ce que tu as ne percera ce cuir — mais tes tirs POUSSENT quand même. Aligne-en un, pousse-le à travers le ciel, et laisse-le traverser leur formation.",
"Listen, {you} - out here the whole fleet fires together, ON THE BEAT. Watch the sky pulse, learn the song, and weave between the verses. Silence a conductor and their whole choir forgets the words.":
  "Écoute, {you} — ici la flotte entière tire ensemble, EN RYTHME. Regarde le ciel pulser, apprends la chanson, et slalome entre les couplets. Fais taire un chef d'orchestre et tout leur chœur oublie les paroles.",
"Nobody can explain this stretch. The sky is a mirror, and so are you — there is a second ship out there flying your flight backwards, and it fires whenever you fire. It cannot be hurt and it cannot be hit. Put yourself where it can do some good.":
  "Personne n'explique ce passage. Le ciel est un miroir, et toi aussi — il y a un second vaisseau là-dehors qui refait ton vol à l'envers, et il tire chaque fois que tu tires. On ne peut ni le blesser ni le toucher. Place-toi là où il servira à quelque chose.",
"They are BUILDING reinforcements right in front of you, {you}. Parts ride the belts toward the assembler - every part you shoot is a ship that never gets born. Starve the machine!":
  "Ils FABRIQUENT des renforts juste devant toi, {you}. Les pièces défilent sur les tapis vers l'assembleuse — chaque pièce que tu détruis est un vaisseau qui ne naîtra jamais. Affame la machine !",
"Something old lives in this garden, {you}, and it is HUNGRY. The Tithe Serpent eats your coins and grows a new ring for every mouthful. Hit the glowing ring - slay it and get every penny back.":
  "Quelque chose d'ancien vit dans ce jardin, {you}, et il a FAIM. Le Serpent à Dîme dévore tes pièces et se fait pousser un anneau à chaque bouchée. Vise l'anneau lumineux — terrasse-le et récupère jusqu'au dernier centime.",
"The crack goes all the way through, {you} - BEHIND the sky, where skies get painted and ships get drawn. Something in the workshop has woken up, and it has been watching you play. It knows every trick you know.":
  "La faille traverse de part en part, {you} — DERRIÈRE le ciel, là où on peint les ciels et où on dessine les vaisseaux. Quelque chose s'est réveillé dans l'atelier, et ça te regarde jouer depuis le début. Ça connaît toutes tes astuces.",
"Behind the workshop, one canvas was left on the easel - a sky with your names pencilled in the corner. Every star you earned was a colour, {you}, and you earned ALL of them. Time to paint it. Everyone's coming.":
  "Derrière l'atelier, une toile est restée sur le chevalet — un ciel avec vos noms crayonnés dans le coin. Chaque étoile que tu as gagnée était une couleur, {you}, et tu les as TOUTES gagnées. C'est l'heure de le peindre. Tout le monde arrive.",

/* ---------------- comms ----------------
   Control is the grown-up on the radio, your mate is the sibling in the next
   seat. {you} is the pilot's name and {n} a live number - both must survive.
   These fly past mid-dodge, so they stay short and spoken, never written. */
"You're clear for launch, {you}.":
  "Décollage autorisé, {you}.",
"Skies are yours, {you}. Show them.":
  "Le ciel est à toi, {you}. Montre-leur.",
"Good hunting, {you}.":
  "Bonne chasse, {you}.",
"Shield online!":
  "Bouclier activé !",
"Shields back up, {you}.":
  "Boucliers rétablis, {you}.",
"That's a fresh shield.":
  "Voilà un bouclier tout neuf.",
"Guns hot!":
  "Canons chauds !",
"Weapons boosted!":
  "Armes améliorées !",
"That's more firepower, {you}.":
  "Voilà plus de puissance de feu, {you}.",
"Double points - go get them!":
  "Points doublés — fonce !",
"Score doubled, make it count.":
  "Score doublé, fais-en bon usage.",
"That was close, {you}!":
  "C'était juste, {you} !",
"Whoa! Nearly had you.":
  "Ouh ! Il t'a presque eu.",
"Careful - that one had your name on it.":
  "Attention — celui-là était à ton nom.",
"Nice dodge, {you}.":
  "Belle esquive, {you}.",
"Last life, {you}. Make it count.":
  "Dernière vie, {you}. Ne la gâche pas.",
"You're down to your last life - fly smart.":
  "Il ne te reste qu'une vie — vole intelligemment.",
"One life left. Take your time out there.":
  "Une vie restante. Prends ton temps là-haut.",
"You okay? Keep going, {you}.":
  "Ça va ? Continue, {you}.",
"Shake it off, {you}.":
  "Secoue-toi, {you}.",
"Still with you. Get back in there.":
  "On est toujours là. Retournes-y.",
"Combo broken at x{n} - rebuild it.":
  "Combo brisé à x{n} — reconstruis-le.",
"Lost the chain at x{n}. Again!":
  "Chaîne perdue à x{n}. On recommence !",
"x{n}! How are you doing that?!":
  "x{n} ! Comment tu fais ça ?!",
"x{n} combo - that's a streak, {you}!":
  "Combo x{n} — quelle série, {you} !",
"Don't stop, {you}, that's x{n}!":
  "Ne t'arrête pas, {you}, tu es à x{n} !",
"Your shots are bouncing - kill the Guardian first!":
  "Tes tirs ricochent — détruis le Gardien d'abord !",
"That blue one is shielding them. Take it out.":
  "Le bleu les protège. Élimine-le.",
"Nothing gets through while the Guardian is up, {you}.":
  "Rien ne passe tant que le Gardien tient, {you}.",
"It's going for your coins, {you}!":
  "Il en veut à tes pièces, {you} !",
"Hey! That one's stealing your money.":
  "Hé ! Celui-là te vole ton argent.",
"Got your money back.":
  "Argent récupéré.",
"Cash recovered, {you}.":
  "Magot récupéré, {you}.",
"It got away with £{n}! Get the next one.":
  "Il s'est enfui avec {n} £ ! Attrape le suivant.",
"There goes £{n}. Faster next time, {you}.":
  "Adieu {n} £. Plus vite la prochaine fois, {you}.",
"Marksman locking on - get out of that line!":
  "Tireur d'élite en approche — sors de sa ligne !",
"See the pink line? Don't be standing in it.":
  "Tu vois le trait rose ? Ne reste pas dedans.",
"The green one is fixing them! Shoot that first.":
  "Le vert les répare ! Détruis-le en premier.",
"They're healing each other, {you}.":
  "Ils se soignent entre eux, {you}.",
"That Hive keeps making more - kill it, {you}.":
  "Cette Ruche en fabrique sans arrêt — détruis-la, {you}.",
"More of them every second. Take out the big purple one.":
  "Il y en a plus à chaque seconde. Élimine le gros violet.",
"Mines! Don't fly into those.":
  "Des mines ! Ne fonce pas dedans.",
"It's dropping mines, {you} - go round.":
  "Il lâche des mines, {you} — contourne.",
"Those ones are following you!":
  "Ceux-là te suivent !",
"It's matching you, {you} - swerve hard.":
  "Il te colle, {you} — braque sec.",
"Those big ones take a beating, {you} - keep on them.":
  "Les gros encaissent, {you} — insiste.",
"Boulder field. Break them up and collect, or fly around.":
  "Champ de rochers. Casse-les et ramasse, ou contourne.",
"A couple of shots won't dent that one, {you}. Keep firing.":
  "Deux ou trois tirs n'entameront pas celui-là, {you}. Continue.",
"Rocks ahead - fly around them or break them up.":
  "Des rochers droit devant — contourne-les ou casse-les.",
"Asteroid field, {you}. Mind the big ones.":
  "Champ d'astéroïdes, {you}. Méfie-toi des gros.",
"It split! Watch out, {you}.":
  "Il s'est divisé ! Attention, {you}.",
"They come apart when you shoot them!":
  "Ils se séparent quand tu les touches !",
"Pilot aboard. Good work, {you}.":
  "Pilote à bord. Beau travail, {you}.",
"That's one of ours home safe.":
  "Un des nôtres est sain et sauf.",
"Rescue confirmed - thank you, {you}.":
  "Sauvetage confirmé — merci, {you}.",
"Watch its wind-ups, {you} - it always tells you first.":
  "Surveille ses élans, {you} — il prévient toujours avant.",
"Steady, {you}. You've got this.":
  "Du calme, {you}. Tu vas y arriver.",
"Your shots are bouncing off, {you} - shoot the PARTS, not the middle!":
  "Tes tirs ricochent, {you} — vise les PIÈCES, pas le centre !",
"It's sealed. Knock the bits off it first!":
  "Il est blindé. Fais d'abord sauter les morceaux !",
"Armour's off - HIT THE MIDDLE, {you}!":
  "Blindage tombé — VISE LE CENTRE, {you} !",
"The core's wide open. Now!":
  "Le cœur est à découvert. Maintenant !",
"You knocked a gun off it!":
  "Tu lui as arraché un canon !",
"It's coming apart, {you}!":
  "Il se démantèle, {you} !",
"Halfway, {you}. Holding up well.":
  "À la moitié, {you}. Tu tiens bien.",
"That's the midpoint - keep it together.":
  "C'est la mi-parcours — tiens bon.",
"Squall ahead, {you}. Watch the streaks - the wind hits right after them.":
  "Bourrasque droit devant, {you}. Surveille les traînées — le vent frappe juste après.",
"It's blowing hard out there. Lean AGAINST the gusts, {you}.":
  "Ça souffle fort là-haut. Penche-toi CONTRE les rafales, {you}.",
"That hauler can't dodge or shoot back, {you}. Stay near it and kill what comes.":
  "Ce cargo ne peut ni esquiver ni riposter, {you}. Reste près de lui et abats tout ce qui vient.",
"They're going straight for our hauler, {you}. Don't let them reach it.":
  "Ils foncent droit sur notre cargo, {you}. Ne les laisse pas l'atteindre.",
"The hauler's in a bad way, {you} - get them off it!":
  "Le cargo est mal en point, {you} — débarrasse-le d'eux !",
"It can't take much more! Clear them out, {you}!":
  "Il ne tiendra plus longtemps ! Nettoie-moi ça, {you} !",
"Walls ahead, {you}. Read each gate, find the gap, thread it.":
  "Des murs droit devant, {you}. Lis chaque porte, trouve l'ouverture, faufile-toi.",
"It's a trench, {you} - weave the gaps or blast your own door.":
  "C'est une tranchée, {you} — slalome dans les trous ou ouvre-toi un passage.",
"The lights are gone, {you}. Your glow is the only lamp out here.":
  "Les lumières sont mortes, {you}. Ta lueur est la seule lampe ici.",
"Fly by your own light, {you} - and look for the ones drifting in the dark.":
  "Vole à ta propre lumière, {you} — et cherche ceux qui dérivent dans le noir.",
"We lost a hauler! Guard the others, {you}!":
  "On a perdu un cargo ! Protège les autres, {you} !",
"Hauler's gone... don't let that happen again.":
  "Le cargo est perdu… que ça ne se reproduise pas.",
"Hauler's through! Well flown, {you}.":
  "Le cargo est passé ! Bien piloté, {you}.",
"That's one home safe. Keep it up.":
  "Un de sauvé. Continue comme ça.",
"Vesper is out here somewhere, {you}. She's as good as you are.":
  "Vesper rôde quelque part par ici, {you}. Elle vole aussi bien que toi.",
"Watch for Vesper, {you}. She'll copy everything you do.":
  "Méfie-toi de Vesper, {you}. Elle copiera tout ce que tu fais.",
"That's her! She's mirroring you, {you} — make her move first!":
  "C'est elle ! Elle te reflète, {you} — force-la à bouger la première !",
"Vesper! Don't chase her, {you} — shoot where she's GOING.":
  "Vesper ! Ne la poursuis pas, {you} — tire là où elle VA.",
"It's Vesper again! She's faster than last time, {you}!":
  "Encore Vesper ! Elle est plus rapide que la dernière fois, {you} !",
"She came back for you, {you}. Same trick — make her commit!":
  "Elle est revenue pour toi, {you}. Même astuce — force-la à s'engager !",
"You got Vesper! Nobody has ever done that, {you}.":
  "Tu as eu Vesper ! Personne n'avait jamais fait ça, {you}.",
"She's down! That was proper flying, {you}.":
  "Elle est à terre ! Ça, c'est du pilotage, {you}.",
"I've lent you two of my drones, {you} - they shoot when you shoot.":
  "Je t'ai prêté deux de mes drones, {you} — ils tirent quand tu tires.",
"Borrowed drones on your wing, {you}. Free guns. Use them.":
  "Des drones prêtés à tes ailes, {you}. Des canons gratuits. Sers-t'en.",
"One ship out there is worth FIVE times the rest, {you}. Look for the gold ring.":
  "Un vaisseau vaut CINQ fois les autres, {you}. Cherche le cercle doré.",
"Bounty flight: find the one with the gold ring round it and take it down.":
  "Vol à prime : trouve celui qui porte le cercle doré et abats-le.",
"Those rocks will eat their bullets, {you}. Hide behind them.":
  "Ces rochers avalent leurs tirs, {you}. Cache-toi derrière.",
"Use the rocks as cover, {you} - nothing gets through them.":
  "Sers-toi des rochers comme abri, {you} — rien ne les traverse.",
"Fly CLOSE to the divers today, {you} - a near miss pays.":
  "Passe TOUT PRÈS des plongeurs aujourd'hui, {you} — un frôlement, ça paie.",
"Points for nerve on this one, {you}. Let them get close, then slip past.":
  "Des points pour le cran sur celle-ci, {you}. Laisse-les approcher, puis file.",
"That band is the sky DRAINING through the Devourer's crack, {you}. Ride it to move, leave it to aim.":
  "Cette bande, c'est le ciel qui SE VIDE par la faille du Dévoreur, {you}. Laisse-toi porter pour avancer, ressors pour viser.",
"Feel the pull? Everything in that band is pouring toward the crack - you included.":
  "Tu sens l'aspiration ? Tout ce qui est dans cette bande file vers la faille — toi compris.",
"That searchlight is all the light we've got, {you}. What it sweeps, you see.":
  "Ce projecteur est toute la lumière qu'on a, {you}. Tu ne vois que ce qu'il balaie.",
"Fly BEHIND the beam - you'll still see what it just lit, and they won't see you.":
  "Reste DERRIÈRE le faisceau — tu verras encore ce qu'il vient d'éclairer, et eux ne te verront pas.",
"You're LIT UP, {you} - move!":
  "Tu es EN PLEINE LUMIÈRE, {you} — bouge !",
"They've got you in the beam!":
  "Ils t'ont dans le faisceau !",
"Out of the light, {you}, out of the light!":
  "Sors de la lumière, {you}, sors de là !",
"Under their guns now, {you} - nothing up there can see us down here. Mind the WALLS.":
  "Sous leurs canons maintenant, {you} — rien là-haut ne nous voit ici en bas. Attention aux PAROIS.",
"Their radar can't look into a canyon. The canyon, though - it BREATHES. Fly the middle.":
  "Leur radar ne voit pas dans un canyon. Le canyon, lui, RESPIRE. Reste au milieu.",
"Light's going, {you}. It'll be pitch black by the last wave - learn them NOW.":
  "La lumière baisse, {you}. Il fera nuit noire à la dernière vague — apprends-les MAINTENANT.",
"The sun's dying out here. Every minute you get less to see by.":
  "Le soleil se meurt ici. Chaque minute, tu y vois moins.",
"Gravity's broken out here, {you}. Your shots will CURVE - swing them.":
  "La gravité est détraquée ici, {you}. Tes tirs vont S'INCURVER — accompagne-les.",
"See the whirlpools? They pull in everything loose - including YOU.":
  "Tu vois les tourbillons ? Ils aspirent tout ce qui traîne — TOI compris.",
"Listen, {you} - they fire on the beat. Move BETWEEN the drums.":
  "Écoute, {you} — ils tirent en rythme. Bouge ENTRE les tambours.",
"The whole fleet is one big song. Dance in the gaps, {you}.":
  "Toute la flotte est une grande chanson. Danse dans les silences, {you}.",
"They're BUILDING ships on those belts, {you}. Pop the parts first!":
  "Ils FABRIQUENT des vaisseaux sur ces tapis, {you}. Détruis les pièces d'abord !",
"Every part you stop is a fight you never have. Starve the machine.":
  "Chaque pièce que tu arrêtes est un combat évité. Affame la machine.",
"One got through the assembler - heads up, it's coming down MEAN.":
  "Un vaisseau est sorti de l'assembleuse — attention, il descend en MODE MÉCHANT.",
"That's what happens when a part gets home. Don't let the next one.":
  "Voilà ce qui arrive quand une pièce passe. Ne laisse pas passer la suivante.",
"Something's alive in this garden, {you}. Keep an eye on your coins.":
  "Quelque chose est vivant dans ce jardin, {you}. Garde un œil sur tes pièces.",
"Old miners' story says a serpent lives here. It's not a story.":
  "Une vieille histoire de mineurs raconte qu'un serpent vit ici. Ce n'est pas une histoire.",
"THERE - the Tithe Serpent! It eats coins. Your coins. Hit the glowing ring!":
  "LÀ — le Serpent à Dîme ! Il mange les pièces. Tes pièces. Vise l'anneau lumineux !",
"It coughed up every penny! Beautiful flying, {you}.":
  "Il a recraché jusqu'au dernier centime ! Magnifique vol, {you}.",
"{you}... the charts stop here. This is behind the sky. Fly careful.":
  "{you}… les cartes s'arrêtent ici. On est derrière le ciel. Vole prudemment.",
"Nothing out here is finished, {you}. I don't think we're meant to see this.":
  "Rien n'est terminé ici, {you}. Je ne crois pas qu'on soit censés voir ça.",
"That... wasn't me on the radio, {you}. Stay sharp.":
  "Ce… n'était pas moi à la radio, {you}. Reste vigilant.",
"{you} - that ship. That's YOUR ship. It's flying your moves!":
  "{you} — ce vaisseau. C'est TON vaisseau. Il refait tes manœuvres !",
"It has your bombs too?! That's cheating. Probably.":
  "Il a aussi tes bombes ?! C'est de la triche. Sans doute.",
"It's... a paintbrush, {you}. The one that draws the skies. RESPECTFULLY: shoot it.":
  "C'est… un pinceau, {you}. Celui qui dessine les ciels. AVEC TOUT LE RESPECT QUE JE LUI DOIS : tire dessus.",
"Those aren't real yet, {you} - they're still drawings! FLY THROUGH THEM. Your paint gets there first and they come out on OUR side.":
  "Ils ne sont pas encore réels, {you} — ce ne sont que des dessins ! TRAVERSE-LES. Ta peinture arrive la première et ils ressortent de NOTRE côté.",
"You painted the sky, {you}. Every star out here is one of yours now.":
  "Tu as peint le ciel, {you}. Chaque étoile ici est désormais une des tiennes.",
"You're the truck today, {you}. Grab a crate, run it up to the green door - take a hit and you'll drop the lot, so go careful AND go fast.":
  "Aujourd'hui c'est toi le camion, {you}. Attrape une caisse, monte-la à la porte verte — un coup encaissé et tu lâches tout, alors sois prudent ET rapide.",
"There's no edge to this place, {you} - fly out one side and you'll come right back in the other. Use it.":
  "Cet endroit n'a pas de bord, {you} — sors d'un côté et tu reviens aussitôt par l'autre. Sers-t'en.",
"Those little green things don't shoot, {you} - they STICK. If one gets you, waggle her hard, left-right-left, and shake it loose.":
  "Ces petits trucs verts ne tirent pas, {you} — ils S'ACCROCHENT. Si l'un d'eux t'attrape, secoue fort, gauche-droite-gauche, et décroche-le.",
"We're right over the star itself, {you}. When the surface flares, CLIMB - anything low burns, them and us both.":
  "On est juste au-dessus de l'étoile, {you}. Quand la surface s'embrase, MONTE — tout ce qui est bas brûle, eux comme nous.",
"Don't waste rounds on the big ones, {you} - nothing gets through that hide. But they MOVE when you hit them. Steer them into the fleet.":
  "Ne gaspille pas tes munitions sur les gros, {you} — rien ne perce ce cuir. Mais ils BOUGENT quand tu les touches. Dirige-les sur la flotte.",
"The sky's a mirror out here, {you} - and so are you. Whatever you fire, your reflection fires it back at them.":
  "Le ciel est un miroir ici, {you} — et toi aussi. Tout ce que tu tires, ton reflet le leur renvoie.",
"This is the one, {you}. Papa sketched it and never got to paint it. Every star you earned is a colour - fly, and use them all.":
  "C'est celui-là, {you}. Papa l'a esquissé sans jamais pouvoir le peindre. Chaque étoile gagnée est une couleur — vole, et sers-t'en de toutes.",
"{you}, look at it. It's really happening - keep painting!":
  "{you}, regarde ça. C'est en train d'arriver pour de vrai — continue à peindre !",
"Everyone in close. Wings level. SMILE, {you}!":
  "Tout le monde se rapproche. Ailes à plat. SOURIS, {you} !",
"Guns are dead, {you}. Don't fight - FLY.":
  "Les canons sont morts, {you}. Ne combats pas — VOLE.",
"No cannons this run, {you}. Slip through quiet and don't get touched.":
  "Pas de canons cette fois, {you}. Passe en silence et ne te fais pas toucher.",
"The crew's working on the guns. Until then: dodge everything.":
  "L'équipe répare les canons. En attendant : esquive tout.",
"That's it, {you}. That's the thing that ate their sun.":
  "C'est lui, {you}. C'est la chose qui a dévoré leur soleil.",
"Everything you've got, {you}. Right now.":
  "Tout ce que tu as, {you}. Maintenant.",
"{you} - look behind you. EVERYONE came.":
  "{you} — regarde derrière toi. TOUT LE MONDE est venu.",
"You brought us all home. Our turn.":
  "Tu nous as tous ramenés. À notre tour.",
"You're not doing this one alone, {you}.":
  "Tu ne feras pas celle-ci tout seul, {you}.",
"Sky's clear, {you}. Come on home.":
  "Le ciel est dégagé, {you}. Rentre à la maison.",
"That's all of them. Bring it back, {you}.":
  "Ils y sont tous passés. Ramène-le, {you}.",
"Clean sweep. Set course for home.":
  "Nettoyage complet. Cap sur la maison.",
"That's a new record, {you}!":
  "C'est un nouveau record, {you} !",
"You just beat it. Nice flying.":
  "Tu viens de le battre. Joli vol.",
"You took my record, {you}. I want it back.":
  "Tu m'as pris mon record, {you}. Je le reprendrai.",
"Okay, that's mine no more. Well flown.":
  "Bon, il n'est plus à moi. Bien piloté.",
"Not a scratch on you, {you}.":
  "Pas une égratignure, {you}.",
"Sky's clear - and your shield charged back up. It does that every wave, {you}.":
  "Ciel dégagé — et ton bouclier s'est rechargé. Il fait ça à chaque vague, {you}.",
"Wave down, shield full again. That's what you paid for, {you}.":
  "Vague terminée, bouclier de nouveau plein. C'est ce que tu as payé, {you}.",
"One slipped past us, {you} - no clean sweep this time.":
  "Un nous a filé entre les doigts, {you} — pas de sans-faute cette fois.",
"That one got by. Clean sweep's gone, but finish the job, {you}.":
  "Celui-là est passé. Le sans-faute est perdu, mais termine le travail, {you}.",

} });
})();
