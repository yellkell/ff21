/**
 * The pre-round countdown signs — "3 / 2 / 1 / FIGHT", painted in neon by
 * ui/signArt.ts — for the centre scoreboard, the arena countdown, the
 * campaign HUD and the pub ring. Null until the sign is ready (the house
 * face still loading), so the hosts fall back to text for that gap.
 */

import { signArt, type SignKey } from './signArt.js';

/** Map a centre-board message to its countdown sign, or null if it has none. */
function keyFor(message: string): SignKey | null {
  if (message === '1' || message === '2' || message === '3') return message;
  if (message === 'FIGHT') return 'fight';
  // The pub fight hall adds an OPEN sign for a ring that's waiting for
  // challengers — the main game never asks for it.
  if (message === 'OPEN') return 'open';
  return null;
}

/** The countdown sign for a message (3/2/1/FIGHT/OPEN), or null. */
export function countdownArt(message: string): HTMLCanvasElement | null {
  const key = keyFor(message);
  return key ? signArt(key) : null;
}
