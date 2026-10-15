/**
 * THE TOWN'S DOORS — how the arena, the venue and the rave reach each
 * other.
 *
 * In-session, when a host has installed handlers (ClubExperienceManager),
 * every door is a curtain: the black comes down, the world swaps, the black
 * lifts, and the XR session never ends. Without handlers (a standalone
 * page) the doors fall back to what they were — end the session, hop the
 * page — which is the one thing a session can't hide, and why the handlers
 * exist.
 *
 * Every door is also where PRESENCE changes hands. This is the one chokepoint
 * the whole town passes through, so announcing the room here means no screen
 * has to remember to do it — and a player who walks from the arena to the
 * venue to the rave leaves exactly one record behind, rewritten, rather than
 * three that disagree.
 */

import type { World } from '@iwsdk/core';
import { raveUrl } from '../config.js';
import { enter } from '../net/presence.js';
import { myName } from '../net/leaderboard.js';
import { myPackedLook } from '../avatar/paint.js';

type NavigationHandler = () => void | Promise<void>;

interface TownHandlers {
  /** FIRE FIGHT's CLUB tab: the venue's floor. */
  enterVenue: NavigationHandler;
  /** The ARCADE's RAVE RAID: the rave's foyer, at the board. */
  enterRave: NavigationHandler;
  /** Back to the arena's lobby from either. */
  leaveToArena: NavigationHandler;
}

let handlers: TownHandlers | null = null;

export function setTownNavigationHandlers(h: TownHandlers): () => void {
  handlers = h;
  return () => {
    if (handlers === h) handlers = null;
  };
}

function endSessionAndNavigate(world: World, url: string): void {
  const go = (): void => window.location.assign(url);
  const session = world.session as XRSession | undefined;
  if (session) void Promise.resolve(session.end()).then(go, go);
  else go();
}

/**
 * Say which room we are in now. Fire-and-forget and fails soft: a headset
 * with no cloud simply isn't listed, and every door still opens.
 */
function announce(where: 'arena' | 'club' | 'rave'): void {
  try {
    enter(where, myName(), myPackedLook());
  } catch {
    /* presence is a courtesy — never let it stand in a doorway */
  }
}

/** Walk onto the venue's floor. */
export function requestVenueEntry(world: World): void {
  announce('club');
  if (handlers) {
    void handlers.enterVenue();
    return;
  }
  // The fallback is a PAGE HOP, and the two doors used to hop to the same
  // bare URL — where the rave page opens on its campaign screen (state.ts
  // screen: 'tour'). So asking for the club got you the RAVE RAID menu and
  // a second walk to find the floor you had already chosen. Say which door
  // it was, and the page opens on the right side of it.
  endSessionAndNavigate(world, `${raveUrl()}?to=club`);
}

/** Cross to RAVE RAID's foyer. */
export function requestRaveEntry(world: World): void {
  announce('rave');
  if (handlers) {
    void handlers.enterRave();
    return;
  }
  endSessionAndNavigate(world, `${raveUrl()}?to=foyer`);
}

export function requestArenaReturn(world: World): void {
  announce('arena');
  if (handlers) {
    void handlers.leaveToArena();
    return;
  }
  endSessionAndNavigate(world, 'index.html');
}
