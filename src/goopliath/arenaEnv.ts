/**
 * GOOPLIATH's reflections — the NEON PLAZA as seen from his chest, rendered
 * in Blender (blendercyber/scripts/goopliath/bake_env.py) with the same
 * setup as the plaza's own env_plaza.jpg, once from his solo spot and once
 * from his raid spot, so the signs his gel throws back sit where they really
 * are around him.
 *
 *   public/arena/neon/env_goopliath_solo.jpg   bossZ -3.9, eye 2.95 m
 *   public/arena/neon/env_goopliath_raid.jpg   bossZ -6.9, eye 3.70 m
 *
 * NEON only: the other arenas have no bake, and he keeps the procedural tint
 * there rather than reflecting a street that isn't around him.
 */

import { EquirectangularReflectionMapping, NoColorSpace, type Texture, TextureLoader } from 'three';

export type GoopSpot = 'solo' | 'raid';

const cache = new Map<GoopSpot, Promise<Texture>>();

/** The baked panorama for that spot (loaded once, shared by every bout). */
export function goopArenaEnv(spot: GoopSpot): Promise<Texture> {
  let p = cache.get(spot);
  if (!p) {
    p = new TextureLoader().loadAsync(`arena/neon/env_goopliath_${spot}.jpg`).then((t) => {
      t.mapping = EquirectangularReflectionMapping;
      // Raw, not sRGB-decoded: the gel shader writes its colour straight to
      // the framebuffer with no output encode, so a decoded panorama would
      // show gamma-darkened twice. Raw, a sign reflects as bright as it hangs.
      t.colorSpace = NoColorSpace;
      return t;
    });
    // A failed fetch must not stick: the next bout tries again.
    p.catch(() => cache.delete(spot));
    cache.set(spot, p);
  }
  return p;
}
