/**
 * THE RAVE HUD'S PAINT — the canvases HudSystem hangs in the room, drawn in
 * the neon district's holo hand (ui/kit/holo.ts), the same one FIRE FIGHT's
 * match UI wears: see-through blue-black glass, a lit edge tube, magenta
 * corner brackets, scanlines, Rajdhani, GLITCH type for the shouts.
 *
 * Pure painters, no scene: HudSystem owns the planes and the timing, and
 * rave-hud-preview.html paints these flat for look-dev.
 *
 *   THE WEDGE   the live readout off your left shoulder — the score as a
 *               padded counter (dim leading zeros, lit digits), the ×mult
 *               chip in your seat's colour, the PERFECT ×1.5 chip that
 *               burns when you ride the beat, the BEATS row (its pips are
 *               real points HudSystem lays over WEDGE_PIPS) and, only once
 *               you're clipped, the CHAIN row of skewed alarm cells.
 *   THE POP     PERFECT / HIT — glitch type on a skewed dark-glass slate.
 *   THE CARD    the count-in numeral and the record's title.
 *   THE GRADE   the night's letter, with what earned it.
 */

import { ACCENT_RGB, HOLO_HOT_RGB, glitchText, holoGlass, neonCell, readoutTicks, rgbOf, skewCell } from '../../ui/kit/holo.js';
import { font } from './fonts.js';

/** The wedge canvas (px) — the plane is 0.5 × 0.28 m. */
export const WEDGE_W = 512;
export const WEDGE_H = 288;
/** The pop canvas (px) — the plane is 0.76 × 0.24 m. */
export const POP_W = 640;
export const POP_H = 200;
/** The centre card canvas (px). */
export const CARD_W = 768;
export const CARD_H = 384;

/** Where the BEATS (groove) pips sit on the wedge (canvas px) — HudSystem maps
 *  these into the plane so its points land on the painted row. */
export const WEDGE_PIPS = { count: 4, x0: 168, gap: 36, y: 178 };

/** THE ALARM: getting clipped. One deep, full-chroma red shared by the HIT
 *  pop and the chain cells, so the two always read as the same event. */
export const ALARM_CSS = '#ff0033';
/** The groove's own colour — electric ice, never the seat's. */
export const GROOVE_CSS = '#1cf5c9';

const ACCENT = `rgb(${ACCENT_RGB})`;
const PAD = 20;
const SCORE_DIGITS = 6;

/** A tracked micro-label — the readout's quiet captions. */
function caption(g: CanvasRenderingContext2D, text: string, x: number, y: number, colour = `rgba(${ACCENT_RGB},0.72)`, align: CanvasTextAlign = 'left'): void {
  g.save();
  g.font = font(600, 19);
  g.letterSpacing = '5px';
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = colour;
  g.fillText(text, x, y);
  g.restore();
}

/** Lit type: a fill under its own halo, then a crisp core on top. */
function lit(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, fill: string, glow: string, weight: 500 | 600 | 700 = 700, track = 0): void {
  g.save();
  g.font = font(weight, px);
  g.letterSpacing = `${track}px`;
  g.textBaseline = 'middle';
  g.fillStyle = fill;
  g.shadowColor = glow;
  g.shadowBlur = Math.round(px * 0.3);
  g.fillText(text, x, y);
  g.shadowBlur = 0;
  g.fillText(text, x, y);
  g.restore();
}

export interface WedgeState {
  score: number;
  /** The live multiplier, or 0 when no chain is running. */
  mult: number;
  /** The seat's neon, as CSS. */
  seatCss: string;
  alive: boolean;
  /** Clipped landings back to back (0 hides the CHAIN row). */
  missChain: number;
  chainOut: number;
  /** What the running groove streak has paid (0 hides the tally). */
  grooveScore: number;
  /** What a perfect landing pays RIGHT NOW: the chain's ×mult times the
   *  perfect bonus — so it climbs with the chain like the score does. */
  perfectMult: number;
  /** A perfect just landed: the PERFECT chip burns. */
  perfectLit: boolean;
}

/* ── the wedge ─────────────────────────────────────────────────────────── */

export function paintWedge(g: CanvasRenderingContext2D, s: WedgeState): void {
  g.clearRect(0, 0, WEDGE_W, WEDGE_H);
  const x = PAD;
  const y = PAD;
  const w = WEDGE_W - PAD * 2;
  const h = WEDGE_H - PAD * 2;
  holoGlass(g, x, y, w, h, { r: 16, arm: 18, bloom: 0.8, fill: 'rgba(5,8,20,0.58)', ticks: false });

  // ── SCORE: a padded counter — the zeros are the dark tube, the digits lit.
  caption(g, 'SCORE', x + 26, y + 28);
  const digits = String(Math.max(0, Math.floor(s.score)));
  const pad = '0'.repeat(Math.max(0, SCORE_DIGITS - digits.length));
  const sy = y + 80;
  g.font = font(700, 74);
  g.letterSpacing = '2px';
  const padW = pad ? g.measureText(pad).width : 0;
  g.letterSpacing = '0px';
  if (pad) lit(g, pad, x + 22, sy, 74, `rgba(${ACCENT_RGB},0.16)`, 'rgba(0,0,0,0)', 700, 2);
  g.textAlign = 'left';
  lit(g, digits, x + 22 + padW, sy, 74, '#ffffff', `rgba(${ACCENT_RGB},0.75)`, 700, 2);

  // ── ×MULT: a skewed chip in the seat's colour, lit while a chain runs.
  const cw = 132;
  const ch = 42;
  const cx = x + w - cw - 24;
  const cy = y + 40;
  const live = s.alive && s.mult > 1;
  neonCell(g, cx, cy, cw, ch, live, s.seatCss);
  g.save();
  g.font = font(700, 34);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = live ? 'rgba(3,6,14,0.92)' : `rgba(${ACCENT_RGB},0.32)`;
  g.fillText(`×${(live ? s.mult : 1).toFixed(1)}`, cx + cw / 2, cy + ch / 2 + 1);
  g.restore();
  caption(g, 'MULT', cx + cw - 4, y + 28, `rgba(${ACCENT_RGB},0.5)`, 'right');

  // ── PERFECT ×n: what a perfect landing pays right now — the chain's
  // multiplier with the perfect bonus on top, so it climbs as the chain
  // does. Dark tube with no chain running, lit while one is, and it burns
  // white the moment a perfect lands.
  const pw = cw - 8;
  const ph = 26;
  const px = cx + 4;
  const py = cy + ch + 8;
  const hot = s.alive && s.perfectLit;
  const running = s.alive && s.mult > 1;
  if (hot) {
    g.save();
    g.shadowColor = ACCENT;
    g.shadowBlur = 18;
    skewCell(g, px, py, pw, ph);
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
  } else {
    neonCell(g, px, py, pw, ph, running, ACCENT);
  }
  g.save();
  g.font = font(700, 16);
  g.letterSpacing = '0.5px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = hot || running ? 'rgba(3,6,14,0.92)' : `rgba(${ACCENT_RGB},0.5)`;
  // ×1.5, ×1.65, ×3.6 — two places only when the second one says something.
  g.fillText(`PERFECT ×${s.perfectMult.toFixed(2).replace(/0$/, '')}`, px + pw / 2, py + ph / 2 + 1);
  g.restore();

  // A hairline with readout ticks under the counter — the instrument's rule.
  const ry = y + 122;
  const rule = g.createLinearGradient(x + 22, 0, x + w - 22, 0);
  rule.addColorStop(0, `rgba(${ACCENT_RGB},0.55)`);
  rule.addColorStop(0.7, `rgba(${ACCENT_RGB},0.18)`);
  rule.addColorStop(1, `rgba(${HOLO_HOT_RGB},0.4)`);
  g.fillStyle = rule;
  g.fillRect(x + 22, ry, w - 44, 1.5);
  readoutTicks(g, x + 22, ry + 4, w - 44, `rgba(${ACCENT_RGB},0.16)`, 16);

  if (!s.alive) {
    glitchText(g, 'SPECTATING', WEDGE_W / 2, y + 180, 40, ACCENT, { weight: 600, track: 6 });
    return;
  }

  // ── BEATS (the groove streak): the pips are points laid over this row;
  // the tally is ink.
  caption(g, 'BEATS', x + 26, WEDGE_PIPS.y, 'rgba(28,245,201,0.72)');
  if (s.grooveScore > 0) {
    g.textAlign = 'left';
    const tx = WEDGE_PIPS.x0 + WEDGE_PIPS.gap * (WEDGE_PIPS.count - 0.5) + 24;
    lit(g, `+${s.grooveScore}`, tx, WEDGE_PIPS.y + 1, 38, GROOVE_CSS, GROOVE_CSS, 700, 1);
  }

  // ── CHAIN: silent until you're clipped, then one alarm cell per clip.
  if (s.missChain > 0) {
    const cy2 = y + 191;
    caption(g, 'CHAIN', x + 26, cy2 + 11, 'rgba(255,60,90,0.85)');
    const last = s.missChain >= s.chainOut - 1;
    for (let i = 0; i < s.chainOut; i++) {
      const on = i < s.missChain;
      const bx = x + 148 + i * 58;
      if (on) {
        g.save();
        g.shadowColor = ALARM_CSS;
        g.shadowBlur = last ? 26 : 16;
        skewCell(g, bx, cy2, 50, 22);
        g.fillStyle = ALARM_CSS;
        g.fill();
        g.fill(); // twice through the bloom — the mark burns, not blushes
        g.restore();
      } else {
        neonCell(g, bx, cy2, 50, 22, false, ALARM_CSS);
      }
    }
    if (last) caption(g, 'LAST', x + w - 26, cy2 + 11, ALARM_CSS, 'right');
  }
}

/* ── the pop ───────────────────────────────────────────────────────────── */

export type PopTone = 'dodge' | 'perfect' | 'hit' | 'milestone' | 'info';

/** Each tone unmistakably its own: WHITE rode the last beat (on the cyan
 *  district glow), the alarm red got clipped, magenta is a milestone, cyan
 *  is information, green survived. */
export function popColour(tone: PopTone): string {
  return tone === 'perfect'
    ? '#ffffff'
    : tone === 'hit'
      ? ALARM_CSS
      : tone === 'milestone'
        ? '#ff2ad5'
        : tone === 'info'
          ? '#6fc8ff'
          : '#2be28a';
}

export function paintPop(g: CanvasRenderingContext2D, text: string, tone: PopTone): void {
  g.clearRect(0, 0, POP_W, POP_H);
  const word = text.replace(/!+$/, '');
  const hit = tone === 'hit';
  const colour = popColour(tone);
  const glow = tone === 'perfect' ? ACCENT : colour;
  const px = 70;
  const cy = POP_H / 2 - 4;

  g.font = font(700, px);
  g.letterSpacing = '8px';
  const tw = Math.min(POP_W - 120, g.measureText(word).width);
  g.letterSpacing = '0px';

  // The slate: a skewed sliver of dark glass the word sits on, so it reads
  // over the lasers without the old black casing round every glyph.
  const sw = tw + 90;
  const sh = 92;
  const sx = (POP_W - sw) / 2;
  const sy = cy - sh / 2;
  const tube = hit ? rgbOf(ALARM_CSS) : ACCENT_RGB;
  g.save();
  skewCell(g, sx, sy, sw, sh, 26);
  g.fillStyle = hit ? 'rgba(40,0,10,0.62)' : 'rgba(4,8,20,0.55)';
  g.fill();
  g.shadowColor = `rgba(${tube},0.9)`;
  g.shadowBlur = 14;
  g.lineWidth = 2;
  g.strokeStyle = `rgba(${tube},0.7)`;
  g.stroke();
  g.restore();
  // Magenta brackets clipping the slate's ends — the holo mark.
  g.save();
  g.strokeStyle = `rgba(${HOLO_HOT_RGB},0.9)`;
  g.shadowColor = `rgb(${HOLO_HOT_RGB})`;
  g.shadowBlur = 8;
  g.lineWidth = 3;
  const a = 16;
  g.beginPath();
  g.moveTo(sx + 26 - 10 + a, sy - 8); g.lineTo(sx + 26 - 10, sy - 8); g.lineTo(sx + 26 - 10 - 4, sy + 8);
  g.moveTo(sx + sw - 26 + 10 - a, sy + sh + 8); g.lineTo(sx + sw - 26 + 10, sy + sh + 8); g.lineTo(sx + sw - 26 + 10 + 4, sy + sh - 8);
  g.stroke();
  g.restore();

  // The word — glitch type, a hit tearing harder than a perfect.
  glitchText(g, word, POP_W / 2, cy + 2, px, glow, {
    track: 8,
    split: hit ? 6 : 3,
    ink: hit ? '#ffe9ec' : colour,
  });
  if (hit) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5;
    glitchText(g, word, POP_W / 2, cy + 2, px, ALARM_CSS, { track: 8, split: 0, ink: ALARM_CSS });
    g.restore();
  }

  // A scan-tear: two thin rows of the word slid sideways — the signal
  // catching on the beat.
  tear(g, sx, cy - 16, sw, 5, hit ? 14 : 6);
  if (hit) tear(g, sx, cy + 18, sw, 3, -10);
}

/** Slide one horizontal band of the canvas sideways by `dx` px. */
function tear(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dx: number): void {
  const band = g.getImageData(Math.round(x), Math.round(y), Math.round(w), h);
  g.clearRect(Math.round(x), Math.round(y), Math.round(w), h);
  g.putImageData(band, Math.round(x + dx), Math.round(y));
}

/* ── the centre card ───────────────────────────────────────────────────── */

export function paintCueing(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, CARD_W, CARD_H);
  glitchText(g, 'CUEING…', CARD_W / 2, CARD_H / 2, 46, ACCENT, { weight: 600, track: 10 });
}

/** The count-in: the number and the record. */
export function paintCount(g: CanvasRenderingContext2D, count: number, title: string | null): void {
  g.clearRect(0, 0, CARD_W, CARD_H);
  glitchText(g, `${Math.max(1, count)}`, CARD_W / 2, CARD_H / 2 - 6, 168, '#ff2ad5', { split: 6 });
  if (title) {
    g.textAlign = 'center';
    lit(g, title, CARD_W / 2, CARD_H - 56, 34, '#eafff6', GROOVE_CSS, 600, 6);
    g.font = font(600, 34);
    g.letterSpacing = '6px';
    const w = Math.min(CARD_W - 120, g.measureText(title).width + 80);
    g.letterSpacing = '0px';
    readoutTicks(g, (CARD_W - w) / 2, CARD_H - 28, w, `rgba(${ACCENT_RGB},0.3)`, 14);
  }
}

export interface GradeState {
  letter: string;
  colour: string;
  alive: boolean;
  coins: number;
  dodges: number;
  faced: number;
  rate: number;
  perfects: number;
}

export function paintGrade(g: CanvasRenderingContext2D, s: GradeState): void {
  g.clearRect(0, 0, CARD_W, CARD_H);
  g.textAlign = 'center';
  // GAME OVER explains why the night ended early and why the letter is F.
  if (!s.alive) glitchText(g, 'GAME OVER', CARD_W / 2, 46, 34, ALARM_CSS, { track: 8, ink: '#ffe9ec' });
  if (s.coins > 0) lit(g, `+ $ ${s.coins} BANKED`, CARD_W / 2, s.alive ? 46 : 86, 28, '#ffb02e', '#ffb02e', 600, 3);
  glitchText(g, s.letter, CARD_W / 2, CARD_H / 2 + 6, 196, s.colour, { split: 7, ink: s.colour });
  lit(
    g,
    s.faced > 0 ? `${s.dodges}/${s.faced} CLEAN · ${Math.round(s.rate * 100)}%` : 'NOTHING THROWN',
    CARD_W / 2,
    CARD_H - 66,
    28,
    '#f0f4fa',
    `rgba(${ACCENT_RGB},0.6)`,
    600,
    4,
  );
  if (s.perfects > 0) lit(g, `${s.perfects} PERFECT`, CARD_W / 2, CARD_H - 28, 24, '#ffd75e', '#ffd75e', 600, 5);
}
