/**
 * THE TAPE — what one bout records for the stat nerds (DESIGN.md §9, the
 * LAB on public/stats.html).
 *
 * A tape opens at the bell and closes at the final; between them it keeps:
 *
 *  - WHERE YOU STOOD: your head's spot on your platform, binned into a
 *    TV.gridW × TV.gridH grid a few times a second (the STANDING heatmap);
 *  - WHERE YOU THREW FROM, per hand: the fist's release point, binned into
 *    a LEFT grid and a RIGHT grid, plus the swing speed;
 *  - WHERE YOU GOT HIT: your standing spot at the moment of every hit you
 *    took, binned, with the part that took it (head / chest / pelvis) and
 *    the hand that threw it;
 *  - WHERE YOU LANDED IT: your standing spot at the moment one of yours
 *    connected — the LANDING heatmap, the throw grids' answer;
 *  - THE ATTACHMENTS: every SPLIT, GROW and SHRINK that actually FIRED,
 *    on either side, at the moment it fired — what a fist was loaded with
 *    matters far less than what it did, and a fired attachment is the one
 *    the wire already carries for both players;
 *  - THE PLAY-BY-PLAY: every throw, hit taken, hit dealt, parry, attachment
 *    and round as a timed tuple, so the page can replay how the bout went;
 *  - THE ROUNDS: outcome, KO or the clock, both health pools at the bell.
 *
 * Everything is in YOUR frame — your platform at the origin, −z toward
 * the fight — so a heatmap of a thousand bouts lines up. Coordinates are
 * kept to the centimetre and the tuples stay numeric so a tape is a few
 * kilobytes. It posts to the \`bouts\` collection (net/leaderboard.ts
 * reportBout) if the bout lasted long enough to mean anything; a tutorial,
 * a training run or a bout you spectated never makes a tape.
 *
 * The recorder is a module singleton the combat systems poke at the
 * moments they already own (FireballSystem's throw, CollisionSystem's
 * hits and parries, CampaignSystem's titan strikes); BroadcastSystem
 * opens and closes it and samples your spot.
 */

import { OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH, TV } from '../config.js';
import { myName, reportBout } from './leaderboard.js';

export type BoutKind = '1v1' | '2v2' | 'ffa' | 'raid' | 'gauntlet' | 'solo';
export type HitPart = 'head' | 'chest' | 'pelvis' | 'body';
export type RoundOutcome = 'win' | 'loss' | 'draw';
export type RoundResult = 'ko' | 'time';

/** Event codes — the first number after the time in every tuple. */
export const EV = { throw: 0, hitTaken: 1, hitDealt: 2, parry: 3, round: 4, attach: 5 } as const;
/** Attachment codes, mirroring config.ts ATTACH: 1 split, 2 grow, 3 shrink. */
export type AttachCode = 1 | 2 | 3;
const PART_CODE: Record<HitPart, number> = { head: 0, chest: 1, pelvis: 2, body: 3 };
const OUT_CODE: Record<RoundOutcome, number> = { win: 0, loss: 1, draw: 2 };
const RES_CODE: Record<RoundResult, number> = { ko: 0, time: 1 };

export interface BoutContext {
  kind: BoutKind;
  /** A live opponent over the wire (a bot bout or a solo run is false). */
  net: boolean;
  /** A quick-match (best of three) duel. */
  quick: boolean;
  /** A RANKED room. */
  ranked: boolean;
}

interface RoundRow {
  n: number;
  out: RoundOutcome;
  res: RoundResult;
  /** [mine, theirs] at the bell (0..100; a team's total in a brawl). */
  hp: [number, number];
  /** Seconds of fighting in the round. */
  dur: number;
}

interface Tape extends BoutContext {
  t0: number;
  startedAt: number;
  names: string[];
  rounds: RoundRow[];
  stand: Uint16Array;
  thrL: Uint16Array;
  thrR: Uint16Array;
  hit: Uint16Array;
  land: Uint16Array;
  ev: number[][];
  /** Events past the cap are counted, not listed. */
  dropped: number;
  thr: { n: number; l: number; r: number; spdSum: number };
  hits: { dealt: number; taken: number; head: number; ret: number; dealtL: number; dealtR: number; takenHead: number };
  par: number;
  /** How many of each attachment fired, per side, indexed by code (0 unused).
   *  Counted even past the event cap, so the totals stay honest. */
  att: { mine: number[]; theirs: number[] };
  boss: { name: string; stage: number } | null;
}

const CELLS = TV.gridW * TV.gridH;
const cm = (v: number): number => Math.round(v * 100) / 100;

/** Bin a platform-local (x, z) into the grid, or -1 when off the slab. */
export function cellOf(x: number, z: number): number {
  const u = (x + OCTAGON_HALF_WIDTH) / (OCTAGON_HALF_WIDTH * 2);
  const v = (z + OCTAGON_HALF_DEPTH) / (OCTAGON_HALF_DEPTH * 2);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
  return Math.floor(v * TV.gridH) * TV.gridW + Math.floor(u * TV.gridW);
}

function bump(grid: Uint16Array, x: number, z: number): void {
  const c = cellOf(x, z);
  if (c >= 0 && grid[c] < 65535) grid[c] += 1;
}

let tape: Tape | null = null;

function now(): number {
  return tape ? Math.round((performance.now() - tape.t0) / 100) / 10 : 0;
}

function push(row: number[]): void {
  if (!tape) return;
  if (tape.ev.length >= TV.eventCap) {
    tape.dropped += 1;
    return;
  }
  tape.ev.push(row);
}

export const telemetry = {
  /** Your standing spot right now (platform-local x/z), kept fresh by
   *  BroadcastSystem so any hook can stamp a hit with where you were. */
  head: { x: 0, z: 0 },

  /** A tape is rolling. */
  get open(): boolean {
    return tape !== null;
  },

  /** The bell. Any tape still rolling is dropped, not posted. */
  begin(ctx: BoutContext): void {
    tape = {
      ...ctx,
      t0: performance.now(),
      startedAt: Date.now(),
      names: [],
      rounds: [],
      stand: new Uint16Array(CELLS),
      thrL: new Uint16Array(CELLS),
      thrR: new Uint16Array(CELLS),
      hit: new Uint16Array(CELLS),
      land: new Uint16Array(CELLS),
      ev: [],
      dropped: 0,
      thr: { n: 0, l: 0, r: 0, spdSum: 0 },
      hits: { dealt: 0, taken: 0, head: 0, ret: 0, dealtL: 0, dealtR: 0, takenHead: 0 },
      par: 0,
      att: { mine: [0, 0, 0, 0], theirs: [0, 0, 0, 0] },
      boss: null,
    };
  },

  /** Who fought (slot order, me first). Called late — names arrive over the wire. */
  setNames(names: string[]): void {
    if (tape) tape.names = names.map((n) => String(n).slice(0, 16));
  },

  /** The titan on the card (campaign / raid tapes). */
  setBoss(name: string, stage: number): void {
    if (tape) tape.boss = { name: name.slice(0, 16), stage };
  },

  /** Your head's spot on the slab (platform-local). */
  sample(x: number, z: number): void {
    if (!tape) return;
    bump(tape.stand, x, z);
  },

  /** A throw left `hand` (0 left, 1 right) from the fist at (hx, hz), at `speed` m/s. */
  throw(hand: 0 | 1, hx: number, hz: number, speed: number): void {
    if (!tape) return;
    bump(hand === 0 ? tape.thrL : tape.thrR, hx, hz);
    tape.thr.n += 1;
    if (hand === 0) tape.thr.l += 1;
    else tape.thr.r += 1;
    tape.thr.spdSum += speed;
    push([now(), EV.throw, hand, cm(hx), cm(hz), Math.round(speed * 10) / 10, cm(this.head.x), cm(this.head.z)]);
  },

  /** A hit landed on ME: the part, the thrower's hand, the damage, a
   *  return-pass flag, and the direction it came from (unit x/z). */
  hitTaken(part: HitPart, hand: 0 | 1, dmg: number, ret: boolean, dirX = 0, dirZ = 0): void {
    if (!tape) return;
    bump(tape.hit, this.head.x, this.head.z);
    tape.hits.taken += 1;
    if (part === 'head') tape.hits.takenHead += 1;
    push([now(), EV.hitTaken, hand, cm(this.head.x), cm(this.head.z), Math.round(dmg), PART_CODE[part], ret ? 1 : 0, cm(dirX), cm(dirZ)]);
  },

  /** My ball landed on someone. `part` is known on a local sim only. */
  hitDealt(hand: 0 | 1, dmg: number, ret: boolean, part: HitPart | null = null): void {
    if (!tape) return;
    bump(tape.land, this.head.x, this.head.z);
    tape.hits.dealt += 1;
    if (hand === 0) tape.hits.dealtL += 1;
    else tape.hits.dealtR += 1;
    if (part === 'head') tape.hits.head += 1;
    if (ret) tape.hits.ret += 1;
    push([now(), EV.hitDealt, hand, Math.round(dmg), ret ? 1 : 0, part ? PART_CODE[part] : -1]);
  },

  /**
   * An attachment FIRED on a live recall: `who` 0 = me, 1 = the other side,
   * `hand` the fist it came home to, `att` the ATTACH code. Only a live
   * recall carries one — a dead ball comes back plain — so this is exactly
   * the moment the ball changed on its way home.
   */
  attach(who: 0 | 1, hand: 0 | 1, att: AttachCode): void {
    if (!tape || att < 1 || att > 3) return;
    (who === 0 ? tape.att.mine : tape.att.theirs)[att] += 1;
    push([now(), EV.attach, who, hand, att]);
  },

  /** I slapped a ball out of the air with `hand`'s ball. */
  parry(hand: 0 | 1): void {
    if (!tape) return;
    tape.par += 1;
    push([now(), EV.parry, hand]);
  },

  /** A round ended. */
  round(n: number, out: RoundOutcome, res: RoundResult, hpMe: number, hpThem: number, dur: number): void {
    if (!tape) return;
    tape.rounds.push({ n, out, res, hp: [Math.round(hpMe), Math.round(hpThem)], dur: Math.round(dur * 10) / 10 });
    push([now(), EV.round, n, OUT_CODE[out], RES_CODE[res], Math.round(hpMe), Math.round(hpThem)]);
  },

  /** The final. Posts the tape if it is worth keeping, then clears it. */
  end(win: boolean, score: number[]): void {
    const t = tape;
    tape = null;
    if (!t) return;
    const dur = (performance.now() - t.t0) / 1000;
    if (dur < TV.minBoutSeconds || t.thr.n === 0) return;
    reportBout({
      v: 1,
      kind: t.kind,
      net: t.net,
      quick: t.quick,
      ranked: t.ranked,
      // `name` is whose tape this is; `names` is everyone who fought. Both
      // are top-level and both are shape-checked by firestore.rules.
      name: myName().slice(0, 16),
      names: t.names.length ? t.names : [myName().slice(0, 16)],
      win,
      score: score.slice(0, 4).map((n) => Math.round(n)),
      rounds: t.rounds,
      dur: Math.round(dur * 10) / 10,
      thr: { n: t.thr.n, l: t.thr.l, r: t.thr.r, spd: t.thr.n ? Math.round((t.thr.spdSum / t.thr.n) * 10) / 10 : 0 },
      hits: t.hits,
      par: t.par,
      att: t.att,
      grid: { w: TV.gridW, h: TV.gridH, stand: Array.from(t.stand), thrL: Array.from(t.thrL), thrR: Array.from(t.thrR), hit: Array.from(t.hit), land: Array.from(t.land) },
      // One string per event ("t,type,…"): Firestore refuses an array of
      // arrays outright (the SDK throws before it sends), so a tape posted
      // as rows never landed anywhere. public/stats.html splits them back.
      ev: t.ev.map((row) => row.join(',')),
      dropped: t.dropped,
      ...(t.boss ? { boss: t.boss } : {}),
    });
  },

  /** A bout that ended without a final (a forfeit, a lost peer): no tape. */
  abort(): void {
    tape = null;
  },

  /** Dev/probe: the rolling tape's counters. */
  peek(): { kind: BoutKind; throws: number; taken: number; dealt: number; parries: number; rounds: number; events: number; stood: number; att: { mine: number[]; theirs: number[] } } | null {
    if (!tape) return null;
    let stood = 0;
    for (const n of tape.stand) stood += n;
    return { kind: tape.kind, throws: tape.thr.n, taken: tape.hits.taken, dealt: tape.hits.dealt, parries: tape.par, rounds: tape.rounds.length, events: tape.ev.length, stood, att: tape.att };
  },
};
