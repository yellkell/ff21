/**
 * Device↔server clock offset for matchmaking freshness.
 *
 * Lobbies carry Firestore SERVER timestamps (`seen`/`createdAt`), but a client
 * decides whether a lobby is "live" by comparing that stamp to its OWN clock
 * with a tight window (LOBBY_FRESH_MS, ~40 s). VR headsets routinely drift —
 * asleep/woken, wrong timezone, no NTP — and a device whose clock is off by
 * more than that window sees EVERY open lobby as stale: it never claims one and
 * never crosses over to another host, so two people both searching never find
 * each other (while private codes, with a 10-minute window, keep working).
 *
 * We fix it by measuring the offset once: write a throwaway doc with
 * serverTimestamp(), read it straight back FROM THE SERVER (so the stamp is
 * resolved, not a pending null), and record serverMillis − localMillis. From
 * then on `serverNow()` returns the device clock corrected onto server time, so
 * freshness windows mean what they say regardless of how wrong the local clock
 * is. The probe lives at `probes/{uid}` — its own collection, one doc per
 * player, deleted right after. If the probe fails we fall back to a zero
 * offset — i.e. exactly the old behaviour, never worse.
 */

let offset: number | null = null;
let syncing: Promise<void> | null = null;
/** True only after a SUCCESSFUL probe — the failure fallback (offset 0) keeps
 *  this false. Destructive freshness judgements (reaping other people's room
 *  docs) must check this: an unsynced skewed clock hiding a room is a blip,
 *  but an unsynced skewed clock DELETING a live room takes the lobby down for
 *  everyone. */
let confident = false;

/** The local clock corrected onto server time (ms). Equals Date.now() until the
 *  first successful {@link syncServerClock}. */
export function serverNow(): number {
  return Date.now() + (offset ?? 0);
}

/** Did a real server probe back the current offset? Gate reaping on this. */
export function clockConfident(): boolean {
  return confident;
}

/** Measure the server-clock offset once (cached). Cheap to over-call: a no-op
 *  after the first success, and concurrent callers share the one probe. */
export function syncServerClock(): Promise<void> {
  if (offset !== null) return Promise.resolve();
  if (!syncing) {
    syncing = (async () => {
      try {
        const { cloud } = await import('./firebase.js');
        const c = await cloud();
        if (!c) {
          offset = 0; // no cloud — assume no skew (status quo, never worse)
          return;
        }
        const { deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc } = c.fs;
        // The probe has its OWN collection, one document per player. It used to
        // be written into the matchmaking collection as a fake lobby marked
        // `open: false` — invisible to the queue, but still a room-shaped
        // document sitting in with the real rooms, and one that would now have
        // to lie about being a room to get past the rules at all.
        const ref = doc(c.db, 'probes', c.uid);
        await setDoc(ref, { t: serverTimestamp() });
        const snap = await getDocFromServer(ref); // server read → the stamp is resolved
        const sv = (snap.data()?.t as { toMillis?: () => number } | undefined)?.toMillis?.();
        if (typeof sv === 'number') {
          offset = sv - Date.now();
          confident = true;
        } else {
          offset = 0;
        }
        void deleteDoc(ref).catch(() => {});
      } catch {
        offset = 0; // can't probe — assume no skew (status quo, never worse)
      } finally {
        syncing = null;
      }
    })();
  }
  return syncing;
}
