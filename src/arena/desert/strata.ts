/**
 * THE BEDS — the one stratigraphy every mesa in the desert is cut from.
 *
 * A mesa's face and a mesa's shape used to disagree: the skin painted
 * eighteen even stripes per tile while the geometry stepped in at three
 * or four arbitrary heights, so ledges fell mid-bed and the beds read as
 * a barcode. Now there is ONE bed table, seeded once, and both read it:
 * the skin colours and parts each bed, and the lathe insets each bed by
 * the same table (a thin shale seam recessed, a massive sandstone bed
 * standing proud, the caprock overhanging), so the ledge you see IS the
 * bed boundary you see.
 *
 * Beds are in TILE units: one tile is TILE_M metres of cliff, and the
 * sequence repeats up the face. A massive bed is 1.5–3 m, an ordinary one
 * half a metre to a metre and a half, a shale seam a hand's breadth.
 */

import { makeRng } from './paper.js';

/** Metres of cliff per repeat of the bed table (and of the mesa skin). */
export const TILE_M = 16;

export interface Bed {
  /** Bottom and top, in tile units (0..1). */
  v0: number;
  v1: number;
  /** A massive sandstone bed — pale, proud, the ledge-maker. */
  hard: boolean;
  /** A shale seam — thin, dark, recessed. */
  seam: boolean;
  /** sRGB 0..1. */
  colour: [number, number, number];
  /** Radial inset of the bed as a fraction of the cliff radius: positive
   *  steps in, negative stands proud. */
  inset: number;
  /** A stable 0..1 for whatever else wants to vary per bed. */
  tone: number;
}

/** Desert sandstone, in sRGB: rust, salmon, the massive beds' tans (two,
 *  so the big beds aren't all one cream), maroon, red, grey-brown. */
const PALETTE: Array<[number, number, number]> = [
  [0.56, 0.31, 0.22],
  [0.7, 0.48, 0.35],
  [0.66, 0.52, 0.38],
  [0.42, 0.22, 0.17],
  [0.62, 0.35, 0.26],
  [0.56, 0.44, 0.35],
  [0.6, 0.45, 0.33],
];

let table: Bed[] | null = null;

/** The bed table, built once. */
export function mesaBeds(): Bed[] {
  if (table) return table;
  const rng = makeRng(9091);
  const out: Bed[] = [];
  let v = 0;
  let lastHard: boolean = false;
  while (v < 1) {
    const hard: boolean = !lastHard && rng() < 0.28;
    const seam: boolean = !hard && rng() < 0.38;
    // Thickness as a fraction of the tile: massive 1.5–3 m, seam 12–35 cm,
    // ordinary 0.5–1.5 m (at TILE_M = 16).
    const t = hard ? 0.095 + rng() * 0.095 : seam ? 0.0075 + rng() * 0.014 : 0.03 + rng() * 0.06;
    const v1 = Math.min(1, v + t);
    const base = hard ? PALETTE[rng() < 0.5 ? 2 : 6] : seam ? PALETTE[3] : PALETTE[[0, 1, 4, 5][(rng() * 4) | 0]];
    const k = 0.88 + rng() * 0.24;
    const lean = (rng() - 0.5) * 0.08; // a hair warmer or cooler than its neighbours
    out.push({
      v0: v,
      v1,
      hard,
      seam,
      colour: [base[0] * k * (1 + lean), base[1] * k, base[2] * k * (1 - lean)],
      inset: hard ? -0.025 : seam ? 0.06 + rng() * 0.04 : rng() * 0.03,
      tone: rng(),
    });
    lastHard = hard;
    v = v1;
  }
  table = out;
  return out;
}

/** The bed at tile height `v` (any real; wraps). */
export function bedAt(v: number): Bed {
  const beds = mesaBeds();
  const w = ((v % 1) + 1) % 1;
  // Few enough beds that a walk beats a search.
  for (const b of beds) if (w < b.v1) return b;
  return beds[beds.length - 1];
}

/** The thickest massive bed — what a mesa is capped with. */
export function capBed(): Bed {
  return mesaBeds().reduce((best, b) => (b.hard && b.v1 - b.v0 > best.v1 - best.v0 ? b : best), mesaBeds()[0]);
}
