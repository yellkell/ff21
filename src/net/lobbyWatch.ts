/**
 * Live list of open arcade LOBBIES for the lobby browser — 2v2, ffa or raid.
 *
 * A host creates an OPEN room doc in `rooms` (tagged with its `format` and
 * the squad's callsigns); this watcher subscribes to the rooms of ONE mode and
 * reports the fresh, still-open, not-yet-started ones so the browser can list
 * them (each shows the host's name, the head-count and the raid hardcore flag).
 *
 * Same lifecycle discipline as rankedWatch: subscribe only while the browser is
 * on screen, tear it down on host/join/close, and load Firebase lazily so
 * players who never open a lobby never pay for the bundle.
 */

import type { ArcadeMode } from '../config.js';
import { FIREBASE_ENABLED } from './firebaseConfig.js';
import { clockConfident, serverNow, syncServerClock } from './serverClock.js';

/** A live lobby's members stamp `beat` on the room doc every 30 s (meshImpl).
 *  A beat older than this means every member crashed/quit without cleaning up
 *  — a zombie shell, not a joinable lobby. Legacy docs without a beat fall
 *  back to createdAt, so old abandoned rooms age out the same way. Two missed
 *  beats + margin: the old 2 min window kept dead rooms on the list long
 *  enough to read as "my old lobby is still there". */
const BEAT_STALE_MS = 75 * 1000;

/** A room silent for THIS long gets deleted by whoever's browsing — zombie
 *  shells otherwise pile up in `rooms` for ever (nothing client-side
 *  runs after a crash), and the quick-match outage taught us where unbounded
 *  ghost growth ends. Far beyond any live pause, so a skewed-but-unsynced
 *  clock can't reap a real lobby. */
const ROOM_REAP_MS = 30 * 60 * 1000;

export interface LobbyRoom {
  /** The room's doc id — passed to mesh.joinLobby to claim a seat. */
  id: string;
  /** The host's callsign, shown in the list. */
  host: string;
  /** Seats filled so far. */
  count: number;
  /** Seats this room's mode holds (its capacity). */
  cap: number;
  /** The lobby's hardcore breaker (raid only), so joiners know the stakes. */
  hardcore: boolean;
  /** The lobby's FIGHT GOOPLIATH breaker (raid only) — this squad skips the
   *  titans and takes on the living tide. */
  goopliath: boolean;
}

type ListListener = (rooms: LobbyRoom[]) => void;

let stop: (() => void) | null = null;
let starting = false;
/** The mode currently being watched, so a switch tears the old sub down. */
let watchedMode: ArcadeMode | null = null;

/** Begin watching the open lobbies of `mode`, reporting on every change. A
 *  call for a DIFFERENT mode than the live watch swaps it; a repeat call for
 *  the same mode is a no-op. */
export function startLobbyWatch(mode: ArcadeMode, onRooms: ListListener): void {
  if ((stop || starting) && watchedMode === mode) return;
  if (watchedMode !== mode) stopLobbyWatch(); // mode switch — drop the old sub
  if (!FIREBASE_ENABLED) {
    onRooms([]);
    return;
  }
  starting = true;
  watchedMode = mode;

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

      // Correct for device clock skew BEFORE judging beats: this watch used to
      // trust Date.now(), so a headset clock >2 min fast saw EVERY live room as
      // a zombie and listed nothing. AWAITED, not just kicked: the first
      // snapshot fires immediately, and letting it judge (and above all REAP)
      // rooms with a raw skewed clock deleted LIVE rooms — a viewer whose
      // clock ran fast assassinated every fresh raid lobby the moment they
      // opened the browser ("I host, nobody ever sees my server").
      await syncServerClock();
      const unsub = onSnapshot(
        query(rooms, where('format', '==', mode), where('visibility', '==', 'public'), where('open', '==', true)),
        (snap) => {
          const now = serverNow();
          const list: LobbyRoom[] = [];
          snap.forEach((docSnap) => {
            // 'estimate': our OWN heartbeat is a pending serverTimestamp() in this
            // cache for a moment every beat, and reads as null without this — so
            // a host browsing the list judged its own room by createdAt and, ten
            // minutes in, reaped it out from under itself.
            const data = docSnap.data({ serverTimestamps: 'estimate' });
            const created = (data.createdAt?.toMillis?.() as number | undefined) ?? now;
            const beat = (data.beat?.toMillis?.() as number | undefined) ?? created;
            // Long-dead shell — reap it so the collection can't silt up (the
            // browser is the only regular reader of this collection). ONLY
            // with a server-confirmed clock: deleting on an unsynced skewed
            // clock is how live rooms got assassinated.
            if (now - beat > ROOM_REAP_MS) {
              if (clockConfident()) reapRoom(c, docSnap.id); // the room, then its signalling
              return;
            }
            if (data.started === true) return;
            if (now - beat > BEAT_STALE_MS) return; // nobody alive inside — zombie
            const seats = (data.seats as string[]) ?? [];
            // Members whose page went away fire a `gone` tombstone (meshImpl
            // onPageHide; value = when) — don't count them as in the room.
            const gone = (data.gone as Record<string, unknown> | undefined) ?? {};
            const count = seats.filter((s) => s && gone[s] === undefined).length;
            if (count === 0) return; // an empty shell isn't a lobby
            const names = (data.names as string[]) ?? [];
            list.push({
              id: docSnap.id,
              host: typeof names[0] === 'string' && names[0] ? names[0] : 'BOXER',
              count,
              cap: (data.capacity as number | undefined) ?? seats.length ?? 4,
              hardcore: data.hardcore === true,
              goopliath: data.goopliath === true,
            });
          });
          list.sort((a, b) => a.id.localeCompare(b.id)); // stable rows
          onRooms(list);
        },
        () => onRooms([]), // listener errored (rules/offline) — empty list
      );

      if (starting && watchedMode === mode) {
        stop = unsub;
      } else {
        unsub(); // stopLobbyWatch (or a mode switch) landed while connecting
      }
    } catch {
      onRooms([]); // Firebase failed to load — nothing to list
    } finally {
      starting = false;
    }
  })();
}

/** Tear the listener down (leaving the browser). Safe when not watching. */
export function stopLobbyWatch(): void {
  starting = false;
  watchedMode = null;
  if (stop) {
    stop();
    stop = null;
  }
}
