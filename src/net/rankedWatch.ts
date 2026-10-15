/**
 * Live list of open RANKED rooms for the server browser.
 *
 * Ranked hosting is serverless (see webrtcTransport.ts `hostRanked`): a boxer
 * with no challenger yet creates an OPEN doc in `rooms` (mode 'ranked'),
 * tagged with their name and heartbeated. This watcher subscribes to that
 * collection and reports the fresh, still-open rooms so the browser can list
 * them (each shows "1/2" — the host is in, one seat free).
 *
 * Same lifecycle discipline as queueWatch: subscribe only while the browser is
 * on screen, tear it down the moment you host/join or leave, and load Firebase
 * lazily so players who never open it never pay for the bundle.
 */

import { FIREBASE_ENABLED } from './firebaseConfig.js';
import { clockConfident, serverNow, syncServerClock } from './serverClock.js';

/** Rooms not heartbeated within this are abandoned hosts — hide them (mirrors
 *  LOBBY_FRESH_MS in webrtcTransport.ts). */
const FRESH_MS = 40 * 1000;

/** A room silent for THIS long gets deleted by whoever's browsing, so ghost
 *  hosts (crashed tabs — nothing client-side cleans up) can't pile up for
 *  ever. Way past any live heartbeat gap (hosts stamp every ~2.5 s). */
const ROOM_REAP_MS = 10 * 60 * 1000;

export interface RankedRoom {
  /** The room's doc id — passed to net.joinRanked to claim it. */
  id: string;
  /** The host's callsign, shown in the list. */
  host: string;
}

type ListListener = (rooms: RankedRoom[]) => void;

let stop: (() => void) | null = null;
let starting = false;

/**
 * Begin watching the open ranked rooms, reporting the list to `onRooms`
 * whenever it changes. No-op (empty list) if Firebase isn't the matchmaker (an
 * explicit relay has no room collection) or a watch is already live.
 */
export function startRankedWatch(onRooms: ListListener): void {
  if (stop || starting) return;
  if (!FIREBASE_ENABLED || usingExplicitRelay()) {
    onRooms([]);
    return;
  }
  starting = true;

  void (async () => {
    try {
      // The shared connection (net/firebase.ts) — the same app, sign-in and uid
      // the boards and the club use. A watch is a READ, and rooms are readable
      // by anyone signed in, so this needs the sign-in as much as any write.
      const { cloud } = await import('./firebase.js');
      const { reapRoom } = await import('./rooms.js');
      const c = await cloud();
      if (!c) {
        onRooms([]);
        return;
      }
      const { collection, onSnapshot, query, where } = c.fs;
      const rooms = collection(c.db, 'rooms');

      // AWAITED so the first snapshot never judges (or reaps) rooms on a raw
      // skewed device clock — see lobbyWatch for the failure this caused.
      await syncServerClock();
      const unsub = onSnapshot(
        query(rooms, where('mode', '==', 'ranked'), where('visibility', '==', 'public'), where('open', '==', true)),
        (snap) => {
          const now = serverNow();
          const list: RankedRoom[] = [];
          snap.forEach((docSnap) => {
            // 'estimate': our OWN heartbeat is a pending serverTimestamp() in this
            // cache for a moment every beat, and reads as null without this — so
            // a host browsing the list judged its own room by createdAt and, ten
            // minutes in, reaped it out from under itself.
            const data = docSnap.data({ serverTimestamps: 'estimate' });
            const seen =
              (data.seen?.toMillis?.() as number | undefined) ??
              (data.createdAt?.toMillis?.() as number | undefined) ??
              now;
            if (now - seen > ROOM_REAP_MS) {
              // Long-dead ghost host — reap it (see the quick-match outage),
              // but only with a server-confirmed clock behind the judgement.
              if (clockConfident()) reapRoom(c, docSnap.id); // the room, then its signalling
              return;
            }
            if (now - seen <= FRESH_MS) {
              // `host` is the uid the rules check ownership against; the name
              // the browser shows is `hostName`. They used to be the same
              // field, which worked only while nothing checked who a host was.
              list.push({ id: docSnap.id, host: typeof data.hostName === 'string' ? data.hostName : 'BOXER' });
            }
          });
          // Stable order so rows don't jump around between snapshots.
          list.sort((a, b) => a.id.localeCompare(b.id));
          onRooms(list);
        },
        () => onRooms([]), // listener errored (rules/offline) — empty list
      );

      if (starting) {
        stop = unsub;
      } else {
        unsub(); // stopRankedWatch was called while we were connecting
      }
    } catch {
      onRooms([]); // Firebase failed to load — nothing to list
    } finally {
      starting = false;
    }
  })();
}

/** Tear the listener down (leaving the browser). Safe to call when not watching. */
export function stopRankedWatch(): void {
  starting = false;
  if (stop) {
    stop();
    stop = null;
  }
}

function usingExplicitRelay(): boolean {
  return (
    new URLSearchParams(location.search).has('server') ||
    localStorage.getItem('ibb-server') !== null
  );
}
