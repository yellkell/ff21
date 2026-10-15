/**
 * The match-verdict signs — KO / WIN / TIME / DRAW, painted in neon by
 * ui/signArt.ts. KO / WIN only ever show to the *winner* (a knockout loss
 * shows nothing at all); the neutral TIME and DRAW mark a round that ran
 * the clock out (a decision, or a dead heat), and show to both fighters.
 */

import { signArt, type SignKey } from './signArt.js';

/** Map a centre-board verdict to its sign, or null if it has none. WIN
 *  covers both a round win and the match-clinching YOU WIN. There is no
 *  KO'D sign — a knockout loss is suppressed upstream. */
function keyFor(message: string): SignKey | null {
  if (message === 'KO') return 'ko';
  if (message === 'WIN' || message === 'YOU WIN') return 'win';
  if (message === 'TIME') return 'time';
  if (message === 'DRAW') return 'draw';
  return null;
}

/** The verdict sign for a message, or null if there's none (or it isn't
 *  ready yet). */
export function verdictArt(message: string): HTMLCanvasElement | null {
  const key = keyFor(message);
  return key ? signArt(key) : null;
}

/** The sign key a centre-board message shows, countdown or verdict — for
 *  tinting the aura behind it to match. */
export function signKeyFor(message: string): SignKey | null {
  if (message === '1' || message === '2' || message === '3') return message;
  if (message === 'FIGHT') return 'fight';
  if (message === 'OPEN') return 'open';
  return keyFor(message);
}
