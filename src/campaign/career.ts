/**
 * THE CAREER — the campaign line-up as a title run, carried over from FIRE
 * FIGHT FLUX (fff game/career.ts). Seven bouts, left to right on the
 * campaign panel; each opens once the one before it is won:
 *
 *   I    AMATEUR BOUT             CHROMEHOOK      wins the AMATEUR belt
 *   II   LOCAL CHAMPIONSHIP       PISTONKAISER    wins the LOCAL belt
 *   III  NATIONAL CHAMPIONSHIP    VULTURE         wins the NATIONAL belt
 *   IV   INTERCONTINENTAL TITLE   JUGGERNAUT      wins the INTERCONTINENTAL belt
 *   V    TITLE DEFENSE            VULTURE+        your intercontinental belt, on the line
 *   VI   WORLD CHAMPIONSHIP       GOLIATH         wins the WORLD belt
 *   VII  WORLD TITLE DEFENSE      GOLIATH+        your world belt, on the line
 *
 * The two DEFENSES are rematches against SUPERCHARGED machines: bigger,
 * tougher, quicker, and armed with the elite attacks (nova, seesaw, surge)
 * the Hard tier spreads to everyone. VULTURE+ has also learned the
 * SPINNING BACKFIST (campaign/melee.ts). Belts are kept forever — a lost
 * defense is just a rematch to win — and every defense won is counted.
 * Winning the last bout for the first time pays CAREER_PRIZE iron-dollars.
 *
 * Save indices: `campaignProgress.cleared[i]` is bout i. The gauntlet runs
 * still fight the five titans; `BOUT_OF_TITAN` maps a titan to the bout
 * that first beats it.
 */

import type { AttackKind, BossDef } from './bosses.js';
import type { MeleeMove } from './melee.js';

export interface Supercharge {
  /** Size, toughness, and how much quicker its turns and windups come. */
  scale: number;
  health: number;
  cooldown: number;
  charge: number;
  /** Reaches it has learned since you last met it. */
  melee?: MeleeMove[];
}

export interface Bout {
  /** On the card and the warning: "TITLE DEFENSE". */
  title: string;
  /** The card's top line: "DEFENSE". */
  short: string;
  /** Which titan (BOSSES index). */
  boss: number;
  /** A supercharged rematch. */
  charged?: Supercharge;
  /** The belt a win takes (belts.ts id) … */
  wins?: string;
  /** … or the one you put on the line. */
  defends?: string;
}

export const CAREER: readonly Bout[] = [
  { title: 'AMATEUR BOUT', short: 'AMATEUR', boss: 0, wins: 'amateur' },
  { title: 'LOCAL CHAMPIONSHIP', short: 'LOCAL', boss: 1, wins: 'local' },
  { title: 'NATIONAL CHAMPIONSHIP', short: 'NATIONAL', boss: 2, wins: 'national' },
  { title: 'INTERCONTINENTAL TITLE', short: 'INTERCONT.', boss: 3, wins: 'intercontinental' },
  {
    title: 'TITLE DEFENSE',
    short: 'DEFENSE',
    boss: 2,
    // …and it has learned GOLIATH's SPINNING BACKFIST.
    charged: {
      scale: 1.3,
      health: 1.5,
      cooldown: 0.7,
      charge: 0.85,
      melee: [{ path: 'spinback', arm: 0, windup: 1.2, strike: 0.48, recover: 0.7 }],
    },
    defends: 'intercontinental',
  },
  { title: 'WORLD CHAMPIONSHIP', short: 'WORLD', boss: 4, wins: 'world' },
  {
    title: 'WORLD TITLE DEFENSE',
    short: 'DEFENSE',
    boss: 4,
    charged: { scale: 1.1, health: 1.6, cooldown: 0.65, charge: 0.85 },
    defends: 'world',
  },
];

/** Iron-dollars for winning the whole career, once. */
export const CAREER_PRIZE = 1500;

/** The bout that first beats each titan (BOSSES index → career index). */
export const BOUT_OF_TITAN: readonly number[] = [0, 1, 2, 3, 5];

/** A supercharged cut of a titan (a COPY; BOSSES is never mutated). */
export function supercharge(def: BossDef, s: Supercharge): BossDef {
  const charge = { ...def.charge };
  for (const k of Object.keys(charge) as AttackKind[]) charge[k] *= s.charge;
  const weights = { ...def.weights };
  for (const k of ['nova', 'seesaw', 'surge'] as AttackKind[]) weights[k] = Math.max(weights[k], 3);
  return {
    ...def,
    scale: def.scale * s.scale,
    health: Math.round(def.health * s.health),
    cooldownMin: def.cooldownMin * s.cooldown,
    cooldownMax: def.cooldownMax * s.cooldown,
    charge,
    grammarCharge: def.grammarCharge === undefined ? undefined : def.grammarCharge * s.charge,
    weights,
    extraMelee: s.melee ? [...(def.extraMelee ?? []), ...s.melee] : def.extraMelee,
  };
}
