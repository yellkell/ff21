/**
 * Scenery obeys energy; the ground's own light never does — the club's law
 * (PALETTE DISCIPLINE, config.ts), out on the circuit: while the deck under
 * you is counting itself out, the void ducks so the countdown owns the room.
 *
 * Only the course's own materials register here, so nothing this touches is
 * ever a wall of the club.
 */

import type { MeshBasicMaterial, PointsMaterial } from 'three';

type Dimmable = MeshBasicMaterial | PointsMaterial;

interface Entry {
  mat: Dimmable;
  r: number;
  g: number;
  b: number;
  group: 'scenery' | 'ground';
}

const entries: Entry[] = [];

export function registerDim(mat: Dimmable, group: Entry['group']): void {
  entries.push({ mat, r: mat.color.r, g: mat.color.g, b: mat.color.b, group });
}

export function applyDim(energy: number): void {
  for (const e of entries) {
    const k = e.group === 'scenery' ? energy : 1;
    e.mat.color.setRGB(e.r * k, e.g * k, e.b * k);
  }
}
