/**
 * THE MOVE GRAMMAR — RAVE RAID's boss vocabulary, ported for the ENCORE
 * campaign (DESIGN.md §4: titans that learned to dance).
 *
 * RAVE RAID choreographed whole songs up front on a beat grid; a titan bout
 * is a live real-time duel, so the port keeps the SHAPES and the LAWS and
 * trades the song clock for seconds: every move builds as a list of
 * target-local landings with second-based delays (each Encore titan carries
 * its own `beat` — the pulse its cascades step on), and the campaign's
 * cooldown loop plays them one move at a time.
 *
 * What ports intact (dance/src/choreo/setlist.ts):
 *  - the SHAPES: gate (stand in the gap, both axes), cross (rails from the
 *    side emitters: singles, THE TRAP's jaws, the vertical twin + bounce),
 *    donut (the rim burns, the middle lives — usually opened by a middle
 *    laser: out, then back), THE RECITAL (a pattern of quarters taught
 *    with a note each, then called by ear alone),
 *    the wave (a march with a dark exit that ALWAYS turns), duckdonut (the
 *    combination: middle AND duck), and the beam's whole upgrade path as
 *    'lanes' (slots, the SPLIT corridor, the TWIN + bounce rally, THE X);
 *  - the LAWS: never the same move twice running, the VERB table damping
 *    repeated body-verbs, THE FLOOR MANAGER (a correct dodge is never
 *    punished by where it parks you — parkOf/evictsPark), windups sacred.
 *
 * Everything is a pure function of a seeded rng, so one 32-bit seed on the
 * raid wire rebuilds the identical move on every client.
 */

import { GRAMMAR, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH } from '../config.js';

/* ── seeded rng (mulberry32 — same generator the paint splats use) ─────── */

export function mix(a: number, b: number): number {
  let h = (a ^ b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── the vocabulary ────────────────────────────────────────────────────── */

/** The Encore moves this module builds. (The classic kinds — slam, sweep,
 *  beam, volley, nova, seesaw, surge — keep their existing machinery.) */
export type GrammarKind = 'lanes' | 'cross' | 'gate' | 'donut' | 'recital' | 'wave' | 'duckdonut';

export const GRAMMAR_KINDS: readonly GrammarKind[] = ['lanes', 'cross', 'gate', 'donut', 'recital', 'wave', 'duckdonut'];

/** The escalation-act floor per kind (RAVE RAID's weight curves, folded to
 *  a single gate): below its act a kind never deals, so an EASY bout keeps
 *  the fight it always was and the hard tiers meet the full vocabulary.
 *  duckdonut is the once-a-night finale — act 4 only, like the charts. */
export const GRAMMAR_ACT_MIN: Record<GrammarKind, number> = {
  lanes: 0,
  cross: 0,
  gate: 0,
  donut: 1,
  wave: 1,
  recital: 2,
  duckdonut: 4,
};

/** A target-local kill zone (the player's platform at the origin, −z toward
 *  the titan — the same frame the classic zones judge in). */
export type GrammarZone =
  /** A laser strip down the deck at local x. `yaw` spins it about the deck
   *  centre (THE X throws two at ±45°). Sidestep off it. */
  | { kind: 'lane'; x: number; halfW: number; yaw?: number }
  /** The crossfire's side laser: a strip ACROSS the deck at local z, fed
   *  from the rail on `from`'s side — step forward or back off it. */
  | { kind: 'rail'; z: number; halfD: number; from: 1 | -1 }
  /** Everything burns EXCEPT a clear band at `at` — stand in the gap.
   *  axis 0: a COLUMN at local x. axis 1: a ROW at local z. */
  | { kind: 'gate'; at: number; half: number; axis: 0 | 1 }
  /** The rim burns, the middle lives — everything outside `innerR` is
   *  doomed, so get to the centre. */
  | { kind: 'ring'; innerR: number }
  /** One step of THE RECITAL: the deck's four quarters, `corner` the only
   *  one that lives (bit 0 = local +x, bit 1 = local +z). A HOLD step
   *  keeps the previous step's corner — the blue cue, "stay". Every step
   *  carries the WHOLE pattern so the lesson can teach it up front. */
  | { kind: 'quad'; corner: number; step: number; hold: boolean; pattern: readonly number[]; holds: readonly boolean[] }
  /** The blade overhead — duck (duckdonut borrows the classic sweep). */
  | { kind: 'sweep' };

/** One landing within a move: `delay` is seconds after the FIRST landing. */
export interface GrammarLanding {
  delay: number;
  zone: GrammarZone;
}

/* ── the movement grammar: verbs, so the floor keeps travelling ────────── */

/** Every kind's dodge asks the body for one primary verb; the picker damps
 *  a repeat so successive moves keep the fighter moving in NEW directions.
 *  Covers the classic kinds too — an Encore titan mixes both vocabularies. */
export const VERB: Record<string, string> = {
  lanes: 'lateral',
  gate: 'lateral',
  seesaw: 'lateral',
  beam: 'lateral',
  cross: 'depth',
  surge: 'depth',
  donut: 'radial',
  duckdonut: 'radial',
  slam: 'spot',
  nova: 'compass',
  sweep: 'duck',
  volley: 'guard',
  recital: 'corners',
  wave: 'travel', // the whole-deck crossing — its own verb, never damped
};

/**
 * Weighted pick honouring the two chart laws: NEVER the same move twice
 * running, and a repeated VERB (same dodge, new face) damped to 0.35×.
 * Pure in the rng, so the authority's roll replays identically from a seed.
 */
export function pickWeighted<K extends string>(
  rng: () => number,
  weights: ReadonlyArray<readonly [K, number]>,
  last: K | null,
): K {
  const pool: Array<[K, number]> = [];
  let total = 0;
  for (const [k, base] of weights) {
    if (base <= 0 || k === last) continue;
    let w = base;
    if (last && VERB[k] !== undefined && VERB[k] === VERB[last]) w *= 0.35;
    pool.push([k, w]);
    total += w;
  }
  let roll = rng() * total;
  for (const [k, w] of pool) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return pool[0]?.[0] ?? weights[0][0];
}

/* ── THE FLOOR MANAGER ─────────────────────────────────────────────────── */
// The grammar can't see the player mid-roll, but it CAN know where each
// move's correct dodge PARKS a fighter who plays it right — and it refuses
// to roll a move whose danger never touches that ground. A `null` park means
// "somewhere unknowable" and accepts anything.

export type Park = { x: number; z: number } | null;

function laneCovers(zone: { x: number; halfW: number; yaw?: number }, p: { x: number; z: number }): boolean {
  const yaw = zone.yaw ?? 0;
  const perp = yaw ? Math.cos(yaw) * p.x - Math.sin(yaw) * p.z : p.x;
  return Math.abs(perp - zone.x) <= zone.halfW + 0.12;
}

/** Does any landing demand something of a fighter standing at the park? */
export function evictsPark(landings: readonly GrammarLanding[], park: Park): boolean {
  if (!park) return true;
  return landings.some(({ zone }) => {
    switch (zone.kind) {
      case 'lane':
        return laneCovers(zone, park);
      case 'rail':
        return Math.abs(park.z - zone.z) <= zone.halfD + 0.12;
      case 'ring':
        return Math.hypot(park.x, park.z) > zone.innerR - 0.05;
      case 'gate':
        return Math.abs((zone.axis ? park.z : park.x) - zone.at) > zone.half - 0.05;
      case 'sweep': // the duck is a demand wherever you stand
      case 'quad': // the recital makes you commit, corner to corner
        return true;
    }
  });
}

/** Where this move's correct dodge leaves the fighter standing. */
export function parkOf(kind: GrammarKind, landings: readonly GrammarLanding[], prev: Park): Park {
  const p = prev ?? { x: 0, z: 0 };
  const cx = (x: number): number => Math.max(-0.7, Math.min(0.7, x));
  const cz = (z: number): number => Math.max(-0.6, Math.min(0.6, z));
  switch (kind) {
    case 'donut':
    case 'duckdonut':
      return { x: 0, z: 0 }; // hauled into the middle by definition
    case 'recital': {
      const quads = landings.filter((l) => l.zone.kind === 'quad');
      const lastQ = quads[quads.length - 1]?.zone;
      if (lastQ?.kind !== 'quad') return prev;
      return { x: (lastQ.corner & 1 ? 1 : -1) * 0.45, z: (lastQ.corner & 2 ? 1 : -1) * 0.4 };
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
      const all: { delay: number; z: number; halfD: number }[] = [];
      for (const l of landings) if (l.zone.kind === 'rail') all.push({ delay: l.delay, ...l.zone });
      const lane = landings.find((l) => l.zone.kind === 'lane')?.zone;
      const x = lane?.kind === 'lane' ? cx(lane.x + (p.x >= lane.x ? 1 : -1) * (lane.halfW + 0.2)) : p.x;
      if (!all.length) return { x, z: p.z };
      const lastDelay = Math.max(...all.map((r) => r.delay));
      const rails = all.filter((r) => r.delay === lastDelay);
      if (rails.length >= 2) {
        // Opposite sides of centre is THE TRAP — the jaws leave a corridor
        // down the middle. Same side is the TWIN, which leaves a whole half.
        return rails[0].z * rails[1].z < 0
          ? { x, z: 0 }
          : { x, z: -Math.sign(rails[0].z || rails[1].z) * 0.42 };
      }
      return { x, z: cz(rails[0].z + rails[0].halfD + 0.3) }; // step off, away from the titan
    }
    case 'lanes': {
      const all: { delay: number; x: number; halfW: number; yaw?: number }[] = [];
      for (const l of landings) if (l.zone.kind === 'lane') all.push({ delay: l.delay, ...l.zone });
      if (!all.length) return prev;
      const lastDelay = Math.max(...all.map((l) => l.delay));
      const lanes = all.filter((l) => l.delay === lastDelay);
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

/* ── building one move ─────────────────────────────────────────────────── */

/** Which side a twin opens on: the side the last move parked the fighter,
 *  so the first pair lands where they actually are. ALWAYS consumes the
 *  roll, so a seeded stream stays aligned whether or not a park existed. */
function twinSide(rng: () => number, at: number | undefined): 1 | -1 {
  const coin: 1 | -1 = rng() < 0.5 ? 1 : -1;
  if (at === undefined || Math.abs(at) < 0.06) return coin; // parked on the line
  return at > 0 ? 1 : -1;
}

/** THE BOUNCE's odds by volley: [_, does it answer, does it come back].
 *  From `twinAlwaysFromAct` up both are certainties — a double is the full
 *  three-volley rally (left, right, left) or nothing. */
function twinKeep(act: number): number[] {
  if (act >= GRAMMAR.twinAlwaysFromAct) return [0, 1, 1];
  const at = (a: readonly number[]): number => a[Math.min(act, a.length - 1)];
  return [0, at(GRAMMAR.twinReturnChance), at(GRAMMAR.twinBounceChance)];
}

export interface GrammarOpts {
  /** Escalation act 0..4 (difficulty picks the floor; enrage lifts one). */
  act: number;
  /** Seconds per grammar beat — THIS titan's pulse; cascades step on it. */
  beat: number;
  /** Blazing serves expert law: the tight donut disc, the rally promise. */
  expert: boolean;
  /** The per-fight coin for THE SWEPT RECITAL (act 4 only). */
  swept: boolean;
  /** Where the last move parked a fighter who played it right. */
  park: Park;
}

/**
 * Build one move's landings from a seeded rng — the RAVE RAID shapes, in
 * seconds. Deterministic: the same (kind, seed-stream, opts) yields the
 * identical move on every client, which is the whole raid wire.
 */
export function buildGrammarMove(kind: GrammarKind, rng: () => number, o: GrammarOpts): GrammarLanding[] {
  const landings: GrammarLanding[] = [];
  const act = o.act;
  const beat = o.beat;

  if (kind === 'lanes') {
    const halfW = GRAMMAR.laneHalfWidth;
    const laneAt = (delay: number, x: number): void => {
      landings.push({ delay, zone: { kind: 'lane', x, halfW } });
    };
    if (act < 2) {
      // One laser, and it lands on a SLOT: the middle, or a third out.
      laneAt(0, GRAMMAR.laneSlots[Math.floor(rng() * GRAMMAR.laneSlots.length)]);
    } else if (rng() < GRAMMAR.laneXChance[Math.min(act, GRAMMAR.laneXChance.length - 1)]) {
      // THE X: two thin beams thrown diagonally at once, crossing dead
      // centre — the safe ground is the four pockets between the arms.
      landings.push({ delay: 0, zone: { kind: 'lane', x: 0, halfW: GRAMMAR.laneXHalfW, yaw: Math.PI / 4 } });
      landings.push({ delay: 0, zone: { kind: 'lane', x: 0, halfW: GRAMMAR.laneXHalfW, yaw: -Math.PI / 4 } });
    } else if (rng() < GRAMMAR.laneSplitChance[Math.min(act, GRAMMAR.laneSplitChance.length - 1)]) {
      // SPLIT: one either side of centre — stand in the corridor BETWEEN.
      laneAt(0, -GRAMMAR.laneSplitX);
      laneAt(0, GRAMMAR.laneSplitX);
    } else {
      // TWIN: two strips shoulder to shoulder taking one whole side — get
      // across. THE BOUNCE: mirrored a bar later, then back again — a rally,
      // not a shove, and the opener is AIMED at the parked side.
      const inner = GRAMMAR.laneTwinInner;
      const outer = GRAMMAR.laneTwinInner + halfW * 2 + 0.02;
      const keep = twinKeep(act);
      let side: 1 | -1 = twinSide(rng, o.park?.x);
      laneAt(0, side * inner);
      laneAt(0, side * outer);
      const ret = GRAMMAR.twinReturnBeats * beat;
      for (let v = 1; v < GRAMMAR.twinChainMax && rng() < keep[v]; v++) {
        side = -side as 1 | -1;
        laneAt(v * ret, side * inner);
        laneAt(v * ret, side * outer);
      }
    }
  } else if (kind === 'donut') {
    // THE ONE-TWO: a laser straight down the middle drives you off centre,
    // and a beat later the rim closes and the middle is the only ground
    // left. Out, then back — the whole deck used in one move. Blazing holds
    // the tight disc every time (the one move you run back into on memory).
    const innerR = o.expert ? GRAMMAR.donutInnerRExpert : act >= 3 ? GRAMMAR.donutInnerRLate : GRAMMAR.donutInnerR;
    const opens = rng() < GRAMMAR.donutOpenChance;
    if (opens) landings.push({ delay: 0, zone: { kind: 'lane', x: 0, halfW: GRAMMAR.laneHalfWidth } });
    landings.push({
      delay: opens ? GRAMMAR.donutFollowBeats * beat : 0,
      zone: { kind: 'ring', innerR },
    });
  } else if (kind === 'cross') {
    // LASERS FROM THE SIDES. THE TRAP (late, on a roll): two rails on the
    // same beat closing like jaws — the safe ground is the corridor between.
    const trapChance = GRAMMAR.railTrapChance[Math.min(act, GRAMMAR.railTrapChance.length - 1)];
    if (rng() < trapChance) {
      landings.push({ delay: 0, zone: { kind: 'rail', z: -GRAMMAR.railTrapZ, halfD: GRAMMAR.railHalfDepth, from: -1 } });
      landings.push({ delay: 0, zone: { kind: 'rail', z: GRAMMAR.railTrapZ, halfD: GRAMMAR.railHalfDepth, from: 1 } });
      return landings;
    }
    // THE VERTICAL TWIN: two rails shoulder to shoulder flooding one whole
    // half (the one you were parked in), then the mirrored pair a bar later
    // — the deck's front/back answer to the lateral twin's walk.
    const twinChance = GRAMMAR.railTwinChance[Math.min(act, GRAMMAR.railTwinChance.length - 1)];
    if (rng() < twinChance) {
      const halfD = GRAMMAR.railHalfDepth;
      const inner = GRAMMAR.railTwinInner;
      const outer = GRAMMAR.railTwinInner + halfD * 2 + 0.02;
      let side: 1 | -1 = twinSide(rng, o.park?.z);
      let from: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const pair = (delay: number, at: number, emitter: 1 | -1): void => {
        landings.push({ delay, zone: { kind: 'rail', z: at * inner, halfD, from: emitter } });
        landings.push({ delay, zone: { kind: 'rail', z: at * outer, halfD, from: emitter } });
      };
      pair(0, side, from);
      const keep = twinKeep(act);
      const ret = GRAMMAR.twinReturnBeats * beat;
      for (let v = 1; v < GRAMMAR.twinChainMax && rng() < keep[v]; v++) {
        side = -side as 1 | -1;
        from = from === 1 ? -1 : 1;
        pair(v * ret, side, from);
      }
      return landings;
    }
    // A single rail always lands on the FRONT half (toward the titan, where
    // your eyes already are); from the lattice act on, a lane crosses it and
    // the safe ground becomes a quarter — the dodge turns diagonal.
    const z = -(GRAMMAR.railOffsetMin + rng() * (GRAMMAR.railOffsetMax - GRAMMAR.railOffsetMin));
    const from: 1 | -1 = rng() < 0.5 ? 1 : -1;
    landings.push({ delay: 0, zone: { kind: 'rail', z, halfD: GRAMMAR.railHalfDepth, from } });
    if (act >= GRAMMAR.latticeFromAct) {
      const xSign = rng() < 0.5 ? 1 : -1;
      landings.push({
        delay: 0,
        zone: { kind: 'lane', x: xSign * (0.2 + rng() * 0.32), halfW: GRAMMAR.laneHalfWidth },
      });
    }
  } else if (kind === 'recital') {
    // THE MEMORY TEST, by ear. A pattern of steps: each a MOVE to one of
    // the three quarters you are not in, or a HOLD — stay where the last
    // step put you (never two holds running, and the first step is always
    // a move). THE LESSON lights every step in turn with its note; THE
    // RECITAL calls the same notes with the marks dark. THE SWEPT RECITAL
    // (act 4, per-fight coin): every blast arrives under the blade too.
    const at = (a: readonly number[]): number => a[Math.min(act, a.length - 1)];
    const n = Math.max(2, Math.min(6, at(GRAMMAR.recitalSteps)));
    const holdChance = at(GRAMMAR.recitalHoldChance);
    const pattern: number[] = [];
    const holds: boolean[] = [];
    let corner = Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const hold = i > 0 && !holds[i - 1] && rng() < holdChance;
      if (i > 0 && !hold) corner = (corner + 1 + Math.floor(rng() * 3)) & 3;
      pattern.push(corner);
      holds.push(hold);
    }
    const swept = o.swept && act >= 4;
    const step = GRAMMAR.recitalStepBeats * beat;
    pattern.forEach((c, i) => {
      landings.push({ delay: i * step, zone: { kind: 'quad', corner: c, step: i, hold: holds[i], pattern, holds } });
      if (swept) landings.push({ delay: i * step, zone: { kind: 'sweep' } });
    });
  } else if (kind === 'wave') {
    // THE WAVE: strips marching 1-2-3 across the deck with a dark EXIT —
    // travel with the march. EVERY wave turns at the exit (a breather, then
    // back it comes); on blazing it sometimes wheels a SECOND time — across,
    // back, and across again, the rally told as a march.
    const axis: 0 | 1 = rng() < 0.5 ? 1 : 0;
    const step = GRAMMAR.waveStepBeats[Math.min(act, GRAMMAR.waveStepBeats.length - 1)] * beat;
    const turnExtra = GRAMMAR.waveTurnExtraBeats * beat;
    const stops = axis ? GRAMMAR.waveRailZ : GRAMMAR.waveLaneX;
    const ordered = rng() < 0.5 ? [...stops] : [...stops].reverse();
    const at: number[] = ordered.slice(0, -1); // out over three; exit = ordered[3]
    const delays: number[] = at.map((_, i) => i * step);
    const turnAt = delays[delays.length - 1] + step * 2 + turnExtra;
    [ordered[3], ordered[2], ordered[1]].forEach((stop, i) => {
      at.push(stop);
      delays.push(turnAt + i * step);
    });
    // Rolled before the gate, never inside it — the stream stays aligned.
    const third = rng() < GRAMMAR.waveThirdChance && o.expert;
    if (third) {
      const backAt = delays[delays.length - 1] + step * 2 + turnExtra;
      [ordered[0], ordered[1], ordered[2]].forEach((stop, i) => {
        at.push(stop);
        delays.push(backAt + i * step);
      });
    }
    const from: 1 | -1 = rng() < 0.5 ? 1 : -1;
    at.forEach((stop, i) => {
      landings.push({
        delay: delays[i],
        zone: axis
          ? { kind: 'rail', z: stop, halfD: GRAMMAR.railHalfDepth, from }
          : { kind: 'lane', x: stop, halfW: GRAMMAR.laneHalfWidth },
      });
    });
  } else if (kind === 'duckdonut') {
    // THE COMBINATION: the rim floods AND the blade hangs over the middle —
    // get to the centre and DUCK there. Always the tight disc: a once-a-
    // night finale doesn't come with training wheels.
    landings.push({ delay: 0, zone: { kind: 'sweep' } });
    landings.push({ delay: 0, zone: { kind: 'ring', innerR: GRAMMAR.donutInnerRExpert } });
  } else {
    // gate: the doorway — or, half the time, its horizontal cousin (a clear
    // ROW at a depth line). The gap never offers the middle of the deck: a
    // doorway you're already standing in asks for nothing.
    const axis: 0 | 1 = rng() < 0.5 ? 1 : 0;
    const span = axis ? 0.35 : 0.5;
    const off = GRAMMAR.gateOffsetMin + rng() * (span - GRAMMAR.gateOffsetMin);
    landings.push({
      delay: 0,
      zone: {
        kind: 'gate',
        at: (rng() < 0.5 ? 1 : -1) * off,
        half: act >= 4 ? GRAMMAR.gateHalfWExpert : act >= 3 ? GRAMMAR.gateHalfWLate : GRAMMAR.gateHalfW,
        axis,
      },
    });
  }
  return landings;
}

/* ── the judge (pure, headlessly provable) ─────────────────────────────── */

/**
 * Does a body sphere at (x, y, z) radius r stand in this zone's danger?
 * Same forgiveness law as the classic zones: a sphere counts at ~0.7 of its
 * radius, and the safe shapes carry their own margins. `quad` judges the
 * HEAD's commitment like the nova does — pass the head for it.
 */
export function grammarZoneHit(zone: GrammarZone, x: number, z: number, r: number): boolean {
  switch (zone.kind) {
    case 'lane': {
      const yaw = zone.yaw ?? 0;
      const perp = yaw ? Math.cos(yaw) * x - Math.sin(yaw) * z : x;
      return Math.abs(perp - zone.x) <= zone.halfW + r * 0.7;
    }
    case 'rail':
      return Math.abs(z - zone.z) <= zone.halfD + r * 0.7;
    case 'gate': {
      const along = zone.axis ? z : x;
      return Math.abs(along - zone.at) > zone.half - r * 0.3;
    }
    case 'ring':
      return Math.hypot(x, z) > zone.innerR - r * 0.3;
    case 'quad': {
      // Committed past the quarter lines into the called corner, or burn —
      // loitering at dead centre never satisfies the recital.
      const sx = zone.corner & 1 ? 1 : -1;
      const sz = zone.corner & 2 ? 1 : -1;
      return !(x * sx > GRAMMAR.recitalMargin && z * sz > GRAMMAR.recitalMargin);
    }
    case 'sweep':
      return false; // judged by height via the classic sweep path
  }
}

/** Dev/probe hook — the pure grammar, drivable from a headless page
 *  (tools/encore-check.mjs proves determinism, the laws and the judge). */
export function installGrammarDevHook(): void {
  const w = window as unknown as { __ff2?: Record<string, unknown> };
  (w.__ff2 ??= {}).grammar = {
    kinds: GRAMMAR_KINDS,
    build: (kind: GrammarKind, seed: number, o?: Partial<GrammarOpts>): GrammarLanding[] =>
      buildGrammarMove(kind, mulberry32(seed >>> 0), {
        act: o?.act ?? 3,
        beat: o?.beat ?? 0.5,
        expert: o?.expert ?? false,
        swept: o?.swept ?? false,
        park: o?.park !== undefined ? o.park : { x: 0, z: 0 },
      }),
    pick: (seed: number, weights: ReadonlyArray<readonly [string, number]>, last: string | null): string =>
      pickWeighted(mulberry32(seed >>> 0), weights, last),
    evicts: (landings: GrammarLanding[], park: Park): boolean => evictsPark(landings, park),
    park: (kind: GrammarKind, landings: GrammarLanding[], prev: Park): Park => parkOf(kind, landings, prev),
    hit: (zone: GrammarZone, x: number, z: number, r = 0.15): boolean => grammarZoneHit(zone, x, z, r),
    onDeck: (zone: GrammarZone): boolean => zoneOnDeck(zone),
  };
}

/** Deck-bounds sanity for probes: every authored coordinate stays on (or
 *  within a margin of) the octagon. */
export function zoneOnDeck(zone: GrammarZone): boolean {
  switch (zone.kind) {
    case 'lane':
      return Math.abs(zone.x) <= OCTAGON_HALF_WIDTH;
    case 'rail':
      return Math.abs(zone.z) <= OCTAGON_HALF_DEPTH;
    case 'gate':
      return Math.abs(zone.at) <= (zone.axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH);
    case 'ring':
      return zone.innerR > 0.2 && zone.innerR < OCTAGON_HALF_DEPTH;
    case 'quad':
      return zone.corner >= 0 && zone.corner <= 3;
    case 'sweep':
      return true;
  }
}
