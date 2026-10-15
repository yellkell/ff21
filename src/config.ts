/**
 * Iron Balls Boxing tunables — the game is FIRE FIGHT: bare-knuckle boxing at
 * a distance with flaming iron balls. Numbers the gameplay feel depends on
 * live here so they are easy to find and adjust. Dimensions are in metres and
 * follow the Blaston "Play Space Dimensions" layout — two octagonal platforms
 * facing each other — pulled slightly CLOSER together for that in-your-face
 * boxing feel.
 *
 * The fantasy: two flaming iron balls orbit your fists while you hold the
 * triggers; you whip a punch to hurl one at your opponent, and a trigger pull
 * calls it roaring back to your hand.
 */

import type { Vector2Tuple } from 'three';

export const GAME_TITLE = 'FIRE FIGHT 2';

/**
 * Progression — the Bronze→Overlord ladder. XP is cumulative across every
 * mode (Aim Training, Quick/bot, Ranked) and only climbs; it sets the rank
 * badge (emblems in src/assets/ranks). A flat ~250-point ladder, Overlord at
 * 2000+. Skill rating (ELO) is separate and lives in the leaderboard.
 */
export const PROGRESSION = {
  // Tiers are paced in GAMES, not flat XP: an average real bout banks ~25 XP
  // (win 50 / loss 25), so the thresholds below land each rank at roughly —
  //   Silver 4 · Gold 16 · Plat 40 · Diamond 80
  //   Master 140 · Legendary 230 · Overlord 360   (games played)
  // Early ranks come quick; the climb stretches HARD toward Overlord. The old
  // curve (Overlord at 6750) fell over when the campaign landed — its short,
  // endlessly re-runnable titan bouts paid full match XP and everyone shot to
  // the top rank — so the top end is stretched AND campaign pays less (below).
  tiers: [
    { name: 'BRONZE', xp: 0 },
    { name: 'SILVER', xp: 100 },
    { name: 'GOLD', xp: 400 },
    { name: 'PLATINUM', xp: 1000 },
    { name: 'DIAMOND', xp: 2000 },
    { name: 'MASTER', xp: 3500 },
    { name: 'LEGENDARY', xp: 5750 },
    { name: 'OVERLORD', xp: 9000 },
  ],

  // A real 1v1: 25 to show up, +25 to win → 25 on a loss, 50 on a win.
  matchPlay: 25,
  matchWin: 25,
  // A completed Aim Training run banks a flat 25 (the run score still sets your
  // training-board best; it just doesn't scale the XP).
  trainingRun: 25,
  // Quick match vs the bot: a flat 25, win or lose.
  quickMatch: 25,
  // Arcade 2v2 / FFA: a flat 25 for taking part, win or lose.
  arcade: 25,
  // An ARCADE campaign titan bout: 10, win or lose — the FIRST time each titan
  // is felled it pays DOUBLE (see net/leaderboard.ts reportCampaign). Priced
  // BELOW a real bout on purpose: titan bouts are short and infinitely
  // re-runnable, and at full match rate they were an XP farm that carried the
  // whole town to Overlord.
  campaign: 10,
  // Graduating the tutorial (first completion only, win or lose): a warm
  // welcome-to-Gasket — more than a bout, not enough to skip earning.
  tutorial: 30,
};

/**
 * The iron-dollar currency — a riveted "$" earned at the SAME moments as XP
 * (every match, bot bout, arcade brawl and training run; see net/leaderboard).
 * A flat amount per completed game, win or loss, so the shop prices read as
 * round "games of play": a platform recolour or the GOLD RUSH premium pad
 * costs 10 games. The wallet itself lives in src/menu/wallet.ts (a
 * localStorage number shared by the arena and the pub, since both pages are
 * same-origin).
 */
/**
 * RANKED ladder points — the public face of the 1v1 ladder. Raw ELO stays a
 * HIDDEN matchmaking signal (it never shows anywhere); the board ranks LP:
 * wins pay (more against stronger rivals), losses nick a little back, and
 * nobody ever drops below zero — a ladder to climb, not a rating to fear.
 */
export const LADDER = {
  win: 20, // base LP per real 1v1 win
  loss: 8, // LP handed back on a real defeat (floored at 0 — never punitive)
  upsetDiv: 25, // hidden-ELO gap per bonus LP ((their elo − yours) / this)
  upsetMax: 10, // toppling a giant pays up to +this on top of the base
  upsetMin: -5, // farming rookies pays down to −this off the base
  botWin: 2, // token LP for a quick-match win over the bot
  // The brawl ladders (2v2 / FFA — no per-mode rating, so no upset math):
  brawlWin: 20, // 2v2 win
  ffaWin: 25, // an FFA win is one-in-four — it pays a little extra
  brawlLoss: 6, // either brawl's defeat, floored at 0
  /** SOFT RESET: a new season carries your final LP over — capped here, so
   *  the summit restarts within reach while the climb below survives. */
  seasonCarryCap: 2000,
  /** INACTIVITY: every full block of this many days without a ranked bout… */
  decayDays: 5,
  /** …hands back this much LP (applied lazily at login, floored at 0). */
  decayLp: 5,
};

/**
 * RANKED ladder SEASONS: LP banks into a per-season field and the board shows
 * the season in progress. When a season closes, finishers take a profile
 * trophy — 1ST / 2ND / 3RD for the podium, TOP 10 for 4–10, TOP 25 for 11–25
 * — and repeat honours stack (the chip shows ×N).
 */
export const SEASON = {
  /** Season 1 opened with the ladder itself. 90 days each, forever. */
  epochUtc: Date.UTC(2026, 6, 6), // Mon 6 Jul 2026
  lengthDays: 90,
};

/** The season in progress at `now` (1-based; never below 1). */
export function seasonIndex(now = Date.now()): number {
  return Math.max(1, 1 + Math.floor((now - SEASON.epochUtc) / (SEASON.lengthDays * 86_400_000)));
}

/** The player-doc field carrying a season's ladder points. */
export function seasonScoreField(idx: number): string {
  return `score_s${idx}`;
}

/**
 * THE PAINT (docs/paint.md) — the blank takes colour from placed stripes,
 * dots, squares and triangles alone. The palette INDEX is the wire value, so the roster
 * is append-only: never reorder, never remove, only add to the end.
 * Tiers by index: 0–7 the base rack, 8–19 the neon rack, 20–23 top shelf.
 */
export const PAINT = {
  /** Placed units per look — the cap IS the wire/moderation bound. */
  maxUnits: 64,
  /**
   * Paint canvas size per body part (px, square). The BODY is one surface
   * now (chest + pelvis merged), covering roughly twice the old chest's
   * arc — so it takes a bigger sheet to hold the same ink density. 768
   * lands near the old chest's ~1200 px/m rather than the pelvis's ~640;
   * drop it to 512 if a full club's textures ever cost more than the
   * paint is worth.
   */
  canvas: { head: 256, body: 768, gearHead: 256, gearBody: 256, gearHands: 128, gearHandsR: 128, hand: 256, handR: 256, gearFace: 384, gearShoulders: 256 } as Record<string, number>,
  /** Unit prices in coins; racks multiply (see tierOf). Paint is CHEAP —
   *  every unit lands between five and ten, under a game's pay, so a first
   *  paint job is an afternoon's idea and not a saving-up. DOTS are the
   *  cheapest geometry: a dot is the paint's atom. (The splotch is
   *  retired: owned ones became dots.) */
  price: { stripe: 8, dot: 5, square: 7, triangle: 6 },
  /** The biggest a unit can be sized in the bay (fraction of its part's
   *  canvas). Big enough for a sash across the chest, never a whole-body
   *  fill — the blank's silhouette stays the picture. */
  maxSize: 0.55,
  /** The most metal a PAINTED surface stays (avatar/paint.ts). A mirror
   *  finish has no diffuse to paint on, so a hand that carries units comes
   *  down to a satin metal; a surface already below this keeps its own
   *  finish, and a bare one is never touched. */
  metalness: 0.45,
  // The racks still cost more, but the top shelf no longer multiplies a
  // cheap unit back into an expensive one: a GOLD LEAF stripe is 32.
  // Base rack · neon rack · top shelf.
  tierMult: [1, 2, 4],
  /** Rack boundaries by colour index: 0–7 base, 8–19 neon, 20+ top. */
  tierOf: (colour: number): number => (colour < 8 ? 0 : colour < 20 ? 1 : 2),
  /** The sold colours. */
  colours: [
    // the base rack
    0xf4f2ee, 0x17171a, 0x8c1d18, 0xb35b1e, 0xc2a24b, 0x4f5d33, 0x24354f, 0x4a3524,
    // the neon rack
    0xffb02e, 0xff5a1f, 0xff2ad5, 0x4fb7ff, 0xb06bff, 0x8fff3d, 0x2be2c2, 0xff4f8e,
    0x9fdcff, 0xffe94a, 0x6fffb0, 0xe8352a,
    // the top shelf
    0xd8b24a, 0xe9e2f2, 0x050507, 0xc9d2dd,
  ],
  /** Colour NAMES, index-parallel to `colours` — the racks label their
   *  swatches with these. */
  colourNames: [
    'BONE WHITE', 'JET BLACK', 'OXBLOOD', 'RUST', 'BRASS', 'OLIVE DRAB', 'NAVY', 'UMBER',
    'AMBER', 'EMBER', 'HOT MAGENTA', 'CYAN', 'VIOLET', 'LIME', 'TEAL', 'PINK',
    'ICE BLUE', 'VOLT YELLOW', 'MINT', 'SIGNAL RED',
    'GOLD LEAF', 'PEARL', 'VOID BLACK', 'CHROME',
  ],
};

export const CURRENCY = {
  /** Coins banked per completed game (any mode, win or loss). */
  perGame: 10,
  /** RAVE RAID: a finished record pays the same flat coins as a bout, and
   *  a clean night pays a little on top — the one wallet, both games. */
  song: 10,
  songGrade: { S: 15, A: 10, B: 5 } as Record<string, number>,
  /** One-time graduation gift for finishing the tutorial — enough to feel
   *  the store's pull ('get yourself some drip') without skipping the grind. */
  tutorial: 50,
  /** THE HOUSE PAYS: a game called from the club floor — a record, a
   *  fight, a raid dealt by THE BELL — pays this on top of whatever the
   *  game itself paid, the moment you fold home to the floor. Turning up
   *  with people is worth REAL money: twice a game's own pay, so a night
   *  spent calling the ball outearns a night spent queueing alone. */
  bell: 20,
};

/**
 * THE NAME GIFT (net/gifts.ts): at midnight UK time, 27 Sep 2026, every
 * account that had swapped its IRON-XXXX callsign for a name of its own is
 * paid £10 worth of iron-dollars, once. £10 buys 3,337 at the STRONGBOX's
 * rate (3000 for £8.99) and 3,891 at the VAULT's (7000 for £17.99) —
 * 3,500 sits between. Only names typed before the hour count.
 */
export const RENAME_GIFT = {
  id: 'rename-2026-09',
  coins: 3500,
  /** 00:00 BST, 27 September 2026. */
  at: Date.parse('2026-09-27T00:00:00+01:00'),
};

/** What a finished record pays, by the night's grade (menu/wallet.ts). */
export function songCoins(grade: string): number {
  return CURRENCY.song + (CURRENCY.songGrade[grade] ?? 0);
}

/**
 * Where RAVE RAID lives: the third page (rave.html, src/rave/) — the
 * ARCADE tab's RAVE RAID button hops there, and its rail's FIRE FIGHT
 * entry hops back. Override with ?rave=<url>.
 */
export function raveUrl(): string {
  return new URLSearchParams(location.search).get('rave') ?? 'rave.html';
}

/**
 * Where the IRON BALLS CLUB social area lives. It builds side by side with
 * the arena in this same app (see vite.config.ts rollup inputs: pub.html),
 * so the lobby button is one page hop away. Override with ?pub=<url>.
 */
export function pubUrl(): string {
  return new URLSearchParams(location.search).get('pub') ?? 'pub.html';
}

/**
 * The player's octagonal dodge box, same footprint as Blaston's play-space
 * diagram: overall ~1.72 m wide x 1.5 m deep, with a 0.75 m straight
 * front/back edge and ~0.6 m chamfered corners. Vertices are listed clockwise
 * in the floor plane (x = left/right, z = forward/back, -z faces the opponent).
 */
export const OCTAGON_HALF_WIDTH = 0.86; // 1.72 m / 2
export const OCTAGON_HALF_DEPTH = 0.75; // 1.5 m / 2
export const EDGE_HALF = 0.375; // half of the 0.75 m straight edge
export const CHAMFER = 0.375; // corner inset, giving ~0.6 m diagonal segments

/** Octagon outline (clockwise), centred on the player rig at the origin. */
export const OCTAGON_VERTICES: Vector2Tuple[] = [
  [-EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-left
  [EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-right
  [OCTAGON_HALF_WIDTH, -CHAMFER], // right-front chamfer
  [OCTAGON_HALF_WIDTH, CHAMFER], // right-back chamfer
  [EDGE_HALF, OCTAGON_HALF_DEPTH], // back-right
  [-EDGE_HALF, OCTAGON_HALF_DEPTH], // back-left
  [-OCTAGON_HALF_WIDTH, CHAMFER], // left-back chamfer
  [-OCTAGON_HALF_WIDTH, -CHAMFER], // left-front chamfer
];

/**
 * FIXED FOVEATED RENDERING, 0..1. The headset renders the edges of your
 * vision — where your eye has no acuity anyway — at reduced resolution, and
 * hands the saved fill rate back. On a game this fill-bound (a raymarched gel
 * boss over passthrough) it is the cheapest GPU there is.
 *
 * This was 0 (full resolution everywhere), because at Quest's default of 1.0
 * the boundary between foveation regions shows as a head-locked dark band on
 * dark, high-contrast content. But 0 pays for that band at the FULL price of
 * peripheral pixels, and a frame that misses its deadline costs far more than
 * a seam: the headset reprojects the last frame to cover the miss, and every
 * time you turn your head the edges of your vision fall outside what was
 * rendered — your real room, showing through the sides of the arena.
 *
 * A third is the compromise the original note pointed at: most of the saving,
 * well short of the level that exposes the seam. If the band ever comes back,
 * this is the one number to turn down.
 */
export const FOVEATION = 0.33;

/**
 * Distance between the two pads, centre to centre. Blaston sits around 3.8 m;
 * boxing wants you closer, so the gap is tightened — punches connect faster
 * and dodges get twitchier.
 */
export const ARENA_GAP = 3.0;

/**
 * The fireball — the whole game. Two per player, one bonded to each fist.
 *
 *  - Hold the trigger and the ball ORBITS your fist, roaring hot.
 *  - Release the trigger mid-punch and it FLIES along your swing.
 *  - Pull the trigger while it's away and it RETURNS to your hand.
 */
export const FIREBALL = {
  radius: 0.09, // iron core radius (also the collision radius)
  damage: 20, // damage per landed hit — five clean hits is a knockout
  headDamage: 25, // clean headshots hit harder

  // Orbit (trigger held): the ball circles the fist.
  orbitRadius: 0.17, // distance from the fist while orbiting
  orbitSpeedMin: 6.0, // rad/s when the orbit starts
  orbitSpeedMax: 13.0, // rad/s after fully spun up
  orbitSpinUp: 1.2, // seconds of trigger-hold to reach max orbit speed

  // Hover (idle): the ball floats just over your knuckles.
  hoverOffset: [0, 0.05, -0.09] as [number, number, number], // grip-local
  hoverLerp: 14, // exponential smoothing rate toward the hover anchor

  // Throw (trigger released during a punch).
  minPunchSpeed: 1.1, // hand speed (m/s) below which a release just hovers
  throwSpeedMin: 4.2, // slowest launch — readable and dodgeable, Blaston-style
  throwSpeedMax: 8.5, // a genuinely fast haymaker
  punchGain: 1.7, // hand speed → ball speed multiplier
  aimAssist: 0.4, // 0..1 blend of your swing direction toward the opponent
  gravity: 1.1, // gentle arc so throws feel thrown, not shot
  lifetime: 3.0, // seconds of flight before the ball dies out

  // Recall (trigger pulled while the ball is away).
  returnSpeed: 9.5, // homing speed back to the fist
  catchRadius: 0.16, // how close counts as "back in hand"
  nearHandRadius: 0.35, // trigger within this of the ball = orbit, not recall
  recallLockout: 0.5, // seconds a spent ball must cool before it can be recalled

  // Defence: an orbiting or returning ball of YOURS knocks an incoming
  // enemy ball out of the air on contact.
  deflectBonus: 0.05, // extra contact radius for the parry check
};

/**
 * Curveball tuning (the per-fist CURVE loadout toggle) — ONE source shared by
 * the arena (FireballSystem) and the pub fight hall (FightSystem), which used
 * to carry drifting private copies. The raw swing turn-rate (rad/s, read off
 * the punch's curvature) is scaled by `gain` above the `min` dead zone and
 * capped at `max`; in flight the velocity rotates about the curl axis while
 * the rate decays at `decay`/s — bank hard off the fist, straighten downrange.
 *
 * These are the numbers the curve had before the 25 Jul retune, restored on
 * request. That retune traded reach for aimability and the trade was not
 * wanted: it cut the ceiling from 5.0 rad/s to 2.0 and more than doubled the
 * decay, which together took roughly four fifths of the bend out. What comes
 * back with them is a curve that keeps turning the whole way down the gap —
 * a hard hook can bend most of the way round rather than arriving on a
 * readable heading. That is the shape of the throw as it was.
 *
 * The one thing NOT restored is the duplication: the mapping lives here, in
 * curlRateFor, instead of being reimplemented on both sides, which is how the
 * arena and the pub drifted apart in the first place.
 */
export const CURL = {
  min: 1.8, // rad/s dead zone: below this the punch is "straight" → no curve
  gain: 1.6, // applied to the swing rate ABOVE the dead zone
  max: 5.0, // rad/s after gain — the hardest hook the ball will bite into
  decay: 1.4, // per second — lower = the bend carries further downrange
  // Curve only really bites on a committed, WIDE swing — small movements are
  // too jittery to read a clean arc, so it ramps in with hand speed (m/s).
  speedMin: 2.2, // below this swing speed → essentially no curve
  speedFull: 4.0, // at/above this → full curve
  /** Curl rate (rad/s) above which a throw FEELS curved — gates the whip-crack
   *  launch sfx, the harder haptic and the corkscrew trail. */
  feelMin: 0.5,
};

/**
 * The curl rate (rad/s) a throw earns: the swing's raw turn rate above the
 * dead zone, scaled by `gain`, capped at `max`, and ramped in linearly with
 * how committed the swing was. `strength` is the player's CURVE STRENGTH
 * dial (0.1..1, ADVANCED face of the loadout panel) — it scales the whole
 * result, so the feel gates (sfx/haptics/trail) follow it for free.
 */
export function curlRateFor(raw: number, handSpeed: number, strength = 1): number {
  const speedK = Math.max(0, Math.min(1, (handSpeed - CURL.speedMin) / (CURL.speedFull - CURL.speedMin)));
  return (raw <= CURL.min ? 0 : Math.min(CURL.max, (raw - CURL.min) * CURL.gain)) * speedK * strength;
}

/**
 * Per-ball attachments (the BALL LOADOUT panel). Each of your two balls can
 * carry one. The effect fires the instant you RECALL a still-FLYING ball — a
 * dead ball on the floor returns plain — and lasts only until you catch it,
 * after which the ball is normal again. Grow/shrink scale with the recall
 * distance: the farther out the ball was when you pulled it back, the bigger
 * the swing, up to the caps below. Split is a fixed fan of three.
 */
export const ATTACH = {
  none: 0,
  split: 1,
  grow: 2,
  shrink: 3,
  /**
   * Recall distance (m) at which SHRINK reaches its full size/damage swing —
   * set FAR out (past how deep a ball usually survives) so the effect ramps
   * very gradually with travel: you need close to the longest possible shot —
   * the ball sailing deep toward the back cage — to approach the max.
   */
  fullRange: 14.0,
  /** GROW ramps over its OWN, much shorter distance — it's the spectacle
   *  attachment, so a normal recall (~3 m out) already comes back visibly
   *  swollen and a long throw hits the cap well before the back cage. */
  growRange: 7.0,
  growSize: 3.5, // up to 3.5x size on a long recall
  /** A recalled grow ball doesn't snap to size — it SWELLS toward its target
   *  over this many seconds of the return flight, so you watch it balloon. */
  growSwellTime: 0.5,
  shrinkSize: 1 / 3, // down to a third of the size on a long recall
  damageSwing: 10, // ±10 damage at full range
  splitCount: 3, // total balls a split becomes
  splitSize: 0.62, // each shard's size vs a normal ball
  splitSpread: 0.26, // lateral fan radius (m) mid-return
  splitSpreadRange: 1.4, // distance (m) over which the fan collapses to the hand
} as const;

/** Combat tuning: health pools shared by the IK body parts. */
export const COMBAT = {
  playerHealth: 100,
};

/**
 * The invisible cage around the whole arena: a wall ~10 yards (9.1 m) out
 * from each platform's rim on every side, plus a ceiling. A flying ball that
 * reaches it bursts against it and drops dead there — fire never sails off
 * into your real room forever.
 */
export const ARENA_BOUNDS = {
  halfWidth: OCTAGON_HALF_WIDTH + 9.1, // left/right of both platforms
  zBack: OCTAGON_HALF_DEPTH + 9.1, // behind YOUR platform (+z)
  zFront: -ARENA_GAP - OCTAGON_HALF_DEPTH - 9.1, // behind THEIR platform (−z)
  ceiling: 9.0,
};

/**
 * Head-driven IK body. The hitbox is not one sphere — it is a spine solved
 * each frame from the tracked head down to pinned hips, with three hitbox
 * spheres along it. Leaning/ducking the head swings the torso, so dodging is
 * a whole-body act. Radii in metres; `hipHeight` is the pinned pelvis height.
 */
export const BODY_IK = {
  hipHeight: 0.95,
  /** Fraction along hips→head where the chest sphere sits. */
  chestAlong: 0.55,
  /**
   * How far the spine hangs BEHIND the head along its yaw — your face sits
   * forward of your spine. Looking down you see the front of your chest,
   * not the base of your own neck, and the torso stops blocking your view
   * of the ball at your fists.
   */
  spineSetBack: 0.16,
  headRadius: 0.13,
  chestRadius: 0.2,
  pelvisRadius: 0.17,
};

/**
 * The practice bot: an iron boxer that bobs, weaves and throws fireballs.
 * These are the FIXED numbers — body geometry, the guard, the beats every
 * rank shares. Everything that gets sharper with rank (cadence, speed, aim,
 * reactions, footwork) lives on BOT_LADDER below, one row per rank.
 */
export const BOT = {
  headY: 1.45, // relaxed head height
  headYMin: 1.0, // deepest duck
  headYMax: 1.62, // tallest stand
  padHalfWidth: 0.7, // lateral roaming range on its pad (a row's `roam` scales it)
  headPitchMax: 0.32, // radians the head tilts up/down to track you — no owl-necking
  headTurnSpeed: 8, // how fast the head eases toward facing you

  // --- defence: an incoming ball triggers ONE decision per approach ---
  blockHold: 0.55, // seconds the guard hand stays up
  blockReach: 0.5, // how far ahead of the head the guard hand plants
  decideEvery: 0.7, // seconds between threat decisions (one per approach)

  // --- offence: a low throw's target ---
  lowAimDrop: 0.62, // metres below the head a low throw aims (the pelvis line)

  // --- the brain's fixed beats (the per-rank numbers live in BOT_LADDER) ---
  dodgeBurst: 0.4, // seconds a dodge moves at burst speed
  dodgeBurstGain: 1.6, // × moveSpeed / duckSpeed while a dodge is fresh
  feintHold: 0.5, // extra seconds a FEINT holds the wind-up past its beat
  doubleTapGap: 0.3, // seconds between the fists of a DOUBLE TAP
  punishFuse: 0.12, // how fast a PUNISH throw comes once your fists are empty
  headLagWindow: 0.6, // seconds of your head's trail the bot remembers (aimLag)
};

/**
 * THE BOT LADDER — one brain per Bronze→Overlord rank. A bot bout reads the
 * player's cumulative XP (the same number that sets their badge), finds their
 * tier, and blends the rows either side of it by how far through the tier
 * they are, so the sparring partner gets steadily sharper as they climb —
 * no cliff at a promotion. Beginners face a ROOKIE that throws slow, aims
 * where you WERE, notices fire late and often just watches it land; the
 * OVERLORD leads your head, punishes empty fists, feints, double-taps and
 * dodges before the ball has left your hand. The tutorial always spars the
 * ROOKIE. See combat/botBrain.ts (the blend) and systems/BotSystem.ts (the
 * behaviour each number drives).
 *
 *  label         : the bot's title on the bout panel ("contender · gold grade").
 *  throwInterval : seconds between throws.
 *  windup        : seconds the ball orbits (the tell) before it leaves.
 *  throwSpeed    : m/s; your own throws run 4.2–8.5.
 *  aimError      : metres of slop at the target.
 *  aimLag        : seconds behind your head it aims — rookies throw at your ghost.
 *  lead          : 0..1 how much it aims where your head is GOING (flight-time lead).
 *  lowAimChance  : base odds a throw hunts the lower body.
 *  readsHabits   : 0..1 how much lowAimChance bends toward where you actually sit
 *                  (a ducker starts eating pelvis-line balls).
 *  reactDistance : metres out it notices an incoming ball.
 *  reactDelay    : seconds it hesitates before acting on one.
 *  defendChance  : odds it does anything at all about a noticed ball.
 *  blockChance   : of those, odds it raises a GUARD rather than dodging.
 *  wrongWayChance: odds a dodge goes INTO the ball (rookie footwork).
 *  moveSpeed / duckSpeed : m/s strafe and bob.
 *  restless      : × how often it re-picks a spot on its pad.
 *  roam          : 0..1 of the pad's width it actually uses.
 *  preDodge      : odds it steps as soon as you SPIN UP, before the ball leaves.
 *  punish        : odds it fires the instant BOTH your fists are empty.
 *  feint         : odds a wind-up holds past its beat before releasing.
 *  doubleTap     : odds the other fist follows a throw within a beat.
 *  recallDelay   : seconds after a throw before it recalls the ball.
 */
export interface BotLadderRow {
  label: string;
  throwInterval: number;
  windup: number;
  throwSpeed: number;
  aimError: number;
  aimLag: number;
  lead: number;
  lowAimChance: number;
  readsHabits: number;
  reactDistance: number;
  reactDelay: number;
  defendChance: number;
  blockChance: number;
  wrongWayChance: number;
  moveSpeed: number;
  duckSpeed: number;
  restless: number;
  roam: number;
  preDodge: number;
  punish: number;
  feint: number;
  doubleTap: number;
  recallDelay: number;
}

/** Index-aligned with PROGRESSION.tiers (row 0 = BRONZE … row 7 = OVERLORD). */
export const BOT_LADDER: BotLadderRow[] = [
  // BRONZE — the ROOKIE: slow, sloppy, throws at where you were, watches most fire land.
  { label: 'ROOKIE', throwInterval: 3.4, windup: 1.1, throwSpeed: 3.4, aimError: 0.36, aimLag: 0.4, lead: 0, lowAimChance: 0.2, readsHabits: 0, reactDistance: 1.0, reactDelay: 0.45, defendChance: 0.4, blockChance: 0.05, wrongWayChance: 0.3, moveSpeed: 0.9, duckSpeed: 1.4, restless: 0.5, roam: 0.35, preDodge: 0, punish: 0, feint: 0, doubleTap: 0, recallDelay: 2.0 },
  // SILVER — the SPARRER: a little quicker, starts to sidestep on purpose.
  { label: 'SPARRER', throwInterval: 3.0, windup: 0.95, throwSpeed: 3.8, aimError: 0.3, aimLag: 0.3, lead: 0.1, lowAimChance: 0.25, readsHabits: 0.1, reactDistance: 1.2, reactDelay: 0.35, defendChance: 0.55, blockChance: 0.1, wrongWayChance: 0.22, moveSpeed: 1.1, duckSpeed: 1.7, restless: 0.7, roam: 0.45, preDodge: 0.1, punish: 0, feint: 0, doubleTap: 0, recallDelay: 1.8 },
  // GOLD — the CONTENDER: aims true more often, first hints of a punish.
  { label: 'CONTENDER', throwInterval: 2.5, windup: 0.8, throwSpeed: 4.2, aimError: 0.22, aimLag: 0.2, lead: 0.25, lowAimChance: 0.3, readsHabits: 0.25, reactDistance: 1.5, reactDelay: 0.25, defendChance: 0.7, blockChance: 0.2, wrongWayChance: 0.14, moveSpeed: 1.4, duckSpeed: 2.0, restless: 0.9, roam: 0.6, preDodge: 0.25, punish: 0.15, feint: 0, doubleTap: 0.05, recallDelay: 1.6 },
  // PLATINUM — the BRUISER: FIRE FIGHT 1's original practice bot, near enough.
  { label: 'BRUISER', throwInterval: 2.1, windup: 0.7, throwSpeed: 4.65, aimError: 0.15, aimLag: 0.12, lead: 0.4, lowAimChance: 0.38, readsHabits: 0.4, reactDistance: 1.7, reactDelay: 0.16, defendChance: 0.8, blockChance: 0.3, wrongWayChance: 0.08, moveSpeed: 1.6, duckSpeed: 2.3, restless: 1.0, roam: 0.75, preDodge: 0.4, punish: 0.3, feint: 0.08, doubleTap: 0.12, recallDelay: 1.4 },
  // DIAMOND — the VETERAN: leads your head, reads your ducking, feints.
  { label: 'VETERAN', throwInterval: 1.85, windup: 0.62, throwSpeed: 4.9, aimError: 0.1, aimLag: 0.06, lead: 0.55, lowAimChance: 0.42, readsHabits: 0.55, reactDistance: 1.95, reactDelay: 0.1, defendChance: 0.88, blockChance: 0.36, wrongWayChance: 0.04, moveSpeed: 1.8, duckSpeed: 2.5, restless: 1.15, roam: 0.85, preDodge: 0.55, punish: 0.5, feint: 0.15, doubleTap: 0.22, recallDelay: 1.25 },
  // MASTER — the ACE: fast hands, a wall of a guard, double-taps.
  { label: 'ACE', throwInterval: 1.65, windup: 0.55, throwSpeed: 5.15, aimError: 0.07, aimLag: 0.03, lead: 0.7, lowAimChance: 0.45, readsHabits: 0.7, reactDistance: 2.2, reactDelay: 0.06, defendChance: 0.93, blockChance: 0.42, wrongWayChance: 0.02, moveSpeed: 2.0, duckSpeed: 2.7, restless: 1.3, roam: 0.92, preDodge: 0.68, punish: 0.65, feint: 0.22, doubleTap: 0.32, recallDelay: 1.1 },
  // LEGENDARY — the CHAMPION: moves before you throw, punishes every empty fist.
  { label: 'CHAMPION', throwInterval: 1.5, windup: 0.48, throwSpeed: 5.45, aimError: 0.05, aimLag: 0.01, lead: 0.82, lowAimChance: 0.45, readsHabits: 0.85, reactDistance: 2.45, reactDelay: 0.03, defendChance: 0.96, blockChance: 0.47, wrongWayChance: 0.01, moveSpeed: 2.15, duckSpeed: 2.85, restless: 1.45, roam: 0.97, preDodge: 0.78, punish: 0.8, feint: 0.3, doubleTap: 0.45, recallDelay: 1.0 },
  // OVERLORD — the OVERLORD: the ceiling. Still slower than your hardest haymaker.
  { label: 'OVERLORD', throwInterval: 1.35, windup: 0.42, throwSpeed: 5.8, aimError: 0.03, aimLag: 0, lead: 0.92, lowAimChance: 0.45, readsHabits: 1.0, reactDistance: 2.7, reactDelay: 0.02, defendChance: 0.98, blockChance: 0.5, wrongWayChance: 0, moveSpeed: 2.3, duckSpeed: 3.0, restless: 1.6, roam: 1.0, preDodge: 0.85, punish: 0.9, feint: 0.35, doubleTap: 0.55, recallDelay: 0.9 },
];

/**
 * MERCY — the in-bout comeback ease for the lower ranks. Every round the
 * player is BEHIND by (rounds lost minus rounds won) softens the bot's skill
 * by `perRound`, capped at `max`; win a round back and it firms up again.
 * Only below tier `belowTier` (DIAMOND and up get the bot they earned), never
 * in the tutorial, never under a dev override.
 */
export const BOT_MERCY = {
  perRound: 0.07,
  max: 0.2,
  belowTier: 4,
};

/**
 * ARCADE CAMPAIGN — the titan gauntlet. Five bosses, each bigger than the
 * last; they never throw fireballs. Instead they wind up melee and ranged
 * strikes whose kill zones charge up visibly ON YOUR PLATFORM — read the
 * floor, move, and punish the weak points that open up after their attacks.
 * Dark-souls pacing on a two-metre stage. Per-boss numbers (and each titan's
 * signature mechanic) live in campaign/bosses.ts.
 */
export const CAMPAIGN = {
  stages: 5,

  // Intro staging: klaxon + strobes, the titan rises, the title card, FIGHT.
  klaxonTime: 1.2, // warning strobes before anything moves
  riseTime: 2.6, // seconds the titan takes to surface
  titleTime: 2.4, // name card + roar hold
  fightCardTime: 0.9, // the FIGHT flash before the bell

  attackDamage: 20, // every landed titan strike is 20 — same law as fireballs
  victoryDelay: 8, // seconds of collapse + payout card before the line-up
  defeatDelay: 5, // seconds of SCRAPPED card before the line-up

  // Weak-point law (Hitbox.damageScale): armour clanks; whatever BLINKS is
  // live. Each titan opens its points its own way (BossDef.weakPattern):
  // both at once, alternating, two-hits-then-swap, or the three-point cycle
  // that ends in the low blow.
  headScale: 1.5,
  coreScale: 2.0,
  lowScale: 2.0, // the low blow — hard to hit, pays like the core
  podScale: 1.5,

  // GOLIATH's crown circuit: five stops (head → right shoulder → core →
  // left shoulder → low) walked this many full loops to kill. The health
  // bar steps down one notch per ring hit, so the count is exact whatever
  // the ball's damage.
  crownLoops: 3,
  // Each completed loop multiplies GOLIATH's attack cooldowns by this.
  crownHaste: 0.85,
  /**
   * GOLIATH's SECOND LIFE on BLAZING drops its ghost hammers this much
   * slower. His slam windup is the tightest in the game (1.15 s squeezed to
   * ~0.98 by the blazing charge multiplier), and the hammer's descent eases
   * IN — it covers three quarters of its drop in the back half of the
   * countdown — so the phase-2 slam was landing before it could be read.
   * Only the SLAM windup stretches, and only in phase 2: the relentless
   * enraged cadence that makes the second life what it is stays untouched.
   */
  phase2SlamCharge: 1.12,

  // The NOVA (GOLIATH only): fire floods the whole platform except one safe
  // wedge — run to the marked ground. Wedge half-width in radians (narrower
  // once enraged).
  novaRadius: 1.15,
  novaHalfAngle: 0.52,
  novaEnragedHalfAngle: 0.4,

  // Strike-zone geometry defaults (per-boss defs tune sizes/cadence).
  // Floor decals hover HERE, clear of the deck furniture — the rim glow bars
  // top out near 0.032 and the corner bolts near 0.035, so anything lower
  // reads as "under the platform" and the warning goes unseen.
  decalY: 0.05,
  slamRadius: 0.32, // tight discs — a slam threatens a spot, not half the pad
  /** Ceiling on the slam disc no matter how big the titan grows — the last
   *  two bosses (and every raid giant) were dropping discs that swallowed
   *  the platform; past this size a slam stops being dodgeable. */
  slamRadiusMax: 0.36,
  slamImpactDelay: 0.14, // a breath of extra hang before the fist lands — a fairer dodge
  beamHalfWidth: 0.22,
  sweepThickness: 0.19, // half-height of the horizontal blade slice

  // Signature-mechanic tuning (which titans use which lives in bosses.ts).
  rehitDelay: 0.85, // seconds between a rehit slam's two detonations
  marchStep: 0.6, // metres between marching slam discs
  marchDelay: 0.55, // seconds between marching detonations — the drumbeat
  beamLockAt: 0.72, // tracking beams freeze at this charge fraction
  // The VOLLEY: shoulder pods spool up, then hurl fireballs straight at you
  // — the one titan attack you can BLOCK: put a fist in its path.
  volleySpeed: 4.2, // projectile speed (m/s) — roughly a one-second flight
  volleyInterval: 0.45, // seconds between shots in a volley
  volleyBlockRadius: 0.32, // a fist this close deflects the shot
  volleyHitRadius: 0.22, // shot core radius vs your body spheres
  // Enrage compresses the GAPS, never the reads: the windup/telegraph length
  // is sacred (a late-fight laser must stay as dodgeable as the first one),
  // so an enraged boss only attacks sooner — and now noticeably sooner, to
  // keep enrage meaning something without the old charge squeeze.
  enrageCooldownMult: 0.55,

  // THE GAUNTLET RUN — all five back to back, unlocked once all are felled.
  // The clock only counts fight time, so intros/collapses cost you nothing.
  runIntro: { klaxon: 0.5, rise: 1.4, title: 1.3, fightCard: 0.6 },
  runVictoryDelay: 3.2, // collapse pause between bosses mid-run
  leaderboardSize: 5, // times kept per mode (gauntlet / hardcore)
};

/**
 * THE DELIVERY — the titan THROWS the hit. A floor zone used to charge on
 * your deck and then simply go off; now the blow leaves the striking fist
 * (or both, for the nova's coil) as a fire bolt that lands ON THE BEAT the
 * zone detonates, always somewhere inside the danger — never on the safe
 * ground — while the whole chassis lunges in behind it. Purely visual: the
 * zones, their timing and their judge are untouched, so every read and
 * every dodge is exactly as fair as before (campaign/delivery.ts).
 */
export const DELIVERY = {
  travel: 0.36, // seconds from fist to floor — launches this long before the zone is due
  raidTravelMult: 1.4, // the raid pit is twice as far out; a longer throw keeps it a throw
  arcLift: 0.22, // how high the lob bows over its straight line, per metre travelled
  boltSize: 0.5, // glow sprite size (m) of the bolt's halo
  lunge: 0.2, // how far the chassis steps in on a throw, per unit of titan scale…
  lungeMax: 0.55, // …capped (m), so GOLIATH's step doesn't swallow the gap
  lungeTime: 0.6, // seconds for the whole step: in fast, hold, settle back
  // GOOPLIATH throws nothing: every beat HEAVES his whole body toward the
  // part of your deck about to burn, sinking into it, the gel shuddering.
  gooSurge: 0.8, // the heave's cap (m) — he's the one boss who moves that far
  gooDip: 0.06, // how far he sinks into each heave, per unit of his scale
  gooShudder: 0.55, // the gel's agitation kick on each beat (0..1)
  gooSway: 1.3, // his sideways rock per metre the beat's mark sits off his line to you…
  gooSwayMax: 0.65, // …capped (m)
  gooBlood: 0xff3b2e, // the enraged gel's colour (matches his HUD accent)
  gooHaft: 0.07, // the gel sweep's tendril radius (m) — fatter than a titan's haft
};

/**
 * THE MOVE GRAMMAR — tuning for the ENCORE campaign's RAVE RAID vocabulary
 * (campaign/grammar.ts; DESIGN.md §4). The numbers are RAVE RAID's own
 * (dance/src/config.ts CHOREO), proven on the same octagon deck; distances
 * in metres, cascades in GRAMMAR BEATS (each Encore titan carries its own
 * `beat` seconds — its pulse). Chance tables index by escalation act 0..4.
 */
export const GRAMMAR = {
  /** Laser lanes: strip half-width, the three SLOTS a single lands on, the
   *  SPLIT pair's offset, the TWIN's inner edge, THE X's thin arms. */
  laneHalfWidth: 0.24,
  laneSlots: [-0.42, 0, 0.42],
  laneSplitX: 0.5,
  laneTwinInner: 0.12,
  laneSplitChance: [0.4, 0.36, 0.42, 0.36, 0.34],
  laneXChance: [0, 0, 0.24, 0.28, 0.32],
  laneXHalfW: 0.14,
  /** THE BOUNCE: whether a twin answers, whether it comes back, the beat
   *  gap between volleys, the chain cap, and the act from which the full
   *  three-volley rally is a promise rather than a coin. */
  twinReturnChance: [0, 0.45, 0.85, 0.9, 0.94],
  twinBounceChance: [0, 0.45, 0.85, 0.95, 0.98],
  twinReturnBeats: 4,
  twinChainMax: 3,
  twinAlwaysFromAct: 3,
  /** THE WAVE: the four stops per axis, march step per act, the breather at
   *  the wheel, and blazing's third-leg coin. */
  waveLaneX: [-0.645, -0.215, 0.215, 0.645],
  waveRailZ: [-0.56, -0.19, 0.19, 0.56],
  waveStepBeats: [2, 2, 1, 1, 1],
  waveTurnExtraBeats: 1,
  waveThirdChance: 0.3,
  /** THE RECITAL: steps per act (moves and holds together), the odds a
   *  step is a HOLD (stay where you are — the blue cue), beats per taught
   *  step in THE LESSON and the pause after it, beats step-to-step in the
   *  recital, how many beats before a landing its note sounds, how many
   *  beats the blocks visibly fall (short: the note is the warning, the
   *  drop only confirms it), the commitment margin past the quarter lines,
   *  and the per-fight swept coin. */
  recitalSteps: [3, 3, 4, 5, 5],
  recitalHoldChance: [0.25, 0.3, 0.35, 0.4, 0.4],
  recitalLessonBeats: 1.6,
  recitalPauseBeats: 1.5,
  recitalStepBeats: 2.5,
  recitalCueBeats: 1.5,
  recitalDropBeats: 0.7,
  recitalMargin: 0.08,
  recitalSweepChance: 0.12,
  /** THE DONUT: safe-disc radii (blazing holds the tight disc all night),
   *  the one-two's opening-laser odds and follow gap. */
  donutInnerR: 0.42,
  donutInnerRLate: 0.34,
  donutInnerRExpert: 0.3,
  donutRadius: 1.15,
  donutFollowBeats: 4,
  donutOpenChance: 0.7,
  /** CROSSFIRE rails: strip half-depth, single-rail offsets (front half
   *  only), THE TRAP's odds + symmetric offset, the vertical twin's odds +
   *  inner edge, and the act the lattice lane joins from. */
  railHalfDepth: 0.2,
  railOffsetMin: 0.12,
  railOffsetMax: 0.42,
  railTrapChance: [0, 0, 0.35, 0.5, 0.5],
  railTrapZ: 0.44,
  railTwinChance: [0, 0, 0.4, 0.72, 0.8],
  railTwinInner: 0.11,
  latticeFromAct: 2,
  /** The gate: safe-band half-widths by act and the offset floor (the gap
   *  never offers the middle of the deck). */
  gateHalfW: 0.3,
  gateHalfWLate: 0.22,
  gateHalfWExpert: 0.2,
  gateOffsetMin: 0.22,
};

/**
 * RAID — the 2–5 player group campaign. Same five titans as the gauntlet but
 * built for a SQUAD: bigger, far tougher, attacks split across up to five
 * platforms, and GOLIATH does not stay down. The host runs the boss (attack
 * picks, health, weak-point pattern) and echoes state; every client renders
 * every attack and judges only the strikes aimed at ITS OWN platform. The
 * boss's pools and cadence scale with the raider count SNAPSHOT at launch
 * (app.raidSize) — a mid-run disconnect never shrinks a boss.
 */
export const RAID = {
  /** A raid can launch short-handed once this many raiders are seated. */
  minRaiders: 2,
  /** Raid titans are ALL giants: every stage starts at solo GOLIATH's size and
   *  grows this much per stage beyond it (stage 0 = GOLIATH-sized RUSTHOOK,
   *  final-stage GOLIATH ~1.5x his solo self). */
  scaleStageStep: 0.13,
  /** Volley shots fly this much faster in a raid — the pit is twice as far
   *  out (RAID_RING_RADIUS), so this keeps the flight time near the solo
   *  ~one-second beat instead of a lazy lob. */
  volleySpeedMult: 1.5,
  /** Weak-point spheres grow this much in a raid. The titan squares up to
   *  its CURRENT target, so a side seat plays the whole fight at an angle —
   *  the extra bulge is what keeps their hits landing past the armour. */
  weakMult: 1.25,
  /** Boss health multiplier PER RAIDER — the pool is this × the launch
   *  squad size, so time-to-kill holds steady from 2 up to 5 fists. A
   *  4-squad lands on 4.6 — the original "four raiders, and then some". */
  healthPerRaider: 1.15,
  /**
   * Attack cadence multiplier PER STAGE, tuned to how many raiders each
   * swing marks: stage I rotates ONE target (so it swings fast to keep the
   * squad honest), stage II marks TWO, stage III+ mark EVERYONE — the pace
   * eases back toward solo, because now every raider dodges every swing.
   */
  cooldownMult: [0.62, 0.72, 0.9, 0.92, 0.88],
  /** Charge-time multiplier — slightly snappier telegraphs. */
  chargeMult: 0.92,
  /**
   * Small-squad mercy on the cadence: `cooldownMult` is tuned for four
   * raiders sharing the heat, so each missing raider below four eases the
   * cooldown scaling this far back toward solo pace (capped at 0.6 — a duo
   * still fights a RAID titan, just not one swinging four players' worth).
   */
  cooldownEase: 0.3,
  /** Seconds between blade landings as a squad sweep cascades around the
   *  arc — one continuous spinning cut, platform after platform. */
  sweepCascade: 0.12,
  /** The titan's full-turn lash while a squad sweep detonates (rad/s). */
  sweepSpinRate: 11,
  /** A SQUAD volley is a BARRAGE: this many rounds of fire, one shot per
   *  marked raider each round — so a four-strong squad eats ~this×4 balls. */
  volleySquadRounds: 6,
  /** Rounds hammer out this fast in a squad barrage (shorter than the solo
   *  volley interval — it's a storm, not a metronome). */
  volleySquadInterval: 0.34,
  /** GOLIATH's crown ring stops take this many hits each in a raid (a squad
   *  shreds single-hit stops too fast). */
  crownPerStop: 2,
  /** The DECREE — GOLIATH's raid-only GROUP attack: novas bloom on EVERY
   *  platform at once around one shared canonical bearing, so the whole squad
   *  must rotate to the same compass point together. */
  decreeWeight: 4, // vs his other attacks once it unlocks
  decreeCharge: 2.9, // seconds — the longest windup in the game
  /** THE RESURRECTION (raid GOLIATH only) — beats in seconds:
   *  fallen still → a shake → he rises over `riseTime` while his health bar
   *  refills, timed so the fight resumes ON the drop of the bespoke track. */
  resStillTime: 3.0,
  resShakeTime: 1.4,
  resRiseTime: 6.0,
  /** Phase 2: the crown walked in REVERSE, this many loops, enrage locked on.
   *  MUST be at least CAMPAIGN.crownLoops (phase 1 = 3) or the second life dies
   *  FASTER than the first — GOLIATH's bar steps down 1 notch per crown hit, so
   *  fewer loops = fewer required hits = bigger chunk per hit. At 3 it matches
   *  phase 1's 30 crown hits, and with enrage cadence + the reversed crown walk
   *  the second life plays harder overall (was 2 → died 33% quicker). */
  phase2Loops: 3,
  /** Host state-echo cadence (seconds). */
  stateEcho: 0.3,
};

/**
 * GOOPLIATH — the living tide. The gel creature from GOOP (vendored under
 * src/goopliath/) blown up to titan scale and dropped into the pit as its own
 * boss fight, separate from the titan gauntlet: a campaign entry beneath the
 * line-up (sealed until all five titans are felled) and a raid lobby breaker
 * that swaps the whole run for one long fight against him.
 *
 * Unlike the titans there are NO weak points — his whole body is the hitbox
 * (every fireball that finds the gel counts), and the fight is scored in HITS,
 * not damage: the health bar is a hit counter. The gel sim runs at its native
 * man-size inside a scaled parent group, so every dent/lump/wobble keeps the
 * exact proportions of the original creature.
 */
export const GOOPLIATH = {
  /** The DEDICATED fight's hit pools, hand-set PER PAIR OF FISTS for every
   *  tier (solo takes one pool; a raid takes the pool × squad, so each
   *  raider's share matches the solo fight). Deliberately short across the
   *  board — the tier dressing (extra beams / volleys / seesaw rocks)
   *  carries the danger, not a wall of hits. */
  hitsEasy: 25,
  hitsCampaign: 35,
  hitsCampaignHard: 40,
  hitsCampaignBlazing: 50,
  /** The blazing run's WEDGE stage (2nd-to-last boss): one stage of six, so
   *  it runs shorter than even the dedicated fight. */
  hitsRunWedge: 45,
  /** Raid fallback PER RAIDER (the dedicated raid always lands on the tier
   *  pools above — this only seeds goopliathBoss's base def). */
  hitsPerRaider: 50,
  /** Body size in TITAN scale units (duel boxer ≈ 1); world height is this
   *  times titanHeightPerScale, so campaign is ~4.15 m of gel across the duel
   *  gap and the raid cut a third taller again for the wide ring.
   *
   *  Trimmed back from GOLIATH's 2.65 (~4.9 m): the gel shader is fill-rate
   *  bound and its cost scales with his PROJECTED AREA, so taking ~15% off
   *  his height takes ~28% off the frame time he costs — the single biggest
   *  lever on this fight, worth more than everything in the raymarch put
   *  together. It costs nothing in danger: the floor zones carry the threat
   *  and they are platform-relative, and his swings are capped at
   *  gestureReach BODY-units so they shrink with him and still land where
   *  they always did. */
  scaleCampaign: 2.25,
  scaleRaid: 2.93,
  /** Titan rigs stand ~1.85 m per scale unit; the gel sim is 1.78 m tall at
   *  native size — this converts def.scale into the parent group's scale. */
  titanHeightPerScale: 1.85,
  /** The sim's clock runs this much slower than real time — a 4-5x giant
   *  jiggling at man-sized frequency reads as a miniature; slowed, the same
   *  dynamics read as tons of gel in motion. (Sounds stay real-time.) */
  timeScale: 0.55,
  /** Raymarch quality override (1 = the full step budget) — 13 steps. The gel
   *  shader is fill-rate bound and a boss this size covers a LOT of Quest
   *  pixels. Was 0.72/16 steps: the over-relaxed march (see MARCH in
   *  goopConfig) reaches further per step and no longer punches see-through
   *  holes when it runs short, so the budget buys surface precision now
   *  rather than basic correctness. Verified hole-free down to 8. */
  quality: 0.6,
  /** Step budget while an attack is mid-swing — 9 steps. The old reason for
   *  this dip was that an extended limb stretched the march's bounding box
   *  across far more of the view; the march is bounded by his blob spheres
   *  now, so a limb only costs its own pixels and this is a plain quality
   *  trade. Kept (and lowered) because a swing is the busiest the frame ever
   *  gets — and because it was the swing budget that used to tear the hole
   *  under his fists, which it no longer can. */
  attackQuality: 0.4,
  /** How far his gesture swings extend, in body-scale units from his centre.
   *  He never needs to reach the player's platform — the floor zones carry
   *  the danger — and the swing must stay basically WITHIN his silhouette:
   *  any limb stretched toward the player drags the raymarch's bounding box
   *  (and the frame time) across the view with it. The wind-up pose is the
   *  telegraph; the strike is a tight body-local snap. */
  gestureReach: 0.5,
  /** How hard a landed ball physically works the gel, relative to a GOOP
   *  fist: >1 shoves the blobs harder and carves wider/deeper craters —
   *  pure spectacle, damage is untouched (hits are hits). */
  impactScale: 1.45,
  /** THE SEESAW — his signature: he floods one half of your platform, then
   *  the other, with this many seconds between halves — enough time to hurl
   *  yourself across the centreline, no more. As the fight progresses the
   *  cascade grows more stages: left, right, left, right… */
  seesawGap: 1.05,
  /** Stages by health quarter: fresh he swings twice; in the last quarter the
   *  platform seesaws five times per attack. */
  seesawStages: [2, 3, 4, 5],
  /** Forgiveness strip either side of the centreline (metres) — a body sphere
   *  dead on the line is spared, so the jump across is never a coin flip. */
  seesawSafeLip: 0.06,
  /** Attack cooldowns multiply down to this as his health drains — the long
   *  fight escalates instead of plateauing. */
  finalHaste: 0.6,
  /** How hard a fireball reads as a "fist" to the gel sim: reaction speed =
   *  base + ball speed × gain, capped. Drives shove/dent/roil strength —
   *  lumps are disabled for the boss (goopConfig CREATURE.maxLumps 0). */
  punchBase: 1.55,
  punchGain: 0.13,
  punchMax: 3.6,
};

/**
 * DIFFICULTY — the four tiers the RUN modes (gauntlet, hardcore, raid, raid
 * hardcore) are played at. Single campaign stages and the solo GOOPLIATH
 * fight always run NORMAL. Normal is the default; EASY is always open; HARD
 * unlocks by clearing a run on Normal-or-higher, BLAZING by clearing one on
 * Hard-or-higher.
 *
 *  - health   : boss HP / hit-count multiplier.
 *  - charge   : telegraph windup multiplier (>1 = slower, easier to read).
 *  - cooldown : gap-between-attacks multiplier (>1 = slower).
 *  - stun     : landed hits stagger the boss (EASY only — see BOSS_STUN).
 *  - elite    : every boss can also use the nova, the seesaw and the surge —
 *               the fanciest attacks spread to the whole roster (HARD+).
 */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'blazing';

export const DIFFICULTY: Record<
  Difficulty,
  { label: string; blurb: string; accent: number; health: number; charge: number; cooldown: number; stun: boolean; elite: boolean }
> = {
  easy: { label: 'EASY', blurb: 'slow attacks · frail · stuns', accent: 0x6fd66f, health: 0.45, charge: 1.5, cooldown: 1.85, stun: true, elite: false },
  normal: { label: 'NORMAL', blurb: 'the standard fight', accent: 0xffb000, health: 1.0, charge: 1.0, cooldown: 1.0, stun: false, elite: false },
  hard: { label: 'HARD', blurb: 'new attacks & mechanics', accent: 0xff7a18, health: 1.0, charge: 1.0, cooldown: 1.0, stun: false, elite: true },
  blazing: { label: 'BLAZING', blurb: 'hard · tanky · relentless', accent: 0xff3b6e, health: 1.6, charge: 0.85, cooldown: 0.6, stun: false, elite: true },
};

/** Selector order + the unlock chain (easy/normal always open). */
export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard', 'blazing'];

/** EASY only: land this many hits inside the decay window and the boss REELS
 *  — its attacks stop for `duration` s while it shakes the stagger off. */
export const BOSS_STUN = { hits: 5, decayPerSec: 1.2, duration: 2.6 };

/** Match format: best-of rounds, Blaston-style pacing. */
export const MATCH = {
  startDelay: 7, // quick-match pre-fight hold before the first live round
  roundTime: 60, // seconds per round
  winTarget: 3, // first to N round wins — RANKED, private and 2v2 stay best of five
  /**
   * QUICK MATCH only: best of three. Five rounds is up to five minutes of round
   * time for a drop-in bout, so the casual queue runs short while ranked keeps
   * the long format.
   *
   * Both peers evaluate this independently (see GameStateSystem.endRound), so
   * they MUST agree — a mismatch leaves the match unfinished for one side. What
   * makes that safe is that the two queues never meet: quick match pools on
   * `lobbies` / the WS relay via net.queue(), ranked on its own `rankedRooms`
   * collection via hostRanked/joinRanked, and a ranked host never crosses over
   * into the public queue (startRankedHeartbeat deliberately runs no cross-over
   * scan). So `app.quickDuel`, set from those entry points, is identical on both
   * sides of any given bout without needing to be sent over the wire.
   */
  winTargetQuick: 2,
  winTargetFfa: 2, // FFA only: a four-way scramble at first-to-3 drags — 2 crowns it
  roundOverDelay: 5, // breather between rounds before the next round's countdown
  roundCountdown: 3, // the 3-2-1 that opens every round AFTER the first
  matchOverDelay: 6, // pause after the match before returning to the lobby
};

/**
 * Round wins that take the match in `mode` — FFA runs shorter (see above), and
 * a QUICK MATCH duel is best of three where ranked/private stay best of five.
 * Pass `app.quickDuel` for `quick`.
 */
export function winTargetFor(mode: ArcadeMode, quick = false): number {
  if (mode === 'ffa') return MATCH.winTargetFfa;
  return mode === '1v1' && quick ? MATCH.winTargetQuick : MATCH.winTarget;
}

/** The visible platform slab under each boxer. */
export const PLATFORM = {
  thickness: 0.14, // slab depth below the floor line — reads as a pedestal
  rimLift: 0.012, // neon rim line height above the floor
};

/**
 * The rim barrier — your platform's guardian. Translucent walls fade in as
 * your head nears the rim; lean your head out past it and the fire of the
 * arena eats your health FAST. Stay on your platform.
 */
export const BOUNDARY = {
  wallHeight: 2.2, // barrier wall height above the platform — clears the head
  warnDistance: 0.3, // walls start glowing when the head is this close (m)
  drainPerSec: 38, // hp/s while your head is outside the rim
  graceDepth: 0.06, // head may poke this far past the rim before draining
};

/** Aim Training: pop-up targets across the gap; optionally they shoot back. */
export const TRAINING = {
  sessionTime: 60, // seconds per training run (90 played too long)
  spawnInterval: 1.6, // base seconds between target pops (speeds up)
  minInterval: 0.75, // fastest spawn cadence at full ramp
  rampTime: 40, // seconds to ramp from base to fastest — full pace for the last third
  maxLive: 4, // most targets up at once
  holdTime: 2.6, // seconds a target stays up before retreating
  discRadius: 0.18, // bullseye disc hit radius
  cutoutRadius: 0.24, // humanoid cutout chest hit radius
  discPoints: 100,
  cutoutPoints: 150,
  streakBonus: 25, // extra points per current streak step
  // The OCTA DRONE: a small strafing gold octagon plate (pub octa-hunt style)
  // that only joins the mix in the closing stretch — lead the shot, bank big.
  bonusWindow: 15, // drones appear when this many seconds remain
  droneChance: 0.35, // spawn roll share once the window opens
  dronePoints: 300,
  droneRadius: 0.13, // small — a genuine skill shot
  droneHold: 2.2, // up for less time than the static targets
  droneDriftAmp: 0.55, // strafe half-range (m)
  droneDriftRate: 2.4, // strafe angular rate (rad/s)
  // Shoot-back: cutouts hurl a blue ball at you while they're up.
  shootChance: 0.55, // chance a cutout takes its shot
  shootDelay: 0.7, // aim time before it fires
  shotSpeed: 4.0,
  shotDamage: 20, // every landed hit is 20 — training regen softens it
  regenDelay: 2.5, // seconds after damage before training regen kicks in
  regenPerSec: 9, // training-only health regen
};

/** Networking. The relay server lives in /server (npm run server). */
export const NET = {
  poseRateHz: 30, // pose packets per second — denser input = smoother rival
  stateRateHz: 2, // host match-state echoes per second
  smoothing: 24, // exponential smoothing rate for the remote avatar
  /**
   * Convergence rate for a remote throw's launch-position correction: the
   * ball leaves from where OUR smoothed sim had it and eases onto the
   * sender's authoritative trajectory instead of teleporting (the smoothed
   * hand lags the real one by ~30 cm at full punch speed).
   */
  throwBlend: 9,
  /** ws:// URL — override with ?server=wss://host:port, else localStorage. */
  defaultPort: 8787,
};

/**
/**
 * THE CHANNEL and THE TAPE (public/stats.html's TV and LAB tabs): what a
 * bout broadcasts while it runs, and what it records when it ends.
 *
 * A running bout casts a small top-down FRAME to THE ROOM SERVER's /tv
 * relay a few times a second (systems/BroadcastSystem.ts and net/tvCast.ts)
 * so the web page can show it live; and it keeps a TAPE (net/telemetry.ts)
 * of where you stood, where each hand threw from, where you were when hit,
 * and every throw, hit, parry and round as a timed event — posted to the
 * `bouts` collection at the final bell for THE LAB to read back.
 */
/**
 * THE PICTURE — FFTV's video feed (net/tvVideo.ts).
 *
 * The channel carries two things at once: the POSE frame (numbers, a
 * top-down diagram, always sent) and this, a real render of the scene
 * shrunk to a postcard and sent as a JPEG. The page prefers the picture
 * and falls back to the diagram the moment the pictures stop, so a headset
 * too busy or too old to shoot one still televises the fight.
 *
 * The numbers are chosen to keep a HEADSET honest, not to look good on a
 * desktop: 256×144 is 37k pixels, three a second, and the readback is
 * fenced rather than stalled. Turn any of them up and the cost lands on
 * the person actually fighting.
 */
export const VIDEO = {
  /**
   * The frame. 16:9, because every player's view is.
   *
   * This was 256x144, chosen to keep the cost off a headset, and it was
   * the wrong trade: stretched across a broadcast panel it is mush, and a
   * picture nobody can read is not cheaper than no picture — it is just
   * cheaper AND useless. 640x360 is six times the pixels for about four
   * times the bytes (measured on the club: 6.9 KB against 27 KB of base64
   * at the same quality), and it is the difference between "there is a
   * fight happening somewhere in there" and being able to see who is
   * winning it.
   */
  w: 640,
  h: 360,
  /** Frames a second. Three reads as motion without competing with the
   *  bout for GPU time; the pose frame still runs at TV.castHz. */
  hz: 3,
  /** JPEG quality. Under about 0.4 the paint goes muddy, which is the one
   *  thing the picture exists to show. */
  quality: 0.62,
  /**
   * SHADOW LIFT, as a gamma. The venues are dark by design — the club is
   * black glass and neon, the void is darkness given shape by light — and
   * a camera that reproduces them faithfully sends a black rectangle with
   * a few bright lines in it. The renderer's own exposure control cannot
   * help: tone mapping is off, so toneMappingExposure does nothing at all.
   * So the lift happens in the encoder, on the pixels, as a curve that
   * raises the darks and leaves the neon where it is. 1 is off.
   */
  lift: 1.5,
  /** A wide ringside lens: the whole platform and both players in frame. */
  fov: 58,
  /** Refuse a frame bigger than this many base64 characters (~67 KiB of
   *  JPEG). A full 640x360 frame of the club measures about 27 KB, so this
   *  is generous headroom — a frame past it means the encoder mis-set, not
   *  a busy scene. */
  maxBytes: 90000,
  /**
   * No picture for this long and the page falls back to the diagram.
   *
   * SIX seconds, not the two and a half it started at. The caster aims for
   * three frames a second, but that is what it ASKS for — the real rate is
   * whatever the headset's render, readback and encode actually cost, and
   * a busy frame can push the gap past two seconds. At the old window the
   * picture expired between frames and the page flipped to the diagram and
   * back, which reads as a fault rather than as television.
   *
   * A slightly old picture beats a strobing one. This only decides how
   * long the LAST frame keeps its place; a caster that has genuinely
   * stopped still hands the floor back to the map within a few seconds.
   */
  staleMs: 6000,
} as const;

export const TV = {
  /** Frames a second to the transmitter. Five reads as motion on a 2D
   *  board and costs about a kilobyte a second; the relay caps a frame
   *  at 12 KiB. */
  castHz: 5,
  /** How often the tape bins your standing spot. */
  sampleHz: 4,
  /** Heatmap bins across the platform footprint: 1.72 by 1.5 m, so the
   *  cells land near 11 cm square. */
  gridW: 16,
  gridH: 14,
  /** Most timed events one tape lists — a five-round duel is about 150.
   *  Past the cap it keeps counting but stops listing; the grids still fill. */
  eventCap: 600,
  /** Shorter bouts are never posted: a mis-tap, a forfeit at the bell. */
  minBoutSeconds: 15,
  /**
   * HOW LONG A TAPE LIVES. `bouts` is the one append-only collection in the
   * project — a board is a ratchet with one row per player, but a tape is a
   * new document every time anybody fights — so without an expiry it is the
   * only thing here that grows for ever.
   *
   * A Firestore TTL policy is the obvious answer and needs the Blaze plan;
   * this project is on Spark. So a tape carries `expiresAt` and the CLIENTS
   * sweep, exactly as `presence` and `rooms` already do (net/presence.ts).
   * The reader filters on the field, so an expired tape is invisible from
   * the moment it lapses whether or not anything has binned it yet.
   *
   * Thirty days is a stat page's useful memory: long enough to see a habit
   * across a month of play, short enough that a busy season cannot fill a
   * free tier's gigabyte.
   */
  keepDays: 30,
  /** Expired tapes one headset bins per session — bounded, lazy, best-effort
   *  housekeeping, like presence's own. */
  sweep: 20,
};

/**
 * THE ROOM SERVER — one hosted process for the whole town.
 *
 * FIRE FIGHT 2 runs FOUR relays (server/room.mjs): the duel relay at /ff,
 * the Iron Balls pub at /pub, the rave's room relay at /rave, and THE
 * CHANNEL at /tv. They used to be three separate hosts, which meant three
 * cold starts, three free-tier services to keep warm, and three URLs to
 * keep in step. They are one process on one port, told apart by path — so
 * one host serves all of it.
 *
 * A free-tier host SLEEPS when idle and takes a while to wake. That is the
 * strongest practical argument for one service rather than three: everyone
 * arriving anywhere in the town wakes the same one, so the pub warms the rave
 * and the rave warms the duel relay. It is also why THE CHANNEL lives here
 * and not on a host of its own: the club peep reads the rave relay's rooms
 * out of memory, which only works inside the same process.
 *
 * Override per-session with ?server=wss://host (no path — the path is added
 * per relay) or by setting `ibb-room-server` in localStorage.
 */
export const ROOM_SERVER = 'wss://ff2-room.onrender.com';

/** Where the room server lives, without a relay path. */
export function roomServerHost(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param.replace(/\/(ff|pub|rave|tv)$/, '');
  try {
    const stored = localStorage.getItem('ibb-room-server');
    if (stored) return stored;
  } catch {
    /* storage may be unavailable */
  }
  // A plain-http page is a dev serve (vite on this machine, or its LAN IP as
  // reached from a headset) — talk to the room server running beside it.
  if (location.protocol !== 'https:') return `ws://${location.hostname}:${NET.defaultPort}`;
  return ROOM_SERVER;
}

/**
 * KNOCK on the room server over HTTP. Fire and forget: a free-tier host
 * sleeps when idle and wakes on any request, and a plain GET gets further
 * through a cold router than a WebSocket upgrade does. The arena knocks at
 * boot and again when the CLUB tab opens, so by the time anyone presses
 * ENTER CLUB the house is usually already up — and the held door
 * (experience/ClubExperienceManager holdForTheFloor) covers the times it
 * isn't, in the arena's own menu rather than in the rave's foyer.
 */
export function warmRoomServer(): void {
  try {
    const http = roomServerHost().replace(/^ws/, 'http');
    void fetch(http, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  } catch {
    /* no fetch, or no host to knock on — the socket will still try */
  }
}

/** THE CHANNEL's transmitter: the room server's /tv, wherever that is.
 *  `?tv=` overrides it outright, for pointing one page at another relay. */
export function tvServerUrl(): string {
  const param = new URLSearchParams(location.search).get('tv');
  if (param) return param;
  return `${roomServerHost()}/tv`;
}

/** Resolve the DUEL relay's URL (server/index.mjs, mounted at /ff). */
export function serverUrl(): string {
  // A `?server=` or a saved `ibb-server` that already names a full URL wins
  // outright — that is the escape hatch for pointing one client at a relay on
  // a laptop, and it must not have a path bolted onto it.
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  try {
    const stored = localStorage.getItem('ibb-server');
    if (stored) return stored;
  } catch {
    /* storage may be unavailable */
  }
  return `${roomServerHost()}/ff`;
}

/**
 * Fire palette. YOUR fire burns orange; THEIR fire burns blue — instantly
 * readable in the heat of a duel.
 */
export const PALETTE = {
  ember: 0xff7a18, // your fire
  flame: 0xffc04d,
  whiteHot: 0xfff3cf,
  coolFlame: 0x4fb7ff, // their fire
  coolCore: 0x9fe2ff,
  venom: 0x57e389, // FFA third fighter — toxic green
  violet: 0xb06bff, // FFA fourth fighter — plasma violet
  danger: 0xe8352a,
  iron: 0x3a3d46,
  gunmetal: 0x2c2f36, // robot-wars chassis steel
  gunmetalDark: 0x1e2126,
  amber: 0xffb000, // industrial hazard amber
  charcoal: 0x191b22,
  white: 0xf4f6fb,
};

/**
 * Team → fire tint. 0 = you (orange), 1 = the classic blue rival. Arcade FFA
 * gives every fighter their own team, so teams 2 and 3 get distinct hues so
 * four boxers read apart at a glance; 2v2 only ever uses 0 (your team, orange)
 * and 1 (the enemy team, blue).
 */
export function teamColor(team: number): number {
  switch (team) {
    case 0:
      return PALETTE.ember; // you / your team — orange
    case 1:
      return PALETTE.coolFlame; // rival / enemy team — blue
    case 2:
      return PALETTE.venom; // FFA third fighter — green
    default:
      return PALETTE.violet; // FFA fourth fighter — violet
  }
}

/* ───────────────────────── ARCADE MODES ─────────────────────────────────
 * The lobby's ARCADE panel hosts three brawls that all share the duel's
 * fireball mechanics but differ in how many boxers stand in the pit and how
 * their platforms are laid out. Every mode is described by a ROSTER of
 * platform "slots" — slot 0 is ALWAYS the local player at the world origin
 * (the headset origin), facing -Z exactly like the classic 1v1. The remaining
 * slots are opponents/allies, each with a world position, a yaw so the fighter
 * faces the action, and a team id (0 = your team).
 *
 * Layouts:
 *  - '1v1'  : the original duel — you and one rival across the 3 m gap. The
 *             roster is bit-identical to the hand-built arena, so ranked /
 *             quick / private bouts play exactly as before.
 *  - '2v2'  : teammates SIDE BY SIDE, enemies directly across. The 1v1 gap is
 *             kept; the line is just widened — you + ally on the near side,
 *             two rivals on the far side, each pair facing off across the gap.
 *  - 'ffa'  : a four-way PLUS/CROSS. Your platform is one pinnacle; the other
 *             three sit N / E / W around a shared centre, everyone facing in.
 */

export type ArcadeMode = '1v1' | '2v2' | 'ffa' | 'raid';

/** Centre-to-centre spacing between same-side platforms in 2v2. */
export const TEAM_SPACING = 1.9;

/**
 * FFA plus arm length — distance from the cross centre out to each pinnacle.
 * 0.7× the duel gap puts each DIAGONAL neighbour at √2×2.1 ≈ 3 m — the
 * classic duel distance to everyone beside you — with 4.2 m to the fighter
 * straight across. The old ARENA_GAP/2 arms felt too tight in playtests:
 * ~2.1 m neighbours left no room to read incoming fire from three sides.
 */
export const FFA_ARM = ARENA_GAP * 0.7;

/** RAID arc seat bearings (radians about the boss anchor): five seats on a
 *  ~144° semicircle spread, symmetric, 36° apart — at RAID_RING_RADIUS that
 *  keeps the same ~3.7 m centre-to-centre between neighbouring platforms as
 *  the old four-seat arc (over a full platform's length of clear air). */
const RAID_ARC_ANGLES = [-1.2566371, -0.6283185, 0, 0.6283185, 1.2566371];

/**
 * RAID ring radius — every seat's distance to the titan's pit. Twice the duel
 * gap: raids are about SCALE, so the squad spreads wide and the giant looms
 * far across the arena instead of crowding the classic 3 m pocket.
 */
export const RAID_RING_RADIUS = 6.0;

/** One platform's place in a mode's roster. */
export interface FighterSlot {
  /** Platform-centre world position. Slot 0 is the local player at the origin. */
  pos: [number, number, number];
  /** Yaw (radians about +Y, 0 = facing -Z) so the boxer faces the fight. */
  yaw: number;
  /** Team id — 0 is always your team. FFA gives every slot its own team. */
  team: number;
}

/**
 * Platform rosters per mode. Yaw values face each platform toward the action:
 * a rotation θ about +Y turns the default -Z forward into (-sinθ, 0, -cosθ),
 * so π faces +Z, +π/2 faces -X (east platform looks west into the cross) and
 * -π/2 faces +X (west platform looks east).
 */
/**
 * THE AUDIENCE (DESIGN §3.2). Every online room keeps seats for WATCHERS
 * beyond its fighters: they claim them in the same room doc, ride the same
 * mesh, and are dealt to the match's own place with the squad — onto the
 * audience ground (arena/desert/audience.ts) rather than a platform.
 */
export const AUDIENCE_SEATS = 6;

/**
 * A watcher's `app.mySlot`. Deliberately OUTSIDE every MODE_LAYOUT: the
 * seat-relative transforms (combat/layout.ts) fall back to the canonical
 * origin for a slot they don't know, which is exactly the frame a watcher
 * wants — the fighters land where the arena actually put them, and the
 * watcher's own rig is moved to the terrace instead.
 */
export const WATCHER_SLOT = 90;

export const MODE_LAYOUT: Record<ArcadeMode, FighterSlot[]> = {
  '1v1': [
    { pos: [0, 0, 0], yaw: 0, team: 0 }, // you
    { pos: [0, 0, -ARENA_GAP], yaw: Math.PI, team: 1 }, // rival, across the gap
  ],
  '2v2': [
    { pos: [0, 0, 0], yaw: 0, team: 0 }, // you
    { pos: [TEAM_SPACING, 0, 0], yaw: 0, team: 0 }, // ally beside you
    { pos: [0, 0, -ARENA_GAP], yaw: Math.PI, team: 1 }, // rival across from you
    { pos: [TEAM_SPACING, 0, -ARENA_GAP], yaw: Math.PI, team: 1 }, // rival across from ally
  ],
  ffa: [
    { pos: [0, 0, 0], yaw: 0, team: 0 }, // you — south pinnacle
    { pos: [0, 0, -2 * FFA_ARM], yaw: Math.PI, team: 1 }, // north, faces +Z
    { pos: [FFA_ARM, 0, -FFA_ARM], yaw: Math.PI / 2, team: 2 }, // east, faces -X
    { pos: [-FFA_ARM, 0, -FFA_ARM], yaw: -Math.PI / 2, team: 3 }, // west, faces +X
  ],
  // RAID: four platforms on a semicircular arc around the titan's pit — the
  // pit anchor sits at (0,0,-RAID_RING_RADIUS) and every seat stands ON A
  // CIRCLE of radius RAID_RING_RADIUS around it, yawed to face it. That
  // geometry is the whole trick: because each seat faces the anchor at the
  // same distance, the titan lands at (0, 0, -RAID_RING_RADIUS) in EVERY
  // player's local frame — so the entire boss-fight stack (telegraphs on
  // your platform, weak-point aim, dodge geometry) runs unchanged per client,
  // and only the OTHER raiders' attacks/platforms need seat transforms.
  raid: RAID_ARC_ANGLES.map((phi) => ({
    pos: [
      Math.sin(phi) * RAID_RING_RADIUS,
      0,
      -RAID_RING_RADIUS + Math.cos(phi) * RAID_RING_RADIUS,
    ] as [number, number, number],
    yaw: phi,
    team: 0, // one squad — no friendly fire
  })),
};

/** RAID canonical boss anchor — the pit the arc curls around. */
export const RAID_BOSS_ANCHOR: [number, number, number] = [0, 0, -RAID_RING_RADIUS];

/** Opponent slots for a mode (everyone but the local player at slot 0). */
export function opponentSlots(mode: ArcadeMode): FighterSlot[] {
  return MODE_LAYOUT[mode].slice(1);
}

/** Every team id present in a mode, deduped (e.g. [0,1] for 2v2, [0,1,2,3] FFA). */
export function modeTeams(mode: ArcadeMode): number[] {
  return [...new Set(MODE_LAYOUT[mode].map((s) => s.team))];
}

/**
 * Map a hue (0..1 around the wheel) to a saturated glow colour for avatar
 * accents. Saturation/lightness are fixed to the ember vibe, so the default
 * hue (≈0.07) reproduces the classic orange — see DEFAULT_ACCENT_HUE.
 */
export function hueToColor(hue: number, light = 0.5): number {
  const h = (((hue % 1) + 1) % 1) * 6;
  const s = 1;
  // light 0..1 (0.5 = neutral) walks the neon's lightness from murky to bright.
  const l = Math.max(0.2, Math.min(0.9, 0.55 + (light - 0.5) * 0.6));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 1) { r = c; g = x; }
  else if (h < 2) { r = x; g = c; }
  else if (h < 3) { g = c; b = x; }
  else if (h < 4) { g = x; b = c; }
  else if (h < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return (R << 16) | (G << 8) | B;
}
