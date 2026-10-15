/**
 * GOOPLIATH: DANCE RAID — every number the feel depends on.
 *
 * The game: a full-VR techno rave over your real floor. Up to 24 dancers
 * stand on octagonal platforms ringed around one giant gel creature — the
 * GOOPLIATH — who dances on a stage in the middle and throws beat-quantized
 * moves that mark EVERY platform at the same time. You don't fight back.
 * You read the floor, move with the rhythm, and outlast everyone else.
 *
 * Dodge → the chain climbs → points multiply. Get clipped → the chain
 * dies. There are no lives: you dance the whole record and the night
 * GRADES you at the end, S to F, on the share of landings you survived.
 * The one way to end early is three clipped landings BACK TO BACK — a
 * dodge wipes that count, so it's a chain, not a budget. Dancing in
 * rhythm builds the COMBO for bonus points. A live holo leaderboard rings
 * the stage; the top ten dance on raised platforms and the current
 * champion above them all.
 *
 * Dimensions are metres. Times are expressed in BEATS wherever the music
 * rules (the whole game is quantized to the track).
 */

import type { Vector2Tuple } from 'three';
import { ROOM_SERVER, roomServerHost } from '../config.js';

export const GAME_TITLE = 'GOOPLIATH: DANCE RAID';

/* ────────────────────────────── THE MUSIC ────────────────────────────────
 * The set is a REAL TRACK (see audio/tracks.ts — measured tempo, downbeat
 * and loudness per file). The whole game hangs off its beat clock, and a
 * track's length decides how long the set runs. audio/techno.ts survives as
 * a synthesised fallback for any browser that can't decode a file.
 */
export const MUSIC = {
  /** Only used when a track can't be decoded and the synth takes over. */
  fallbackBpm: 128,
  beatsPerBar: 4,
  barsPerPhrase: 8, // the choreography thinks in 8-bar phrases
  /** Bars of pure dancing before the first landing — the first telegraph is
   *  already blooming seconds after the drop. */
  introBars: 2,
  /** Master music level (the sfx bus is its own knob in audio/sfx.ts). */
  volume: 0.6,
};

export const beatSeconds = (bpm: number): number => 60 / bpm;

/**
 * Count-in length in beats, sized in SECONDS so slow records don't dawdle:
 * ~3 s of "the set drops in" whatever the tempo (MONEY at 78 BPM used to
 * hold you for six seconds; LOOP at 150 still gets its full two bars).
 */
export function countInBeatsFor(bpm: number): number {
  return Math.max(4, Math.min(8, Math.ceil(3.0 / (60 / bpm))));
}

/* ────────────────────────────── THE RING ─────────────────────────────────
 * Platforms stand on one circle around the boss stage. Every client sees
 * ITSELF at the world origin facing −Z (the headset can't be teleported),
 * so the canonical ring is re-expressed per seat — and because every seat
 * faces the centre at the same radius, the GOOPLIATH lands at (0,0,−R) in
 * every player's frame and the whole boss/choreo stack runs unchanged per
 * client. Only the OTHER dancers' platforms need seat transforms.
 */
export const RING = {
  minSeats: 4,
  maxSeats: 24,
  /** A full ring is the headline, but it is also twenty-three other
   *  figures — the overwhelming majority of everything drawn in a raid —
   *  so the DEFAULT sits where the frame is comfortable and the big rings
   *  are something a room opts into. (`detailRadius` below is what keeps
   *  the opt-in affordable.) */
  defaultSeats: 4,
  /** Centre-to-centre air between neighbouring platforms on the circle. */
  seatSpacing: 2.7,
  /** The ring never tightens below this radius even with 4 dancers. */
  minRadius: 4.6,
  /** Dancers nearer than this (metres, deck centre to deck centre) get the
   *  full figure; everyone beyond it drops the millimetre work — jewellery,
   *  joint fillers, seams — and keeps the silhouette, the lit panels, the
   *  sticks and the halos.
   *
   *  8 m takes in your two neighbours either side. On a 24-seat ring the
   *  radius is 10.3 m, so the far side stands 20 m off and seventeen of the
   *  twenty-three are past this line, where an ear pip is smaller than a
   *  pixel. Small rings sit entirely inside it and are untouched. */
  detailRadius: 8,
  /** The boss stage: a round dance floor in the middle. */
  stageRadius: 2.6,
  /** Low concert riser: enough depth for skirting and two shallow steps,
   *  keeping the performer near eye level. Rank lifts remain relative. */
  stageHeight: 0.42,
};

/** Ring radius for a seat count: keep neighbour spacing honest. */
export function ringRadius(seats: number): number {
  return Math.max(RING.minRadius, (seats * RING.seatSpacing) / (Math.PI * 2));
}

/**
 * The dancer's octagonal platform — the Blaston play-space footprint carried
 * over from FIRE FIGHT (~1.72 × 1.5 m, chamfered corners). The whole dodge
 * game happens inside this slab.
 */
export const OCTAGON_HALF_WIDTH = 0.86;
export const OCTAGON_HALF_DEPTH = 0.75;
const EDGE_HALF = 0.375;
const CHAMFER = 0.375;

export const OCTAGON_VERTICES: Vector2Tuple[] = [
  [-EDGE_HALF, -OCTAGON_HALF_DEPTH],
  [EDGE_HALF, -OCTAGON_HALF_DEPTH],
  [OCTAGON_HALF_WIDTH, -CHAMFER],
  [OCTAGON_HALF_WIDTH, CHAMFER],
  [EDGE_HALF, OCTAGON_HALF_DEPTH],
  [-EDGE_HALF, OCTAGON_HALF_DEPTH],
  [-OCTAGON_HALF_WIDTH, CHAMFER],
  [-OCTAGON_HALF_WIDTH, -CHAMFER],
];

/** Platform slab + neon trim. */
export const PLATFORM = {
  thickness: 0.14,
  rimLift: 0.012,
};

/** Floor decals hover here, clear of the deck furniture. */
export const DECAL_Y = 0.05;

/* ─────────────────────────────── THE BOSS ────────────────────────────────
 * The gel sim always runs man-sized (1.78 m) inside a scaled parent group —
 * identical trick to the FIRE FIGHT boss — so every wobble keeps the
 * creature's true proportions.
 */
export const GOOP = {
  /** Parent-group scale: ~4.3 m of dancing gel on the centre stage. */
  scale: 2.4,
  /** The sim clock runs slow so the giant reads as tons of gel, not jelly. */
  timeScale: 0.55,
  /** Raymarch step budget (the single biggest perf knob on Quest). */
  quality: 0.85,
  /** Step budget while a gesture is mid-swing (limb stretches balloon the
   *  raymarch bounds — drop quality exactly then). */
  attackQuality: 0.5,
  /** Gesture swings stay basically inside his silhouette (reach in body
   *  units from his centre) — the floor zones carry the danger. */
  gestureReach: 0.5,
  /** How hard he bounces to the beat at rest (sim agitation pulse). */
  danceBounce: 0.35,
};

/* ─────────────────────────────── THE MOVES ───────────────────────────────
 * Every move telegraphs on EVERY live platform at once and lands ON a
 * downbeat. The windup is sacred: escalation compresses the gaps between
 * moves, never the read.
 *
 * THE TELEGRAPH IS THE WHOLE INSTRUCTION. Danger shapes fill amber→red:
 * whatever is filling, don't be in it when it lands. Safe ground is drawn
 * with bright DOORPOST rails and chevrons marching INTO it: whatever the
 * chevrons run toward, be there. An experienced dancer never needs a word:
 *
 *  beam   : a strip fills down the deck — SIDESTEP off the lane. A single
 *           laser snaps to one of three slots (middle, or a third out); a
 *           DOUBLE is never two random strips — it is either a TWIN pair
 *           shoulder to shoulder covering one side and the middle (get
 *           across), or a SPLIT evenly either side of centre (stand in the
 *           corridor between them). Deliberate shapes, read at a glance.
 *           A twin usually comes with THE RETURN: a bar after it lands,
 *           the same pair arrives mirrored on the side you just ran to, so
 *           the move walks you across the deck and straight back. On the
 *           EXPERT acts the return almost always comes back a third time,
 *           onto the side it opened on — left, right, left, a rally rather
 *           than a shove, and the shape those acts are built around.
 *  sweep  : the AIR burns, never the floor — a danger roof overhead with a
 *           blazing limbo line as its underside, a short chevron fringe
 *           dripping off it — get UNDER the line (duck). The deck stays
 *           unpainted on purpose: floor paint means "move your feet"
 *           everywhere else, and the sweep's answer is the opposite.
 *  seesaw : one half floods, chevrons march at the centreline — CROSS.
 *  surge  : the seesaw's cousin, front/back.
 *  gate   : the WHOLE deck fills except one clear column, doorposts + both
 *           chevron streams pointing into it — STAND IN THE GAP.
 *  nova   : everything burns EXCEPT one wedge at a shared compass bearing —
 *           the whole ring rotates to the same safe ground together.
 *  duckdonut: the rare late-set COMBINATION — the donut's rim floods AND
 *           the sweep's blade hangs over the safe middle: get to the
 *           centre and DUCK there. Two honest reads at once; both answers
 *           are ones you already know.
 *  routine: THE MEMORY TEST. The deck splits into four quarters and the
 *           boss teaches a ROUTINE — two to four corners, never the same
 *           one twice, each marked with its step number and pointed out in
 *           order by his own body. Then the marks go out, and blocks
 *           crush the three corners you didn't learn. NOTHING calls the
 *           steps: the blocks are visibly falling for two beats before
 *           each landing (routineDropBeats), so the move is already its
 *           own clock and a cue over the top of it was only noise.
 *           The quarter lines stay lit the whole way through: the floor
 *           tells you where the boxes are, never which one is yours.
 *  donut  : the RIM burns and the middle lives — a closing ring with a
 *           bright doorpost circle and chevrons marching INWARD: get to the
 *           centre. Usually opens with a laser straight down the middle,
 *           which drives you OFF centre first, so the pair walks you out
 *           and hauls you back in.
 *  cross  : LASERS FROM THE SIDES. A strip fills ACROSS the deck, fed from
 *           an emitter at one rail — step FORWARD or BACK off it (the beam's
 *           quarter-turn cousin: same read, the other axis). Late on it
 *           lays a stage lane across itself and the safe ground is a cell.
 *           It carries the beam's doubles too, quarter-turned: the TRAP
 *           (two rails closing like jaws, stand in the corridor) and the
 *           VERTICAL TWIN — two shoulder to shoulder taking a whole half,
 *           with the same RETURN a bar later on the other half. Two at the
 *           back then two at the front, and the deck travels that way.
 */
export type MoveKind =
  | 'beam'
  | 'sweep'
  | 'seesaw'
  | 'surge'
  | 'gate'
  | 'nova'
  | 'cross'
  | 'donut'
  | 'routine'
  | 'duckdonut'
  | 'wave';

export const MOVES: Record<
  MoveKind,
  {
    /** Telegraph length in beats (act 0 baseline; acts may stretch it). */
    chargeBeats: number;
    /** Weight in the seeded set-list roll, per act (index clamps). */
    weights: number[];
  }
> = {
  // The BEAM shoots on a short fuse — it's the most readable shape on the
  // deck, so it earns the snappiest wind-up in the set.
  beam: { chargeBeats: 3, weights: [2, 3, 3, 3, 3] },
  // Ducking is the most physically demanding dodge in the game — a spice,
  // not a staple. At weight 3 it was landing several times every song.
  sweep: { chargeBeats: 4, weights: [1, 2, 2, 2, 2] },
  // The gentle 2-stage seesaw joins the openers — crossing is a day-one verb.
  seesaw: { chargeBeats: 4, weights: [2, 3, 4, 4, 4] },
  surge: { chargeBeats: 4, weights: [0, 0, 2, 3, 3] },
  // The GATE is the early-variety hero: instantly readable, teaches lateral
  // precision, and looks great rippling around the whole ring.
  gate: { chargeBeats: 4, weights: [3, 3, 2, 2, 2] },
  // The PIE: finding the wedge takes one look,
  // and the old 8-beat wind-up was a 6-second stand-and-wait on slow
  // records. 5 beats keeps the whole-ring rotate honest and lands sooner.
  nova: { chargeBeats: 5, weights: [0, 0, 2, 3, 3] },
  // CROSSFIRE is a day-one verb (it reads exactly like the beam) and it's
  // the only move that regularly asks for a step toward or away from the
  // stage — the ring stops being a left/right game.
  cross: { chargeBeats: 4, weights: [2, 3, 3, 3, 3] },
  // The DONUT is the nova's opposite number and mostly arrives as a
  // one-two, so it charges like one: long enough to read the middle laser,
  // clear it, and still get home — but no longer: the shape is a one-look
  // read and the run home is the fun part.
  donut: { chargeBeats: 4, weights: [0, 2, 3, 3, 3] },
  // THE ROUTINE charges for two bars because the charge IS the lesson —
  // you're being taught, not warned. Rare on purpose: it's the set piece
  // the floor talks about afterwards, and a memory test you meet every
  // phrase stops being one.
  routine: { chargeBeats: 8, weights: [0, 1, 2, 2, 3] },
  // THE COMBINATION asks for the two hardest answers in the game on one
  // beat, which is exactly why it should be something you meet once in a
  // night and talk about after — not a shape the back stretch serves
  // regularly. Fractional weights (the roll is a plain weighted sum, so
  // they work): well under a percent of the moves at act 3, and still
  // rare at act 4, where it stays twice as likely as the act below it.
  duckdonut: { chargeBeats: 6, weights: [0, 0, 0, 0.2, 0.4] },
  // THE WAVE is the travel move: four beams marching 1-2-3-4 across the
  // whole deck. Each beam gets the beam's own short fuse; the march is
  // the long read.
  wave: { chargeBeats: 3, weights: [0, 2, 3, 3, 3] },
};

export const CHOREO = {
  /** Beam lane half-width. */
  beamHalfWidth: 0.24,
  /** A SINGLE laser only ever lands on one of these local-x slots — the
   *  middle or a third out. Random x read as noise; three slots read as a
   *  choice the boss made, and the middle one is the setup the donut wants
   *  to answer. */
  beamSlots: [-0.42, 0, 0.42],
  /** DOUBLE lasers, two deliberate shapes and nothing in between:
   *   SPLIT — one either side of centre at ±beamSplitX. The strips leave a
   *     corridor down the middle and only slivers at the rim, so the answer
   *     is to stand BETWEEN the lasers.
   *   TWIN — two shoulder to shoulder from beamTwinInner outward, covering
   *     one whole side AND the middle: the answer is to get across.
   *  The split owns the middle acts, where precision is the point. It gives
   *  ground back on the EXPERT acts — not because it stops being good, but
   *  because the twin is the only double that TRAVELS, and an expert night
   *  is supposed to move you. It keeps about a tenth of the laser moves
   *  there, which is often enough that the corridor read stays in the
   *  vocabulary rather than becoming a surprise. */
  beamSplitX: 0.5,
  beamTwinInner: 0.12,
  beamSplitChance: [0.4, 0.36, 0.42, 0.36, 0.34],
  /** THE RETURN — the twin's second half, and the set's plainest travel
   *  order: the twin takes one side, and a bar later the SAME pair lands
   *  mirrored on the side you just ran to. Across, and straight back.
   *
   *  Only the TWIN earns it. A split is symmetrical — it has no "other
   *  side" to answer with — and the X already sends you radial. And it's a
   *  full BAR apart, like the donut's one-two: the return's telegraph opens
   *  exactly as the first pair fires, so there is never more than one pair
   *  of strips on the deck to read, and the beat you spend crossing is the
   *  beat you get to read the answer in. */
  twinReturnBeats: 4,
  twinReturnChance: [0, 0.45, 0.85, 0.9, 0.94],
  /** How many volleys THE BOUNCE may run to, the opener included. At 3 the
   *  pattern is across, back, and across again — the third pair lands on
   *  the side the first one did, so the deck throws you left, right and
   *  left rather than shunting you over once and letting go. Each extra
   *  volley costs another bar, and three bars of one idea is the most a
   *  phrase can carry without becoming the whole phrase. */
  twinChainMax: 3,
  /** ...and whether it actually gets there. The first roll (twinReturnChance)
   *  asks "does this twin answer at all"; THIS one asks the different and
   *  more important question: having answered, does it come back across?
   *
   *  They were one number, and that made the two-volley chain — shove you
   *  over, let go — as likely as the full rally, which is the exact thing
   *  the bounce was built to stop being. A rally that has started should
   *  finish, so on the expert acts the third pair is close to a promise.
   *  Below them it stays a coin, because a floor still learning to read one
   *  pair does not need three bars of them.
   *
   *  Both rolls sit high, and the twin's competition (split, X) sits lower
   *  than it did: the three-volley rally is the signature of this floor,
   *  and it was landing on barely a quarter of laser moves. It is now the
   *  likeliest thing a double laser does. (The act-0 and act-1 entries are
   *  unreachable — below act 2 a laser move is a single strip and there is
   *  no twin to answer — and are kept only so the arrays index by act.) */
  twinBounceChance: [0, 0.45, 0.85, 0.95, 0.98],
  /** …and from THIS act up, both rolls are skipped entirely: a double
   *  laser is three volleys or it is nothing. EXPERT sits at act 3 for its
   *  first stretch and act 4 after the lift, so on that difficulty the
   *  rally is a promise rather than a near-certainty — a 2-volley shove
   *  still turned up a few times in a hundred, and one exception is all it
   *  takes for "the double always comes in threes" to stop being a rule
   *  you can play by. (HARD's back stretch reaches act 3 too, and inherits
   *  it: the hardest phrases of HARD are exactly where the promise belongs
   *  as well.) */
  twinAlwaysFromAct: 3,
  /** THE X: two beams thrown diagonally through the deck centre at once,
   *  crossing in an X — the safe ground is the four pockets between the
   *  arms, so the dodge reads radial (out of the cross, not off a line).
   *  The arms run THINNER than a straight beam: two full-width strips on
   *  the diagonals left pockets too tight to trust — and 0.17 still
   *  wasn't room enough. At 0.14 the side pockets hold ~0.18 m of true
   *  clearance each way (judge margin included) and the shallower
   *  front/back pockets ~0.14 m, up from ~0.15/~0.11: pockets you can
   *  stand in with your shoulders, not thread with your spine. */
  beamXChance: [0, 0, 0.24, 0.28, 0.32],
  beamXHalfW: 0.14,
  /** THE WAVE: beams marching across the deck in order, one landing per
   *  step, with the far quarter left dark — the EXIT. EVERY wave turns:
   *  the march wheels at the exit (its first return strike is that very
   *  square, after the breather below) and sweeps home, new exit at the
   *  far side. Sideways = lanes walking x; front/back = rails walking z. */
  waveLaneX: [-0.645, -0.215, 0.215, 0.645],
  waveRailZ: [-0.56, -0.19, 0.19, 0.56],
  waveStepBeats: [2, 2, 1, 1, 1],
  /** Beats between the out-march's last fire and the turn's first — a
   *  double step plus one whole extra beat: you only just reached the
   *  exit, and the breather is what makes the wheel readable. The same
   *  breather buys the third march below its own wheel. */
  waveTurnExtraBeats: 1,
  /** THE LONG WAVE — EXPERT only, and only sometimes: the march wheels a
   *  SECOND time and runs the deck once more. Across, back, and across
   *  again — the exact rally the twin's bounce plays with lasers, told in
   *  a march. Every wave already turns, so the shape is one a dancer
   *  knows by the time expert serves it; what the third leg asks for is
   *  the legs to still be there on the last beat of it. Kept a coin
   *  rather than a promise: a wave that ALWAYS ran three times would own
   *  its phrase, and the read that makes the move (breathe at the wheel,
   *  ride one square behind) stops being a read once it's a routine. */
  waveThirdChance: 0.3,
  /** THE ROUTINE: how many corners you're asked to hold in your head (per
   *  act, clamped to the 2–4 the deck's four quarters can offer without
   *  ever repeating one), and how many beats apart the steps land. Two
   *  beats is a brisk corner-to-corner step — about a metre of travel —
   *  which is the point: the memory has to be ready before the tick. */
  routineSteps: [2, 2, 3, 4, 4],
  /** THE SWEPT ROUTINE (act 4): every blast of the routine arrives under
   *  the sweep's blade — stand in the taught corner AND duck on each tick.
   *  A per-SONG coin, not a per-move one: some expert charts carry it,
   *  some never do, so the hardest nights stay distinct — and at even odds
   *  "some" was every other night, which is a garnish, not a legend. At
   *  one chart in eight it is the thing a floor remembers a record for. */
  routineSweepChance: 0.12,
  /** Three beats corner-to-corner: two read as a shove at raid tempo — the
   *  memory needs a breath between ticks, not just travel time. */
  routineStepBeats: 3,
  /** How many beats before each routine step its blocks are already VISIBLY
   *  falling — the DOWN language, upside down: spinning neon polyhedra
   *  descend onto the three quarters you weren't taught, deck rings
   *  brightening under them as they close. The descent is beat-locked, so
   *  the landing IS the downbeat. */
  routineDropBeats: 2,
  /** How far PAST the quarter line you must stand for a corner to count.
   *  Without it, loitering at dead centre would satisfy all four corners
   *  at once and the whole move would be free — so the routine asks you to
   *  commit, and the lit quarter lines show exactly where the line is. */
  routineMargin: 0.08,
  /** THE DONUT: radius of the safe disc in the middle, how long after the
   *  opening laser the ring closes, and how often it opens with that laser
   *  instead of arriving alone. A full bar between the two is the whole
   *  move: driven off centre, then hauled back.
   *
   *  The disc tightens act by act — EXCEPT on EXPERT, which serves ONE
   *  donut all night: the tight disc, first bar to last. The donut is the
   *  move you run BACK INTO, off the memory of where the middle was, and a
   *  target that quietly resizes between phrases is a target nobody can
   *  learn. Expert gets the honest version — the same disc every time, and
   *  the smallest one the game serves. */
  donutInnerR: 0.42,
  donutInnerRLate: 0.34,
  /** EXPERT's one and only donut, and the tightest disc in the game — and
   *  the DUCK DONUT's disc wherever THAT deals, on every difficulty: the
   *  finale combination never opens a roomier middle than the plain donut
   *  it out-ranks. */
  donutInnerRExpert: 0.3,
  donutRadius: 1.15,
  donutFollowBeats: 4,
  donutOpenChance: 0.7,
  /** The sweep's LIMBO LINE: the rendered underside of the danger. Sits a
   *  touch BELOW the average duck threshold (judgement is duck-state, not
   *  metres) so "visibly under the line" is never a hit — the picture may
   *  demand slightly more crouch than the judge, never less. */
  sweepY: 1.26,
  /** Half-height of the glowing line pane at sweepY. */
  sweepThickness: 0.12,
  /** Head below this fraction of your calibrated standing height = ducked. */
  duckFrac: 0.78,
  /** Seesaw/surge: beats between half-floods per act. Whole bars early,
   *  half-bars late — every flood lands where the music actually hits (a
   *  3-beat gap straddled the grid and read as random). */
  seesawGapBeats: [4, 4, 2, 2, 2],
  /** Forgiveness strip either side of the centreline (m). */
  seesawSafeLip: 0.06,
  /** Nova safe-wedge half-angle (radians); tightens with the acts. */
  novaHalfAngle: 0.6,
  novaHalfAngleLate: 0.45,
  /** EXPERT's one and only pie, held for the whole night — and cut a touch
   *  WIDER than the slivers the last act used to serve (0.42). Expert is
   *  the difficulty where every nova arrives as THE CHAIN: three pies in a
   *  row, each wedge a third of the compass on, walking the ring the whole
   *  way around. Three of anything asks for a slice you can actually stand
   *  in — expert lives in density and combinations, not in slivers of safe
   *  ground, and a chain of slivers is just the same read three times with
   *  less room to make it. */
  novaHalfAngleExpert: 0.5,
  novaRadius: 1.15,
  /** THE CHAIN (late-act nova): three SINGULAR pies, one after the other,
   *  each safe wedge a third of the compass further on — three dodges walk
   *  you the whole way around the ring. Only ONE pie is ever on the floor
   *  (the next disc doesn't even appear until the last one has gone off).
   *  A full BAR between discharges: at 3 beats the walk felt like a shove
   *  (and drifted off the downbeat law) — 4 keeps every detonation on a
   *  bar line and gives the turn its breath. */
  novaChainBeats: 4,
  novaChainTurn: (Math.PI * 2) / 3,
  /** CROSSFIRE: half-depth of the side-laser strip (a shade tighter than the
   *  beam's — the deck is shallower front-to-back than it is wide, so the
   *  same margin has to come out of less ground). */
  railHalfDepth: 0.2,
  /** How far off deck centre a rail can sit — a rail through the middle
   *  leaves a mean margin both ways, so they always favour one side. */
  railOffsetMin: 0.12,
  railOffsetMax: 0.42,
  /** THE TRAP (late crossfire): TWO rails land on the same beat, one from
   *  each side emitter, symmetric about the centreline — the safe ground
   *  is the corridor pinned between them. */
  railTrapChance: [0, 0, 0.35, 0.5, 0.5],
  railTrapZ: 0.44,
  /** THE VERTICAL TWIN: the beam's twin, quarter-turned. Two rails shoulder
   *  to shoulder covering one whole HALF of the deck — both fired from the
   *  same emitter, so they read as one battery rather than two decisions —
   *  and then, on the return, the mirrored pair covering the other half.
   *  Two at the back and then two at the front, or the other way about.
   *
   *  This is the one shape allowed to flood the ground BEHIND you, and it
   *  earns that the way the trap and the wave do: it isn't a strip you
   *  could miss, it's half the floor going up at once. The rule the single
   *  rail obeys — always land on the front half, where your eyes already
   *  are — is about thin lasers sneaking in behind your back, and a whole
   *  half of the deck is not sneaking anywhere.
   *
   *  Inner rail centred just past the middle so the pair covers its half
   *  plus a shade over, exactly as the lateral twin does: no corridor, no
   *  choice, step off it.
   *
   *  On the expert acts it takes most of what the SINGLE rail used to have.
   *  That's the cheapest trade on the deck: one thin strip across the front
   *  is the plainest shape in the crossfire's vocabulary, and a floor at
   *  this act has read it a hundred times. (The trap rolls first and keeps
   *  its half regardless, so the jaws are untouched.) */
  railTwinInner: 0.11,
  railTwinChance: [0, 0, 0.4, 0.72, 0.8],
  /** From this act on, the crossfire lays a stage lane ACROSS the rail: the
   *  safe ground becomes a quarter of the deck and the dodge is diagonal. */
  latticeFromAct: 2,
  /** Gate: half-width of the safe band; tightens in the last act. The gap
   *  never offers the middle of the deck — a doorway you're already
   *  standing in is a move that asks for nothing. */
  gateHalfW: 0.3,
  gateHalfWLate: 0.22,
  gateHalfWExpert: 0.2,
  gateOffsetMin: 0.22,
  /** Moves per phrase by act — the escalation curve. */
  movesPerPhrase: [2, 3, 4, 5, 6],
  /** Minimum clear beats between one landing and the next telegraph —
   *  bar/half-bar multiples so successive moves stay on the grid. */
  restBeats: [4, 4, 2, 2, 0],
  /** THE DEAD AIR CEILING, by act. `movesPerPhrase` is a floor, not a
   *  quota: while a phrase still has more than this many beats of unclaimed
   *  music, it books another move. Nothing else in the generator bounds
   *  silence — a phrase whose shapes wouldn't fit used to abandon its
   *  remaining slots and hand the floor twenty seconds of standing about.
   *  Easy acts still breathe; the peak never rests two bars.
   *
   *  These are measured inside a phrase, so the gap a dancer actually feels
   *  runs a little longer — the next phrase's opening telegraph still has to
   *  clear its own downbeat. Three bars here reads as about four out there. */
  maxSilentBeats: [12, 10, 8, 8, 8],
  /** THE VISITOR'S PACE — how a DOUBLE-TIME chart is served. EXPERT runs a
   *  slow record on a doubled clock so landings sit where its groove
   *  actually lives (DIFFICULTY.doubleTimeBelowBpm) — but the doubled clock
   *  serving the STANDARD tables threw ~0.9 landings a second, half again
   *  the 122–135 shelf's measured 0.57–0.64, and that mid shelf is the
   *  pocket these charts should live in (the first pass aimed at 135–150,
   *  the second at 122–135, and both still ran hot on the floor — the
   *  sweet spot the floor kept asking for is the 110–117 shelf: perked
   *  up, feel intact). So a doubled chart keeps the grid and borrows that
   *  shelf's EVERYTHING — not just the landing cadence but the reads and
   *  the cascades, all converted to the same real seconds: charges from
   *  its own table below (a beam fills ~1.6 s, a gate ~2.2 s, the routine
   *  teaches over ~4 s, exactly what those records serve), a smaller
   *  quota for the half-length phrases, a roomier dead-air ceiling, wave
   *  marches on the record's own beats, and every cascade gap stretched
   *  to the shelf's spacing.
   *
   *  The cascades stretch to the shelf's spacing. Twin volleys answer at
   *  SEVEN chart beats (~2.2 s — the shelf's own bar; every other volley
   *  sits an eighth off the beat, which on these shuffles and struts is
   *  exactly where the groove's ghosts live). Nova chains and the donut's
   *  one-two take EIGHT — the record's own real bar, so the big booms
   *  keep the strongest landings there are. These volleys dominate the
   *  measured density, which is why the quota knobs alone couldn't buy
   *  the band back. All numbers are CHART beats (the record's eighths);
   *  only doubled charts ever read them, and ChoreoSystem's staged
   *  telegraph windows read the spacing off the landings themselves, so
   *  the gates follow whichever table built the move. */
  /* Tuned against the shelf's measured serve (ten seeds a record):
   *  110–117 on EXPERT throws 0.50–0.56 landings/s (0.60–0.67 in the back
   *  stretch) at ~10.5 moves a minute — the target band for everything
   *  below. Only acts 3 and 4 are reachable (double time is EXPERT's);
   *  the lower rows just keep the arrays' shape coherent.
   *
   *  `chargeBeats` is the read table — the part the earlier passes left
   *  on the doubled clock, which is why the shelf still FELT fast at the
   *  right cadence: a beam was filling in under a second. Each charge is
   *  the standard read × the clock ratio, so in seconds every telegraph
   *  fills exactly as long as it does on a 112 record — and the MC's
   *  wind-up, the charge drone and the telegraph windows all follow the
   *  chart's own telegraphBeat rather than the standard table. */
  doubleTimePace: {
    movesPerPhrase: [2, 3, 3, 3, 3],
    restBeats: [8, 8, 4, 5, 0],
    maxSilentBeats: [16, 14, 12, 14, 14],
    chargeBeats: {
      beam: 5,
      sweep: 7,
      seesaw: 7,
      surge: 7,
      gate: 7,
      nova: 8,
      cross: 7,
      donut: 7,
      routine: 13,
      duckdonut: 10,
      wave: 5,
    } as Record<MoveKind, number>,
    // Seesaw floods stay on the record's own beats — the standard table
    // doubled. The shelf's spacing (3) put every other flood on an eighth,
    // and a flood you cross on reads as off the music there, not a ghost.
    seesawGapBeats: [8, 8, 4, 4, 4],
    waveStepBeats: [4, 4, 2, 2, 2],
    waveTurnExtraBeats: 2,
    routineStepBeats: 5,
    routineDropBeats: 3,
    twinReturnBeats: 7,
    novaChainBeats: 8,
    donutFollowBeats: 8,
  },
};

/**
 * DIFFICULTY — chosen on the board, applied to the whole song. The old
 * universal ramp gave every record a trivially easy opening third; now the
 * player picks the floor and the song adds ONE act of lift in its back
 * stretch (a set still deserves a finale), capped at act 3.
 *
 *   EASY   : acts 0 → 1
 *   NORMAL : acts 1 → 2
 *   HARD   : acts 2 → 3
 *
 * Shared like the song pick: solo it's yours; on the club floor the ball
 * carries the caller's choice so the whole ring dances one chart.
 */
export const DIFFICULTY = {
  labels: ['EASY', 'NORMAL', 'HARD', 'EXPERT'],
  /** EXPERT ONLY. Off the tour there is no picker any more: every solo set
   *  and every ball on the club floor is EXPERT, because the lower floors
   *  read as boring and nearly every run on the world boards was EXPERT
   *  anyway. The tour keeps its own ramp (game/flow.ts startRaid) — EASY,
   *  NORMAL, HARD by set — as the place the moves are learnt. */
  solo: 3,
  baseAct: [0, 1, 2, 3],
  /** The lift: one more act from this fraction of the set on. */
  liftAt: 0.6,
  /** The ceiling. Act 4 is EXPERT's back stretch: six moves a phrase with
   *  no rest between them, and the hardest combinations in the game. */
  maxAct: 4,
  /** EXPERT DOUBLE TIME. The whole pressure curve is written in BEATS —
   *  moves per phrase, rests, charges, cascade gaps — so its real-time
   *  density scales with the record: at act 4 a 91 BPM night threw barely
   *  half the landings per second of a 174 one, and its bar grid walked
   *  right past where those records' grooves actually live (the slow shelf
   *  is shuffles and struts whose onsets ride the eighths — ORIGINAL's sit on
   *  a literal 190 lattice). So on EXPERT, a record under this tempo runs
   *  its whole chart clock at 2×: the grid rides the eighths and landings
   *  hit the real half-bars (the 1 and the 3). The CLOCK doubles for the
   *  grid's sake only — the chart is SERVED at the fast shelf's measured
   *  pace (CHOREO.doubleTimePace), because a doubled clock serving the
   *  standard tables charted 182–196 and played like it, a third past any
   *  record the difficulty ships. The catalog's gap between 98 and 110
   *  makes 100 a robust line, and EXPERT is unreachable on the tour, so
   *  no authored night changes feel.
   *
   *  Deliberately UNANNOUNCED. The menus wear the record's own measured
   *  tempo and nothing else: a "×2" badge beside the BPM explained an
   *  implementation to somebody choosing a song, and the floor already
   *  tells you — a slow record on EXPERT simply comes at you like a fast
   *  one, which is the whole point. */
  doubleTimeBelowBpm: 100,
};

/** The tempo a record CHARTS at — its measured tempo, except on EXPERT
 *  under the double-time line, where the whole clock runs at 2×. Pure, so
 *  every client in a room (same track, same difficulty off the ball)
 *  derives the identical grid. */
export function chartBpm(trackBpm: number, difficulty: number): number {
  return difficulty >= 3 && trackBpm < DIFFICULTY.doubleTimeBelowBpm ? trackBpm * 2 : trackBpm;
}

/* ────────────────────────────── THE GROOVE ───────────────────────────────
 * Dance like the groupies dance: ONE HAND UP, ONE HAND DOWN, and swap on
 * the beat. Every rhythmic swap pays a little — and the payout creeps up
 * the longer you keep the motion going. It never rivals a dodge; it's the
 * tax refund for actually dancing between them.
 *
 * NAMING: neither meter wears a word on screen anymore. The groove
 * answers loudly through the glowsticks (spark bursts off the paying tip)
 * and quietly through the wedge's GROOVE ROW (pips winding up, then a
 * fill bar and the streak's earnings); the dodge chain is the wedge's ×N.
 * The code keeps its groove-flavoured identifiers so the two streaks can
 * never be confused in here.
 */
export const GROOVE = {
  /** Hand separation (m) that counts as "one up, one down" — the size of
   *  the throw, measured between the hands THEMSELVES, not on the world's
   *  vertical. See splitLean for why. */
  split: 0.35,
  /** THE LEAN. Mid-dodge the whole dance tilts — a lunge off a beam, a
   *  crouch under the blade — and a swap thrown just as big stops going
   *  straight up: at 60° of tilt a 0.55 m throw keeps barely 0.27 m of
   *  world-vertical, and the old vertical-only judge read a dancer
   *  grooving THROUGH a dodge as standing still. So the judge asks two
   *  things instead: the hands a full `split` apart in space (the throw
   *  is the same size, just aimed sideways), and at least this much of it
   *  vertical — enough to still name an UP hand, so a level carry (both
   *  sticks out in front, a T-pose) never reads as dancing. Upright play
   *  is untouched: |Δy| ≥ split implies both tests pass. */
  splitLean: 0.16,
  /** Points for a rhythmic swap. */
  base: 6,
  /** Extra points per streak step — the consistency creep. */
  perStreak: 0.5,
  /** The STREAK counter runs to 999 — a whole-night flex on the HUD. */
  streakCap: 999,
  /** …but PAY saturates here (base + 50 = 56 a swap), so the trickle never
   *  outruns dodging no matter how long the flex gets. */
  payCap: 100,
  /**
   * PAY-RATE CAP: rewarded swaps lock to the HALF-BEAT grid. Records have
   * double-time passages (MORNING's fast bits) where swapping on the
   * eighths IS the dance — capping at whole beats forced you to groove
   * slower than the song. Light-speed flailing is still absorbed silently
   * (no reward, no reset): pay can never exceed two swaps a beat, however
   * fast the hands go. Slightly under 0.5 for human timing slop.
   */
  minBeats: 0.45,
  /** Stop swapping for this long and the streak lets go. */
  maxBeats: 2.6,
};

/* ────────────────────────────── THE SCORE ────────────────────────────────
 * Survive a landing → a DODGE: points × the chain multiplier, and the
 * chain climbs one. Get clipped → lose a life, the chain dies, brief
 * i-frames. Three and out. (The chain is `combo` in code — the field rides
 * the score wire; on screen it's just the ×N in your colour.)
 * A PERFECT is a last-instant dodge: you were still inside the doomed zone
 * one beat before impact and clear when it landed — riding the beat.
 */
export const SCORE = {
  base: 100,
  perfectMult: 1.5,
  comboStep: 0.1, // multiplier = 1 + comboStep × min(combo, comboCap)
  comboCap: 30, // → ×4 ceiling
  invulnBeats: 2,
  /** Sample "were you inside the zone" this many beats before impact. */
  perfectProbeBeats: 1,
  /** Survival tick: staying alive pays a trickle every bar so late-game
   *  rankings separate even between flawless dancers. */
  aliveBarBonus: 10,
};

/* ───────────────────────────── THE GRADE ─────────────────────────────────
 * No lives. You dance the whole record and the night grades you at the
 * end — S down to F, off the share of landings you survived, with the
 * top letter reserved for a clean set danced on the last beat.
 *
 * The one way to end early is a CHAIN: three clipped landings back to
 * back and you're off the floor. It is not a budget of three hits — any
 * dodge wipes the count clean. Being clipped costs you your grade; being
 * clipped three times running costs you the night, and takes the letter
 * with it.
 */
export const GRADE = {
  /** Consecutive clipped landings that end your night. A dodge clears it. */
  chainOut: 3,
  /** Beats between a solo game over and the results card — long enough for
   *  the last crush and the flair to land, short enough to feel like an
   *  ending rather than a wait. */
  overBeats: 3,
  /** The letter cuts, best first. `rate` is the share of landings you
   *  survived; `perfect` is the share of those taken on the last beat —
   *  only S asks for it, so the crown means clean AND late. */
  cuts: [
    { letter: 'S', rate: 0.999, perfect: 0.25 },
    { letter: 'A', rate: 0.93, perfect: 0 },
    { letter: 'B', rate: 0.82, perfect: 0 },
    { letter: 'C', rate: 0.62, perfect: 0 },
  ],
  /** Below the last cut — and always, if the chain took you out. */
  fail: 'F',
  /** Letter colours, so the card and the board agree. */
  colors: {
    S: '#ffd75e',
    A: '#b9ffc4',
    B: '#4fb7ff',
    C: '#b06bff',
    F: '#ff5040',
  } as Record<string, string>,
};

/* ─────────────────────────────── THE RANK ────────────────────────────────
 * Alive beats eliminated; among the living, score; among the fallen, who
 * lasted longest. VR height law: NOBODY EVER RENDERS BELOW THE FLOOR.
 * Dancers who outrank you rise above you by the tier gap; your own lift is
 * something only OTHERS see (their clients raise your platform — you can't
 * feel a floor you're not standing on, and nobody has to look at sunken,
 * shortened dancers anymore). Eliminated platforms dim; they don't sink.
 */
export const RANK = {
  championLift: 0.7,
  topTenLift: 0.32,
  /** Height easing rate (per second). */
  lerp: 1.6,
  /** THE RISE: how fast the world sinks under a leading player. The
   *  slowest ease in the game on purpose — taking the lead should feel
   *  like a swell arriving, and losing it like the tide going out, never
   *  an elevator. */
  riseLerp: 0.45,
  /** THE CLIMB: holding rank 1 keeps you going up — the world sinks a
   *  little further every second you stay champion, so a dominant night
   *  ends with the giant's crown below your eyeline. `climbPerSec` is the
   *  accrual; `climbMax` is how much can accrue on top of the champion
   *  lift (0.7 + 4.4 = 5.1 m of rise — the goop stands ~4.4 m). Losing
   *  the lead lets it go at the same gentle riseLerp ease. */
  climbPerSec: 0.09,
  climbMax: 4.4,
  /** Rank recompute cadence (seconds). */
  refresh: 0.25,
};

/* ────────────────────────────── THE PODIUM ───────────────────────────────
 * When the set ends (or, on the tour and on a club ring, one dancer
 * remains) the winner takes the high ground, confetti cannons fire, and
 * the board freezes for the reading.
 */
export const PODIUM = {
  holdSeconds: 18,
};


/* ──────────────────────────────── THE MC ─────────────────────────────────
 * The headliner most nights: a GIANT of the dancers' own kind — same sleek
 * neon humanoid as the groupies, scaled to tower over the stage — whose
 * whole body ACTS OUT every attack during its charge. The point: the tell
 * lives at EYE LEVEL, in silhouette, so nobody has to stare at the floor.
 * The GOOP still owns the set finales (and eats this guy on the way in).
 */
export const MC = {
  /** Rig root scale — the groupie figure is ~1.6 m, so ×2.1 ≈ a 3.4 m icon. */
  scale: 2.1,
  /** Signature colour (hue for hueToColor) — royal violet. He wore the
   *  stage's own icy cyan for a while and read as scenery; purple against
   *  his gold warn burn is the headliner's outfit, and it sits inside the
   *  disco's magenta/cyan/violet vocabulary without touching danger amber,
   *  red, or goop green. One number to taste. */
  hue: 0.8,
  /** Sticks/accents flip to WARN amber while a move charges. */
  warnColor: 0xffb03a,
  /**
   * THE WARDROBE. He does not wear one colour all night: the map, the
   * floor, the count-in, the record and the podium each dress him, and a
   * SET takes its colour from the record on the decks — so walking from
   * the menu into a song visibly changes the headliner.
   *
   * THE ONE LAW: never red, never yellow. Danger speaks hazard amber→red
   * (telegraphs, beams, novas — PALETTE DISCIPLINE above), so an MC in
   * either is an MC who looks like a warning. Every hue he can wear is
   * folded into a SAFE BAND that starts past yellow and stops before red
   * comes round again: greens, cyans, blues, violets, magentas. The band
   * is the guarantee — nothing that picks his colour, not even a hash of
   * a track id, can put him in the danger vocabulary.
   */
  band: { lo: 0.28, hi: 0.92 },
  /** His outfit per place (hues; folded through the band anyway). */
  wear: { tour: 0.8, lobby: 0.88, countdown: 0.55, podium: 0.36 },
  /** How fast he changes between them (hue units per second). */
  changeRate: 0.5,
};

/** Fold any hue into the MC's SAFE BAND — out of red and yellow, for good. */
export function mcSafeHue(hue: number): number {
  const t = (((hue % 1) + 1) % 1);
  return MC.band.lo + t * (MC.band.hi - MC.band.lo);
}

/**
 * THE VISIT. He does not wear the same colour on the floor two nights
 * running: every arrival in the club (from the arena's door, from the
 * foyer, from the podium after a set) turns his wardrobe one notch, and
 * the notch is remembered across sessions so tomorrow's visit is not a
 * repeat of tonight's. The stride is a big irrational-ish step through the
 * band, so consecutive visits land far apart on the wheel — and it is
 * folded through the safe band like everything else, so the floor never
 * dresses him red or yellow either.
 */
const VISIT_KEY = 'gdr-mc-visits';
const VISIT_STRIDE = 0.38;
let mcVisit = ((): number => {
  try {
    return Number(localStorage.getItem(VISIT_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
})();

/** A new visit to the floor: turn the wardrobe one notch and remember it. */
export function nextMcVisit(): void {
  mcVisit++;
  try {
    localStorage.setItem(VISIT_KEY, String(mcVisit));
  } catch {
    /* private mode — this session still turns */
  }
}

/** Which visit this is (the probe reads it to prove the notch turned). */
export function mcVisitCount(): number {
  return mcVisit;
}

/** The colour the MC should be wearing right now: the place he's in, and —
 *  once a record is on the decks — that record's own hue (a stable hash of
 *  the track id, folded into the safe band, so every song dresses him
 *  differently and the same song always dresses him the same). On the
 *  floor, the visit turns the colour too (see THE VISIT above). */
export function mcHueFor(screen: string, trackId: string): number {
  if ((screen === 'raid' || screen === 'countdown') && trackId) {
    let h = 2166136261;
    for (let i = 0; i < trackId.length; i++) {
      h ^= trackId.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const t = ((h >>> 0) % 10007) / 10007;
    // The count-in keeps its own cool blue-cyan; the record's colour lands
    // with the first downbeat.
    return screen === 'countdown' ? mcSafeHue(MC.wear.countdown) : mcSafeHue(t);
  }
  if (screen === 'lobby') return mcSafeHue(MC.wear.lobby + mcVisit * VISIT_STRIDE);
  const wear = MC.wear as Record<string, number>;
  return mcSafeHue(wear[screen] ?? MC.hue);
}

/* ─────────────────────────────── THE TOUR ────────────────────────────────
 * The campaign proper: NIGHTS grouped into SETS of three records. Nights
 * unlock in order; a set's third night is the GOOP FINALE — the gel returns
 * in a new colour and EATS the MC as the record starts. The first
 * `freeSets` sets ship with the game; the teaser row at the bottom of the
 * tour screen is where paid sets would slot in later.
 */
export interface TourSet {
  id: string;
  name: string;
  /** Exactly three track ids (audio/tracks.ts); index 2 is the finale. */
  songs: [string, string, string];
  /** Finale gel tint (gelMaterial uniforms); null = the classic green. */
  tint: { shallow: number; deep: number; nucleus: number } | null;
}

export const TOUR: { sets: TourSet[]; freeSets: number; maxPhrases: number } = {
  freeSets: 3,
  /** Tour nights cap here even when the record could run longer — UNITY is
   *  five minutes; a campaign night shouldn't be. Free play still rides the
   *  whole file. */
  maxPhrases: 12,
  sets: [
    {
      id: 'opening',
      name: 'OPENING SET',
      // The night starts in the MORNING — short, fun, duck-free — then
      // SAKUPENED kicks the pace up before CAPTURE brings in the first goop.
      songs: ['morning', 'sakupened', 'capture'], // 97 → 134 → 117 BPM
      tint: null, // the classic green goop
    },
    {
      id: 'peak',
      name: 'PEAK HOURS',
      // The night after the first goop falls opens on DISCO BALL — a slow
      // 73 BPM strut, the victory lap — MONEY keeps the swagger going at
      // 78, and then DYNASTY kicks the doors in. Two laid-back records
      // then a hard turn: the climb lives in the last night, not the walk
      // up to it. Neither opener asks anyone to duck. COMBAT and LOOP both
      // hold quick-raid seats now.
      songs: ['discoball', 'money', 'dynasty'], // 73 → 78 → 155 BPM
      tint: { shallow: 0xff6ee0, deep: 0x571040, nucleus: 0xff9ff0 }, // hot magenta
    },
    {
      id: 'afterhours',
      name: 'AFTER HOURS',
      // No repeats anywhere on the tour. SPREAD replaced UNITY (a fight
      // record where a five-minute journey used to sit) and, being the
      // faster of the two openers, it plays second so the set still climbs.
      // GIVE IT TO ME has INFECTION's old seat, which opens the last night
      // 26 BPM lower and makes the step into SPREAD the steepest on the
      // tour — the climb is the whole shape of this set, so a longer run-up
      // suits it. (INFECTION keeps its place on the SOLO shelf.)
      songs: ['giveit', 'spread', 'breakcore'], // 112 → 150 → 174 BPM
      tint: { shallow: 0xffd24a, deep: 0x6e3c06, nucleus: 0xffefad }, // molten gold
    },
  ],
};

export const TOUR_KEY = 'gdr-tour';

/* ─────────────────────────────── THE BOTS ────────────────────────────────
 * Empty seats are filled with bots — seeded, deterministic dancers every
 * client simulates identically (no bot netcode: same seed, same outcome,
 * same leaderboard everywhere). They wear plain service tags (BOT01…),
 * numbered around the ring in state.buildRoster.
 */
export const BOTS = {
  /** Dodge chance range rolled per bot from the match seed. */
  skillMin: 0.7,
  skillMax: 0.96,
  /** Dodge chance shrinks by this per act (the floor thins as the set peaks). */
  actPenalty: 0.05,
};

/* ─────────────────────────────── THE LOOK ────────────────────────────────
 * An absolute disco: neon on the void's black. Everything additive — a
 * bloom-ish glow without post-processing.
 */
export const PALETTE = {
  goopGreen: 0x36e05a,
  goopDeep: 0x14602f,
  magenta: 0xff2ad5,
  cyan: 0x4fb7ff,
  violet: 0xb06bff,
  amber: 0xffb000,
  danger: 0xe8352a,
  whiteHot: 0xfff3cf,
  white: 0xf4f6fb,
  mirror: 0xcfd8e6,
};

/**
 * PALETTE DISCIPLINE — how you tell an attack from the party:
 * danger speaks ONLY hazard amber→red (telegraphs, beams, novas) and goo
 * green (the gel itself arriving); the disco speaks magenta/cyan/violet.
 * The two vocabularies never share a colour, and while a telegraph charges
 * on YOUR deck the disco DUCKS (lasers and shafts fade to a quarter) so the
 * warning owns the room.
 */

/* (The old ROOM DIM / SET VOID passthrough toggle is gone: the game is FULL
 * VR now — the void environment IS the set's world, always, and the scene
 * carries an opaque backdrop everywhere. No halfway states.) */

/** Laser fan hues cycled by the light rig. */
export const LASER_HUES = [0.9, 0.55, 0.75, 0.33, 0.12];

/** Seat accent hue: golden-angle walk around the wheel — 24 distinct neons. */
export function seatHue(seat: number): number {
  return (seat * 0.381966) % 1;
}

/** hue (0..1) → saturated neon colour. */
export function hueToColor(hue: number, light = 0.55): number {
  const h = (((hue % 1) + 1) % 1) * 6;
  const l = Math.max(0.2, Math.min(0.9, light));
  const c = (1 - Math.abs(2 * l - 1)) * 1;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1) {
    r = c;
    g = x;
  } else if (h < 2) {
    r = x;
    g = c;
  } else if (h < 3) {
    g = c;
    b = x;
  } else if (h < 4) {
    g = x;
    b = c;
  } else if (h < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return (R << 16) | (G << 8) | B;
}

/* ────────────────────────────── NETWORKING ───────────────────────────────
 * Optional — the game is fully playable solo against the groupies. With a
 * relay up (npm run server) you host a room, read out the 4-digit code, and
 * the server hands everyone a seat, the seed and a shared start time. The
 * whole choreography is deterministic from the seed, so the wire only
 * carries poses, hits and scores.
 */
export const NET = {
  poseRateHz: 10,
  scoreRateHz: 3,
  smoothing: 14,
  /** THE ROOM SERVER's port (server/room.mjs) — the rave's relay answers
   *  at /rave on it. A relay run alone (server:rave) is on 8788, bare. */
  defaultPort: 8787,
  path: '/rave',
};

/** The hosted room relay: THE ROOM SERVER's /rave mount (server/room.mjs,
 *  deployed once and serving the duel relay and the pub alongside this).
 *  Override per-session with ?server=wss://… or localStorage 'gdr-server'. */
export const DEFAULT_RELAY = `${ROOM_SERVER}${NET.path}`;

/** Resolve the relay URL: ?server= param > localStorage > a local dev
 *  relay when the page itself is local > the hosted relay (raveraid.web.app
 *  and friends can't reach ws://localhost). */
export function serverUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  try {
    const stored = localStorage.getItem('gdr-server');
    if (stored) return stored;
  } catch {
    /* storage may be unavailable */
  }
  // roomServerHost() sorts out dev-vs-deployed; the rave just asks for its
  // own mount on whichever room server that turns out to be.
  return `${roomServerHost()}${NET.path}`;
}
