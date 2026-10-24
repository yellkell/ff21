/**
 * THE BOARD — the lobby's one menu FORMAT, back from the Meta Quest build
 * (ff2meta UI/Board.cs, Wordmark.cs and MenuSystem.cs's header chips),
 * which lifted it from RAVE RAID's own front desk (rave/systems/
 * MenuSystem.ts drawShell) and dressed it in FIRE FIGHT's colours:
 *
 *   ┌ wordmark (sheared) ─────────── status chip · cog · THE PROFILE ┐
 *   ├ rule ──────────────────────────────────────────────────────────┤
 *   │ 01 TAB ▌ │                                                     │
 *   │ 02 TAB   │      one content region: the open page's face       │
 *   │ 03 TAB   │      (a panel of its own, hung a hair in front)     │
 *   └──────────┴─────────────────────────────────────────────────────┘
 *
 * A page can take the WHOLE board (the CAREER): the rail and the wordmark
 * step aside, and ‹ BACK and the page's title take the header's left.
 *
 * This module only paints; menu/wrap.ts owns the pages, the hosted panels
 * and the routing. Every coordinate is board px (W × H).
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { ACCENT_RGB, HOLO_HOT_RGB } from '../ui/kit/holo.js';
import { app } from './appState.js';
import { coins } from './wallet.js';
import { hueToColor } from '../config.js';
import { myStats } from '../net/leaderboard.js';
import { tierForXp } from './progression.js';
import { coinDisplayValue } from './menu.js';

export const BOARD_W = 1660;
export const BOARD_H = 1024;
export const RAIL_X = 24;
export const RAIL_W = 264;
export const RAIL_Y = 140;
export const RAIL_BOTTOM = 1000;
/** The content region a page is hosted in, beside the rail. */
export const CONTENT = { x: 320, y: 150, w: 1300, h: 850 };
/** The content region of a page that takes the whole board. */
export const FULL = { x: 40, y: 150, w: 1580, h: 850 };
/** The board's own pane: near-opaque, so the street behind never muddies the type. */
export const BOARD_PANE = 'rgba(5,9,20,0.975)';
export const WORD_PX = 64;

const WORD_X = 44;
const WORD_Y = 68;
const BACK = { x: 28, y: 30, w: 220, h: 66 };
export const BACK_ID = 'board:back';

/* THE PROFILE chip, the settings cog left of it, the status chip left of that. */
export const CHIP = { x: 1150, y: 30, w: 470, h: 66 };
const COG_S = 58;
const COG = { x: CHIP.x - 16 - COG_S, y: CHIP.y + (CHIP.h - COG_S) / 2 };
export const COG_ID = 'board:settings';

/**
 * A board's palette — the FORMAT is shared, the colours are each area's own
 * (BoardLook in the Quest build): FIRE FIGHT's glass cyan, the club's LED
 * cyan over violet.
 */
export interface BoardLook {
  /** The hairlines' colour (r,g,b) and their base alpha. */
  lineRgb: string;
  lineA: number;
  /** The rail's recessed well. */
  well: string;
  /** The wordmark's two misregistered ghosts and its glow. */
  ghostA: string;
  ghostB: string;
  glow: string;
  /** The board's own near-opaque pane. */
  pane: string;
}

export const FF_LOOK: BoardLook = {
  lineRgb: '90,230,255',
  lineA: 0.3,
  well: 'rgba(0,6,16,0.42)',
  ghostA: `rgba(${ACCENT_RGB},0.85)`,
  ghostB: `rgba(${HOLO_HOT_RGB},0.85)`,
  glow: `rgba(${ACCENT_RGB},0.55)`,
  pane: 'rgba(5,9,20,0.975)',
};

/** THE CLUB's: the venue's LED cyan, its violet, a violet-black pane. */
export const CLUB_LOOK: BoardLook = {
  lineRgb: '143,123,255',
  lineA: 0.34,
  well: 'rgba(10,4,30,0.5)',
  ghostA: `rgba(${ACCENT_RGB},0.85)`,
  ghostB: 'rgba(179,92,255,0.85)',
  glow: 'rgba(179,92,255,0.55)',
  pane: 'rgba(8,5,22,0.975)',
};

const accent = (a: number): string => `rgba(${ACCENT_RGB},${a.toFixed(3)})`;
/** A hairline at `a` of FIRE FIGHT's line strength, in the look's colour. */
export const line = (look: BoardLook, a: number): string => `rgba(${look.lineRgb},${((a / 0.3) * look.lineA).toFixed(3)})`;
const stroke = (look: BoardLook): string => `rgba(${look.lineRgb},${look.lineA})`;

/** One rail entry. */
export interface RailTab {
  id: string;
  label: string;
  sub?: string;
  disabled?: boolean;
  /** A little air above this tab: the rail's groups. */
  groupStart?: boolean;
}

/** What the board needs to paint itself this frame. */
export interface BoardState {
  tabs: RailTab[];
  /** The open rail tab's id (one off the rail — SETTINGS — parks no marker). */
  active: string | null;
  /** The title of a page that has the whole board, or null when the rail is up. */
  full: string | null;
  status: { text: string; led: string; lit: boolean };
  /** SETTINGS is the open page: the cog lights. */
  cogOpen: boolean;
  /** THE PROFILE's card is dropped. */
  profileOpen: boolean;
}

export interface Slot {
  tab: RailTab;
  y: number;
  h: number;
}

export function layout(tabs: RailTab[]): Slot[] {
  const GAP = 14;
  let groups = 0;
  tabs.forEach((t, i) => {
    if (t.groupStart && i > 0) groups++;
  });
  const avail = RAIL_BOTTOM - RAIL_Y - 12 - groups * GAP;
  const pitch = Math.min(118, avail / Math.max(1, tabs.length));
  const h = pitch - Math.min(16, pitch * 0.14);
  let y = RAIL_Y + 12;
  return tabs.map((tab, i) => {
    if (i > 0 && tab.groupStart) y += GAP;
    const s = { tab, y, h };
    y += pitch;
    return s;
  });
}

/** The rail's ghost buttons (the body paints the tabs). */
export function railButtons(tabs: RailTab[]): PanelButton[] {
  return layout(tabs).map((s) => ({ id: s.tab.id, label: s.tab.label, ghost: true, disabled: s.tab.disabled, x: RAIL_X + 8, y: s.y, w: RAIL_W - 16, h: s.h }));
}

/** The board's buttons: the rail (or ‹ BACK on a full page), the cog, THE PROFILE. */
export function boardButtons(st: BoardState): PanelButton[] {
  const out: PanelButton[] = st.full ? [{ id: BACK_ID, label: 'BACK', ghost: true, ...BACK }] : railButtons(st.tabs);
  out.push(
    { id: COG_ID, label: '', ghost: true, x: COG.x, y: COG.y, w: COG_S, h: COG_S },
    { id: 'profile-toggle', label: '', ghost: true, ...CHIP },
  );
  return out;
}

/**
 * The rail's marker: a slanted blade that SLIDES to the open tab (~90 ms).
 * `ease` advances it; the owner repaints while it reports movement.
 */
export class RailMarker {
  private y = NaN;
  private target = NaN;

  aim(y: number | null): void {
    // A page off the rail parks no marker: it stays put and slides on from
    // there when a tab opens.
    if (y !== null) this.target = y;
    if (Number.isNaN(this.y)) this.y = this.target;
  }

  at(): number {
    return this.y;
  }

  /** Ease toward the open tab; true while it is still moving. */
  ease(delta: number): boolean {
    if (Number.isNaN(this.y) || Number.isNaN(this.target) || this.y === this.target) return false;
    const gap = this.target - this.y;
    this.y = Math.abs(gap) > 0.5 ? this.y + gap * Math.min(1, delta / 0.09) : this.target;
    return true;
  }
}

/** Paint the board's chrome: header, wordmark or ‹ BACK, the rail, the chips. */
export function drawBoard(g: CanvasRenderingContext2D, st: BoardState, hoverOf: (id: string) => number, marker: RailMarker): void {
  drawHeaderRule(g, FF_LOOK);
  if (st.full) drawBack(g, st.full, hoverOf(BACK_ID));
  else {
    drawWordmark(g, 'FIRE FIGHT 2', FF_LOOK);
    drawRail(g, st.tabs, st.active, hoverOf, marker, FF_LOOK);
  }
  drawStatusChip(g, COG.x, st.status.text, st.status.led, st.status.lit, FF_LOOK);
  drawCog(g, st.cogOpen, hoverOf(COG_ID));
  drawProfileChip(g, st.profileOpen, hoverOf('profile-toggle'));
}

/** The header rule fading out to the right, an accent lead-in under the
 *  wordmark, and a notch where the two meet. */
export function drawHeaderRule(g: CanvasRenderingContext2D, look: BoardLook): void {
  const rule = g.createLinearGradient(28, 0, BOARD_W - 28, 0);
  rule.addColorStop(0, line(look, 0.45));
  rule.addColorStop(0.6, line(look, 0.18));
  rule.addColorStop(1, line(look, 0.04));
  g.fillStyle = rule;
  g.fillRect(28, 128, BOARD_W - 56, 2);
  g.fillStyle = KIT.accent;
  g.fillRect(28, 127, RAIL_W, 4);
  g.beginPath();
  g.moveTo(28 + RAIL_W, 127);
  g.lineTo(28 + RAIL_W + 10, 129);
  g.lineTo(28 + RAIL_W, 131);
  g.closePath();
  g.fill();
}

/**
 * THE WORDMARK, SHEARED: a glowing white word over a cyan / magenta
 * misregistration, cut once just under its middle with the lower strip
 * shoved right and a dark seam between (Wordmark.cs). Each half is the
 * two ghosts and the face, clipped.
 */
export function drawWordmark(g: CanvasRenderingContext2D, word: string, look: BoardLook, x = WORD_X, y = WORD_Y): void {
  const PX = WORD_PX;
  const SHIFT = 6;
  const CUT = 5;
  const SEAM = 2;
  g.save();
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, PX);
  g.letterSpacing = '7px';
  const tw = g.measureText(word).width;
  const half = (cx: number, cy: number, cw: number, ch: number, shift: number): void => {
    g.save();
    g.beginPath();
    g.rect(cx, cy, cw, ch);
    g.clip();
    g.fillStyle = look.ghostA;
    g.fillText(word, x + shift - 3, y + 1);
    g.fillStyle = look.ghostB;
    g.fillText(word, x + shift + 3, y - 1);
    g.fillStyle = KIT.textHi;
    g.shadowColor = look.glow;
    g.shadowBlur = 16;
    g.fillText(word, x + shift, y);
    g.restore();
  };
  half(x - 14, y - PX * 1.1, tw + 40, PX * 1.1 + CUT, 0);
  half(x - 14, y + CUT + SEAM, tw + 40, PX * 0.75, SHIFT);
  g.restore();
}

/** ‹ BACK, top-left, then the full page's title where the wordmark sits. */
function drawBack(g: CanvasRenderingContext2D, title: string, hov: number): void {
  if (hov > 0.01) {
    g.beginPath();
    g.roundRect(BACK.x, BACK.y, BACK.w, BACK.h, 14);
    g.fillStyle = accent(0.08 * hov);
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = accent(0.45 * hov);
    g.stroke();
  }
  const cy = BACK.y + BACK.h / 2;
  const ax = BACK.x + 30;
  const col = hov > 0 ? `rgba(255,255,255,${(0.82 + 0.18 * hov).toFixed(3)})` : KIT.dim;
  g.strokeStyle = col;
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(ax + 10, cy - 13);
  g.lineTo(ax - 2, cy);
  g.lineTo(ax + 10, cy + 13);
  g.stroke();
  g.lineCap = 'butt';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 28);
  g.letterSpacing = '3px';
  g.fillStyle = col;
  g.fillText('BACK', ax + 26, cy + 1);
  g.fillStyle = KIT.line;
  g.fillRect(BACK.x + BACK.w + 22, BACK.y + 12, 2, BACK.h - 24);
  g.save();
  g.font = font(700, 52);
  g.letterSpacing = '6px';
  g.fillStyle = KIT.textHi;
  g.shadowColor = KIT.accentDim;
  g.shadowBlur = 14;
  g.fillText(title, BACK.x + BACK.w + 50, cy, 760);
  g.restore();
  g.letterSpacing = '0px';
}

export function drawRail(g: CanvasRenderingContext2D, tabs: RailTab[], active: string | null, hoverOf: (id: string) => number, marker: RailMarker, look: BoardLook): void {
  const slots = layout(tabs);
  // The rail's recessed well.
  g.beginPath();
  g.roundRect(RAIL_X, RAIL_Y, RAIL_W, RAIL_BOTTOM - RAIL_Y, 20);
  g.fillStyle = look.well;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = stroke(look);
  g.stroke();

  const on = slots.find((s) => s.tab.id === active) ?? null;
  const first = slots[0];
  const activeH = on?.h ?? first?.h ?? 100;
  marker.aim(on ? on.y + on.h * 0.18 : first ? first.y + first.h * 0.18 : null);
  const compact = activeH < 96;
  const rx = RAIL_X + 8;
  const rw = RAIL_W - 16;
  slots.forEach((s, idx) => {
    const t = s.tab;
    const lit = t.id === active;
    const hov = hoverOf(t.id);
    if (lit || hov > 0.01) {
      g.beginPath();
      g.roundRect(rx, s.y, rw, s.h, 14);
      g.fillStyle = lit ? accent(0.1) : line(look, 0.06 * hov);
      g.fill();
      if (lit) {
        g.lineWidth = 1.5;
        g.strokeStyle = accent(0.45);
        g.stroke();
      }
    }
    // The index, tucked top-right of the tab.
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.font = font(600, 15);
    g.letterSpacing = '2px';
    g.fillStyle = lit ? KIT.accent : line(look, 0.42);
    g.fillText(String(idx + 1).padStart(2, '0'), rx + rw - 14, s.y + 18);
    g.textAlign = 'left';
    g.font = font(lit ? 700 : 600, compact ? 26 : 29);
    g.letterSpacing = '2.5px';
    g.fillStyle = t.disabled ? KIT.disabled : lit ? KIT.textHi : hov > 0 ? `rgba(255,255,255,${(0.82 + 0.18 * hov).toFixed(3)})` : KIT.dim;
    const ty = s.y + (t.sub ? s.h * 0.38 : s.h * 0.5);
    if (lit) {
      g.shadowColor = KIT.accentDim;
      g.shadowBlur = 10;
    }
    g.fillText(t.label, rx + 26, ty, rw - 56);
    g.shadowBlur = 0;
    if (t.sub) {
      g.font = font(500, compact ? 17 : 20);
      g.letterSpacing = '0.5px';
      g.fillStyle = t.disabled ? 'rgba(205,236,255,0.2)' : lit ? KIT.dim : KIT.faint;
      g.fillText(t.sub, rx + 26, ty + (compact ? 26 : 34), rw - 40);
    }
    g.letterSpacing = '0px';
  });
  // The marker: a slanted blade, mid-slide or parked.
  if (!on) return;
  const my = marker.at();
  const mh = activeH * 0.64;
  g.fillStyle = accent(0.22);
  g.beginPath();
  g.moveTo(RAIL_X + 10, my - 6);
  g.lineTo(RAIL_X + 26, my - 6);
  g.lineTo(RAIL_X + 22, my + mh + 6);
  g.lineTo(RAIL_X + 6, my + mh + 6);
  g.closePath();
  g.fill();
  g.fillStyle = KIT.accent;
  g.beginPath();
  g.moveTo(RAIL_X + 15, my);
  g.lineTo(RAIL_X + 21, my);
  g.lineTo(RAIL_X + 17, my + mh);
  g.lineTo(RAIL_X + 11, my + mh);
  g.closePath();
  g.fill();
}

/** The status chip: a square LED and quiet caps, parked left of `rightX`. */
export function drawStatusChip(g: CanvasRenderingContext2D, rightX: number, text: string, led: string, lit: boolean, look: BoardLook): void {
  g.font = font(600, 21);
  g.letterSpacing = '2px';
  const tw = g.measureText(text).width + 2;
  const h = 44;
  const y = 34 + (58 - h) / 2;
  const w = tw + 66;
  const x = rightX - 20 - w;
  g.beginPath();
  g.roundRect(x, y, w, h, 9);
  g.fillStyle = line(look, 0.1);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = stroke(look);
  g.stroke();
  if (lit) {
    g.globalAlpha = 0.25;
    g.fillStyle = led;
    g.fillRect(x + 18, y + h / 2 - 8, 16, 16);
    g.globalAlpha = 1;
  }
  g.fillStyle = led;
  g.fillRect(x + 21, y + h / 2 - 5, 10, 10);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = KIT.dim;
  g.fillText(text, x + 44, y + h / 2 + 1);
  g.letterSpacing = '0px';
}

/** The settings cog: a plate like THE PROFILE's, eight teeth round a REAL
 *  hole (the chip shows through — evenodd, never a dark dot painted on),
 *  lit while SETTINGS is open. */
function drawCog(g: CanvasRenderingContext2D, open: boolean, hov: number): void {
  g.beginPath();
  g.roundRect(COG.x, COG.y, COG_S, COG_S, 14);
  g.fillStyle = open ? accent(0.14) : `rgba(255,255,255,${(0.04 + 0.05 * hov).toFixed(3)})`;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = open ? accent(0.9) : hov > 0.01 ? KIT.lineHover : KIT.line;
  g.stroke();
  const cx = COG.x + COG_S / 2;
  const cy = COG.y + COG_S / 2;
  // One outline — the ring at r 13, a tooth out to r 18 every eighth of a
  // turn — and the hub as a second loop, filled even-odd so it is a hole.
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const teeth: Array<[number, number]> = [
      [13, a - 0.32],
      [18, a - 0.18],
      [18, a + 0.18],
      [13, a + 0.32],
    ];
    teeth.forEach(([r, t], k) => {
      const px = cx + Math.cos(t) * r;
      const py = cy + Math.sin(t) * r;
      if (i === 0 && k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
  }
  g.closePath();
  g.moveTo(cx + 5.5, cy);
  g.arc(cx, cy, 5.5, 0, Math.PI * 2);
  g.fillStyle = open ? KIT.accent : hov > 0 ? `rgba(255,255,255,${(0.82 + 0.18 * hov).toFixed(3)})` : KIT.dim;
  g.fill('evenodd');
}

/** THE PROFILE chip: your mark, name, rank and XP, the way to the next rank
 *  as a hairline, the wallet (gold while a bout's coins roll in) and the
 *  card's chevron. */
function drawProfileChip(g: CanvasRenderingContext2D, open: boolean, hov: number): void {
  const { x, y, w, h } = CHIP;
  g.beginPath();
  g.roundRect(x, y, w, h, 18);
  g.fillStyle = open ? accent(0.14) : `rgba(255,255,255,${(0.04 + 0.04 * hov).toFixed(3)})`;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = open ? accent(0.9) : hov > 0.01 ? KIT.lineHover : KIT.line;
  g.stroke();
  const stats = myStats();
  const tier = tierForXp(stats.xp);
  const mark = `#${hueToColor(app.accentHue, app.accentLight).toString(16).padStart(6, '0')}`;
  const cy = y + h / 2;
  const diamond = (r: number): void => {
    g.beginPath();
    g.moveTo(x + 34, cy - r);
    g.lineTo(x + 34 + r, cy);
    g.lineTo(x + 34, cy + r);
    g.lineTo(x + 34 - r, cy);
    g.closePath();
    g.fill();
  };
  g.globalAlpha = 0.25;
  g.fillStyle = mark;
  diamond(17);
  g.globalAlpha = 1;
  diamond(12);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 25);
  g.letterSpacing = '1.5px';
  g.fillStyle = KIT.textHi;
  g.fillText(stats.name, x + 64, cy - 11, 230);
  g.font = font(500, 16);
  g.letterSpacing = '1px';
  g.fillStyle = KIT.dim;
  g.fillText(`${tier.name} · ${stats.xp} XP`, x + 64, cy + 16, 230);
  g.letterSpacing = '0px';
  const rx = x + 64;
  const rw = 236;
  const ry = y + h - 8;
  g.fillStyle = accent(0.2);
  g.fillRect(rx, ry, rw, 2);
  g.fillStyle = accent(0.62);
  g.fillRect(rx, ry, rw * Math.max(0, Math.min(1, tier.progress)), 2);
  const rolling = coinDisplayValue() !== coins.balance;
  g.textAlign = 'right';
  g.font = font(700, 26);
  g.letterSpacing = '1px';
  g.fillStyle = rolling ? '#ffd27a' : KIT.accent;
  g.fillText(`$ ${coinDisplayValue()}`, x + w - 52, cy);
  g.letterSpacing = '0px';
  const vx = x + w - 26;
  g.fillStyle = KIT.faint;
  g.beginPath();
  if (open) {
    g.moveTo(vx, cy - 5);
    g.lineTo(vx + 8, cy + 5);
    g.lineTo(vx - 8, cy + 5);
  } else {
    g.moveTo(vx - 8, cy - 5);
    g.lineTo(vx + 8, cy - 5);
    g.lineTo(vx, cy + 5);
  }
  g.closePath();
  g.fill();
}

/** A section kicker: a slash pair in the accent, the label in dim caps. */
export function kicker(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 24);
  g.letterSpacing = '2px';
  g.fillStyle = KIT.accent;
  g.fillText('//', x, y);
  const sx = x + g.measureText('// ').width + 6;
  g.font = font(600, 24);
  g.letterSpacing = '4px';
  g.fillStyle = KIT.dim;
  g.fillText(text, sx, y);
  g.letterSpacing = '0px';
}
