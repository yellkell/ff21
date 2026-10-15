/**
 * THE NEON SIGNS — the match's big words (3 / 2 / 1 / FIGHT, and the
 * KO / WIN / TIME / DRAW verdicts, plus the pub ring's OPEN), painted in
 * the neon district's own hand instead of shipped as art:
 *
 *   - Rajdhani 700, leaned on the kit's own slant (the skew cells' /),
 *   - a white-hot core inside a lit tube of the sign's colour,
 *   - a wide bloom and a tighter halo under it — the sign lights the air,
 *   - the GLITCH kit's cyan / magenta chromatic split behind the tube,
 *   - two torn scan slices and faint scanlines across the glyph,
 *   - a small tracked tag over the word (KNOCKOUT, VICTORY…) between tube
 *     stubs, and under it a lit rule — or, under a countdown digit, three
 *     skew cells that drain 3 → 2 → 1.
 *
 * The countdown goes cool to hot: 3 and 2 cyan, then 1 and FIGHT
 * red. KO burns magenta, WIN is the accent cyan,
 * TIME is the clock's amber, DRAW a cool violet.
 *
 * WHY PAINTED ONCE: the old hand-made PNGs were 1536×1024 apiece (~2 MB
 * each). The first time one showed, the browser decoded it on the spot
 * and the plate helper read the whole image back (getImageData, 1.5 M
 * pixels) to find the word inside its padding — a main-thread hitch on
 * every countdown beat and on the KO. A sign here is painted ONCE, while
 * the game is idle after the fonts land, into its own 1024×512 canvas;
 * its content box is known from the layout, so showing it is one
 * drawImage. Pure canvas, no Three, so sign-preview.html can lay the
 * same signs out on a page.
 */

import { font, fontsReady, onFontsReady } from './kit/fonts.js';
import { ACCENT_RGB, HOLO_HOT_RGB, neonCell, skewCell } from './kit/holo.js';
import { registerContentBox } from './plateArt.js';

export const SIGN_W = 1024;
export const SIGN_H = 512;

/** The sign colours, as "r,g,b". */
const CYAN = ACCENT_RGB; // KIT.accent
const AMBER = '255,180,84'; // KIT.warn — the clock's warning
const RED = '255,82,102'; // KIT.danger
const MAGENTA = HOLO_HOT_RGB;
const VIOLET = '176,124,255';

/** The kit's lean: x shifts by this much per px of rise (the skew cells' /). */
const LEAN = 0.16;

interface SignSpec {
  word: string;
  rgb: string;
  /** Small tracked tag over the word. */
  tag?: string;
  /** Countdown digits: [lit, of] skew cells under the figure. */
  cells?: [number, number];
  /** Deterministic glitch: where the two torn slices fall (fractions of the cap). */
  tear: [number, number];
}

const SPECS: Record<string, SignSpec> = {
  '3': { word: '3', rgb: CYAN, cells: [3, 3], tear: [0.28, 0.71] },
  '2': { word: '2', rgb: CYAN, cells: [2, 3], tear: [0.34, 0.8] },
  '1': { word: '1', rgb: RED, cells: [1, 3], tear: [0.22, 0.62] },
  fight: { word: 'FIGHT', rgb: RED, tag: 'ROUND START', tear: [0.3, 0.74] },
  ko: { word: 'K.O.', rgb: MAGENTA, tag: 'KNOCKOUT', tear: [0.36, 0.68] },
  win: { word: 'WIN', rgb: CYAN, tag: 'VICTORY', tear: [0.26, 0.77] },
  time: { word: 'TIME', rgb: AMBER, tag: 'DECISION', tear: [0.4, 0.82] },
  draw: { word: 'DRAW', rgb: VIOLET, tag: 'DEAD HEAT', tear: [0.24, 0.66] },
  open: { word: 'OPEN', rgb: CYAN, tag: 'RING OPEN', tear: [0.32, 0.78] },
};

/** Every sign key, in the order they're warmed (the countdown first). */
export const SIGN_KEYS = ['3', '2', '1', 'fight', 'ko', 'win', 'time', 'draw', 'open'] as const;
export type SignKey = (typeof SIGN_KEYS)[number];

/** A sign's colour as CSS — for the aura behind it, so the two always match. */
export function signColour(key: SignKey): string {
  return `rgb(${SPECS[key].rgb})`;
}

/** Mix an "r,g,b" toward white by `k` (0 = the colour, 1 = white). */
function toWhite(rgb: string, k: number): string {
  const [r, g, b] = rgb.split(',').map(Number);
  const m = (c: number): number => Math.round(c + (255 - c) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/**
 * Paint one sign into a SIGN_W × SIGN_H canvas (cleared first). Returns
 * the box the sign's VISIBLE parts occupy — glyph, tag, rule and the inner
 * reach of the bloom — so a host can size it by what shows.
 */
export function paintSign(g: CanvasRenderingContext2D, key: SignKey): { x: number; y: number; w: number; h: number } {
  const s = SPECS[key];
  const c = s.rgb;
  const digit = !!s.cells;
  g.clearRect(0, 0, SIGN_W, SIGN_H);
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';

  // ── Size the word: digits stand tall, words fit the width. ──
  let px = digit ? 372 : 236;
  const track = digit ? 0 : 0.07;
  const maxW = SIGN_W - 260;
  for (;;) {
    g.font = font(700, px);
    g.letterSpacing = `${Math.round(px * track)}px`;
    const wWord = g.measureText(s.word).width + px * 0.72 * LEAN;
    if (wWord <= maxW || px <= 120) break;
    px -= 6;
  }
  g.font = font(700, px);
  g.letterSpacing = `${Math.round(px * track)}px`;
  const m = g.measureText(s.word);
  const cap = m.actualBoundingBoxAscent; // the glyph's real rise above the baseline
  const wordW = m.width;

  // ── Vertical stack: [tag] · word · [rule or cells], centred. ──
  const tagH = s.tag ? 34 : 0;
  const tagGap = s.tag ? 30 : 0;
  const ruleGap = digit ? 34 : 28;
  const ruleH = digit ? 26 : 12;
  const stackH = tagH + tagGap + cap + ruleGap + ruleH;
  const top = (SIGN_H - stackH) / 2;
  const base = top + tagH + tagGap + cap; // the word's baseline
  const cx = SIGN_W / 2;
  const midY = base - cap / 2;

  // The lean, about the word's own middle, so the sheared word stays centred.
  const leaned = (): void => {
    g.setTransform(1, 0, -LEAN, 1, LEAN * midY, 0);
  };

  // ── 1. Bloom: the shadow alone (the glyph is drawn far off-canvas). ──
  // Two passes — a wide wash that lights the air, a tighter halo on the tube.
  g.save();
  leaned();
  g.globalCompositeOperation = 'lighter';
  const OFF = 4000;
  g.shadowOffsetX = OFF;
  g.fillStyle = '#000';
  for (const [blur, alpha] of [
    [px * 0.34, 0.75],
    [px * 0.12, 0.95],
  ] as const) {
    g.shadowColor = `rgba(${c},${alpha})`;
    g.shadowBlur = blur;
    g.fillText(s.word, cx - OFF, base);
  }
  g.restore();

  // ── 2. The chromatic split — the GLITCH kit's ghosts, behind the tube. ──
  const split = Math.max(4, Math.round(px * 0.03));
  g.save();
  leaned();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.6;
  g.fillStyle = `rgb(${ACCENT_RGB})`;
  g.fillText(s.word, cx - split, base);
  g.fillStyle = `rgb(${HOLO_HOT_RGB})`;
  g.fillText(s.word, cx + split, base);
  g.restore();

  // ── 3. The tube: a lit stroke in the sign's colour… ──
  g.save();
  leaned();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(6, px * 0.07);
  g.strokeStyle = `rgb(${c})`;
  g.shadowColor = `rgb(${c})`;
  g.shadowBlur = px * 0.06;
  g.strokeText(s.word, cx, base);
  g.shadowBlur = 0;
  // …and its white-hot core, a breath of the colour pooling at the foot.
  const core = g.createLinearGradient(0, base - cap, 0, base);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.55, toWhite(c, 0.9));
  core.addColorStop(1, toWhite(c, 0.55));
  g.fillStyle = core;
  g.fillText(s.word, cx, base);
  g.restore();

  // ── 4. Scanlines across the glyph — the tell of an emissive screen. ──
  const gx0 = cx - wordW / 2 - px * 0.3;
  const gx1 = cx + wordW / 2 + px * 0.3;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.26)';
  for (let y = Math.floor(base - cap - 8); y < base + 8; y += 5) g.fillRect(gx0, y, gx1 - gx0, 1.5);
  g.restore();

  // ── 5. Two torn slices: a band of the lit word shoved sideways. ──
  const tear = document.createElement('canvas');
  for (const [i, f] of s.tear.entries()) {
    const bandH = Math.max(6, Math.round(cap * (i === 0 ? 0.06 : 0.035)));
    const y = Math.round(base - cap + cap * f);
    const x0 = Math.max(0, Math.floor(gx0));
    const w = Math.min(SIGN_W, Math.ceil(gx1)) - x0;
    const dx = Math.round(px * (i === 0 ? 0.06 : -0.035));
    tear.width = w;
    tear.height = bandH;
    const t = tear.getContext('2d')!;
    t.drawImage(g.canvas, x0, y, w, bandH, 0, 0, w, bandH);
    g.clearRect(x0, y, w, bandH);
    g.drawImage(tear, x0 + dx, y);
    // A hairline of the split colour along the tear's top edge.
    g.fillStyle = `rgba(${i === 0 ? ACCENT_RGB : HOLO_HOT_RGB},0.55)`;
    g.fillRect(cx - wordW * 0.32 + dx, y, wordW * 0.64, 1.5);
  }

  // ── 6. The tag: small, tracked, between two tube stubs. ──
  if (s.tag) {
    g.save();
    g.font = font(600, tagH);
    g.letterSpacing = '12px';
    g.textBaseline = 'middle';
    const ty = top + tagH / 2;
    const tw = g.measureText(s.tag).width;
    g.shadowColor = `rgb(${c})`;
    g.shadowBlur = 14;
    g.fillStyle = toWhite(c, 0.7);
    g.fillText(s.tag, cx + 6, ty); // letterSpacing trails the last glyph; nudge it back to centre
    g.fillStyle = `rgb(${c})`;
    const stub = 64;
    const gap = 26;
    g.fillRect(cx - tw / 2 - gap - stub, ty - 1.5, stub, 3);
    g.fillRect(cx + tw / 2 + gap, ty - 1.5, stub, 3);
    g.restore();
  }

  // ── 7. Under the word: the countdown's draining cells, or a lit rule. ──
  const ry = base + ruleGap;
  if (s.cells) {
    const [lit, of] = s.cells;
    const cw = 78;
    const gap = 16;
    const total = of * cw + (of - 1) * gap;
    for (let i = 0; i < of; i++) {
      neonCell(g, cx - total / 2 + i * (cw + gap), ry, cw, ruleH, i < lit, `rgb(${c})`);
    }
  } else {
    const rw = Math.max(260, wordW * 0.86);
    g.save();
    const rule = g.createLinearGradient(cx - rw / 2, 0, cx + rw / 2, 0);
    rule.addColorStop(0, `rgba(${c},0)`);
    rule.addColorStop(0.2, `rgba(${c},0.95)`);
    rule.addColorStop(0.8, `rgba(${c},0.95)`);
    rule.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = rule;
    g.shadowColor = `rgb(${c})`;
    g.shadowBlur = 16;
    skewCell(g, cx - rw / 2, ry, rw, ruleH * 0.5, ruleH * 0.25);
    g.fill();
    // A white-hot cell at each end of the rule — the kit's skew pips.
    g.shadowBlur = 10;
    g.fillStyle = '#ffffff';
    skewCell(g, cx - rw / 2 - 40, ry - 3, 26, ruleH, ruleH * 0.45);
    g.fill();
    skewCell(g, cx + rw / 2 + 14, ry - 3, 26, ruleH, ruleH * 0.45);
    g.fill();
    g.restore();
  }
  g.restore();

  // The visible box: the stack, widened to the leaned word, plus the inner
  // reach of the bloom (its outer wash is meant to fade off the edges).
  const reach = px * 0.14;
  const halfW = Math.max(wordW / 2 + cap * LEAN * 0.5, s.cells ? 140 : wordW * 0.43 + 40) + reach;
  return {
    x: Math.max(0, cx - halfW),
    y: Math.max(0, top - reach),
    w: Math.min(SIGN_W, halfW * 2),
    h: Math.min(SIGN_H, stackH + reach * 2),
  };
}

/** The painted signs, filled in as they're warmed (or first asked for). */
const cache = new Map<SignKey, HTMLCanvasElement>();

function build(key: SignKey): HTMLCanvasElement {
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = SIGN_W;
  c.height = SIGN_H;
  const g = c.getContext('2d')!;
  registerContentBox(c, paintSign(g, key));
  cache.set(key, c);
  return c;
}

/**
 * The painted sign for a key, or null until the house face has loaded (the
 * hosts' text fallback covers that gap, and they fold "art ready" into
 * their redraw keys so the sign swaps in the moment it's there). A sign
 * that hasn't been warmed yet is painted on the spot — once.
 */
export function signArt(key: SignKey): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !fontsReady()) return null;
  return build(key);
}

// Warm every sign once the fonts land, one per idle slice, so no beat of the
// match ever pays for its own paint.
if (typeof document !== 'undefined') {
  onFontsReady(() => {
    const idle: (cb: () => void) => void =
      typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(cb, { timeout: 2000 }) : (cb) => setTimeout(cb, 50);
    const queue = [...SIGN_KEYS];
    const next = (): void => {
      const key = queue.shift();
      if (!key) return;
      build(key);
      idle(next);
    };
    idle(next);
  });
}

/**
 * A neon tube catching: two quick dips in the first ~0.22 s after a sign
 * lands, then steady. An opacity multiplier for the sign's material —
 * kept shallow (never below 0.55) so it reads as a tube striking, not a
 * strobe.
 */
export function signFlicker(t: number): number {
  if (t < 0 || t > 0.22) return 1;
  if (t < 0.05) return 1;
  if (t < 0.09) return 0.55;
  if (t < 0.14) return 1;
  if (t < 0.17) return 0.7;
  return 1;
}
