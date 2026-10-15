/**
 * Deterministic randomness — the spine of the whole multiplayer model.
 *
 * A raid is a pure function of its seed: the set-list, every zone position,
 * every bot's every dodge roll. Every client (and every bot-only solo run)
 * derives identical outcomes from the same seed, so the wire never has to
 * carry the choreography — only human poses and human hits.
 */

/** mulberry32 — tiny, fast, good enough for choreography. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix extra lanes into a seed (seat index, move index…) without collisions. */
export function mix(seed: number, ...lanes: number[]): number {
  let h = seed >>> 0;
  for (const lane of lanes) {
    h = Math.imul(h ^ (lane + 0x9e3779b9), 2654435761) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** One deterministic uniform in [0,1) for a (seed, …lanes) key. */
export function roll(seed: number, ...lanes: number[]): number {
  return mulberry32(mix(seed, ...lanes))();
}

/** A fresh random match seed (host-side only — everyone else receives it). */
export function freshSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
