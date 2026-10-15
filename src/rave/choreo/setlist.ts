/**
 * The SET-LIST — the entire raid choreographed up front, deterministically,
 * from the match seed.
 *
 * Every move is a telegraph → landing pair quantized to the beat grid:
 * telegraphs start on beats, landings hit BAR downbeats, multi-part moves
 * (slam drumlines, seesaw cascades) step on beats after their first landing.
 * The same seat-local pattern marks EVERY platform simultaneously — one
 * giant's move, twenty-four floors lighting up as one — so the raid is fair
 * by construction and no client ever has to be told what the boss will do.
 *
 * The nova is the exception that proves the rule: its safe wedge is one
 * CANONICAL compass bearing shared by the whole ring (each seat sees it
 * rotated into its own frame), so the entire floor rotates to the same
 * ground together. Pure spectacle, still deterministic.
 */

import {
  CHOREO,
  DIFFICULTY,
  MOVES,
  MUSIC,
  type MoveKind,
} from '../config.js';
import { mix, mulberry32 } from '../game/rng.js';

/** A seat-local danger zone, judged at its landing beat. */
export type Zone =
  /** A laser strip. `yaw` spins it about the deck centre (THE X throws two
   *  at ±45° through the middle); `x` is the perpendicular offset. */
  | { kind: 'lane'; x: number; halfW: number; yaw?: number }
  /** The crossfire's side laser: a strip ACROSS the deck at local z, fed
   *  from the rail on `from` — step forward or back off it. */
  | { kind: 'rail'; z: number; halfD: number; from: 1 | -1 }
  /** The rim burns, the middle lives — everything outside `innerR` is
   *  doomed, so the whole ring collapses toward its own centre. */
  | { kind: 'donut'; innerR: number }
  /** One step of THE ROUTINE: the deck's four quarters, and `corner` is
   *  the only one that lives. Every step carries the WHOLE routine so the
   *  preview (and the boss's body) can teach it before step one lands.
   *  Corner bit 0 = local +x, bit 1 = local +z. */
  | { kind: 'quad'; corner: number; step: number; routine: readonly number[] }
  | { kind: 'sweep' }
  | { kind: 'half'; side: 1 | -1; axis: 0 | 1 }
  /** Everything burns EXCEPT a clear band at `at` — stand in the gap.
   *  axis 0: a COLUMN at local x (sidestep in). axis 1: the horizontal
   *  cousin — a ROW at local z (step forward or back into it). */
  | { kind: 'gate'; at: number; half: number; axis: 0 | 1 }
  | { kind: 'nova'; bearing: number; halfAngle: number };

/** One landing within a move (a move may land several beats in a row). */
export interface Landing {
  /** Song beat this zone detonates. */
  beat: number;
  zone: Zone;
}

export interface SetMove {
  index: number;
  kind: MoveKind;
  /** Telegraphs appear here… */
  telegraphBeat: number;
  /** …and the first landing hits here (a bar downbeat). */
  landBeat: number;
  landings: Landing[];
  /** Musical act 0..3 at the landing (drives strike visuals + bot odds). */
  act: number;
}

const barBeats = MUSIC.beatsPerBar;
const phraseBeats = MUSIC.beatsPerBar * MUSIC.barsPerPhrase;

/** Act for a phrase within a set of `total` phrases: the chosen DIFFICULTY
 *  sets the floor for the whole song, and the back stretch lifts one act —
 *  a set still deserves a finale, but nobody sits through a trivial
 *  opening third ever again. */
export function actOfPhrase(phrase: number, total: number, difficulty = 1): number {
  const progress = total > 0 ? phrase / total : 0;
  const base = DIFFICULTY.baseAct[Math.max(0, Math.min(DIFFICULTY.baseAct.length - 1, difficulty))];
  return Math.min(DIFFICULTY.maxAct, base + (progress >= DIFFICULTY.liftAt ? 1 : 0));
}

export function actOfBeat(beat: number, totalPhrases: number, difficulty = 1): number {
  return actOfPhrase(Math.floor(Math.max(0, beat) / phraseBeats), totalPhrases, difficulty);
}

/**
 * The MOVEMENT GRAMMAR: every kind's dodge asks the body for one primary
 * verb. Successive moves are steered AWAY from repeating a verb, so the
 * floor keeps travelling — out and in, left and right, forward and back —
 * instead of sidestepping three times in a row.
 */
const VERB: Record<MoveKind, string> = {
  beam: 'lateral',
  seesaw: 'lateral',
  gate: 'lateral', // the row gate reads as depth, but the kind leans lateral
  cross: 'depth',
  surge: 'depth',
  donut: 'radial',
  duckdonut: 'radial',
  nova: 'compass',
  sweep: 'duck',
  routine: 'corners',
  wave: 'travel', // the whole-deck crossing — its own verb, never damped
};

function pickKind(
  rng: () => number,
  act: number,
  last: MoveKind | null,
  banned: readonly MoveKind[],
): MoveKind {
  const kinds = Object.keys(MOVES) as MoveKind[];
  const pool: Array<[MoveKind, number]> = [];
  let total = 0;
  for (const k of kinds) {
    if (banned.includes(k)) continue; // this record never calls it
    if (k === 'duckdonut' && banned.includes('sweep')) continue; // no duck → no combo
    if (k === last) continue; // NEVER the same move twice running
    const weights = MOVES[k].weights;
    let w = weights[Math.min(act, weights.length - 1)];
    if (w <= 0) continue;
    if (last && VERB[k] === VERB[last]) w *= 0.35; // same verb, new face — still a rut
    pool.push([k, w]);
    total += w;
  }
  let roll = rng() * total;
  for (const [k, w] of pool) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return pool[0]?.[0] ?? 'beam';
}

/** A move's read length on this chart: the standard table, or — on a
 *  double-time chart — the visitor's charges, which convert the same read
 *  into the doubled clock's beats so it fills over the same real seconds
 *  a 110–117 record gives it. Exported for ChoreoSystem (the swept
 *  routine's staggered blades run the sweep's own fuse). */
export function chartChargeBeats(kind: MoveKind, doubleTime: boolean): number {
  return doubleTime ? CHOREO.doubleTimePace.chargeBeats[kind] : MOVES[kind].chargeBeats;
}

/** THE BOUNCE's two odds, indexed by volley: [_, does it answer, does it
 *  come back across]. Volley 2 is a shove; volley 3 is the rally. From
 *  `twinAlwaysFromAct` up both are certainties, so a double laser on the
 *  expert acts is ALWAYS the full three — left, right, left — and never a
 *  single shove across. Both twins, lateral and vertical, read this pair.
 *
 *  Returning 1 rather than skipping the rolls keeps the seeded stream
 *  aligned: every client still draws the same numbers in the same order,
 *  whatever the act. */
function twinKeep(act: number): number[] {
  if (act >= CHOREO.twinAlwaysFromAct) return [0, 1, 1];
  const at = (a: readonly number[]): number => a[Math.min(act, a.length - 1)]!;
  return [0, at(CHOREO.twinReturnChance), at(CHOREO.twinBounceChance)];
}

/**
 * Which side a twin opens on: the one the last move parked the floor on,
 * so the first pair lands where the dancers actually are. `at` is the
 * park's coordinate on the twin's axis (x for the lateral twin, z for the
 * vertical one); undefined — an unknowable park, i.e. after a nova —
 * falls back to the coin. ALWAYS consumes the roll, so a chart's random
 * stream stays aligned whether or not there was a park to aim at.
 */
function twinSide(rng: () => number, at: number | undefined): 1 | -1 {
  const coin: 1 | -1 = rng() < 0.5 ? 1 : -1;
  if (at === undefined || Math.abs(at) < 0.06) return coin; // parked on the line
  return at > 0 ? 1 : -1;
}

/** Build one move's landings from the seeded rng (seat-local pattern).
 *  `sweptRoutines` is the chart-wide coin for THE SWEPT ROUTINE — rolled
 *  once per song, so some expert nights carry it and some never do.
 *  `park` is where the LAST move left a dancer who played it right (see
 *  THE FLOOR MANAGER); the twins aim their opening volley at it.
 *  `doubleTime` reads every cascade gap from the doubled pace table:
 *  routine steps stretch back to the real seconds the fast shelf serves
 *  them at, while seesaw floods stay on the record's real beats and the
 *  bar-locked cascades (twin returns, nova chains, the donut's one-two)
 *  keep their own spacing. */
function buildLandings(
  kind: MoveKind,
  landBeat: number,
  act: number,
  rng: () => number,
  sweptRoutines = false,
  park: Park = null,
  doubleTime = false,
  expert = false,
): Landing[] {
  const landings: Landing[] = [];
  if (kind === 'beam') {
    const halfW = CHOREO.beamHalfWidth;
    const laneAt = (beat: number, x: number) => landings.push({ beat, zone: { kind: 'lane', x, halfW } });
    const lane = (x: number) => laneAt(landBeat, x);
    if (act < 2) {
      // One laser, and it lands on a SLOT: the middle, or a third out.
      lane(CHOREO.beamSlots[Math.floor(rng() * CHOREO.beamSlots.length)]);
    } else if (rng() < CHOREO.beamXChance[Math.min(act, CHOREO.beamXChance.length - 1)]) {
      // THE X: two beams thrown diagonally at once, crossing dead centre.
      // The safe ground is the four pockets between the arms — the dodge
      // is radial, out of the cross, not a sidestep off a line. The arms
      // run thin so the pockets are real rooms, not slivers.
      const xw = CHOREO.beamXHalfW;
      landings.push({ beat: landBeat, zone: { kind: 'lane', x: 0, halfW: xw, yaw: Math.PI / 4 } });
      landings.push({ beat: landBeat, zone: { kind: 'lane', x: 0, halfW: xw, yaw: -Math.PI / 4 } });
    } else if (rng() < CHOREO.beamSplitChance[Math.min(act, CHOREO.beamSplitChance.length - 1)]) {
      // SPLIT: evenly spaced either side of centre. What's left is a
      // corridor down the middle — the dodge is to stand BETWEEN them.
      lane(-CHOREO.beamSplitX);
      lane(CHOREO.beamSplitX);
    } else {
      // TWIN: two strips shoulder to shoulder, taking one whole side and
      // the middle with them. No corridor, no choice — get across.
      //
      // THE BOUNCE: and then it does it again, mirrored, a bar later — and
      // again after that, back on the side it opened with. Each volley
      // lands on the ground the one before it chased you onto, so the pair
      // stops being a shove across the deck and becomes a rally: left,
      // right, left. The chain always ALTERNATES, so however long it runs
      // the answer never changes — the strips are coming, go the other way.
      const inner = CHOREO.beamTwinInner;
      const outer = CHOREO.beamTwinInner + halfW * 2 + 0.02;
      const keep = twinKeep(act);
      // THE OPENER IS AIMED. Whatever ran last — a wave's march, the
      // routine's corner, a gate, a seesaw — left the floor standing
      // somewhere known, and the twin's first pair lands on THAT side.
      // Rolled at random it was a coin whether the rally even started
      // where anybody was: half the time the opening volley burned the
      // empty half of the deck and the move only began on the answer.
      // Aimed, the shove starts on the beat it fires, and the alternating
      // chain still means the read never changes — go the other way.
      // (After a NOVA the park is null: its wedge lands somewhere
      // different on every deck, so there is no shared side to aim at and
      // the coin is the honest answer.)
      let side: 1 | -1 = twinSide(rng, park?.x);
      lane(side * inner);
      lane(side * outer);
      const ret = doubleTime ? CHOREO.doubleTimePace.twinReturnBeats : CHOREO.twinReturnBeats;
      for (let v = 1; v < CHOREO.twinChainMax && rng() < keep[v]; v++) {
        side = -side as 1 | -1;
        const at = landBeat + v * ret;
        laneAt(at, side * inner);
        laneAt(at, side * outer);
      }
    }
  } else if (kind === 'donut') {
    // THE ONE-TWO: a laser straight down the middle drives everyone off
    // centre, and a bar later the rim closes and the middle is the only
    // ground left. Out, then back — the whole deck used in four beats.
    // (The ring's own telegraph holds off until the laser has fired; see
    // ChoreoSystem, which gates the second stage's window.)
    // THE SAFE DISC tightens act by act — except on EXPERT, where every
    // donut in the night is the same tight disc. This is the one move you
    // run BACK INTO on memory (the opening laser drives you off the very
    // ground the rim then demands), so a middle that quietly resizes
    // between phrases asks you to re-learn the answer mid-set. Expert
    // holds the tightest disc from the first bar and never moves it.
    const innerR = expert
      ? CHOREO.donutInnerRExpert
      : act >= 3
        ? CHOREO.donutInnerRLate
        : CHOREO.donutInnerR;
    const opens = rng() < CHOREO.donutOpenChance;
    if (opens) {
      landings.push({
        beat: landBeat,
        zone: { kind: 'lane', x: 0, halfW: CHOREO.beamHalfWidth },
      });
    }
    landings.push({
      beat: landBeat + (opens ? (doubleTime ? CHOREO.doubleTimePace.donutFollowBeats : CHOREO.donutFollowBeats) : 0),
      zone: { kind: 'donut', innerR },
    });
  } else if (kind === 'cross') {
    // LASERS FROM THE SIDES: a strip across the deck, always pushed off
    // centre so one side of it is roomy ground and the read is obvious.
    // From the lattice act on, a stage lane crosses it on the same beat and
    // the safe ground becomes a quarter — the dodge turns diagonal.
    // THE TRAP (late acts, on a roll): TWO rails on the same beat, one
    // from each side emitter, symmetric about the centreline — the safe
    // ground is the corridor pinned between them. Sideways lasers that
    // close like jaws; the read is the gap.
    const trapChance = CHOREO.railTrapChance[Math.min(act, CHOREO.railTrapChance.length - 1)];
    if (rng() < trapChance) {
      landings.push({
        beat: landBeat,
        zone: { kind: 'rail', z: -CHOREO.railTrapZ, halfD: CHOREO.railHalfDepth, from: -1 },
      });
      landings.push({
        beat: landBeat,
        zone: { kind: 'rail', z: CHOREO.railTrapZ, halfD: CHOREO.railHalfDepth, from: 1 },
      });
      return landings;
    }
    // THE VERTICAL TWIN: the beam's twin, quarter-turned. Two rails
    // shoulder to shoulder take one whole HALF — both from the same
    // emitter, one battery firing a pair — and the RETURN mirrors them onto
    // the other half a bar later. Two at the back, then two at the front:
    // the deck's front/back answer to the lateral twin's walk across, and
    // the surest way to make a floor that only ever sidesteps travel.
    const twinChance = CHOREO.railTwinChance[Math.min(act, CHOREO.railTwinChance.length - 1)];
    if (rng() < twinChance) {
      const halfD = CHOREO.railHalfDepth;
      const inner = CHOREO.railTwinInner;
      const outer = CHOREO.railTwinInner + halfD * 2 + 0.02;
      // Aimed like its lateral twin, on the depth axis: the pair floods
      // the half the last move parked you in. (+1 floods the back.)
      let side: 1 | -1 = twinSide(rng, park?.z);
      let from: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const pair = (beat: number, at: number, emitter: 1 | -1) => {
        landings.push({ beat, zone: { kind: 'rail', z: at * inner, halfD, from: emitter } });
        landings.push({ beat, zone: { kind: 'rail', z: at * outer, halfD, from: emitter } });
      };
      pair(landBeat, side, from);
      // The same BOUNCE, quarter-turned: back, front, back. Each answering
      // battery fires from the OTHER rail, so every volley announces itself
      // as a new machine rather than a repeat of the last one.
      const keep = twinKeep(act);
      const ret = doubleTime ? CHOREO.doubleTimePace.twinReturnBeats : CHOREO.twinReturnBeats;
      for (let v = 1; v < CHOREO.twinChainMax && rng() < keep[v]; v++) {
        side = -side as 1 | -1;
        from = from === 1 ? -1 : 1;
        pair(landBeat + v * ret, side, from);
      }
      return landings;
    }
    // A single rail always lands on the FRONT half (toward the stage,
    // where your eyes already are) — one strip behind your back was a
    // read nobody should be asked to make. The trap and the wave keep
    // their rear ground: both telegraph as a whole-deck event.
    const z = -(CHOREO.railOffsetMin + rng() * (CHOREO.railOffsetMax - CHOREO.railOffsetMin));
    const from: 1 | -1 = rng() < 0.5 ? 1 : -1;
    landings.push({ beat: landBeat, zone: { kind: 'rail', z, halfD: CHOREO.railHalfDepth, from } });
    if (act >= CHOREO.latticeFromAct) {
      const xSign = rng() < 0.5 ? 1 : -1;
      landings.push({
        beat: landBeat,
        zone: { kind: 'lane', x: xSign * (0.2 + rng() * 0.32), halfW: CHOREO.beamHalfWidth },
      });
    }
  } else if (kind === 'routine') {
    // THE MEMORY TEST. A seeded shuffle of the four quarters, cut to
    // length — a shuffle can't repeat a corner, so "never the same corner
    // twice" is true by construction rather than by retrying rolls.
    const bag = [0, 1, 2, 3];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const want = CHOREO.routineSteps[Math.min(act, CHOREO.routineSteps.length - 1)];
    const routine = bag.slice(0, Math.max(2, Math.min(4, want)));
    // THE SWEPT ROUTINE (act 4, on the charts that carry it): every blast
    // arrives under the sweep's blade — stand in the taught corner AND
    // duck on each tick. The memory test and the limbo, one body.
    const swept = sweptRoutines && act >= 4;
    const stepBeats = doubleTime ? CHOREO.doubleTimePace.routineStepBeats : CHOREO.routineStepBeats;
    routine.forEach((corner, step) => {
      const beat = landBeat + step * stepBeats;
      landings.push({ beat, zone: { kind: 'quad', corner, step, routine } });
      if (swept) landings.push({ beat, zone: { kind: 'sweep' } });
    });
  } else if (kind === 'wave') {
    // THE WAVE: beams marching 1-2-3 across the deck — travel with the
    // march into the EXIT: the last quarter never fires, so the crossing
    // has a destination instead of a countdown. Sideways (lanes walking x)
    // or front/back (rails walking z); each stop's telegraph runs the
    // beam's own short fuse, staggered, so the deck reads as a wave
    // building.
    //
    // THE TURN — on every wave: the march wheels AT the exit and comes
    // back. Its first return strike is the exit square itself, a double
    // step plus one whole beat late (you only just got there; the
    // breather is the read), and the new exit is the far side where the
    // whole thing began. Across, and all the way back.
    //
    // THE LONG WAVE — EXPERT, sometimes: it wheels a SECOND time and runs
    // the deck again, so the move goes across, back, and across once more
    // — the twin bounce's rally, marched instead of fired.
    const axis: 0 | 1 = rng() < 0.5 ? 1 : 0;
    const steps = doubleTime ? CHOREO.doubleTimePace.waveStepBeats : CHOREO.waveStepBeats;
    const step = steps[Math.min(act, steps.length - 1)];
    const turnExtra = doubleTime ? CHOREO.doubleTimePace.waveTurnExtraBeats : CHOREO.waveTurnExtraBeats;
    const stops = axis ? CHOREO.waveRailZ : CHOREO.waveLaneX;
    const ordered = rng() < 0.5 ? [...stops] : [...stops].reverse();
    const at: number[] = ordered.slice(0, -1); // out over three; exit = ordered[3]
    const beats: number[] = at.map((_, i) => landBeat + i * step);
    const turnAt = beats[beats.length - 1] + step * 2 + turnExtra;
    [ordered[3], ordered[2], ordered[1]].forEach((stop, i) => {
      at.push(stop);
      beats.push(turnAt + i * step);
    });
    // Rolled before the gate, never inside it, so the seeded stream draws
    // the same numbers in the same order whatever the difficulty.
    const third = rng() < CHOREO.waveThirdChance && expert;
    if (third) {
      // The return parked everyone at ordered[0]; the third leg walks back
      // out from there, exit returning to the far side it started from.
      const backAt = beats[beats.length - 1] + step * 2 + turnExtra;
      [ordered[0], ordered[1], ordered[2]].forEach((stop, i) => {
        at.push(stop);
        beats.push(backAt + i * step);
      });
    }
    const from: 1 | -1 = rng() < 0.5 ? 1 : -1;
    at.forEach((stop, i) => {
      landings.push({
        beat: beats[i],
        zone: axis
          ? { kind: 'rail', z: stop, halfD: CHOREO.railHalfDepth, from }
          : { kind: 'lane', x: stop, halfW: CHOREO.beamHalfWidth },
      });
    });
  } else if (kind === 'duckdonut') {
    // THE COMBINATION: the rim floods AND the blade hangs over the middle
    // — get to the centre and DUCK there. Both zones detonate together;
    // both answers are ones the set already taught.
    // Its disc is EXPERT's tight one, always — the roomy opener disc made
    // the rarest move in the game gentler than the plain donut beside it,
    // and a once-a-night finale shouldn't come with training wheels. It
    // only ever deals from the top two acts, where the tight middle is
    // either already the law (expert) or exactly one act away (hard's
    // back stretch serving donutInnerRLate).
    landings.push({ beat: landBeat, zone: { kind: 'sweep' } });
    landings.push({ beat: landBeat, zone: { kind: 'donut', innerR: CHOREO.donutInnerRExpert } });
  } else if (kind === 'sweep') {
    landings.push({ beat: landBeat, zone: { kind: 'sweep' } });
  } else if (kind === 'gate') {
    // The doorway — or, half the time, its horizontal cousin: a clear ROW
    // at a depth line, so the gap asks for a forward/back step instead.
    // The gap never sits over the middle: a doorway you're probably
    // already standing in asks for nothing.
    const axis: 0 | 1 = rng() < 0.5 ? 1 : 0;
    const span = axis ? 0.35 : 0.5;
    const off = CHOREO.gateOffsetMin + rng() * (span - CHOREO.gateOffsetMin);
    landings.push({
      beat: landBeat,
      zone: {
        kind: 'gate',
        at: (rng() < 0.5 ? 1 : -1) * off,
        half: act >= 4 ? CHOREO.gateHalfWExpert : act >= 3 ? CHOREO.gateHalfWLate : CHOREO.gateHalfW,
        axis,
      },
    });
  } else if (kind === 'seesaw' || kind === 'surge') {
    const axis: 0 | 1 = kind === 'surge' ? 1 : 0;
    const stages = 2 + Math.min(act, kind === 'surge' ? 2 : 3);
    const gaps = doubleTime ? CHOREO.doubleTimePace.seesawGapBeats : CHOREO.seesawGapBeats;
    const gap = gaps[Math.min(act, gaps.length - 1)];
    let side: 1 | -1 = rng() < 0.5 ? 1 : -1;
    for (let i = 0; i < stages; i++) {
      landings.push({ beat: landBeat + i * gap, zone: { kind: 'half', side, axis } });
      side = side === 1 ? -1 : 1;
    }
  } else {
    // nova: one canonical compass bearing for the whole ring — and at the
    // set's peak, THE CHAIN: three SINGULAR pies one after the other, each
    // safe wedge a third of the compass on, so the wedges partition the
    // whole rose and the ring walks the full way around together. Each
    // disc appears only as the previous pie detonates (ChoreoSystem gates
    // the telegraph per landing) — one pie on the floor at a time, ever.
    const slices = act >= 3 ? 3 : act >= 2 && rng() < 0.45 ? 2 : 1;
    // THE WEDGE. It tightens act by act — except on EXPERT, which holds one
    // wedge all night, cut a touch wider than the last act used to. Every
    // expert nova is a three-pie chain, and three walks around the rose in
    // a row want a slice you can stand in rather than thread.
    const halfAngle = expert
      ? CHOREO.novaHalfAngleExpert
      : act >= 3
        ? CHOREO.novaHalfAngleLate
        : CHOREO.novaHalfAngle;
    let bearing = rng() * Math.PI * 2;
    const turn = (rng() < 0.5 ? 1 : -1) * CHOREO.novaChainTurn;
    const chain = doubleTime ? CHOREO.doubleTimePace.novaChainBeats : CHOREO.novaChainBeats;
    for (let i = 0; i < slices; i++) {
      landings.push({ beat: landBeat + i * chain, zone: { kind: 'nova', bearing, halfAngle } });
      bearing += turn;
    }
  }
  return landings;
}

/* ── THE FLOOR MANAGER ──────────────────────────────────────────────────
 * The set-list can't see the player (every deck runs the identical chart),
 * but it CAN know where each move's correct dodge PARKS a dancer who plays
 * it right: the split's corridor parks you dead centre, the seesaw leaves
 * you hugging the centreline, the donut ends in the middle by definition.
 * So the generator carries that parking spot forward and re-rolls any move
 * whose danger never touches it — a move that asks nothing of the ground
 * you're standing on is a move that didn't happen. A `null` park means
 * "somewhere unknowable" (the nova's wedge is a different place on every
 * deck) and accepts anything.
 */
export type Park = { x: number; z: number } | null;

function laneCovers(zone: { x: number; halfW: number; yaw?: number }, p: { x: number; z: number }): boolean {
  const yaw = zone.yaw ?? 0;
  const perp = yaw ? Math.cos(yaw) * p.x - Math.sin(yaw) * p.z : p.x;
  return Math.abs(perp - zone.x) <= zone.halfW + 0.12;
}

/** Does any landing of this move touch the park — i.e., demand something
 *  of a dancer standing exactly where the last move left them? */
export function evictsPark(landings: readonly Landing[], park: Park): boolean {
  if (!park) return true;
  return landings.some(({ zone }) => {
    switch (zone.kind) {
      case 'lane':
        return laneCovers(zone, park);
      case 'rail':
        return Math.abs(park.z - zone.z) <= zone.halfD + 0.12;
      case 'donut':
        return Math.hypot(park.x, park.z) > zone.innerR - 0.05;
      case 'gate':
        return Math.abs((zone.axis ? park.z : park.x) - zone.at) > zone.half - 0.05;
      case 'half':
        return (zone.axis ? park.z : park.x) * zone.side > -0.06;
      case 'sweep': // the duck is a demand wherever you stand
      case 'nova': // dead centre is never safe, and the wedge rotates per seat
      case 'quad': // the routine makes you commit, corner to corner
        return true;
    }
  });
}

/** Where this move's correct dodge leaves a dancer standing. */
export function parkOf(kind: MoveKind, landings: readonly Landing[], prev: Park): Park {
  const p = prev ?? { x: 0, z: 0 };
  const cx = (x: number) => Math.max(-0.7, Math.min(0.7, x));
  const cz = (z: number) => Math.max(-0.6, Math.min(0.6, z));
  switch (kind) {
    case 'sweep':
      return prev; // ducked in place — nobody moved
    case 'donut':
    case 'duckdonut':
      return { x: 0, z: 0 }; // hauled into the middle by definition
    case 'nova':
      return null; // the wedge is a different place on every deck
    case 'routine': {
      const quads = landings.filter((l) => l.zone.kind === 'quad');
      const lastQ = quads[quads.length - 1]?.zone;
      if (lastQ?.kind !== 'quad') return prev;
      return { x: (lastQ.corner & 1 ? 1 : -1) * 0.45, z: (lastQ.corner & 2 ? 1 : -1) * 0.4 };
    }
    case 'seesaw':
    case 'surge': {
      // Crossers hug the line — the seesaw centre-parks as surely as the
      // donut does, which is exactly why the manager has to know it.
      const lastH = landings[landings.length - 1].zone;
      if (lastH.kind !== 'half') return prev;
      const coord = -lastH.side * 0.22;
      return lastH.axis ? { x: p.x, z: coord } : { x: coord, z: p.z };
    }
    case 'gate': {
      const g = landings[0].zone;
      if (g.kind !== 'gate') return prev;
      return g.axis ? { x: p.x, z: g.at } : { x: g.at, z: p.z };
    }
    case 'wave': {
      // Every wave turns, so the final exit is the ground where the march
      // BEGAN — the first stop's square.
      const first = landings[0].zone;
      if (first.kind === 'rail') return { x: p.x, z: first.z };
      if (first.kind === 'lane') return { x: first.x, z: p.z };
      return prev;
    }
    case 'cross': {
      // Only the LAST volley decides where you end up: a vertical twin that
      // returns chases you off one half and then off the other.
      const all: { beat: number; z: number; halfD: number }[] = [];
      for (const l of landings) if (l.zone.kind === 'rail') all.push({ beat: l.beat, ...l.zone });
      const lane = landings.find((l) => l.zone.kind === 'lane')?.zone;
      const x = lane?.kind === 'lane' ? cx(lane.x + (p.x >= lane.x ? 1 : -1) * (lane.halfW + 0.2)) : p.x;
      if (!all.length) return { x, z: p.z };
      const lastBeat = Math.max(...all.map((r) => r.beat));
      const rails = all.filter((r) => r.beat === lastBeat);
      if (rails.length >= 2) {
        // Opposite sides of centre is THE TRAP — the jaws leave a corridor
        // down the middle. Same side is the TWIN, which leaves you a whole
        // half and no corridor at all.
        return rails[0].z * rails[1].z < 0
          ? { x, z: 0 }
          : { x, z: -Math.sign(rails[0].z || rails[1].z) * 0.42 };
      }
      return { x, z: cz(rails[0].z + rails[0].halfD + 0.3) }; // step off, away from the stage
    }
    case 'beam': {
      const all: { beat: number; x: number; halfW: number; yaw?: number }[] = [];
      for (const l of landings) if (l.zone.kind === 'lane') all.push({ beat: l.beat, ...l.zone });
      if (!all.length) return prev;
      // A twin that RETURNS lands twice: only the second pair decides where
      // the dodge finally leaves you standing.
      const lastBeat = Math.max(...all.map((l) => l.beat));
      const lanes = all.filter((l) => l.beat === lastBeat);
      if (lanes.some((l) => l.yaw)) {
        // THE X: the nearest pocket between the arms.
        const pockets = [
          { x: 0.55, z: 0 },
          { x: -0.55, z: 0 },
          { x: 0, z: 0.5 },
          { x: 0, z: -0.5 },
        ];
        let best = pockets[0];
        let bd = Infinity;
        for (const q of pockets) {
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        return best;
      }
      if (lanes.length === 2) {
        return lanes[0].x * lanes[1].x < 0
          ? { x: 0, z: p.z } // SPLIT: the corridor parks you dead centre
          : { x: -Math.sign(lanes[0].x || lanes[1].x) * 0.5, z: p.z }; // TWIN: the empty side
      }
      const s = lanes[0]?.x ?? 0;
      const side = p.x >= s ? 1 : -1; // step off the short way
      return { x: cx(s + side * ((lanes[0]?.halfW ?? 0.24) + 0.24)), z: p.z };
    }
  }
}

/** THE AIMED SHAPES: moves whose whole attack lands in one impact, aimed at
 *  wherever the last move parked the floor. That lets the chart promise a
 *  strike on a given downbeat without guessing how long a randomly rolled
 *  cascade will become — and, because the aim is derived from the park
 *  rather than rolled, one of these ALWAYS asks for a dodge.
 *
 *  Two jobs, one vocabulary: THE CLOSER on the final downbeat, and the
 *  STAND-IN that keeps a phrase from going quiet when nothing the grammar
 *  rolled will fit the room that's left. All three charge in at most one
 *  bar; keep the reservation beside the vocabulary. */
const CLOSER_KINDS: readonly MoveKind[] = ['gate', 'beam', 'sweep'];
const closerChargeBeats = (doubleTime: boolean): number =>
  Math.max(...CLOSER_KINDS.map((kind) => chartChargeBeats(kind, doubleTime)));

function buildAimed(
  landBeat: number,
  act: number,
  banned: readonly MoveKind[],
  last: MoveKind | null,
  park: Park,
  rng: () => number,
): { kind: MoveKind; landings: Landing[] } | null {
  const available = CLOSER_KINDS.filter((kind) => {
    const weights = MOVES[kind].weights;
    return !banned.includes(kind) && weights[Math.min(act, weights.length - 1)] > 0;
  });
  if (!available.length) return null;
  // Preserve the chart-wide no-repeat law whenever at least two closers are
  // legal. A deliberately over-banned dev chart still gets an ending.
  const fresh = available.filter((kind) => kind !== last);
  const pool = fresh.length ? fresh : available;
  const kind = pool[Math.floor(rng() * pool.length)]!;

  if (kind === 'sweep') {
    return { kind, landings: [{ beat: landBeat, zone: { kind: 'sweep' } }] };
  }
  if (kind === 'beam') {
    // Aim the final single strip through the park, so the closer always asks
    // for one last dodge instead of decorating empty ground.
    const x = park
      ? CHOREO.beamSlots.reduce((best, slot) =>
          Math.abs(slot - park.x) < Math.abs(best - park.x) ? slot : best,
        )
      : CHOREO.beamSlots[Math.floor(rng() * CHOREO.beamSlots.length)]!;
    return {
      kind,
      landings: [{ beat: landBeat, zone: { kind: 'lane', x, halfW: CHOREO.beamHalfWidth } }],
    };
  }

  // Put the gate's SAFE band on the opposite edge from the park. The ground
  // the last move left you on is therefore guaranteed to burn, while the
  // bright doorway remains a full, ordinary gate-width target.
  const axis: 0 | 1 = rng() < 0.5 ? 1 : 0;
  const coord = park ? (axis ? park.z : park.x) : rng() < 0.5 ? -1 : 1;
  const at = (coord >= 0 ? -1 : 1) * (axis ? 0.35 : 0.5);
  const half =
    act >= 4 ? CHOREO.gateHalfWExpert : act >= 3 ? CHOREO.gateHalfWLate : CHOREO.gateHalfW;
  return {
    kind,
    landings: [{ beat: landBeat, zone: { kind: 'gate', at, half, axis } }],
  };
}

/**
 * The full raid set. Pure function of (seed, phrases, banned, difficulty,
 * doubleTime) — every client, and every rewatch of the same seed, gets the
 * identical show. `banned` comes from the record on the decks (tracks.ts):
 * some songs simply never call certain moves. `doubleTime` marks a chart
 * whose clock EXPERT doubled (config.chartBpm): the grid stays doubled —
 * that is what keeps landings on the music — but the chart is SERVED at
 * the fast shelf's pace (CHOREO.doubleTimePace) instead of the standard
 * tables, because standard tables on a ~190 clock threw a third more
 * landings a second than any record the difficulty actually ships.
 */
export function generateSetlist(
  seed: number,
  phrases: number,
  banned: readonly MoveKind[] = [],
  difficulty = 1,
  doubleTime = false,
  /** Chart-beat spans where the record drops out (tracks.ts breakBeats). */
  breaks: readonly (readonly [number, number])[] = [],
): SetMove[] {
  const rng = mulberry32(mix(seed, 0xc03e0));
  // A move that is telegraphing or landing while the music is gone reads as
  // the boss playing to an empty room. Returns the break a move's span
  // [telegraph, last landing] would cross, if any.
  const breakHit = (tele: number, end: number) => breaks.find(([from, to]) => tele < to && end > from);
  const moves: SetMove[] = [];
  // EXPERT is a floor, not a phase: the whole night is served at the top
  // difficulty's terms (the donut's disc reads this — see buildLandings).
  const expert = difficulty >= 3;
  // THE SWEPT ROUTINE is a per-CHART coin: some expert nights carry it,
  // some never do — the hardest challenges stay distinct records, not a
  // constant garnish. (Rolled for every chart so the stream stays aligned;
  // it only ever bites at act 4.)
  const sweptRoutines = rng() < CHOREO.routineSweepChance;
  // Two bars of dancing, then the show starts: the first telegraph blooms at
  // bar 2 and the first landing hits the bar-3 downbeat — you're dodging
  // within seconds of the drop, not a phrase later.
  let cursor = MUSIC.introBars * barBeats;
  let last: MoveKind | null = null;
  let park: Park = { x: 0, z: 0 }; // everyone spawns dead centre
  let index = 0;

  for (let phrase = 0; phrase < phrases; phrase++) {
    // A phrase is a place on the record, not merely a quota. When an easy
    // phrase's two moves finished early, the old shared cursor stayed there;
    // the NEXT phrase then spent its quota in the same stretch of music.
    // Whole charts were pulled toward the front until the final minute had
    // nothing left in it. Never let a phrase begin before its own downbeat.
    cursor = Math.max(cursor, phrase * phraseBeats);
    const act = actOfPhrase(phrase, phrases, difficulty);
    // A double-time chart keeps the doubled GRID but borrows the fast
    // shelf's SERVICE — its phrases hold half the seconds, so the standard
    // quota and rests would land a third more often than any shipped chart.
    const pace = doubleTime ? CHOREO.doubleTimePace : CHOREO;
    const want = pace.movesPerPhrase[Math.min(act, pace.movesPerPhrase.length - 1)];
    const phraseEnd = (phrase + 1) * phraseBeats;
    const rest = pace.restBeats[Math.min(act, pace.restBeats.length - 1)];
    const finalPhrase = phrase === phrases - 1;
    // The last quota includes THE CLOSER below, whose four-beat wind-up owns
    // the final bar. No rest is kept in front of it: a clear bar before the
    // one move the whole set has been building to is the emptiest the floor
    // ever felt, and the finale reads better arriving on the heels of the
    // move before it.
    const restHere = finalPhrase ? 0 : rest;
    const moveEnd = finalPhrase ? phraseEnd - closerChargeBeats(doubleTime) : phraseEnd;
    const ordinaryMoves = finalPhrase ? Math.max(0, want - 1) : want;
    // THE DEAD AIR CEILING: the quota is a FLOOR. While this phrase still
    // holds more than `maxSilent` beats of unclaimed music the loop keeps
    // booking moves, so a phrase can never hand the floor a long stretch of
    // nothing to do. `cursor` climbs by at least a move's charge every pass,
    // so the extra condition always terminates.
    const maxSilent = pace.maxSilentBeats[Math.min(act, pace.maxSilentBeats.length - 1)];

    for (let m = 0; m < ordinaryMoves || moveEnd - cursor > maxSilent; m++) {
      let kind = pickKind(rng, act, last, banned);
      let charge = chartChargeBeats(kind, doubleTime);
      // Land on the next bar downbeat that the telegraph fits in front of.
      let landBeat = Math.ceil((cursor + charge) / barBeats) * barBeats;
      let landings = buildLandings(kind, landBeat, act, rng, sweptRoutines, park, doubleTime, expert);
      // THE FLOOR MANAGER: a move whose danger never touches the ground
      // the last move parked you on asks for nothing — roll another shape
      // (same seeded stream, so every client re-rolls identically). A WHOLE
      // move must also fit: checking only its first landing let waves and
      // rallies run beyond the record's ending.
      for (
        let attempt = 0;
        attempt < 12 &&
        (!evictsPark(landings, park) ||
          landings[landings.length - 1].beat > moveEnd ||
          breakHit(landBeat - charge, landings[landings.length - 1].beat));
        attempt++
      ) {
        kind = pickKind(rng, act, last, banned);
        charge = chartChargeBeats(kind, doubleTime);
        landBeat = Math.ceil((cursor + charge) / barBeats) * barBeats;
        landings = buildLandings(kind, landBeat, act, rng, sweptRoutines, park, doubleTime, expert);
      }
      if (
        !evictsPark(landings, park) ||
        landings[landings.length - 1].beat > moveEnd ||
        breakHit(landBeat - charge, landings[landings.length - 1].beat)
      ) {
        // TWELVE SHAPES AND NOT ONE OF THEM FITS. This used to abandon the
        // phrase — every remaining slot with it — which is how a chart ended
        // up with a whole phrase of nothing and the floor stood there
        // grooving for twenty seconds. Book a STAND-IN instead: one aimed
        // impact, drawn from the closer's vocabulary, short enough to fit
        // any room a bar can hold and aimed through the park so it always
        // asks for a dodge. Only genuinely empty ground ends the phrase now.
        const standBeat = Math.ceil((cursor + closerChargeBeats(doubleTime)) / barBeats) * barBeats;
        if (standBeat > moveEnd) break;
        // THE BREAK: not even the stand-in fits in front of the gap, so the
        // floor rests through it and booking resumes as the music comes
        // back. The slot isn't spent — the quota still wants its moves after
        // the gap. (The stand-in's telegraph sits at or after `cursor` and
        // before the break's end, so this always moves the cursor forward.)
        const standGap = breakHit(standBeat - closerChargeBeats(doubleTime), standBeat);
        if (standGap) {
          cursor = standGap[1];
          m--;
          continue;
        }
        const stand = buildAimed(standBeat, act, banned, last, park, rng);
        if (!stand) break; // a record that bans the whole vocabulary
        moves.push({
          index: index++,
          kind: stand.kind,
          telegraphBeat: standBeat - chartChargeBeats(stand.kind, doubleTime),
          landBeat: standBeat,
          landings: stand.landings,
          act,
        });
        park = parkOf(stand.kind, stand.landings, park);
        last = stand.kind;
        cursor = standBeat + restHere;
        continue;
      }
      moves.push({ index: index++, kind, telegraphBeat: landBeat - charge, landBeat, landings, act });
      park = parkOf(kind, landings, park);
      last = kind;
      cursor = landings[landings.length - 1].beat + restHere;
    }
  }

  // Every chart finishes with an authored one-impact move ON the final
  // downbeat. The ordinary final-phrase moves reserved its wind-up above,
  // so the ending is guaranteed without overlapping another landing or
  // letting a long random cascade spill past the record.
  if (phrases > 0) {
    const landBeat = phrases * phraseBeats;
    const act = actOfPhrase(phrases - 1, phrases, difficulty);
    const closer = buildAimed(landBeat, act, banned, last, park, rng);
    if (closer) {
      moves.push({
        index: index++,
        kind: closer.kind,
        telegraphBeat: landBeat - chartChargeBeats(closer.kind, doubleTime),
        landBeat,
        landings: closer.landings,
        act,
      });
    }
  }
  return moves;
}

