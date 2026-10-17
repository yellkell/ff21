/**
 * THE FORGE's tile art (docs/forge.md §4): every frame and every piece of
 * gear has a studio render of itself, made in Blender with the asset
 * (public/forge/icons/<name>.webp), and the locker and store draw it on
 * the tile instead of a flat glyph.
 *
 * Icons load on first ask. Until one lands the caller draws its fallback
 * (the old procedural glyph); when it does, the customization version is
 * bumped — batched, so a shelf of icons arriving together repaints the
 * panels once.
 */

import { customization } from './customization.js';

const BASE = 'forge/icons/';
const cache = new Map<string, HTMLImageElement | null>();
let bump = 0;

function landed(): void {
  if (bump) return;
  bump = window.setTimeout(() => {
    bump = 0;
    customization.version += 1;
  }, 60);
}

/** The icon called `name` if it has loaded, else null (and it starts to). */
export function forgeIcon(name: string): HTMLImageElement | null {
  const hit = cache.get(name);
  if (hit !== undefined) return hit && hit.complete && hit.naturalWidth > 0 ? hit : null;
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  cache.set(name, img);
  img.decoding = 'async';
  img.onload = landed;
  img.onerror = (): void => {
    cache.set(name, null); // no icon: the glyph stands
  };
  img.src = BASE + name + '.webp';
  return null;
}

/** Draw `img` centred on (cx, cy), fitted inside w × h, keeping its aspect. */
export function drawIcon(g: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, w: number, h: number): void {
  const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * k;
  const dh = img.naturalHeight * k;
  g.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
}
