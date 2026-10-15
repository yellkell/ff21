/**
 * THE LOAD, BEFORE THE DOOR — everything the first minutes in the headset
 * need is on the device before ENTER VR lights.
 *
 * The landing used to light its button the moment the arena's code had
 * built, while the district (the neon streets are ~56 MB of baked atlases),
 * the pad kit, the sign art and the lobby music were all still streaming.
 * Tap early and you stood in an empty violet void until the alley landed
 * around you. Now main.ts waits here first:
 *
 *   - every three.js load in flight (GLTF/texture loaders all report to
 *     DefaultLoadingManager, which this module counts from boot), quiet for
 *     a moment so a load that starts another is waited for too;
 *   - anything handed to holdBoot() (the audio decodes);
 *   - the backdrop saying it's ready (NEON's districts in, THE COVE baked).
 *
 * …then pushes every texture in the scene to the GPU (hidden ones too, so
 * the fight district doesn't upload its atlases mid-crossing). A cap keeps a
 * stalled request from holding the door shut forever: past it the button
 * lights anyway and the stragglers land in-session, exactly as before.
 */

import { DefaultLoadingManager, type Material, type Object3D, type Texture, type WebGLRenderer } from 'three';

let started = 0;
let ended = 0;
let lastActivity = performance.now();

// Wrap the manager's own bookkeeping (not its on* handlers, which a loader
// may own): every loader built without a manager of its own passes here.
{
  const m = DefaultLoadingManager;
  const itemStart = m.itemStart.bind(m);
  const itemEnd = m.itemEnd.bind(m);
  m.itemStart = (url: string) => {
    started++;
    lastActivity = performance.now();
    itemStart(url);
  };
  m.itemEnd = (url: string) => {
    ended++;
    lastActivity = performance.now();
    itemEnd(url);
  };
}

const held: Promise<unknown>[] = [];
let heldDone = 0;

/** Hold the door for a non-three load (an audio decode). Never rejects it. */
export function holdBoot(p: Promise<unknown>): void {
  held.push(p);
  lastActivity = performance.now();
  const done = () => {
    heldDone++;
    lastActivity = performance.now();
  };
  p.then(done, done);
}

export interface BootWait {
  /** The backdrop's own word that it's whole (NEON in, THE COVE baked). */
  ready: () => boolean;
  /** The backdrop's own 0..1, where it can say (bytes of the districts). */
  progress?: () => number;
  /** 0..1 as it goes (never called backwards). */
  onProgress?: (f: number) => void;
  /** Give up waiting after this long (ms) and open the door anyway. */
  cap: number;
}

/** No load in flight and nothing new for this long counts as settled. */
const QUIET_MS = 400;

/** Resolves true when everything is in, false if the cap ran out first. */
export function waitForBootLoads(w: BootWait): Promise<boolean> {
  const t0 = performance.now();
  let shown = 0;
  return new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      const items = started + held.length;
      const done = ended + heldDone;
      const itemsF = items > 0 ? done / items : 1;
      const backdrop = w.progress ? Math.max(0, Math.min(1, w.progress())) : itemsF;
      const ready = w.ready();
      // The district's bytes are most of the wait, so they carry the bar.
      const f = Math.min(ready && done >= items ? 1 : 0.98, 0.7 * backdrop + 0.3 * itemsF);
      if (f > shown) {
        shown = f;
        w.onProgress?.(f);
      }
      if (ready && done >= items && now - lastActivity >= QUIET_MS) {
        w.onProgress?.(1);
        resolve(true);
        return;
      }
      if (now - t0 >= w.cap) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * Upload every texture under `root` to the GPU now, visible or not, so the
 * first frame that shows one (the plaza behind the curtain, a menu tab)
 * doesn't stall on it. Textures still waiting on an image are skipped by
 * the renderer itself and upload on first use, as they always did.
 */
export function warmTextures(renderer: WebGLRenderer, root: Object3D): number {
  const seen = new Set<Texture>();
  const visit = (mat: Material) => {
    for (const v of Object.values(mat)) {
      if ((v as Texture | null)?.isTexture && !seen.has(v as Texture)) seen.add(v as Texture);
    }
  };
  root.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach(visit);
    else visit(m);
  });
  for (const t of seen) {
    try {
      renderer.initTexture(t);
    } catch {
      /* an odd texture type — it uploads on first use instead */
    }
  }
  return seen.size;
}
