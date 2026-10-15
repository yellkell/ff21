/**
 * THE BRIDGE — the one seam between the rave and whatever is hosting it.
 *
 * The rave runs in two places: on its own page (rave/main.ts), and inside
 * FIRE FIGHT 2's arena world, mounted in-session (rave/experience.ts). Its
 * board carries a FIRE FIGHT door either way, and this is how the door
 * finds out where it leads. Standalone, nothing is installed and the door
 * falls back to a page hop; in the arena the host installs a handler and
 * the door is a curtain, not a browser.
 *
 * THE BELL crosses the same seam the other way round: a FIGHT called from
 * the club floor needs an arena room to deal into, and a deal needs
 * carrying across. Standalone, neither is installed — the desk offers
 * only the record shelf, and a fight deal that somehow lands is folded
 * straight back onto the floor.
 */

import type { BellMode, FightDeal } from './club/bell.js';

export const raveBridge: {
  /** Back to the arena's lobby, in-session. Absent on the standalone page. */
  leaveToArena?: () => void;
  /** THE BELL, the caller's side: open a FIRE FIGHT room for `mode` in my
   *  name and resolve with its code — the ball carries the code up, and
   *  the relay deals it back to everyone who touched in. Rejects when no
   *  room could be opened, in which case there is no ball. */
  openFightRoom?: (mode: Exclude<BellMode, 'rave'>, name: string) => Promise<string>;
  /** THE BELL fired with me on it: carry me across to the arena room it
   *  names, as a fighter or a watcher, and bring me home when it's over. */
  dealToFight?: (deal: FightDeal) => void;
} = {};
