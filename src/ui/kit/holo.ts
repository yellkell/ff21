/**
 * THE HOLO KIT — the neon-district surface every screen in the game is
 * painted with, pulled out of the Panel so the menus and the match draw
 * from one hand: a see-through blue-black pane with a cool tint pooling at
 * the top, faint scanlines, a diagonal sheen, a lit edge tube (a soft
 * bloom and a crisp inner hairline), the "on" light bar across the top,
 * magenta corner brackets and the readout ticks along the foot.
 *
 * Beside the glass it carries the few other pieces of the language the
 * match needs on a canvas: the skewed neon CELL (round pips) and BAR, and GLITCH type — a white word lifted off a cyan/magenta
 * chromatic split, the district's headline voice.
 */

import { font } from './fonts.js';

/** The accent as an "r,g,b" triple, for the few places that need it at an
 *  arbitrary alpha (press flashes, selection rings). */
export const ACCENT_RGB = '63,242,255';
/** The holo screens' second tube colour — decoration only (corner brackets,
 *  the scan line), never selection or primacy. */
export const HOLO_HOT_RGB = '255,61,166';
export const HOLO_HOT = `rgba(${HOLO_HOT_RGB},0.85)`;

/** "#rgb" / "#rrggbb" → "r,g,b" (anything else falls back to the accent). */
export function rgbOf(css: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return ACCENT_RGB;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export interface HoloOpts {
  /** Corner radius of the pane (px). */
  r?: number;
  /** The lit edge tube's colour as "r,g,b" (the accent by default). */
  edge?: string;
  /** The pane's fill (the kit's holo glass by default). */
  fill?: string;
  /** Corner-bracket colour; `false` leaves them off. */
  brackets?: string | false;
  /** Bracket arm length (px). */
  arm?: number;
  /** The "on" light bar across the top edge. */
  lightBar?: boolean;
  /** The readout ticks along the foot. */
  ticks?: boolean;
  /** The inner hairline, inset from the edge. */
  inner?: boolean;
  /** Scale for the edge bloom (a small plaque wants less than a wall). */
  bloom?: number;
}

/**
 * THE HOLO GLASS, painted into (x, y, w, h). Leaves the context's path set
 * to the pane's outline and its state as it found it.
 */
export function holoGlass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: HoloOpts = {}): void {
  const r = o.r ?? 22;
  const edge = o.edge ?? ACCENT_RGB;
  const bloom = o.bloom ?? 1;
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = o.fill ?? 'rgba(6,10,22,0.46)';
  g.fill();
  g.save();
  g.clip();
  // A cool tint pooling at the top, a breath of magenta at the foot.
  const tint = g.createLinearGradient(0, y, 0, y + h);
  tint.addColorStop(0, `rgba(${edge},0.10)`);
  tint.addColorStop(0.35, `rgba(${edge},0.03)`);
  tint.addColorStop(1, `rgba(${HOLO_HOT_RGB},0.05)`);
  g.fillStyle = tint;
  g.fillRect(x, y, w, h);
  // Scanlines — the tell of an emissive screen, faint enough to read through.
  g.fillStyle = 'rgba(150,235,255,0.035)';
  for (let sy = y + 2; sy < y + h; sy += 4) g.fillRect(x, sy, w, 1);
  // A diagonal holo sheen across the upper third.
  const sheen = g.createLinearGradient(x, y, x + w * 0.6, y + h * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.0)');
  g.fillStyle = sheen;
  g.fillRect(x, y, w, h * 0.5);
  g.restore();

  // Lit edge: a soft bloom, then (optionally) a crisp inner hairline.
  g.save();
  g.shadowColor = `rgba(${edge},0.8)`;
  g.shadowBlur = 16 * bloom;
  g.lineWidth = 2.5;
  g.strokeStyle = `rgba(${edge},0.55)`;
  g.stroke();
  g.restore();
  if (o.inner ?? true) {
    g.beginPath();
    g.roundRect(x + 8, y + 8, w - 16, h - 16, Math.max(0, r - 6));
    g.lineWidth = 1;
    g.strokeStyle = `rgba(${edge},0.14)`;
    g.stroke();
  }
  // Top light bar — the screen's "on" strip.
  if (o.lightBar ?? true) {
    const bar = g.createLinearGradient(x + w * 0.2, 0, x + w * 0.8, 0);
    bar.addColorStop(0, `rgba(${edge},0)`);
    bar.addColorStop(0.5, `rgba(${edge},0.9)`);
    bar.addColorStop(1, `rgba(${edge},0)`);
    g.fillStyle = bar;
    g.fillRect(x + w * 0.2, y + 1, w * 0.6, 3);
  }

  // Corner brackets — magenta tube on all four corners, the holo mark.
  const brackets = o.brackets ?? HOLO_HOT;
  if (brackets) {
    g.save();
    g.strokeStyle = brackets;
    g.shadowColor = brackets;
    g.shadowBlur = 10;
    g.lineWidth = 3;
    const arm = o.arm ?? 30;
    const L = x + 14;
    const R = x + w - 14;
    const T = y + 14;
    const B = y + h - 14;
    g.beginPath();
    g.moveTo(L + arm, T); g.lineTo(L, T); g.lineTo(L, T + arm);
    g.moveTo(R - arm, T); g.lineTo(R, T); g.lineTo(R, T + arm);
    g.moveTo(L + arm, B); g.lineTo(L, B); g.lineTo(L, B - arm);
    g.moveTo(R - arm, B); g.lineTo(R, B); g.lineTo(R, B - arm);
    g.stroke();
    g.restore();
  }
  // Tiny readout ticks along the bottom edge.
  if (o.ticks ?? true) readoutTicks(g, x + 54, y + h - 18, w - 108, `rgba(${edge},0.14)`);
  g.restore();
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A run of readout ticks (every fifth one long) along a baseline. */
export function readoutTicks(g: CanvasRenderingContext2D, x: number, y: number, w: number, colour: string, pitch = 18): void {
  g.fillStyle = colour;
  for (let i = 0, tx = x; tx < x + w; i++, tx += pitch) g.fillRect(tx, y, 2, i % 5 === 0 ? 8 : 4);
}

/** Trace one skewed (/-leaning) cell — the district's pip and bar unit. */
export function skewCell(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, skew = h * 0.45): void {
  g.beginPath();
  g.moveTo(x + skew, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w - skew, y + h);
  g.lineTo(x, y + h);
  g.closePath();
}

/** A lit cell (team colour, glowing) or a dark one (faint tube outline). */
export function neonCell(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean, colour: string, skew?: number): void {
  skewCell(g, x, y, w, h, skew);
  g.save();
  if (lit) {
    g.fillStyle = colour;
    g.shadowColor = colour;
    g.shadowBlur = 12;
    g.fill();
    g.shadowBlur = 0;
    // The glassy top light every lit fill in the kit carries.
    const sheen = g.createLinearGradient(0, y, 0, y + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.45)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fill();
  } else {
    g.fillStyle = 'rgba(120,230,255,0.06)';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(90,230,255,0.24)';
    g.stroke();
  }
  g.restore();
}

/**
 * A neon readout bar: one solid skewed block lit to exactly `frac` with a
 * white-hot leading edge, the rest dark tube. Pass `count` > 1 to split it
 * into cells.
 */
export function neonBar(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  frac: number,
  colour: string,
  count = 1,
  gap = 4,
): void {
  const f = Math.max(0, Math.min(1, frac));
  const skew = h * 0.45;
  const cw = (w - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) neonCell(g, x + i * (cw + gap), y, cw, h, false, colour, skew);
  if (f <= 0) return;
  // The level, as a cut on the cells' own slant.
  const lx = x + (w - skew) * f;
  g.save();
  g.beginPath();
  g.moveTo(x - 20, y - 20);
  g.lineTo(lx + skew + skew * (20 / h), y - 20);
  g.lineTo(lx - skew * (20 / h), y + h + 20);
  g.lineTo(x - 20, y + h + 20);
  g.closePath();
  g.clip();
  for (let i = 0; i < count; i++) neonCell(g, x + i * (cw + gap), y, cw, h, true, colour, skew);
  g.restore();
  if (f < 1) {
    g.save();
    g.fillStyle = '#ffffff';
    g.shadowColor = colour;
    g.shadowBlur = 10;
    skewCell(g, lx - 1.5, y, 3 + skew, h, skew);
    g.fill();
    g.restore();
  }
}

/**
 * GLITCH TYPE — the district's headline voice: the word in white, lit by
 * a halo of its accent, sat on a cyan / magenta chromatic split. `split` is
 * the ghosts' offset in px (0 draws the clean word).
 */
export function glitchText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  accent: string,
  opts: { weight?: 500 | 600 | 700; track?: number; split?: number; align?: CanvasTextAlign; ink?: string } = {},
): void {
  const weight = opts.weight ?? 700;
  const split = opts.split ?? Math.max(2, Math.round(px * 0.035));
  g.save();
  g.font = font(weight, px);
  g.letterSpacing = `${opts.track ?? 0}px`;
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  if (split > 0) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.55;
    g.fillStyle = `rgb(${ACCENT_RGB})`;
    g.fillText(text, x - split, y);
    g.fillStyle = `rgb(${HOLO_HOT_RGB})`;
    g.fillText(text, x + split, y);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  g.shadowColor = accent;
  g.shadowBlur = Math.round(px * 0.22);
  g.fillStyle = opts.ink ?? '#ffffff';
  g.fillText(text, x, y);
  g.shadowBlur = 0;
  g.fillText(text, x, y);
  g.restore();
}
