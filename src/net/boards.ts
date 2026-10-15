/**
 * THE BOARDS — every leaderboard in the app, one shape.
 *
 * FF2 had three different answers to "where does a score go". The 1v1 ladder
 * and aim training lived as fields on the player document. PvE runs were
 * APPEND-ONLY logs — `runGauntlet`, `runRaid`, `runGoopliath` — a fresh
 * document per attempt, so a board was a pile of every run anyone had ever
 * made and the client had to sort the wheat out of it on read. RAVE RAID, in
 * a different project entirely, had already worked out the better answer, and
 * the pub's arcade board was a single hand-maintained document.
 *
 * This is RAVE RAID's answer, applied everywhere:
 *
 *     boards/{board}/rows/{uid}
 *
 * ONE DOCUMENT PER PLAYER PER BOARD. A board is a table of personal bests,
 * not a log. Three things fall out of that, all of them good:
 *
 *  - Nobody can flood a chart. Fifty runs overwrite one row fifty times.
 *  - The rules can prove ownership from the document's own NAME, without
 *    trusting a field the client filled in.
 *  - A better run REPLACES a worse one, and the rules refuse the write if it
 *    doesn't actually beat what's there — so the ratchet is server-side, not
 *    a favour the client does us.
 *
 * DIRECTION LIVES IN THE BOARD ID. An id ending `-time` is a race and ranks
 * low-to-high; everything else ranks high-to-low. That convention is load
 * bearing — firestore.rules reads it with a regex to decide which way the
 * ratchet turns, without a lookup. Add a timed board and you MUST name it
 * `-time` or its rows will ratchet the wrong way.
 *
 * Everything here fails soft. No cloud, no network, a project with auth off:
 * a read returns an empty board marked 'off', a write is dropped, and the
 * local record book — which is the real source of truth for your OWN bests —
 * is untouched either way.
 */

import { cloud, cloudUid } from './firebase.js';

/* ── the boards ───────────────────────────────────────────────────────── */

/**
 * Every board id in the app, spelled out rather than generated, so that
 * grepping for one finds every place it is written and read. The `-time`
 * suffix is not decoration — see the note above.
 */
export const BOARD = {
  /** FIRE FIGHT 1v1 ladder points, this season. */
  ranked: 'ff2-ranked',
  /** Aim training, personal best run score. */
  aim: 'ff2-aim',
  /** THE SPEEDRUN, the titan line-up against a clock. Not here: it is one
   *  board PER DIFFICULTY, so see speedrunBoard() below. */
  /** The raid — fastest clear, ANY difficulty (the legacy mixed board; the
   *  per-feat boards are runBoard('raid', …)). */
  raid: 'ff2-raid-time',
  /** GOOPLIATH — fastest fell, any difficulty (legacy mixed board). */
  goopliath: 'ff2-goopliath-time',
  /** OCTA HUNT, the pub's arcade cabinet. */
  octaHunt: 'pub-octahunt',
} as const;

/** The difficulty tiers that rank. EASY plays but never posts, on any board. */
export const RANKED_TIERS = ['normal', 'hard', 'blazing'] as const;
export type RankedTier = (typeof RANKED_TIERS)[number];

/**
 * THE SPEEDRUN's board for one difficulty: `ff2-speedrun-<tier>-time`.
 *
 * One board per tier rather than one board with the tier in `meta`, because
 * a board is a RATCHET keyed on your uid: with a single board your blazing
 * run and your normal run fight over the same row and only the faster
 * survives, which is exactly the comparison a speedrunner cares about most.
 * Three boards means three personal bests, and the stats page can rank each
 * tier honestly instead of filtering a pile that already lost the losers.
 *
 * RAID and GOOPLIATH now split the same way, and hardcore runs get boards
 * of their own too — see runBoard() below.
 */
export function speedrunBoard(difficulty: string): string {
  return runBoard('gauntlet', difficulty, false);
}

/** The three PvE run families that race a clock. */
export type RunMode = 'gauntlet' | 'raid' | 'goopliath';

/**
 * THE FEAT BOARDS: one board per (run, difficulty, hardcore).
 *
 *   ff2-speedrun-<tier>-time      ff2-speedrun-<tier>-hc-time
 *   ff2-raid-<tier>-time          ff2-raid-<tier>-hc-time
 *   ff2-goopliath-<tier>-time     (the tide has no hardcore)
 *
 * The same ratchet problem that split SPEEDRUN by tier (above) was still
 * eating the hardest runs everywhere else. RAID and GOOPLIATH kept ONE row
 * per player across every difficulty, so a blazing hardcore clear that took
 * longer than your normal clear was refused at the door — the board only
 * ever held the easy, fast one. And a hardcore speedrun slower than your
 * plain one on the same tier went the same way. The most impressive runs in
 * the game were the ones the boards could not keep.
 *
 * So every feat gets its own personal best. A hardcore run ALSO posts to its
 * tier's plain board (it is a clear of that tier, under stricter rules), so
 * the tier board still answers "fastest on BLAZING, any rules".
 *
 * The legacy mixed boards (BOARD.raid, BOARD.goopliath) keep being written
 * too, so their history and older clients stay whole; the lobby reads them
 * alongside the feat boards and files each legacy row under its own feat.
 */
export function runBoard(mode: RunMode, difficulty: string, hardcore: boolean): string {
  const tier = (RANKED_TIERS as readonly string[]).includes(difficulty) ? difficulty : 'normal';
  const family = mode === 'gauntlet' ? 'speedrun' : mode;
  const hc = hardcore && mode !== 'goopliath' ? '-hc' : '';
  return `ff2-${family}-${tier}${hc}-time`;
}

/** Every board a run family's feats live on — tier boards, hardcore boards,
 *  and the legacy mixed board where there is one. */
export function runBoardsFor(mode: RunMode): string[] {
  const ids: string[] = [];
  for (const tier of RANKED_TIERS) {
    ids.push(runBoard(mode, tier, false));
    if (mode !== 'goopliath') ids.push(runBoard(mode, tier, true));
  }
  if (mode === 'raid') ids.push(BOARD.raid);
  if (mode === 'goopliath') ids.push(BOARD.goopliath);
  return ids;
}

/** Every board one finished run should post to (see runBoard). */
export function runPostBoards(mode: RunMode, difficulty: string, hardcore: boolean): string[] {
  const ids = [runBoard(mode, difficulty, false)];
  if (hardcore && mode !== 'goopliath') ids.push(runBoard(mode, difficulty, true));
  if (mode === 'raid') ids.push(BOARD.raid);
  if (mode === 'goopliath') ids.push(BOARD.goopliath);
  return ids;
}

/** RAVE RAID charts are per track AND per difficulty — one board each. */
export function raveBoard(track: string, difficulty: number): string {
  // Board ids are path segments: keep them boring. Anything that isn't a
  // letter, a digit or a dash becomes a dash, so a track called "Neon/Fall"
  // can't smuggle a slash in and silently create a nested collection.
  const safe = track.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `rave-${safe}-${difficulty}`;
}

/** Does this board rank low-to-high? Mirrors the rule in firestore.rules. */
export function isTimeBoard(board: string): boolean {
  return board.endsWith('-time');
}

/** Absurd-value guards, mirrored in the rules. Real runs land far under. */
export const SCORE_CAP = 5_000_000;
export const TIME_CAP = 86_400;

/** How many rows a board fetch pulls. */
export const BOARD_TOP = 100;
/** A board older than this refetches when something asks for it again. */
const TTL_MS = 60_000;

/* ── shape ────────────────────────────────────────────────────────────── */

export interface BoardRow {
  /** The owning player's uid — also the document id. */
  uid: string;
  name: string;
  /** Points on a score board, seconds on a `-time` board. */
  value: number;
  /** Free-form extras the board wants to show: squad names, difficulty,
   *  grade. Never trusted for ranking — only `value` orders a board. */
  meta: Record<string, unknown>;
  /** True for the row this headset owns. */
  isMe: boolean;
}

export type BoardState = 'idle' | 'loading' | 'ready' | 'error' | 'off';

interface Board {
  state: BoardState;
  rows: BoardRow[];
  note: string;
  fetchedAt: number;
}

/** Bumped whenever any board changes — menus repaint when it moves. */
export const boards = { dirty: 0 };

const cache = new Map<string, Board>();

function slot(board: string): Board {
  let b = cache.get(board);
  if (!b) {
    b = { state: 'idle', rows: [], note: '', fetchedAt: 0 };
    cache.set(board, b);
  }
  return b;
}

/** The rows currently held for a board. Synchronous — paint from this. */
export function boardRows(board: string): BoardRow[] {
  return slot(board).rows;
}

/** What a board is doing, for the UI's status line. */
export function boardState(board: string): BoardState {
  return slot(board).state;
}

export function boardNote(board: string): string {
  return slot(board).note;
}

/** This headset's own row on a board, if it has posted one. */
export function myRow(board: string): BoardRow | null {
  return slot(board).rows.find((r) => r.isMe) ?? null;
}

/* ── reading ──────────────────────────────────────────────────────────── */

/**
 * Pull a board's top rows. Cheap to call repeatedly: a fetch inside the TTL
 * is a no-op, and concurrent calls collapse onto the one in flight.
 */
export async function fetchBoard(board: string, force = false): Promise<void> {
  const b = slot(board);
  if (!force && b.state === 'ready' && Date.now() - b.fetchedAt < TTL_MS) return;
  if (b.state === 'loading') return;

  b.state = 'loading';
  boards.dirty++;

  const c = await cloud();
  if (!c) {
    b.state = 'off';
    b.note = 'offline';
    b.fetchedAt = Date.now();
    boards.dirty++;
    return;
  }

  try {
    const { collection, getDocs, limit, orderBy, query } = c.fs;
    const rows = query(
      collection(c.db, 'boards', board, 'rows'),
      orderBy('value', isTimeBoard(board) ? 'asc' : 'desc'),
      limit(BOARD_TOP),
    );
    const snap = await getDocs(rows);
    const me = cloudUid();
    b.rows = snap.docs.map((d) => {
      const data = d.data() as { name?: unknown; value?: unknown; meta?: unknown };
      return {
        uid: d.id,
        name: typeof data.name === 'string' ? data.name : '—',
        value: typeof data.value === 'number' ? data.value : 0,
        meta: (data.meta ?? {}) as Record<string, unknown>,
        isMe: d.id === me,
      };
    });
    b.state = 'ready';
    b.note = '';
  } catch (err) {
    b.state = 'error';
    b.note = String((err as { code?: string })?.code ?? 'unavailable');
  }
  b.fetchedAt = Date.now();
  boards.dirty++;
}

/* ── writing ──────────────────────────────────────────────────────────── */

/**
 * Post a result to a board. The write is a plain `setDoc` at your own uid, so
 * it either replaces your row or creates it — and the RULES decide whether it
 * lands, refusing anything that doesn't beat what you already had. That means
 * this can be called on every run without checking first; a worse run is
 * simply denied, which is the correct outcome and costs one round trip.
 *
 * Returns true if the row landed. A denial is NOT an error — it is the
 * ratchet doing its job — so a false here is unremarkable and silent.
 */
export async function postScore(
  board: string,
  value: number,
  name: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  if (!Number.isFinite(value)) return false;
  const cap = isTimeBoard(board) ? TIME_CAP : SCORE_CAP;
  // Clamp rather than refuse: a wild value is a bug somewhere upstream, and
  // silently dropping the run would hide it. The rules reject out-of-range
  // anyway, so this only decides whether we bother with the round trip.
  if (value <= 0 || value > cap) return false;

  const c = await cloud();
  if (!c) return false;

  try {
    const { doc, setDoc } = c.fs;
    await setDoc(doc(c.db, 'boards', board, 'rows', c.uid), {
      name: name.slice(0, 16),
      value,
      meta,
      at: Date.now(),
    });
    // Our own row moved — the cached copy is stale.
    slot(board).fetchedAt = 0;
    boards.dirty++;
    return true;
  } catch {
    // Denied by the ratchet, or the network went away. Either way the local
    // record book already has the truth; nothing here is worth surfacing.
    return false;
  }
}
