/**
 * SUPER OCTAGON — the arcade's shared bits: the refs the builder registers
 * (screen + leaderboard canvases living inside the club's static shell) and
 * the cabinet's local record book.
 *
 * The game itself is ArcadeSystem (aim, fire, spawn, score); the geometry
 * is built with the club (build.ts buildArcade). This file is the seam
 * between them, in the style of arena.ts's registry.
 *
 * The board rides BOTH ledgers the game already has: a local top list in
 * this headset's storage, and the world board via the same Firestore
 * scores collection the songs use — SUPER OCTAGON posts as the pseudo-
 * chart 'superoctagon' at difficulty 0, with its letter derived from
 * score bands (the rules demand a letter; the cabinet grades hard).
 */

import type { CanvasTexture, Mesh, Vector3 } from 'three';

export interface ArcadeRefs {
  /** The CRT plane the lasers aim at — 'live-octagon-screen'. */
  screen: Mesh;
  screenCanvas: HTMLCanvasElement;
  screenTex: CanvasTexture;
  /** The wall leaderboard — 'live-octagon-board'. */
  boardCanvas: HTMLCanvasElement;
  boardTex: CanvasTexture;
  /** Where the cabinet stands (for the stand-close gate). */
  cabinetPos: Vector3;
}

let refs: ArcadeRefs | null = null;

export function registerArcade(r: ArcadeRefs): void {
  refs = r;
}

export function arcadeRefs(): ArcadeRefs | null {
  return refs;
}

/** The pseudo-chart the world board files this cabinet under. */
export const OCTAGON_TRACK = 'superoctagon';

/** The cabinet's letter for a run — the world board's rules want a grade,
 *  and an arcade should grade like an arcade: S is a real night's work. */
export function octagonGrade(score: number): string {
  if (score >= 15000) return 'S';
  if (score >= 9000) return 'A';
  if (score >= 5000) return 'B';
  if (score >= 2000) return 'C';
  return 'F';
}

/* ── the local record book ────────────────────────────────────────────── */

const OCTAGON_KEY = 'gdr-octagon';
const TOP = 8;

export interface OctagonRun {
  s: number;
  n: string;
}

export function octagonBook(): OctagonRun[] {
  try {
    const raw = localStorage.getItem(OCTAGON_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as OctagonRun[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordOctagonRun(score: number, name: string): void {
  const book = octagonBook();
  book.push({ s: Math.round(score), n: name });
  book.sort((a, b) => b.s - a.s);
  book.length = Math.min(book.length, TOP);
  try {
    localStorage.setItem(OCTAGON_KEY, JSON.stringify(book));
  } catch {
    /* fine */
  }
}
