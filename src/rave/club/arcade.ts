/**
 * THE ARCADE — the shared bits: the refs the builder registers (one live
 * screen per cabinet + the wall board, canvases living inside the club's
 * static shell) and each game's local record book.
 *
 * Four cabinets stand along the arcade's back wall and every one of them
 * plays: SUPER OCTAGON (the light-gun wave shooter) and PEBBLES (the swap-
 * to-match pattern puzzle), two of each, alternating. Which cabinet plays
 * which game is the layout's call (layout.json arcade.decor[].game).
 *
 * The games themselves live in systems/arcade/ and ArcadeSystem runs them
 * (aim, gate, board); the geometry is built with the club (build.ts
 * liveArcade). This file is the seam between them, in the style of
 * arena.ts's registry.
 *
 * Each game's board rides BOTH ledgers the game already has: a local top
 * list in this headset's storage, and the world board via the same
 * Firestore scores collection the songs use — each game posts as a pseudo-
 * chart at difficulty 0 ('superoctagon', 'pebbles'), with its letter
 * derived from score bands (the rules demand a letter; cabinets grade hard).
 */

import type { CanvasTexture, Mesh, Vector3 } from 'three';

export type ArcadeGameId = 'octagon' | 'pebbles';

export interface ArcadeCabinet {
  game: ArcadeGameId;
  /** The CRT plane the lasers aim at — 'live-arcade-screen-<i>'. */
  screen: Mesh;
  screenCanvas: HTMLCanvasElement;
  screenTex: CanvasTexture;
  /** Where the cabinet stands, at the floor (for the stand-close gate). */
  pos: Vector3;
}

export interface ArcadeRefs {
  cabinets: ArcadeCabinet[];
  /** The wall leaderboard — 'live-arcade-board'. Cycles between the games. */
  boardCanvas: HTMLCanvasElement;
  boardTex: CanvasTexture;
}

let refs: ArcadeRefs | null = null;

export function registerArcade(r: ArcadeRefs): void {
  refs = r;
}

export function arcadeRefs(): ArcadeRefs | null {
  return refs;
}

/** Screen canvas size, shared by every cabinet (the CRT is one model). */
export const SCREEN_W = 384;
export const SCREEN_H = 300;

/* ── per-game identity: title, world-board chart, grading ─────────────── */

export interface ArcadeTitle {
  /** Marquee + board heading. */
  name: string;
  /** The pseudo-chart the world board files this game under. */
  track: string;
  /** Neon the marquee and board glow in. */
  glow: string;
  ink: string;
  /** What a board row's number counts. */
  unit: string;
  /** The game's letter for a run — the world board's rules want a grade,
   *  and an arcade should grade like an arcade: S is a real night's work. */
  grade(score: number): string;
}

export const ARCADE_TITLES: Record<ArcadeGameId, ArcadeTitle> = {
  octagon: {
    name: 'SUPER OCTAGON',
    track: 'superoctagon',
    glow: '#ff2ad5',
    ink: '#ffd9f6',
    unit: 'solo runs',
    grade: (s) => (s >= 15000 ? 'S' : s >= 9000 ? 'A' : s >= 5000 ? 'B' : s >= 2000 ? 'C' : 'F'),
  },
  pebbles: {
    name: 'PEBBLES',
    track: 'pebbles',
    glow: '#3fe0b0',
    ink: '#dcfff3',
    unit: 'patterns in 60 s',
    grade: (s) => (s >= 12 ? 'S' : s >= 9 ? 'A' : s >= 6 ? 'B' : s >= 3 ? 'C' : 'F'),
  },
};

/* ── the local record books ───────────────────────────────────────────── */

const BOOK_KEY: Record<ArcadeGameId, string> = {
  octagon: 'gdr-octagon',
  pebbles: 'gdr-pebbles',
};
const TOP = 8;

export interface ArcadeRun {
  s: number;
  n: string;
}

export function arcadeBook(game: ArcadeGameId): ArcadeRun[] {
  try {
    const raw = localStorage.getItem(BOOK_KEY[game]);
    if (!raw) return [];
    const list = JSON.parse(raw) as ArcadeRun[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordArcadeRun(game: ArcadeGameId, score: number, name: string): void {
  const book = arcadeBook(game);
  book.push({ s: Math.round(score), n: name });
  book.sort((a, b) => b.s - a.s);
  book.length = Math.min(book.length, TOP);
  try {
    localStorage.setItem(BOOK_KEY[game], JSON.stringify(book));
  } catch {
    /* fine */
  }
}
