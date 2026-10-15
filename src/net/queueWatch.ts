/**
 * Live "how many are searching" count for the 1V1 panel.
 *
 * Quick match is serverless (see webrtcTransport.ts): a boxer with no opponent
 * yet creates an OPEN lobby doc in Firestore and waits; a second boxer claims
 * it (flipping it closed) and they pair up. So the number of FRESH, still-open
 * lobbies is exactly the number of people standing in the queue right now.
 *
 * We subscribe to that collection only while the lobby menu is on screen and
 * tear the listener down the moment a bout/training/pub starts — and the
 * Firebase bundle is imported lazily, so players who never open the 1V1 panel
 * (and the whole bot/training path) still never pay for it.
 */

import { FIREBASE_ENABLED } from './firebaseConfig.js';
import { serverNow, syncServerClock } from './serverClock.js';

/** Lobbies not heartbeated within this are abandoned tabs — don't count them as
 *  searchers (mirrors LOBBY_FRESH_MS in webrtcTransport.ts). */
const FRESH_MS = 40 * 1000;

type CountListener = (count: number) => void;

let stop: (() => void) | null = null;
let starting = false;

/**
 * Begin watching the queue size, reporting it to `onCount` whenever it
 * changes. No-op if Firebase isn't the matchmaker (an explicit relay has no
 * lobby collection to count) or a watch is already live.
 */
export function startQueueWatch(onCount: CountListener): void {
  if (stop || starting) return;
  if (!FIREBASE_ENABLED || usingExplicitRelay()) return;
  starting = true;

  void (async () => {
    try {
      // The shared connection (net/firebase.ts) — the same app, sign-in and uid
      // the boards and the club use. A watch is a READ, and rooms are readable
      // by anyone signed in, so this needs the sign-in as much as any write.
      const { cloud } = await import('./firebase.js');
      const c = await cloud();
      if (!c) {
        onCount(-1);
        return;
      }
      const { collection, onSnapshot, query, where } = c.fs;
      const rooms = collection(c.db, 'rooms');

      await syncServerClock(); // corrected clock BEFORE the first count lands
      const unsub = onSnapshot(
        query(rooms, where('mode', '==', 'duel'), where('visibility', '==', 'public'), where('open', '==', true)),
        (snap) => {
          const now = serverNow();
          let count = 0;
          snap.forEach((doc) => {
            // 'estimate': our OWN heartbeat is a pending serverTimestamp() in this
            // cache for a moment every beat, and reads as null without this — so
            // a host browsing the list judged its own room by createdAt and, ten
            // minutes in, reaped it out from under itself.
            const data = doc.data({ serverTimestamps: 'estimate' });
            const seen = (data.seen?.toMillis?.() as number | undefined) ?? (data.createdAt?.toMillis?.() as number | undefined) ?? now;
            if (now - seen <= FRESH_MS) count += 1;
          });
          onCount(count);
        },
        () => onCount(-1), // listener errored (rules/offline) — back to "unknown"
      );

      if (starting) {
        stop = unsub;
      } else {
        unsub(); // stopQueueWatch was called while we were connecting
      }
    } catch {
      onCount(-1); // Firebase failed to load — leave the count unknown
    } finally {
      starting = false;
    }
  })();
}

/** Tear the listener down (leaving the lobby). Safe to call when not watching. */
export function stopQueueWatch(): void {
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
