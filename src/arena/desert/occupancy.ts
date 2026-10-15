/**
 * WHO STANDS WHERE — the desert's one list of taken ground.
 *
 * Every builder used to scatter its own things over the same plane with
 * its own seed and no word to the others, so a saguaro could grow out of
 * a boulder pile and a boulder could sit inside a mesa. The mesas claim
 * their footprints first (index.ts builds them first), the boulder
 * clusters claim theirs, and everything planted after asks before it
 * stands. Far-layer coordinates (the layer that yaws per site), since
 * that is where all of these live.
 */

interface Spot {
  x: number;
  z: number;
  r: number;
}

const taken: Spot[] = [];

/** Take this ground. */
export function claimSpot(x: number, z: number, r: number): void {
  taken.push({ x, z, r });
}

/** Is a thing of radius `r` at (x, z) clear of everything claimed? */
export function spotFree(x: number, z: number, r: number): boolean {
  for (const s of taken) {
    const d = s.r + r;
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < d * d) return false;
  }
  return true;
}

/** Roll `pick` until it lands on free ground (or give up and take the
 *  last roll — a crowded desert is better than an endless loop). */
export function freeSpot(pick: () => [number, number], r: number, tries = 24): [number, number] {
  let p: [number, number] = pick();
  for (let i = 0; i < tries && !spotFree(p[0], p[1], r); i++) p = pick();
  claimSpot(p[0], p[1], r);
  return p;
}
