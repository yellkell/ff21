/**
 * THE REACH — a titan that comes across the gap and HITS you (FIRE FIGHT
 * fff's strike, ported for the solo campaign). Not a zone on your floor: a
 * body action with a target. It starts at the titan's shoulder and travels
 * to where your head was when the windup ended.
 *
 *   WINDUP   the tell. The fist draws back into a silhouette you learn to
 *            read (a jab cocks low, an overhand rises, a hook swings wide)
 *            and its glow swells. Sacred: nothing ever shortens it.
 *   STRIKE   the travel. At the windup's end your head is SNAPSHOTTED; the
 *            whole titan lunges across the gap and the fist flies its path
 *            to that point. Step off the line, duck, or put a hand in its
 *            way (a block staggers it).
 *   RECOVER  the fist comes home and the titan steps back to its pad.
 *
 * Solo only: a raid titan stands in the pit and fights the ring, and the
 * reach is one fist at one head. Pure maths here; CampaignSystem runs it.
 */

import { Vector3 } from 'three';
import type { TitanStyle } from './bosses.js';

export type MeleePath = 'jab' | 'hook' | 'overhand' | 'sweep' | 'piston' | 'clap';

export interface MeleeMove {
  path: MeleePath;
  /** Which arm swings (0 = the titan's −x), or both for a clap. */
  arm: 0 | 1 | 'both';
  windup: number;
  strike: number;
  recover: number;
  /** Blows in a chain (the piston): each one after the first comes from
   *  the OTHER arm, wound up for `beat` seconds, aimed at where you are by
   *  then. A block breaks the chain. */
  combo?: number;
  beat?: number;
}

/**
 * Where the fist draws back to for the windup, relative to its SHOULDER,
 * in the titan's root space (its own −z faces you), per unit of titan
 * scale. `side` is the arm's side (−1 or +1 along the rig's x).
 */
export function windupOffset(path: MeleePath, side: number, out: Vector3): Vector3 {
  switch (path) {
    case 'jab':
      return out.set(side * -0.05, -0.28, -0.12); // cocked low and tight at the chin
    case 'hook':
      return out.set(side * 0.55, -0.1, 0.25); // swung out wide and back
    case 'overhand':
      return out.set(side * 0.15, 0.45, 0.2); // raised high over the shoulder
    case 'sweep':
      return out.set(side * 0.75, -0.25, -0.1); // out wide, low, the arm laid open
    case 'piston':
      return out.set(side * 0.05, -0.38, 0.25); // drawn right back to the hip, a ram cocked
    case 'clap':
      return out.set(side * 0.65, 0.05, 0.1); // both arms thrown wide open, level
  }
}

const _c = new Vector3();
const _end = new Vector3();

/**
 * The fist's path from `from` (the windup point) through `to` (your head,
 * snapshotted), world space, at `t` 0..1 of the strike. `outward` is the
 * striking arm's side as a world direction. A sweep carries on past you to
 * the far side; every other path ends on you.
 */
export function strikePoint(path: MeleePath, from: Vector3, to: Vector3, outward: Vector3, t: number, out: Vector3): Vector3 {
  const u = Math.min(1, Math.max(0, t));
  _c.copy(from).add(to).multiplyScalar(0.5);
  _end.copy(to);
  switch (path) {
    case 'jab':
    case 'piston':
      break; // straight down the line
    case 'hook':
      _c.addScaledVector(outward, 0.55); // arcs in from the side
      break;
    case 'clap':
      _c.addScaledVector(outward, 0.4); // each arm sweeps in from its side, to meet on you
      break;
    case 'overhand':
      _c.y += 0.6; // comes down on you from above
      break;
    case 'sweep':
      // Level at your head, from its side, through you, out the far side:
      // a quadratic whose midpoint is exactly on you.
      _end.copy(to).addScaledVector(outward, -0.9);
      _end.y = to.y;
      _c.copy(to).multiplyScalar(2).addScaledVector(from, -0.5).addScaledVector(_end, -0.5);
      break;
  }
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const d = u * u;
  return out.set(a * from.x + b * _c.x + d * _end.x, a * from.y + b * _c.y + d * _end.y, a * from.z + b * _c.z + d * _end.z);
}

const _ab = new Vector3();
const _ap = new Vector3();

/** Distance from point `p` to the segment a→b. */
export function segmentDistance(a: Vector3, b: Vector3, p: Vector3): number {
  _ab.copy(b).sub(a);
  const len2 = _ab.lengthSq();
  const k = len2 > 0 ? Math.min(1, Math.max(0, _ap.copy(p).sub(a).dot(_ab) / len2)) : 0;
  return _ap.copy(a).addScaledVector(_ab, k).distanceTo(p);
}

/**
 * Each titan's reach. Timings (windup / strike / recover, seconds) are
 * fff's, a touch longer on the strike: here the whole machine crosses a
 * three-metre gap behind the fist.
 *
 *  CHROMEHOOK — the manipulator jabs and drops the overhand; the crane hook
 *               does the wide work (the hook, the sweep).
 *  PISTONKAISER — THE PISTON: three straight ram punches from alternating
 *               arms on a beat, each at where you are when it fires — step
 *               left, right, left (or block one and break the chain); the
 *               overhand is its drop-forge.
 *  VULTURE    — the talons hook and scythe, and jab.
 *  JUGGERNAUT — the CLAP: both gauntlets swing in from the sides to meet on
 *               your head (duck, step back, or block either); the
 *               overhand is the baton.
 *  GOLIATH    — has learned it all: the clap, the piston, the overhand, the
 *               hook.
 */
export const MELEE: Record<Exclude<TitanStyle, 'goop'>, MeleeMove[]> = {
  hook: [
    { path: 'jab', arm: 0, windup: 0.9, strike: 0.55, recover: 0.6 },
    { path: 'overhand', arm: 0, windup: 1.2, strike: 0.6, recover: 0.7 },
    { path: 'hook', arm: 1, windup: 1.1, strike: 0.65, recover: 0.7 },
    { path: 'sweep', arm: 1, windup: 1.3, strike: 0.85, recover: 0.8 },
  ],
  piston: [
    { path: 'piston', arm: 1, windup: 1.0, strike: 0.4, recover: 0.3, combo: 3, beat: 0.55 },
    { path: 'overhand', arm: 0, windup: 1.25, strike: 0.6, recover: 0.75 },
  ],
  vulture: [
    { path: 'hook', arm: 0, windup: 1.05, strike: 0.6, recover: 0.7 },
    { path: 'sweep', arm: 1, windup: 1.25, strike: 0.8, recover: 0.8 },
    { path: 'jab', arm: 1, windup: 0.9, strike: 0.5, recover: 0.6 },
  ],
  fortress: [
    { path: 'clap', arm: 'both', windup: 1.25, strike: 0.6, recover: 0.85 },
    { path: 'overhand', arm: 1, windup: 1.3, strike: 0.65, recover: 0.8 },
    { path: 'jab', arm: 0, windup: 1.0, strike: 0.55, recover: 0.65 },
  ],
  king: [
    { path: 'clap', arm: 'both', windup: 1.2, strike: 0.6, recover: 0.8 },
    { path: 'piston', arm: 0, windup: 1.0, strike: 0.4, recover: 0.3, combo: 3, beat: 0.5 },
    { path: 'overhand', arm: 1, windup: 1.25, strike: 0.6, recover: 0.75 },
    { path: 'hook', arm: 0, windup: 1.1, strike: 0.6, recover: 0.7 },
  ],
};

/** Never the same move twice running (the grammar's first law). */
export function pickMelee(moves: readonly MeleeMove[], last: MeleePath | null, rand: () => number = Math.random): MeleeMove {
  const pool = moves.filter((m) => m.path !== last);
  const list = pool.length ? pool : moves;
  return list[Math.floor(rand() * list.length)] ?? list[0];
}
