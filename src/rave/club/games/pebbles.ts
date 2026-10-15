/**
 * PEBBLES — the swap-to-match pattern puzzle, brought into the arcade as
 * its SPEED CHALLENGE: sixty seconds, match as many patterns as you can.
 *
 * Two 3×3 grids of river stones on the glass. The small one on the left is
 * the pattern; the big one on the right is yours, the same stones shuffled.
 * Swap pairs until yours matches, and a new pattern drops in.
 *
 *  - POINT: either laser; the stone under it lifts.
 *  - SWAP: trigger one stone, trigger another — or hold the trigger on one,
 *    sweep to the other and let go. Trigger the picked stone (or the glass
 *    between) to put it back down.
 *  - SCORE: patterns matched before the clock runs out.
 *
 * The stones keep the original's six schemes (earthy, river, clay, moss,
 * quartz, lava) — on a black CRT they read as stones under a lamp.
 */

import * as sfx from '../../audio/sfx.js';
import { font } from '../../ui/fonts.js';
import { ARCADE_TITLES, arcadeBook, SCREEN_H as H, SCREEN_W as W, type ArcadeCabinet } from '../arcade.js';
import { HANDS, type CabinetGame, type Hand, type Phase, type Pointers } from './game.js';

const RUN_SECONDS = 60;
/** The celebration between a match and the next pattern (input is shut). */
const SOLVE_HOLD = 0.6;
const SWAP_TIME = 0.14;
/** A fresh pattern starts at least this many stones out of place. */
const MIN_SCRAMBLE = 5;

const SCHEMES: readonly [string, string, string][] = [
  ['#d8ccc0', '#8b7d74', '#4e473f'], // earthy stone
  ['#dce1de', '#a1b1aa', '#6b7f77'], // river stone
  ['#efd7c1', '#cfa483', '#a67c52'], // warm clay
  ['#cde0c0', '#7a8b64', '#556b2f'], // moss green
  ['#ffffff', '#eaeaea', '#c0c0c0'], // quartz white
  ['#9a837c', '#5a4740', '#2e1b14'], // lava rock
];

const MINT = '#3fe0b0';

/** A 3×3 grid's placement on the glass. */
interface Grid {
  x: number;
  y: number;
  cell: number;
  gap: number;
}
// The pattern's tray (grid + 8 px rim) and your grid sit as one centred
// block under the HUD: 17 | tray 124 | 24 | grid 202 | 17, both on y 167.
const PLAYER: Grid = { x: 165, y: 66, cell: 62, gap: 8 };
const TARGET: Grid = { x: 25, y: 113, cell: 32, gap: 6 };
const DEMO: Grid = { x: 124, y: 80, cell: 40, gap: 8 };

function cellCentre(grid: Grid, i: number): [number, number] {
  const step = grid.cell + grid.gap;
  return [grid.x + (i % 3) * step + grid.cell / 2, grid.y + Math.floor(i / 3) * step + grid.cell / 2];
}

function gridSpan(grid: Grid): number {
  return grid.cell * 3 + grid.gap * 2;
}

/** The stone under a canvas point (generous: the gaps belong to the
 *  nearest stone), or -1 off the grid. */
function cellAt(grid: Grid, at: [number, number] | null): number {
  if (!at) return -1;
  const step = grid.cell + grid.gap;
  const lx = at[0] - grid.x + grid.gap / 2;
  const ly = at[1] - grid.y + grid.gap / 2;
  if (lx < 0 || ly < 0 || lx >= step * 3 || ly >= step * 3) return -1;
  return Math.floor(ly / step) * 3 + Math.floor(lx / step);
}

function randomPattern(): number[] {
  return Array.from({ length: 9 }, () => Math.floor(Math.random() * SCHEMES.length));
}

function misplaced(a: number[], b: number[]): number {
  let n = 0;
  for (let i = 0; i < 9; i++) if (a[i] !== b[i]) n++;
  return n;
}

function shuffled(src: number[]): number[] {
  const out = src.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Stone sprites, one per scheme per size — gradients are drawn once, not
 *  eighteen times a frame. Shared by every PEBBLES cabinet. */
const sprites = new Map<string, HTMLCanvasElement>();
function stone(scheme: number, d: number): HTMLCanvasElement {
  const key = `${scheme}:${d}`;
  let c = sprites.get(key);
  if (c) return c;
  const pad = 4;
  c = document.createElement('canvas');
  c.width = c.height = d + pad * 2;
  const g = c.getContext('2d')!;
  const r = d / 2;
  const cx = pad + r;
  // A soft contact shadow, then the stone lit from the upper left.
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.ellipse(cx + 1.5, cx + 3, r, r * 0.96, 0, 0, Math.PI * 2);
  g.fill();
  const [hi, mid, lo] = SCHEMES[scheme];
  const grad = g.createRadialGradient(cx - r * 0.4, cx - r * 0.4, 0, cx, cx, r);
  grad.addColorStop(0, hi);
  grad.addColorStop(0.6, mid);
  grad.addColorStop(1, lo);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.fill();
  sprites.set(key, c);
  return c;
}

export class PebblesGame implements CabinetGame {
  readonly id = 'pebbles' as const;
  phase: Phase = 'attract';
  score = 0;
  private target = randomPattern();
  private board = shuffled(this.target);
  private timeLeft = RUN_SECONDS;
  private swaps = 0;
  /** The picked-up stone, or -1. */
  private picked = -1;
  /** Where (and with which hand) the trigger went down, for press-drag-release. */
  private press: { hand: Hand; cell: number } | null = null;
  private hover: Record<Hand, number> = { left: -1, right: -1 };
  private cursors: [number, number][] = [];
  /** The swap in flight: stones a and b crossing over, t 0→1. */
  private swap: { a: number; b: number; t: number } | null = null;
  private solveT = 0;
  private lastTick = 0;
  private readonly g: CanvasRenderingContext2D;

  constructor(readonly cab: ArcadeCabinet) {
    this.g = cab.screenCanvas.getContext('2d')!;
  }

  start(): void {
    this.score = 0;
    this.timeLeft = RUN_SECONDS;
    this.lastTick = RUN_SECONDS;
    this.solveT = 0;
    this.newPattern();
    sfx.uiClick();
  }

  ended(): void {
    sfx.pebblesTime();
  }

  step(delta: number, hands: Pointers): boolean {
    this.timeLeft -= delta;
    // The last five seconds tick.
    const whole = Math.ceil(this.timeLeft);
    if (whole < this.lastTick && whole <= 5 && whole > 0) sfx.pebbleTap(true);
    this.lastTick = whole;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      return true;
    }

    if (this.swap) {
      this.swap.t += delta / SWAP_TIME;
      if (this.swap.t >= 1) this.swap = null;
    }

    this.cursors = [];
    for (const hand of HANDS) {
      const at = hands[hand].at;
      if (at) this.cursors.push(at);
      this.hover[hand] = cellAt(PLAYER, at);
    }

    if (this.solveT > 0) {
      this.solveT -= delta;
      if (this.solveT <= 0) this.newPattern();
      return false;
    }

    for (const hand of HANDS) {
      const p = hands[hand];
      const cell = this.hover[hand];
      if (p.down) {
        if (cell < 0 || cell === this.picked) {
          // Off the stones, or the picked one again: put it back down.
          this.picked = -1;
          this.press = null;
        } else if (this.picked < 0) {
          this.picked = cell;
          this.press = { hand, cell };
          sfx.pebbleTap(false);
        } else {
          this.doSwap(this.picked, cell);
        }
      } else if (p.up && this.press?.hand === hand) {
        // Press-drag-release: let go over a different stone and they trade.
        if (cell >= 0 && cell !== this.press.cell && this.picked === this.press.cell) {
          this.doSwap(this.picked, cell);
        }
        this.press = null;
      }
    }
    return false;
  }

  private doSwap(a: number, b: number): void {
    this.picked = -1;
    this.press = null;
    const bd = this.board;
    [bd[a], bd[b]] = [bd[b], bd[a]];
    this.swaps += 1;
    this.swap = { a, b, t: 0 };
    sfx.pebbleSwap();
    if (misplaced(bd, this.target) === 0) {
      this.score += 1;
      this.solveT = SOLVE_HOLD;
      sfx.pebblesSolve();
    }
  }

  private newPattern(): void {
    this.target = randomPattern();
    // Shuffle until the puzzle is worth the name (a pattern can't always
    // reach MIN_SCRAMBLE — a run of one colour — so take the best of a few).
    let best = shuffled(this.target);
    for (let k = 0; k < 24 && misplaced(best, this.target) < MIN_SCRAMBLE; k++) {
      const next = shuffled(this.target);
      if (misplaced(next, this.target) > misplaced(best, this.target)) best = next;
    }
    if (misplaced(best, this.target) === 0) {
      this.newPattern();
      return;
    }
    this.board = best;
    this.swaps = 0;
    this.picked = -1;
    this.press = null;
    this.swap = null;
  }

  /* ── the CRT ──────────────────────────────────────────────────────────── */

  paint(clock: number): void {
    const g = this.g;
    g.fillStyle = '#07090b';
    g.fillRect(0, 0, W, H);
    // Raked sand: faint ripples across the glass.
    g.strokeStyle = 'rgba(63,224,176,0.06)';
    g.lineWidth = 1;
    g.beginPath();
    for (let y = 14; y < H; y += 18) {
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 24) g.lineTo(x, y + Math.sin(x * 0.03 + y * 0.11) * 2.5);
    }
    g.stroke();

    if (this.phase === 'attract') {
      this.paintAttract(clock);
    } else {
      this.paintRun();
      if (this.phase === 'dead') this.paintCard();
    }
    this.cab.screenTex.needsUpdate = true;
  }

  private paintAttract(clock: number): void {
    const g = this.g;
    // The demo grid idles through slow swaps (attract repaints are ~2 Hz).
    const a = Math.floor(Math.random() * 9);
    const b = Math.floor(Math.random() * 9);
    [this.board[a], this.board[b]] = [this.board[b], this.board[a]];
    this.grid(DEMO, this.board, -1);

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#dcfff3';
    g.shadowColor = MINT;
    g.shadowBlur = 14;
    g.font = font(700, 38);
    g.fillText('PEBBLES', W / 2, 44);
    g.shadowBlur = 0;
    const pulse = 0.7 + Math.sin(clock * 2.2) * 0.3;
    g.font = font(600, 17);
    g.fillStyle = `rgba(233,236,244,${(0.35 + 0.35 * pulse).toFixed(2)})`;
    g.fillText('STEP UP · PULL THE TRIGGER', W / 2, 248);
    const top = arcadeBook('pebbles')[0];
    g.font = font(600, 15);
    g.fillStyle = 'rgba(233,236,244,0.4)';
    g.fillText(top ? `HOUSE BEST ${top.s} · ${top.n}` : 'MATCH THE PATTERN · 60 SECONDS', W / 2, 274);
  }

  private paintRun(): void {
    const g = this.g;

    // HUD strip.
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = font(700, 20);
    g.fillStyle = '#f2f3f7';
    g.fillText(`MATCHED ${this.score}`, 10, 18);
    g.textAlign = 'right';
    const secs = Math.ceil(this.timeLeft);
    g.fillStyle = secs <= 10 ? '#ff5266' : '#f2f3f7';
    g.fillText(`0:${String(secs).padStart(2, '0')}`, W - 10, 18);

    // The pattern, on its own little tray.
    const span = gridSpan(TARGET);
    g.fillStyle = 'rgba(63,224,176,0.07)';
    g.beginPath();
    g.roundRect(TARGET.x - 8, TARGET.y - 8, span + 16, span + 16, 10);
    g.fill();
    g.textAlign = 'center';
    g.font = font(600, 14);
    g.fillStyle = 'rgba(233,236,244,0.55)';
    g.letterSpacing = '2px';
    g.fillText('MATCH', TARGET.x + span / 2, TARGET.y - 22);
    g.letterSpacing = '0px';
    this.grid(TARGET, this.target, -1);
    g.font = font(600, 14);
    g.fillStyle = 'rgba(233,236,244,0.4)';
    g.fillText(`SWAPS ${this.swaps}`, TARGET.x + span / 2, TARGET.y + span + 26);

    // Yours.
    this.grid(PLAYER, this.board, this.picked, this.hover);

    if (this.solveT > 0) {
      // The zen ripple: rings out from the middle stone, and the word.
      const k = 1 - this.solveT / SOLVE_HOLD;
      const [cx, cy] = cellCentre(PLAYER, 4);
      for (let i = 0; i < 2; i++) {
        const kk = Math.max(0, k - i * 0.25);
        g.strokeStyle = `rgba(63,224,176,${(0.7 * (1 - kk)).toFixed(2)})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, 20 + kk * 130, 0, Math.PI * 2);
        g.stroke();
      }
      g.textAlign = 'center';
      g.font = font(700, 30);
      g.fillStyle = '#dcfff3';
      g.shadowColor = MINT;
      g.shadowBlur = 12;
      g.fillText('MATCH!', cx, cy);
      g.shadowBlur = 0;
    }

    // The lasers' dots.
    g.fillStyle = MINT;
    for (const [x, y] of this.cursors) {
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  private paintCard(): void {
    const g = this.g;
    g.fillStyle = 'rgba(6,4,10,0.74)';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(700, 34);
    g.fillStyle = MINT;
    g.fillText("TIME'S UP", W / 2, 112);
    g.font = font(700, 24);
    g.fillStyle = '#f2f3f7';
    g.fillText(`${this.score} MATCHED`, W / 2, 152);
    g.font = font(600, 15);
    g.fillStyle = 'rgba(233,236,244,0.6)';
    g.fillText(`GRADE ${ARCADE_TITLES.pebbles.grade(this.score)}`, W / 2, 182);
  }

  /** Draw a 3×3 of stones. `picked` lifts and rings one; `hover` lifts the
   *  stones under the lasers. The swap in flight slides its pair. */
  private grid(grid: Grid, stones: number[], picked: number, hover?: Record<Hand, number>): void {
    const g = this.g;
    const d = grid.cell - 4;
    const sw = this.swap && grid === PLAYER ? this.swap : null;
    const ease = sw ? 1 - (1 - sw.t) ** 3 : 1;
    for (let i = 0; i < 9; i++) {
      let [x, y] = cellCentre(grid, i);
      if (sw && (i === sw.a || i === sw.b)) {
        // This stone just arrived from the other end of the swap.
        const [fx, fy] = cellCentre(grid, i === sw.a ? sw.b : sw.a);
        x = fx + (x - fx) * ease;
        y = fy + (y - fy) * ease;
      }
      const lifted = i === picked || (hover && (hover.left === i || hover.right === i));
      const s = lifted ? 1.08 : 1;
      const img = stone(stones[i], d);
      const size = img.width * s;
      g.drawImage(img, x - size / 2, y - size / 2 - (lifted ? 2 : 0), size, size);
      if (i === picked) {
        g.strokeStyle = MINT;
        g.lineWidth = 3;
        g.shadowColor = MINT;
        g.shadowBlur = 10;
        g.beginPath();
        g.arc(x, y - 2, (d * s) / 2 + 5, 0, Math.PI * 2);
        g.stroke();
        g.shadowBlur = 0;
      }
    }
  }
}
