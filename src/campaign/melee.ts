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

export type MeleePath = 'jab' | 'hook' | 'overhand' | 'sweep' | 'piston' | 'clap' | 'spinback' | 'spinhammer';

export interface MeleeMove {
  path: MeleePath;
  /** Which arm swings (0 = the titan's −x), or both for a clap. */
  arm: 0 | 1 | 'both';
  windup: number;
  strike: number;
  recover: number;
  /** Blows in a chain (the piston): each one after the first comes from
   *  the OTHER arm the moment the last one lands or whiffs, no recovery in
   *  between, chambered for just `beat` seconds while the spent fist pulls
   *  home and the titan steps back to wind up, and aimed at where you are
   *  by then. A block breaks the chain; only the last blow recovers. */
  combo?: number;
  beat?: number;
}

/**
 * Where the fist draws back to for the windup, relative to its SHOULDER,
 * in the titan's root space (its own −z faces you), per unit of titan
 * scale. `side` is the arm's side (−1 or +1 along the rig's x).
 *
 * A titan's arm is a metre long per unit of scale, and every cock keeps
 * the fist out past the body at most of that — a BIG draw-back you read
 * from across the gap. (fff's tight chin-high cocks, made for a small
 * titan at arm's length, folded these arms up inside their own chests.)
 */
export function windupOffset(path: MeleePath, side: number, out: Vector3): Vector3 {
  switch (path) {
    case 'jab':
      return out.set(side * 0.22, -0.35, 0.42); // drawn back past the hip
    case 'hook':
      return out.set(side * 0.8, -0.1, 0.35); // swung out wide and back
    case 'overhand':
      return out.set(side * 0.35, 0.6, 0.35); // raised high, back over the shoulder
    case 'sweep':
      return out.set(side * 0.95, -0.3, 0.05); // out wide, low, the arm laid open
    case 'piston':
      return out.set(side * 0.25, -0.45, 0.55); // rammed right back, a piston cocked
    case 'clap':
      return out.set(side * 0.95, 0.05, 0.2); // both arms thrown wide open, level
    case 'spinback':
      return out.set(side * -0.35, -0.2, -0.45); // folded across the chest (its back is to you)
    case 'spinhammer':
      return out.set(side * 0.15, 0.7, 0.1); // raised high over its head
  }
}

/**
 * THE SPINNING BLOWS (fff's): the backfist and the hammerfist. The whole
 * titan turns, the striking shoulder going back first, and keeps turning —
 *   WINDUP   it turns its BACK on you (the tell: no other move does);
 *   STRIKE   the turn carries on round and the arm whips out, the fist on a
 *            level arc about its spine that lands on your head as the
 *            striking shoulder comes round (a hammer drops onto you);
 *   RECOVER  the turn finishes the revolution and it faces you again.
 * Duck it, or step the way it's turning.
 */
export const isSpin = (path: MeleePath): boolean => path === 'spinback' || path === 'spinhammer';

export const SPIN = {
  /** Turned this far round by the windup's end: its back to you. */
  windup: 0.85 * Math.PI,
  /** And this far when the fist lands: its striking shoulder toward you. */
  contact: 1.5 * Math.PI,
  /** A hammerfist starts its arc this far over your head, per unit scale. */
  lift: 0.45,
};

const smoothK = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/** How far round a spinning blow has turned, `u` (0–1) through `stage`.
 *  A recovery finishes the revolution from `from`, wherever the strike
 *  was cut off (a block stops the fist, not the body). */
export function spinTurn(stage: 'windup' | 'strike' | 'recover', u: number, from: number = SPIN.contact): number {
  const t = Math.min(1, Math.max(0, u));
  if (stage === 'windup') return SPIN.windup * smoothK(t / 0.85);
  if (stage === 'strike') return SPIN.windup + (SPIN.contact - SPIN.windup) * t;
  return from + (2 * Math.PI - from) * smoothK(t);
}

/** Where a spinning blow's fist is: your head (`to`, snapshotted) turned
 *  back round the titan's spine (the vertical through `axis`) by the turn
 *  still to come, `behind` radians about +y — it rides the body round and
 *  lands on you as `behind` reaches 0. A hammer also drops from `lift`. */
export function spinPoint(path: MeleePath, axis: Vector3, to: Vector3, behind: number, t: number, lift: number, out: Vector3): Vector3 {
  const dx = to.x - axis.x;
  const dz = to.z - axis.z;
  const c = Math.cos(behind);
  const s = Math.sin(behind);
  out.set(axis.x + c * dx + s * dz, to.y, axis.z - s * dx + c * dz);
  if (path === 'spinhammer') out.y += lift * (1 - smoothK(t));
  return out;
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
 *  PISTONKAISER — THE PISTON: a three-punch combo, RIGHT, LEFT, RIGHT (its
 *               own right), straight ram punches, stepping back for only a
 *               short windup between each, every one at where you are when
 *               it fires (each can land: the windup outlasts the i-frames) —
 *               keep stepping (or block one and break the chain); the
 *               overhand is its drop-forge.
 *  VULTURE    — the talons hook and scythe, and jab.
 *  JUGGERNAUT — the CLAP: both gauntlets swing in from the sides to meet on
 *               your head (duck, step back, or block either); the
 *               overhand is the baton; and the SPINNING HAMMERFIST, a whole
 *               revolution with one fist raised, brought down as it comes.
 *  GOLIATH    — has learned it all: the clap, the piston, the overhand, the
 *               hook, the SPINNING BACKFIST and the hammerfist.
 */
export const MELEE: Record<Exclude<TitanStyle, 'goop'>, MeleeMove[]> = {
  hook: [
    { path: 'jab', arm: 0, windup: 0.9, strike: 0.55, recover: 0.6 },
    { path: 'overhand', arm: 0, windup: 1.2, strike: 0.6, recover: 0.7 },
    { path: 'hook', arm: 1, windup: 1.1, strike: 0.65, recover: 0.7 },
    { path: 'sweep', arm: 1, windup: 1.3, strike: 0.85, recover: 0.8 },
  ],
  piston: [
    // arm 1 is the titan's right (it faces down its own −z): R, L, R.
    { path: 'piston', arm: 1, windup: 1.0, strike: 0.4, recover: 0.45, combo: 3, beat: 0.45 },
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
    { path: 'spinhammer', arm: 1, windup: 1.4, strike: 0.55, recover: 0.9 },
  ],
  king: [
    { path: 'clap', arm: 'both', windup: 1.2, strike: 0.6, recover: 0.8 },
    { path: 'piston', arm: 0, windup: 1.0, strike: 0.4, recover: 0.45, combo: 3, beat: 0.45 },
    { path: 'overhand', arm: 1, windup: 1.25, strike: 0.6, recover: 0.75 },
    { path: 'hook', arm: 0, windup: 1.1, strike: 0.6, recover: 0.7 },
    { path: 'spinback', arm: 0, windup: 1.25, strike: 0.48, recover: 0.7 },
    { path: 'spinhammer', arm: 1, windup: 1.3, strike: 0.52, recover: 0.85 },
  ],
};

/** Never the same move twice running (the grammar's first law). */
export function pickMelee(moves: readonly MeleeMove[], last: MeleePath | null, rand: () => number = Math.random): MeleeMove {
  const pool = moves.filter((m) => m.path !== last);
  const list = pool.length ? pool : moves;
  return list[Math.floor(rand() * list.length)] ?? list[0];
}
