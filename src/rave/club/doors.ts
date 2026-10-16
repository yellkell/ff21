/**
 * THE FLOOR IS OPEN — the one rule for when the club is the place you're
 * standing in: you're in a room, its host isn't still holding you in the
 * foyer to read the code, and the hall itself has loaded (club/venue.ts).
 * Until all three, the foyer stands where it is, and the MC stays by the
 * board rather than at decks floating in the void.
 */

import { match } from '../game/state.js';
import { inRoom } from '../net/session.js';
import { venueReady } from './venue.js';

export function clubFloorOpen(): boolean {
  return inRoom() && !match.holdFoyer && venueReady();
}

/** In a room, but the hall is still on its way: the board says so. */
export function clubFloorLoading(): boolean {
  return inRoom() && !venueReady();
}
