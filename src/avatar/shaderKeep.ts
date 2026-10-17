/**
 * THE FORGE's programs, kept (docs/forge.md): a piece taken off gives its
 * GPU program to the keeper instead of throwing it away.
 *
 * Swapping a head disposed the old head's materials, and a disposed
 * material is the last hold on its program, so three.js deleted it — and
 * the next time that head (or any piece cut the same way) went on, the
 * frame stalled on a compile and link all over again. The warm-up
 * (forgeWarm.ts) holds one program per kind of piece, but a piece whose
 * maps fall outside those kinds slipped through on every wear. Now a
 * material coming off whose program nobody else holds is kept, undisposed,
 * as that program's hold: at most one per program, so the keep is bounded
 * by the handful of variants there are.
 */

import type { Material, WebGLRenderer } from 'three';

let renderer: WebGLRenderer | null = null;
/** One material per program key, held so its program stays linked. */
const kept = new Map<string, Material>();

/** The renderer whose programs are kept (forgeWarm hands it over). */
export function keepPrograms(r: WebGLRenderer): void {
  renderer = r;
}

const programKey = (mat: Material): string | undefined =>
  (renderer?.properties.get(mat) as { currentProgram?: { cacheKey?: string } } | undefined)?.currentProgram?.cacheKey;

/** Hold `mats` (the warm-up's) as their programs' keepers. */
export function holdPrograms(mats: Iterable<Material>): void {
  for (const mat of mats) {
    const key = programKey(mat);
    if (key && !kept.has(key)) kept.set(key, mat);
  }
}

/** A piece's material coming off a rig: dispose it, unless it is the last
 *  hold on a program — then keep it, so the next wear doesn't relink. */
export function retireMaterial(mat: Material): void {
  const key = programKey(mat);
  if (key && kept.get(key) === mat) return; // shared by two meshes of the piece
  if (!key || kept.has(key)) {
    mat.dispose();
    return;
  }
  kept.set(key, mat);
}
