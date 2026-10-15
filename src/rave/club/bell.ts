/**
 * THE BELL — what a ball can carry (DESIGN.md §3.1).
 *
 * RAVE RAID's ball called one thing: a record. In this house it is the
 * launcher for EVERYTHING — pick a fight or pick a record, press HOST,
 * and whoever touches in rides along when the relay's clock hits zero.
 * The ball is mode-agnostic: it carries `{ mode, code }` up and the relay
 * deals `{ mode, code, fighters, watchers, seed, startInMs }` down.
 *
 * A RAVE deal stays on the rave's wire as it always did (seats, seed, a
 * shared beat zero). A FIGHT deal names a FIRE FIGHT room the caller
 * opened when they called — a private room behind its own code — and the
 * dealt squad crosses to the arena under the curtain and claims its seats
 * there: the first `capacity` who touched in fight, everyone after them
 * watches from the terrace. The club floor stays open behind them.
 *
 * This module is the catalogue and the wire's types, shared by the floor's
 * desk, the ball's plate, the session and the host that carries a deal
 * across.
 */

/** Everything the ball can call: the record, or one of the four fights. */
import type { Difficulty } from '../../config.js';

export type BellMode = 'rave' | '1v1' | '2v2' | 'ffa' | 'raid';

export const FIGHT_MODES: readonly Exclude<BellMode, 'rave'>[] = ['1v1', '2v2', 'ffa', 'raid'];

export function isFightMode(mode: string): mode is Exclude<BellMode, 'rave'> {
  return (FIGHT_MODES as readonly string[]).includes(mode);
}

/** How many fight — the arena's own capacities (net/meshImpl CAPACITY). */
export const FIGHT_CAPACITY: Record<Exclude<BellMode, 'rave'>, number> = {
  '1v1': 2,
  '2v2': 4,
  ffa: 4,
  raid: 5,
};

/** The four fights, NAMES ONLY. Everyone on the floor already knows what
 *  a 1V1 is, and the desk is a place to press a button, not to read. */
export const FIGHTS: Array<{ id: Exclude<BellMode, 'rave'>; label: string }> = [
  { id: '1v1', label: '1V1' },
  { id: '2v2', label: '2V2' },
  { id: 'ffa', label: 'FFA' },
  { id: 'raid', label: 'TITAN RAID' },
];

export function fightLabel(mode: string): string {
  return FIGHTS.find((f) => f.id === mode)?.label ?? mode.toUpperCase();
}

/** A member the relay dealt, by their room index and name. */
export interface DealtMember {
  idx: number;
  name: string;
}

/** What lands on every dealt headset when a FIGHT ball fires. */
export interface FightDeal {
  mode: Exclude<BellMode, 'rave'>;
  /** A TITAN RAID's difficulty — the caller's pick on the club desk, dealt
   *  to the whole squad so the arena builds one boss for everyone. (The
   *  other fights have no tiers; it rides as NORMAL and nobody reads it.) */
  difficulty: Difficulty;
  /** A TITAN RAID run HARDCORE — no refit between titans. The caller's
   *  desk toggle, dealt with the tier so the whole squad launches one
   *  raid. Always false for the other fights. */
  hardcore: boolean;
  /** The FIRE FIGHT room's code (the caller opened it at the call). */
  code: string;
  /** Am I on a platform or on the rail? */
  role: 'fighter' | 'watcher';
  /** The caller — the room's host, already seated when the ball went up. */
  callerIdx: number;
  /** Am I the caller (and so the arena room's host)? */
  mine: boolean;
  /** Dealt from a ROOM OF ONE: there is no arena room to join — the
   *  arena starts the fight against its own bots. */
  solo: boolean;
  fighters: DealtMember[];
  watchers: DealtMember[];
  seed: number;
}

/**
 * THE HOUSE MONEY, as the floor reads it: what the wallet held when the
 * bell dealt you out, and what the whole trip paid — the game's own pay
 * plus the house's bell bonus — when you folded home. The desk shows it.
 */
export const bellView = {
  /** Wallet balance the moment the deal landed (−1 = not dealt). */
  balanceAtDeal: -1,
  /** What the last trip through the bell paid, all in. */
  lastPay: 0,
  /** When it was paid (performance.now ms), for the desk's fade. */
  paidAt: 0,
};
