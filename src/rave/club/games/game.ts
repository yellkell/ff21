/**
 * The contract every arcade cabinet game keeps with ArcadeSystem.
 *
 * The system owns everything that's the same on every machine — which
 * cabinet you're standing at, raycasting both lasers onto its glass, the
 * walk-away gate, posting the run to both ledgers, the GAME OVER hold —
 * and hands the game only what it needs: each hand's point on THIS screen
 * (canvas pixels) and its trigger edges. The game owns its rules and
 * paints its own CRT.
 */

import type { ArcadeCabinet, ArcadeGameId } from '../arcade.js';

export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];

/** One hand's laser on a cabinet's glass this frame. */
export interface Pointer {
  /** Canvas pixels, or null when the laser is off this screen. */
  at: [number, number] | null;
  /** Trigger went down / came up this frame. */
  down: boolean;
  up: boolean;
}

export type Pointers = Record<Hand, Pointer>;

export type Phase = 'attract' | 'playing' | 'dead';

export interface CabinetGame {
  readonly id: ArcadeGameId;
  readonly cab: ArcadeCabinet;
  phase: Phase;
  /** The current run's score (the last run's, while dead). */
  score: number;
  /** A fresh run — the system has already set phase = 'playing'. */
  start(): void;
  /** One frame of play. Returns true when the run ended on its own terms
   *  (lives gone, clock out); the system then posts it and holds the card. */
  step(delta: number, hands: Pointers): boolean;
  /** The run is over (any reason that shows the GAME OVER card): the sting. */
  ended(): void;
  /** Paint the CRT for the current phase and flag the texture. */
  paint(clock: number): void;
}
