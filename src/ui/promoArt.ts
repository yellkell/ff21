/**
 * THE PROMOTION'S ART — every canvas the rank-up celebration
 * (systems/PromotionSystem.ts) paints, in the neon district's own hand:
 * the holo kit's glass for the plate, GLITCH type for the new tier, and
 * light in the kit's colours (neon cyan the accent, magenta decoration
 * only). Pure canvas, no Three, so promo-preview.html can lay the same
 * pieces out on a page.
 */

import { font } from './kit/fonts.js';
import { ACCENT_RGB, HOLO_HOT_RGB, glitchText, holoGlass } from './kit/holo.js';

/** The accent as a Three colour (glow halo, burst sparks). */
export const PROMO_ACCENT = 0x3ff2ff;
/** The burst's flash: white with a breath of the accent in it. */
export const PROMO_FLASH = 0xe6fdff;

export const PLATE_W = 512;
export const PLATE_H = 564;
export const LABEL_W = 512;
export const LABEL_H = 160;

/**
 * The backing plate: holo glass, but filled near-opaque. The menus' glass
 * is see-through so the street shows behind it; this one stands in front
 * of the player's own lit room (passthrough), where the celebration's
 * additive light only reads if something dark sits under it. The edge
 * tube, light bar, brackets and ticks are the kit's own. A faint divider
 * parts the emblem from the words.
 */
export function paintPromoPlate(g: CanvasRenderingContext2D, w = PLATE_W, h = PLATE_H): void {
  // Inset by the edge bloom so the lit tube isn't cropped.
  const pad = 18;
  g.clearRect(0, 0, w, h);
  holoGlass(g, pad, pad, w - pad * 2, h - pad * 2, {
    r: 30,
    fill: 'rgba(4,7,16,0.96)',
    arm: 36,
    bloom: 1.2,
  });
  // The divider sits just above the label (plate px ~372 of 564).
  const y = Math.round(h * 0.66);
  const line = g.createLinearGradient(w * 0.18, 0, w * 0.82, 0);
  line.addColorStop(0, `rgba(${ACCENT_RGB},0)`);
  line.addColorStop(0.5, `rgba(${ACCENT_RGB},0.4)`);
  line.addColorStop(1, `rgba(${ACCENT_RGB},0)`);
  g.fillStyle = line;
  g.fillRect(w * 0.18, y, w * 0.64, 1.5);
}

/**
 * The words: PROMOTED as a small tracked cyan tag between two tube stubs,
 * and the new tier in GLITCH type under it. `split` widens the chromatic
 * split for the burst's glitch tear (undefined = the kit's resting split).
 */
export function paintPromoLabel(
  g: CanvasRenderingContext2D,
  tierName: string,
  split?: number,
  w = LABEL_W,
  h = LABEL_H,
): void {
  g.clearRect(0, 0, w, h);
  const accent = `rgb(${ACCENT_RGB})`;

  // The tag line.
  g.save();
  g.font = font(600, 30);
  g.letterSpacing = '10px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // letterSpacing trails the last glyph too; nudge right to re-centre.
  const tagW = g.measureText('PROMOTED').width;
  g.shadowColor = accent;
  g.shadowBlur = 12;
  g.fillStyle = accent;
  g.fillText('PROMOTED', w / 2 + 5, 36);
  const stub = 46;
  const gap = 18;
  const ty = 35;
  g.fillRect(w / 2 - tagW / 2 - gap - stub, ty, stub, 2);
  g.fillRect(w / 2 + tagW / 2 + gap, ty, stub, 2);
  g.restore();

  // The tier, fitted so a long one (LEGENDARY) never overflows.
  const track = 6;
  const px = fitWidth(g, tierName, w - 72, 74, 34, track);
  glitchText(g, tierName, w / 2 + track / 2, 108, px, accent, { track, split });
}

/** A wheel of light spokes behind the emblem, additive: cyan tubes with a
 *  thin magenta spoke between each pair. */
export function paintPromoRays(g: CanvasRenderingContext2D, size = 256): void {
  const c = size / 2;
  const rays = 14;
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < rays * 2; i++) {
    const hot = i % 2 === 1;
    g.save();
    g.translate(c, c);
    g.rotate((i / (rays * 2)) * Math.PI * 2);
    const grad = g.createLinearGradient(0, 0, 0, -c);
    if (hot) {
      grad.addColorStop(0, `rgba(${HOLO_HOT_RGB},0.35)`);
      grad.addColorStop(0.6, `rgba(${HOLO_HOT_RGB},0.12)`);
      grad.addColorStop(1, `rgba(${HOLO_HOT_RGB},0)`);
    } else {
      grad.addColorStop(0, 'rgba(230,253,255,0.9)');
      grad.addColorStop(0.55, `rgba(${ACCENT_RGB},0.32)`);
      grad.addColorStop(1, `rgba(${ACCENT_RGB},0)`);
    }
    g.fillStyle = grad;
    const half = hot ? 3 : 7;
    g.beginPath();
    g.moveTo(-half, 0);
    g.lineTo(half, 0);
    g.lineTo(0, hot ? -c * 0.82 : -c);
    g.closePath();
    g.fill();
    g.restore();
  }
}

/** The burst's shockwave: a white-hot cyan annulus with a magenta fringe on
 *  its outer edge, the chromatic split of GLITCH type drawn as a ring. */
export function paintPromoRing(g: CanvasRenderingContext2D, size = 128): void {
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0)');
  grad.addColorStop(0.74, `rgba(${ACCENT_RGB},0.5)`);
  grad.addColorStop(0.8, 'rgba(235,254,255,0.95)');
  grad.addColorStop(0.88, `rgba(${ACCENT_RGB},0.45)`);
  grad.addColorStop(0.94, `rgba(${HOLO_HOT_RGB},0.3)`);
  grad.addColorStop(1, `rgba(${HOLO_HOT_RGB},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
}

/** The largest weight-700 size (max..min) at which `text` fits `maxW`. */
function fitWidth(g: CanvasRenderingContext2D, text: string, maxW: number, max: number, min: number, track: number): number {
  g.save();
  g.letterSpacing = `${track}px`;
  let px = max;
  for (; px > min; px -= 2) {
    g.font = font(700, px);
    if (g.measureText(text).width <= maxW) break;
  }
  g.restore();
  return px;
}
