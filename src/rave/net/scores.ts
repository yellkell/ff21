/**
 * THE WORLD BOARD — every headset's solo runs, in one place.
 *
 * This module used to be RAVE RAID's own little Firebase client: its own
 * project (`raveraid-bc866`), its own anonymous sign-in, its own `scores`
 * collection, its own cache and its own uid. It was also the only part of the
 * three games that had the score model RIGHT — one document per player per
 * chart, ownership provable from the document's name, and a server-side
 * ratchet — while FF2 next door was keeping append-only logs behind
 * `allow read, write: if true`.
 *
 * So the model won and the module lost. RAVE RAID's shape is now the shape of
 * every board in the app (see net/boards.ts), the connection is the one shared
 * with FF2 and the club (net/firebase.ts), and a raver and a fighter are the
 * same player with the same uid and the same callsign. What is left here is a
 * thin adapter: the vocabulary RAVE RAID's menus already speak — tracks,
 * difficulties, grades — mapped onto the shared boards underneath.
 *
 *     scores/<track>__<diff>__<uid>   →   boards/rave-<track>-<diff>/rows/<uid>
 *
 * One thing quietly got better in the move: the old query filtered on `track`
 * and `diff` and ordered by `score`, which needed a composite index — and a
 * missing one was the predictable first-run failure, complete with a console
 * link in the error message. A chart is now its own board, so the query is a
 * plain single-field order and there is no index to forget.
 *
 * WHAT THIS IS NOT: proof. The client computes the score, so a determined
 * cheater can post a fake one under their own name. The rules bound the damage
 * (shape, range, one row each, monotonic) — they cannot make a client honest.
 *
 * Everything here is LAZY and FAILS SOFT: no Firebase code loads until a board
 * is actually asked for, and a headset without a network simply reports 'off'
 * and leaves the local record book — the real source of truth for your own
 * bests — untouched.
 */

import {
  SCORE_CAP as SHARED_SCORE_CAP,
  boardNote,
  boardRows,
  boardState,
  boards,
  fetchBoard,
  postScore,
  raveBoard,
  type BoardState,
} from '../../net/boards.js';
import { cloudState, cloudUid } from '../../net/firebase.js';

export type { BoardState };

/** Rows a chart shows. */
export const WORLD_TOP = 100;
/** Absurd-value guard, mirrored in the rules. Real sets land far under. */
export const SCORE_CAP = SHARED_SCORE_CAP;

export interface WorldRow {
  uid: string;
  name: string;
  score: number;
  grade: string;
  /** True for the row this headset owns. */
  isMe: boolean;
}

export interface Board {
  state: BoardState;
  rows: WorldRow[];
  note: string;
}

/**
 * Bumped whenever any board changes — menus repaint when it moves. Kept as a
 * live view onto the shared counter so RAVE RAID's paint code, which watches
 * `scores.dirty`, still sees FF2's boards move too.
 */
export const scores = {
  get dirty(): number {
    return boards.dirty;
  },
  get uid(): string {
    return cloudUid();
  },
};

/** No connection to be had this session. */
export function worldOffline(): boolean {
  return cloudState.status === 'off';
}

/* ── reading ──────────────────────────────────────────────────────────── */

/**
 * The board for one chart. Returns immediately with whatever is known and
 * kicks off a fetch when the cache is cold or stale — call it from paint code
 * freely; it never blocks and never fetches twice at once.
 */
export function worldBoard(track: string, diff: number): Board {
  const id = raveBoard(track, diff);
  void fetchBoard(id); // no-op inside the TTL, and self-collapsing when in flight
  const me = cloudUid();
  return {
    state: boardState(id),
    note: boardNote(id),
    rows: boardRows(id)
      .slice(0, WORLD_TOP)
      .map((r) => ({
        uid: r.uid,
        name: r.name.slice(0, 12),
        score: r.value,
        grade: typeof r.meta.grade === 'string' ? r.meta.grade : 'F',
        isMe: r.uid === me,
      })),
  };
}

/** Force a refetch — after posting a run, or on an explicit RETRY. */
export function refreshWorldBoard(track: string, diff: number): void {
  void fetchBoard(raveBoard(track, diff), true);
}

/* ── writing ──────────────────────────────────────────────────────────── */

/**
 * Post a finished solo run. Silent about failure by design: a set that can't
 * reach the world board is still a set you danced, already written to this
 * headset's book.
 *
 * The write is unconditional — the RULES hold the ratchet, refusing a run that
 * doesn't beat your stored best — so there is nothing to check first.
 */
export async function submitWorldScore(
  track: string,
  diff: number,
  score: number,
  grade: string,
  name: string,
): Promise<void> {
  if (!track || diff < 0 || diff > 3) return;
  const landed = await postScore(raveBoard(track, diff), Math.round(score), name.slice(0, 12) || 'RAVER', { grade });
  if (landed) refreshWorldBoard(track, diff);
}
