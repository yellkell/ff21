/**
 * Live "N raids open" count for the ARCADE panel's RAID button.
 *
 * The room browser (lobbyWatch) only watches while its modal is on screen, and
 * only one arcade mode at a time — so the main lobby had no idea whether any
 * raid squad was forming until you clicked in. This watcher mirrors the RANKED
 * button's "N OPEN" badge: subscribe to the open raid rooms for the whole
 * lobby stay, count the LIVE, joinable ones (same freshness rules as the
 * browser list), and tear down when a bout/training/pub starts.
 *
 * Kept separate from lobbyWatch on purpose: that module is a singleton keyed
 * to ONE watched mode, and the browser modal re-points it (2v2/ffa/raid) —
 * sharing it would make the badge and the browser fight over the sub.
 */

import { FIREBASE_ENABLED } from './firebaseConfig.js';
import { serverNow, syncServerClock } from './serverClock.js';

/** Mirrors lobbyWatch's zombie rule: no beat within this = nobody alive. */
const BEAT_STALE_MS = 75 * 1000;

type CountListener = (count: number) => void;

let stop: (() => void) | null = null;
let starting = false;

/** Begin watching the open-raid count. No-op if already watching. */
export function startRaidWatch(onCount: CountListener): void {
  if (stop || starting) return;
  if (!FIREBASE_ENABLED) {
    onCount(-1);
    return;
  }
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

      // Awaited so the first count never judges beats on a raw skewed clock.
      await syncServerClock();
      const unsub = onSnapshot(
        query(rooms, where('format', '==', 'raid'), where('visibility', '==', 'public'), where('open', '==', true)),
        (snap) => {
          const now = serverNow();
          let count = 0;
          snap.forEach((docSnap) => {
            // 'estimate': our OWN heartbeat is a pending serverTimestamp() in this
            // cache for a moment every beat, and reads as null without this — so
            // a host browsing the list judged its own room by createdAt and, ten
            // minutes in, reaped it out from under itself.
            const data = docSnap.data({ serverTimestamps: 'estimate' });
            if (data.started === true) return;
            const created = (data.createdAt?.toMillis?.() as number | undefined) ?? now;
            const beat = (data.beat?.toMillis?.() as number | undefined) ?? created;
            if (now - beat > BEAT_STALE_MS) return; // zombie shell
            const seats = (data.seats as string[]) ?? [];
            const gone = (data.gone as Record<string, unknown> | undefined) ?? {};
            if (seats.filter((s) => s && gone[s] === undefined).length === 0) return; // empty shell
            count += 1;
          });
          onCount(count);
        },
        () => onCount(-1), // listener errored (rules/offline) — unknown
      );

      if (starting) {
        stop = unsub;
      } else {
        unsub(); // stopRaidWatch landed while we were connecting
      }
    } catch {
      onCount(-1); // Firebase failed to load — leave the count unknown
    } finally {
      starting = false;
    }
  })();
}

/** Tear the listener down (leaving the lobby). Safe when not watching. */
export function stopRaidWatch(): void {
  starting = false;
  if (stop) {
    stop();
    stop = null;
  }
}
