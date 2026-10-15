/**
 * PRESENCE — who is about, and which room they are in.
 *
 * The social area's heartbeat. One document per player, rewritten as you move
 * between the menu, the club, the pub, the arena and a rave set, so that any
 * face of the app can answer "is anyone around?" before you commit to walking
 * through a door into an empty room. That question was previously unanswerable
 * without joining, which is exactly the wrong order.
 *
 * This is DELIBERATELY COARSE. It is a foyer sign, not a tracker: your name,
 * the room you are in, and when you last checked in. Where you are STANDING —
 * pose, hands, voice — never comes near Firestore; that rides the relay and
 * peer-to-peer WebRTC at 10 Hz, and putting it here would be both ruinous per
 * document read and far too slow to look like a person moving.
 *
 * BEATING costs one write a minute per player, and the read the club does is
 * one query. Both are bounded and both are cheap, which is the only reason
 * presence belongs in Firestore at all.
 *
 * LEAVING is best-effort. A headset that crashes, sleeps or walks out of wifi
 * range never gets to say goodbye, so a stale record has to stop counting on
 * its own. Every write carries `expiresAt`, and the roster query filters on it
 * SERVER-SIDE — an expired record is never returned, never shown, and never
 * costs a read. That is what makes a ghost harmless.
 *
 * Actually removing them is housekeeping on top of that, and it is done by the
 * clients (see `sweep`) rather than by a Firestore TTL policy, because TTL
 * requires a billing plan and this project is on the free one.
 */

import { cloud, cloudUid } from './firebase.js';

/** The places a player can be. Mirrored in firestore.rules — adding one here
 *  without adding it there means every write from that room is denied. */
export type Where = 'menu' | 'club' | 'pub' | 'arena' | 'rave';

/** How often a present player re-stamps their record. */
const BEAT_MS = 45_000;
/** How long a record stays good. Comfortably more than two beats, so one
 *  missed write on a flaky connection doesn't blink you out of the room. */
const TTL_MS = 150_000;
/** A roster older than this refetches when something asks again. */
const ROSTER_TTL_MS = 20_000;

export interface Present {
  uid: string;
  name: string;
  where: Where;
  /** Packed look/gear, so the club can show a recognisable silhouette in a
   *  list without a second fetch of the full player document. */
  look: string;
  /** Wall-clock ms of their last beat. */
  at: number;
  isMe: boolean;
}

/** Bumped whenever the roster changes — menus repaint when it moves. */
export const presence = { dirty: 0, state: 'idle' as 'idle' | 'loading' | 'ready' | 'off' };

let roster: Present[] = [];
let fetchedAt = 0;
let beating = 0;
let mine: { name: string; where: Where; look: string } | null = null;

/** Everyone currently checked in, freshest first. Synchronous — paint from it. */
export function presentPlayers(): Present[] {
  return roster;
}

/** How many are in a given room right now. */
export function headcount(where: Where): number {
  return roster.filter((p) => p.where === where).length;
}

/* ── checking in ──────────────────────────────────────────────────────── */

async function beat(): Promise<void> {
  if (!mine) return;
  const c = await cloud();
  if (!c) return;
  try {
    const { doc, setDoc } = c.fs;
    const now = Date.now();
    await setDoc(doc(c.db, 'presence', c.uid), {
      name: mine.name.slice(0, 16),
      where: mine.where,
      look: mine.look.slice(0, 128),
      at: now,
      // A TIMESTAMP, not a number: a TTL policy pointed at a numeric field
      // sweeps nothing at all, and says nothing about it. See net/rooms.ts.
      expiresAt: new Date(now + TTL_MS),
    });
  } catch {
    // A missed beat is survivable — the next one is 45 seconds away and the
    // TTL is generous enough to ride out a few. Nothing to tell the player.
  }
}

/**
 * Announce that you are in a room, and keep saying so until you enter another
 * one or call `leave()`. Safe to call on every room change; re-entering the
 * room you are already in just updates the stamp.
 */
export function enter(where: Where, name: string, look = ''): void {
  const changed = !mine || mine.where !== where || mine.name !== name || mine.look !== look;
  mine = { name, where, look };
  if (!changed && beating) return;

  void beat();
  if (!beating) {
    beating = setInterval(() => void beat(), BEAT_MS) as unknown as number;
  }
}

/**
 * Stand down — stop beating and remove the record. Best effort by nature: a
 * headset that crashes never reaches this, which is what the TTL is for.
 */
export function leave(): void {
  if (beating) {
    clearInterval(beating);
    beating = 0;
  }
  mine = null;
  void (async () => {
    const c = await cloud();
    if (!c) return;
    try {
      await c.fs.deleteDoc(c.fs.doc(c.db, 'presence', c.uid));
    } catch {
      /* the TTL will get it */
    }
  })();
}

// A tab closing is the common case for "left without saying so", and the
// browser gives us one last synchronous moment to try. It often doesn't make
// it out — that is fine, the TTL is the real answer — but when it does the
// room updates immediately instead of a couple of minutes later.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (mine) leave();
  });
}

/* ── reading the room ─────────────────────────────────────────────────── */

/**
 * THE SWEEP — take out expired records, once per session, a handful at a time.
 *
 * This is the job a Firestore TTL policy would do, done by the clients instead,
 * because TTL requires a billing plan and this project is on the free one. It
 * is not a workaround so much as the same arrangement the duel lobbies have
 * always had: webrtcTransport reaps the ghosts it scans past, for the same
 * reason and with the same caution.
 *
 * Worth being clear about what this is and isn't for. Nothing DEPENDS on it:
 * the roster query filters on `expiresAt > now` server-side, so an expired
 * record is never returned, never shown, and never costs a read. It is
 * housekeeping — bytes, not correctness — which is why it is fine for it to be
 * lazy, bounded and best-effort.
 *
 * Once per session and twenty at a time: a hundred headsets should not all
 * grind the same collection, and the pile only grows at the rate people stop
 * playing.
 */
let swept = false;

async function sweep(): Promise<void> {
  if (swept) return;
  swept = true;
  const c = await cloud();
  if (!c) return;
  try {
    const { collection, deleteDoc, getDocs, limit, orderBy, query, where: whereFn } = c.fs;
    const snap = await getDocs(
      query(collection(c.db, 'presence'), whereFn('expiresAt', '<', new Date()), orderBy('expiresAt'), limit(20)),
    );
    // Firestore orders values by TYPE before value, and numbers sort below
    // timestamps — so this one query also catches records written back when
    // the lease was a number, which is convenient, because a TTL policy never
    // could have.
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    // Denied, offline, or nothing to do. The roster is unaffected either way.
  }
}

/**
 * Refresh the roster. Cheap to call repeatedly — a fetch inside the TTL is a
 * no-op. Records past their expiry are dropped by the query itself, so a ghost
 * never shows however long it sits there.
 */
export async function fetchPresence(force = false): Promise<void> {
  if (!force && presence.state === 'ready' && Date.now() - fetchedAt < ROSTER_TTL_MS) return;
  if (presence.state === 'loading') return;

  presence.state = 'loading';
  presence.dirty++;

  const c = await cloud();
  if (!c) {
    presence.state = 'off';
    roster = [];
    fetchedAt = Date.now();
    presence.dirty++;
    return;
  }

  try {
    const { collection, getDocs, limit, orderBy, query, where: whereFn } = c.fs;
    const now = Date.now();
    const snap = await getDocs(
      query(
        collection(c.db, 'presence'),
        whereFn('expiresAt', '>', new Date(now)),
        orderBy('expiresAt', 'desc'),
        limit(200),
      ),
    );
    const me = cloudUid();
    roster = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        uid: d.id,
        name: typeof data.name === 'string' ? data.name : '—',
        where: (typeof data.where === 'string' ? data.where : 'menu') as Where,
        look: typeof data.look === 'string' ? data.look : '',
        at: typeof data.at === 'number' ? data.at : 0,
        isMe: d.id === me,
      };
    });
    presence.state = 'ready';
    void sweep(); // once a session, after we know the cloud answers
  } catch {
    presence.state = 'off';
    roster = [];
  }
  fetchedAt = Date.now();
  presence.dirty++;
}
