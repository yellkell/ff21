/**
 * THE ROOM, LOADED — whether the club's baked hall is actually standing.
 *
 * The hall (neon_club.glb) is the one heavy thing in the venue: some
 * sixteen megabytes, streamed and decoded after the live layer is already
 * up. The floor used to open the moment you were in a room, so a cold
 * entry — through the arena's CLUB door or the foyer board's — showed the
 * DJ at his decks and the props in the void for the seconds the hall took
 * to land. Now the floor opens on the room AND the hall (club/doors.ts),
 * and both doors wait for it: the arena's in its held door and under its
 * black, the foyer's at the board.
 *
 * The bytes can be fetched ahead of the build (the arena knocks for them
 * while the house wakes), and the build takes them from here, so the hall
 * is downloaded once whoever asked first. Dependency-free on purpose: the
 * arena reaches for this without pulling the rave in.
 */

export const VENUE_GLB = 'club/neon_club.glb';

let bytes: Promise<ArrayBuffer> | null = null;
let fetched = false;
let ready = false;

/** Start downloading the hall, if nobody has yet. Idempotent. */
export function prefetchVenue(): void {
  if (bytes || ready) return;
  const p = fetch(VENUE_GLB).then((r) => {
    if (!r.ok) throw new Error(`venue ${r.status}`);
    return r.arrayBuffer();
  });
  // Settled either way: a failed fetch is the build's to retry, not a wait.
  p.then(
    () => (fetched = true),
    () => (fetched = true),
  );
  bytes = p;
}

/** The build's claim on the bytes (the promise is let go once taken, so
 *  the sixteen megabytes aren't held after the parse). */
export function takeVenueBytes(): Promise<ArrayBuffer> {
  prefetchVenue();
  const p = bytes!;
  bytes = null;
  return p;
}

/** The download has finished (or failed) — the arena's held door waits on
 *  this, so the black only covers the decode. */
export function venueFetched(): boolean {
  return fetched || ready;
}

/** The hall is in the scene — or failed for good, in which case the floor
 *  opens on what there is rather than never opening. */
export function venueReady(): boolean {
  return ready;
}

export function markVenueReady(): void {
  ready = true;
  fetched = true;
}
