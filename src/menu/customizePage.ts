/**
 * THE BOARD's CUSTOMIZE page — back from the Meta Quest build (ff2meta
 * UI/Menu/CustomizePage.cs). The old customization plate (lockerFace.ts
 * LOCKER + STORE, menu/paintbay.ts PAINT, menu/bankBoard.ts, the ball
 * loadout beside it) recast as a page that takes the whole board, as the
 * CAREER does: ‹ BACK top-left, CUSTOMIZE in the header, THE PROFILE chip
 * (the wallet) top-right.
 *
 *   - TABS across the top for each section — LOCKER · STORE · PAINT ·
 *     LOADOUT — and under them the section's own row: the boards
 *     (PLATFORMS · GEAR · BODY, or · BANK in the store) with the shelves
 *     after a divider (HEADS · HEADGEAR · SHOULDERS · BODY · HANDS, or
 *     STREET · HONOURS); PAINT's row is its tool strip.
 *   - The shelf is a full grid of big square tiles, THE FORGE's studio
 *     render filling each, one badge in the corner (WORN · the price ·
 *     EARNED), the empty places kept as faint wells so the grid is whole.
 *   - One data plate on the right for the hovered (else the selected)
 *     thing — its render, its name, its slot, its price or WORN — and ONE
 *     CTA under it (EQUIP / TAKE OFF / STAND ON in the locker, BUY $N in
 *     the store, PUT BACK with paint on the pointer).
 *   - PAINT's racks are an even swatch grid (a count or price badge on
 *     each, the colour's name only on the plate).
 *   - No instruction or sub-line text anywhere.
 *
 * Every id the old plate pressed still routes through MenuSystem; a tile
 * tap still does what it did (wear / take off; try on in the store), the
 * CTA does the same to the selected tile, BUY buys it. The page's own ids
 * are `cz:go` (the CTA) and `cz:loadout` (the LOADOUT tab).
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { customization, gearOwned, myFrame, platformOwned } from './customization.js';
import { canAfford, coins } from './wallet.js';
import { DECK_SHELVES, PLATFORM_SKINS, PLATFORMS_OPEN, platformOnShelf, platformShelf, type PlatformSkin } from '../avatar/skins.js';
import { GEAR, type GearSlot } from '../avatar/gear.js';
import { FRAMES, loadForgeGear, preloadFrame } from '../avatar/forge.js';
import { bay, myLook, ownedCount, unitPrice, PAINT_KINDS, type PaintKind } from '../avatar/paint.js';
import { PAINT } from '../config.js';
import { bankBoard } from './bankBoard.js';
import { bayFaceState, drawShapeIcon, KIND_LABEL, rackColours, resetArmed, turnIndex, turnLabel } from './paintbay.js';
import { drawPlatformIcon } from './skinIcons.js';
import { drawIcon, forgeIcon } from './forgeIcons.js';

export const CUST_W = 1580;
export const CUST_H = 850;
/** The board header's title while the page is up. */
export const CUSTOMIZE_TITLE = 'CUSTOMIZE';

// The rows: the section tabs, then the section's own row.
const TAB_Y = 0;
const TAB_H = 58;
const SUB_Y = 78;
const SUB_H = 52;
// The grid (left) and the plate + CTA (right).
const GRID_Y = 152;
const GRID_W = 1080;
const GRID_H = CUST_H - GRID_Y;
const PLATE_X = 1116;
const PLATE_W = CUST_W - PLATE_X;
const PLATE_Y = GRID_Y;
const CTA_H = 116;
const PLATE_H = CUST_H - GRID_Y - CTA_H - 20;
const COLS = 5;
const ROWS = 3;
const GAP = 18;
const TILE = Math.min((GRID_W - (COLS - 1) * GAP) / COLS, (GRID_H - (ROWS - 1) * GAP) / ROWS);

/** The page's own state: the tile the CTA acts on (a tap selects), what the
 *  CTA presses, and whether the LOADOUT section is up. */
export const customizePage = { selected: '', cta: '', loadout: false };

export type Section = 'locker' | 'store' | 'paint' | 'loadout';

export function section(): Section {
  if (app.paintBayOpen) return 'paint';
  if (customizePage.loadout) return 'loadout';
  return customization.shopOpen ? 'store' : 'locker';
}

interface Face {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

type HoverOf = (id: string) => number;

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const accent = (a: number): string => `rgba(63,242,255,${a.toFixed(3)})`;

/* ── the section tabs ─────────────────────────────────────────────────── */

const SECTIONS: ReadonlyArray<[Section, string, string]> = [
  ['locker', 'open-locker', 'LOCKER'],
  ['store', 'open-shop', 'STORE'],
  ['paint', 'open-paintbay', 'PAINT'],
  ['loadout', 'cz:loadout', 'LOADOUT'],
];

interface TabSpec {
  id: string;
  label: string;
  on: boolean;
  off: boolean;
  x: number;
  w: number;
}

let measurer: CanvasRenderingContext2D | null = null;
function measure(text: string, px: number, track: number): number {
  measurer ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!measurer) return text.length * px * 0.62 + text.length * track;
  measurer.font = font(700, px);
  measurer.letterSpacing = `${track}px`;
  return measurer.measureText(text).width;
}

/** Text tabs laid left to right from x (the rail's type, an accent bar under the open one). */
function layTabs(tabs: Array<[string, string, boolean, boolean]>, x: number, px: number, pad: number, track: number): TabSpec[] {
  return tabs.map(([id, label, on, off]) => {
    const w = measure(label, px, track) + pad * 2;
    const t = { id, label, on, off, x, w };
    x += w + 8;
    return t;
  });
}

function tabButtons(tabs: TabSpec[], y: number, h: number): PanelButton[] {
  return tabs.map((t) => ({ id: t.id, label: t.label, ghost: true, disabled: t.off, x: t.x, y, w: t.w, h }));
}

function drawTabs(g: CanvasRenderingContext2D, tabs: TabSpec[], y: number, h: number, px: number, track: number, big: boolean, hoverOf: HoverOf): void {
  for (const t of tabs) {
    const hov = t.off ? 0 : hoverOf(t.id);
    if (t.on || hov > 0.01) {
      g.beginPath();
      g.roundRect(t.x, y, t.w, h, 12);
      g.fillStyle = t.on ? accent(big ? 0.1 : 0.08) : `rgba(90,230,255,${(0.06 * hov).toFixed(3)})`;
      g.fill();
    }
    if (t.on) {
      g.lineWidth = 1.5;
      g.strokeStyle = accent(0.45);
      g.stroke();
      g.fillStyle = KIT.accent;
      g.fillRect(t.x + 18, y + h - 4, t.w - 36, 3);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(t.on ? 700 : 600, px);
    g.letterSpacing = `${track}px`;
    g.fillStyle = t.off ? KIT.disabled : t.on ? KIT.textHi : hov > 0 ? `rgba(255,255,255,${(0.82 + 0.18 * hov).toFixed(3)})` : KIT.dim;
    if (t.on && big) {
      g.shadowColor = KIT.accentDim;
      g.shadowBlur = 10;
    }
    g.fillText(t.label, t.x + t.w / 2, y + h / 2 + 1);
    g.shadowBlur = 0;
    g.letterSpacing = '0px';
  }
}

function sectionTabs(): TabSpec[] {
  const now = section();
  return layTabs(
    SECTIONS.map(([s, id, label]) => [id, label, s === now, false]),
    0,
    28,
    30,
    3,
  );
}

/** The section tabs and the rule under the rows (every section wears them). */
function drawFrame(g: CanvasRenderingContext2D, tabs: TabSpec[], hoverOf: HoverOf): void {
  drawTabs(g, tabs, TAB_Y, TAB_H, 28, 3, true, hoverOf);
  g.fillStyle = KIT.lineFaint;
  g.fillRect(0, SUB_Y - 10, CUST_W, 1);
}

/* ── the face ─────────────────────────────────────────────────────────── */

export function customizePageFace(hoverOf: HoverOf): Face {
  switch (section()) {
    case 'paint':
      return paintFace(hoverOf);
    case 'loadout': {
      // The ball panel hangs over the page under the tabs (wrap.ts hosts it).
      customizePage.cta = '';
      const tabs = sectionTabs();
      return { title: '', buttons: tabButtons(tabs, TAB_Y, TAB_H), body: (g) => drawFrame(g, tabs, hoverOf) };
    }
    default:
      return catalogueFace(section() === 'locker', hoverOf);
  }
}

/** Where the LOADOUT's ball panel hangs: the page under the rows (page px). */
export const LOADOUT_RECT = {
  x: CUST_W / 2 - (CUST_H - GRID_Y + 10) / 2,
  y: GRID_Y - 10,
  w: CUST_H - GRID_Y + 10,
  h: CUST_H - GRID_Y + 10,
};

/* ── LOCKER and STORE ─────────────────────────────────────────────────── */

type Board = 'platforms' | 'gear' | 'colour' | 'bank';

/** BODY is the locker's alone, the BANK the store's; the other face falls
 *  back to the pads. */
function board(locker: boolean): Board {
  const t = customization.tab;
  const b: Board = !locker && t === 'colour' ? 'platforms' : locker && t === 'bank' ? 'platforms' : t === 'gear' || t === 'colour' || t === 'bank' ? t : 'platforms';
  return b === 'platforms' && !PLATFORMS_OPEN ? 'gear' : b;
}

const GEAR_SHELVES: ReadonlyArray<[GearSlot, string]> = [
  ['face', 'HEADS'],
  ['head', 'HEADGEAR'],
  ['shoulders', 'SHOULDERS'],
  ['body', 'BODY'],
  ['hands', 'HANDS'],
];

function slotLabel(slot: string): string {
  if (slot === 'platform') return 'PLATFORM';
  return GEAR_SHELVES.find(([s]) => s === slot)?.[1] ?? (slot === 'frame' ? 'FRAME' : slot.toUpperCase());
}

interface Item {
  id: string;
  defId: string;
  name: string;
  slot: string;
  price: number;
  index: number;
  gear: boolean;
  earned: boolean;
  pad?: PlatformSkin;
  x: number;
  y: number;
}

function items(locker: boolean, b: Board): Item[] {
  const out: Item[] = [];
  if (b === 'gear') {
    GEAR.forEach((d, i) => {
      if (d.hidden || d.slot !== customization.gearSlot || gearOwned(d.id) !== locker) return;
      out.push({ id: `shop-gr-${i}`, defId: d.id, name: d.name, slot: d.slot, price: d.price, index: i, gear: true, earned: false, x: 0, y: 0 });
      void loadForgeGear(d.id); // the shelf on show is fetched ahead of the tap
    });
  } else if (b === 'platforms') {
    // Only the listed pads: the modelled four, the standard deck, the earned
    // ones once earned (avatar/skins.ts platformOnShelf).
    PLATFORM_SKINS.forEach((s, i) => {
      if (platformShelf(s) !== customization.platformShelf || !platformOnShelf(s, locker, platformOwned(s.id))) return;
      out.push({ id: `shop-pf-${i}`, defId: s.id, name: s.name, slot: 'platform', price: s.price ?? 0, index: i, gear: false, earned: !!s.earnedBy, pad: s, x: 0, y: 0 });
    });
  }
  out.forEach((it, i) => {
    it.x = (i % COLS) * (TILE + GAP);
    it.y = GRID_Y + Math.floor(i / COLS) * (TILE + GAP);
  });
  return out;
}

/** A tile's studio render: THE FORGE's for gear, the pad's own for a pad
 *  (public/forge/icons/pad_<id>.webp) — null until it lands. */
function iconOf(it: Item): HTMLImageElement | null {
  return forgeIcon(it.gear ? it.defId : `pad_${it.defId}`);
}

const worn = (it: Item): boolean => (it.gear ? customization.gear.includes(it.defId) : customization.platform === it.defId);
const trying = (it: Item): boolean => customization.preview?.kind === (it.gear ? 'gear' : 'platform') && customization.preview.id === it.defId;

/** The item the CTA acts on: the tapped one, else (locker) what's worn on the shelf, else (store) the try-on. */
function selectedOf(list: Item[], locker: boolean): Item | null {
  return list.find((i) => i.id === customizePage.selected) ?? (locker ? list.find(worn) : list.find(trying)) ?? null;
}

function catalogueFace(locker: boolean, hoverOf: HoverOf): Face {
  const b = board(locker);
  const tabs = sectionTabs();
  const buttons = tabButtons(tabs, TAB_Y, TAB_H);

  // The section's row: the boards, then (catalogue boards) the shelves after a divider.
  const row = layTabs(
    [
      ['tab-platforms', 'PLATFORMS', b === 'platforms', !PLATFORMS_OPEN],
      ['tab-gear', 'GEAR', b === 'gear', false],
      locker ? ['tab-colour', 'BODY', b === 'colour', false] : ['tab-bank', 'BANK', b === 'bank', false],
    ],
    0,
    24,
    22,
    2.5,
  );
  const last = row[row.length - 1];
  const divX = last.x + last.w + 22;
  let shelves: TabSpec[] | null = null;
  if (b === 'gear') {
    shelves = layTabs(
      GEAR_SHELVES.map(([slot, label]) => [`gear-${slot}`, label, customization.gearSlot === slot, false]),
      divX + 22,
      24,
      20,
      2.5,
    );
  } else if (b === 'platforms') {
    // HONOURS only in the locker, and only once a pad on it is earned.
    const open = DECK_SHELVES.filter(
      ([id]) => id !== 'honours' || (locker && PLATFORM_SKINS.some((s) => s.earnedBy && platformOwned(s.id))),
    ).map(([id]) => id);
    if (!open.includes(customization.platformShelf)) customization.platformShelf = open[0];
    shelves = layTabs(
      DECK_SHELVES.filter(([id]) => open.includes(id)).map(([id, label]) => [`shelf-${id}`, label, customization.platformShelf === id, false]),
      divX + 22,
      24,
      20,
      2.5,
    );
  }
  buttons.push(...tabButtons(row, SUB_Y, SUB_H));
  if (shelves) buttons.push(...tabButtons(shelves, SUB_Y, SUB_H));

  const chrome = (g: CanvasRenderingContext2D): void => {
    drawFrame(g, tabs, hoverOf);
    drawTabs(g, row, SUB_Y, SUB_H, 24, 2.5, false, hoverOf);
    if (shelves) {
      g.fillStyle = KIT.line;
      g.fillRect(divX, SUB_Y + 12, 2, SUB_H - 24);
      drawTabs(g, shelves, SUB_Y, SUB_H, 24, 2.5, false, hoverOf);
    }
  };

  if (b === 'colour') return bodyBoard(buttons, chrome, hoverOf);
  if (b === 'bank') {
    // THE BANK is laid for the old 1024 plate: centred under the rows.
    customizePage.cta = '';
    const dx = (CUST_W - 1024) / 2;
    const bb = bankBoard(GRID_Y - 10, CUST_H);
    buttons.push(...bb.buttons.map((x) => ({ ...x, x: x.x + dx })));
    return {
      title: '',
      buttons,
      body: (g, hover) => {
        chrome(g);
        g.save();
        g.translate(dx, 0);
        bb.body(g, hover);
        g.restore();
      },
    };
  }

  const list = items(locker, b);
  for (const it of list) buttons.push({ id: it.id, label: '', ghost: true, x: it.x, y: it.y, w: TILE, h: TILE });
  const sel = selectedOf(list, locker);
  customizePage.cta = !sel ? '' : locker ? sel.id : sel.earned ? '' : `shop-buy-${sel.gear ? 'gr' : 'pf'}-${sel.index}`;
  // THE CTA: the selected tile's verb.
  const cta = { x: PLATE_X, y: CUST_H - CTA_H, w: PLATE_W, h: CTA_H, px: 40 };
  if (sel) {
    if (locker && !sel.gear && worn(sel) && sel.defId === 'ember') {
      // A worn pad comes off to the STANDARD deck; the standard one can't.
      buttons.push({ id: 'cz:go', label: 'WORN', ...cta, disabled: true });
    } else if (locker) {
      buttons.push({ id: 'cz:go', label: worn(sel) ? 'TAKE OFF' : sel.gear ? 'EQUIP' : 'STAND ON', ...cta, primary: !worn(sel) });
    } else if (!sel.earned) {
      const can = canAfford(sel.price);
      buttons.push({ id: 'cz:go', label: `BUY  $ ${sel.price}`, ...cta, primary: can, disabled: !can });
    }
  }

  return {
    title: '',
    buttons,
    body: (g, hover) => {
      chrome(g);
      let hot: Item | null = null;
      for (let i = 0; i < COLS * ROWS; i++) {
        const it = list[i];
        const x = (i % COLS) * (TILE + GAP);
        const y = GRID_Y + Math.floor(i / COLS) * (TILE + GAP);
        if (!it) {
          g.beginPath();
          g.roundRect(x, y, TILE, TILE, 18);
          g.fillStyle = 'rgba(255,255,255,0.015)';
          g.fill();
          continue;
        }
        if (hover === it.id) hot = it;
        drawItem(g, it, locker, sel === it, hoverOf(it.id));
      }
      drawItemPlate(g, hot ?? sel, locker, list.length, !!sel, b);
    },
  };
}

function tilePlate(g: CanvasRenderingContext2D, x: number, y: number, s: number, on: boolean, edge: string, width: number, hov: number): void {
  g.beginPath();
  g.roundRect(x, y, s, s, 18);
  g.fillStyle = on ? KIT.accentFaint : KIT.plate;
  g.fill();
  if (hov > 0.01) {
    g.fillStyle = `rgba(120,230,255,${(0.09 * hov).toFixed(3)})`;
    g.fill();
  }
  g.lineWidth = width;
  g.strokeStyle = edge;
  g.stroke();
}

function tileName(g: CanvasRenderingContext2D, name: string, x: number, y: number, lit: boolean): void {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 21);
  g.letterSpacing = '1.5px';
  g.fillStyle = lit ? KIT.textHi : KIT.dim;
  g.fillText(name, x + 16, y + TILE - 22, TILE - 32);
  g.letterSpacing = '0px';
}

/** One tile: the render filling it, the name along its foot, one badge in the corner. */
function drawItem(g: CanvasRenderingContext2D, it: Item, locker: boolean, selected: boolean, hov: number): void {
  const { x, y } = it;
  const isWorn = worn(it);
  const isTrying = !locker && trying(it);
  const afford = locker || it.earned || canAfford(it.price);
  const tint = it.gear ? KIT.accent : css(it.pad!.neon);
  tilePlate(g, x, y, TILE, selected || isTrying, selected || isTrying ? tint : hov > 0.01 ? KIT.lineHover : isWorn ? KIT.accentDim : KIT.line, selected ? 3 : 2, hov);
  const cx = x + TILE / 2;
  const art = iconOf(it);
  if (art) {
    g.globalAlpha = afford ? 1 : 0.45;
    drawIcon(g, art, cx, y + TILE * 0.44, TILE - 20, TILE * 0.78);
    g.globalAlpha = 1;
  } else if (it.pad) drawPlatformIcon(g, it.pad, cx, y + TILE * 0.42, TILE * 0.26);
  tileName(g, it.name, x, y, selected || hov > 0.5);

  // The one badge.
  if (isWorn) badge(g, x + TILE - 12, y + 12, 'WORN', KIT.accent, true);
  else if (!locker && it.earned) badge(g, x + TILE - 12, y + 12, 'EARNED', KIT.info, false);
  else if (!locker) badge(g, x + TILE - 12, y + 12, `$ ${it.price}`, afford ? KIT.accent : KIT.disabled, false);
}

/** A small pill, right-aligned at (rx, y): filled (a state) or outlined (a price). */
function badge(g: CanvasRenderingContext2D, rx: number, y: number, text: string, c: string, filled: boolean, px = 18): void {
  g.font = font(700, px);
  g.letterSpacing = '1.5px';
  const w = g.measureText(text).width + px * 1.3;
  const h = px * 1.75;
  g.beginPath();
  g.roundRect(rx - w, y, w, h, 8);
  if (filled) {
    g.fillStyle = c;
    g.fill();
  } else {
    g.fillStyle = 'rgba(4,8,18,0.8)';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = c;
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = filled ? '#04121a' : c;
  g.fillText(text, rx - w / 2, y + h / 2 + 1);
  g.letterSpacing = '0px';
}

/** The plate: a recessed well. */
function plate(g: CanvasRenderingContext2D, h: number): void {
  g.beginPath();
  g.roundRect(PLATE_X, PLATE_Y, PLATE_W, h, 18);
  g.fillStyle = KIT.well;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = KIT.line;
  g.stroke();
}

function plateTitle(g: CanvasRenderingContext2D, text: string, y: number): void {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 34);
  g.letterSpacing = '2px';
  g.fillStyle = KIT.textHi;
  g.fillText(text, PLATE_X + 30, y, PLATE_W - 60);
  g.letterSpacing = '0px';
  g.fillStyle = KIT.line;
  g.fillRect(PLATE_X + 30, y + 36, PLATE_W - 60, 2);
}

function plateRows(g: CanvasRenderingContext2D, y: number, rows: Array<[string, string, string?]>): void {
  rows.forEach(([label, value, tone], i) => {
    const ry = y + i * 52;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = font(600, 18);
    g.letterSpacing = '1.5px';
    g.fillStyle = KIT.faint;
    g.fillText(label, PLATE_X + 30, ry);
    g.textAlign = 'right';
    g.font = font(700, 26);
    g.letterSpacing = '1px';
    g.fillStyle = tone ?? KIT.textHi;
    g.fillText(value, PLATE_X + PLATE_W - 30, ry, PLATE_W - 200);
  });
  g.letterSpacing = '0px';
}

function drawItemPlate(g: CanvasRenderingContext2D, it: Item | null, locker: boolean, count: number, cta: boolean, b: Board): void {
  const h = cta ? PLATE_H : CUST_H - PLATE_Y;
  plate(g, h);
  if (!it) {
    const shelf = b === 'platforms' ? DECK_SHELVES.find(([id]) => id === customization.platformShelf)?.[1] ?? '' : slotLabel(customization.gearSlot);
    plateTitle(g, shelf, PLATE_Y + 52);
    plateRows(g, PLATE_Y + 140, [
      [locker ? 'OWNED' : 'IN STORE', String(count)],
      ['WALLET', `$ ${coins.balance}`, KIT.accent],
    ]);
    return;
  }
  const art = Math.min(PLATE_W - 60, h - 250);
  const cy = PLATE_Y + 20 + art / 2;
  const icon = iconOf(it);
  if (icon) drawIcon(g, icon, PLATE_X + PLATE_W / 2, cy, art, art);
  else if (it.pad) drawPlatformIcon(g, it.pad, PLATE_X + PLATE_W / 2, cy, art * 0.32);
  const ty = PLATE_Y + 40 + art;
  plateTitle(g, it.name, ty);
  const isWorn = worn(it);
  let state: string;
  let tone: string;
  if (isWorn) [state, tone] = ['WORN', KIT.accent];
  else if (locker || (it.gear ? gearOwned(it.defId) : platformOwned(it.defId))) [state, tone] = ['OWNED', KIT.positive];
  else if (it.earned) [state, tone] = [it.pad?.earnedBy ?? 'EARNED', KIT.info];
  else [state, tone] = [`$ ${it.price}`, canAfford(it.price) ? KIT.accent : KIT.danger];
  plateRows(g, ty + 78, [
    ['SLOT', slotLabel(it.slot)],
    [locker || isWorn ? 'STATUS' : 'PRICE', state, tone],
  ]);
}

/* ── BODY: the tone and THE FRAME ─────────────────────────────────────── */

function bodyBoard(buttons: PanelButton[], chrome: (g: CanvasRenderingContext2D) => void, hoverOf: HoverOf): Face {
  customizePage.cta = '';
  const onyx = customization.avatar === 'onyx';
  const tones: Array<[string, string, boolean]> = [
    ['base-white', 'ALL WHITE', false],
    ['base-black', 'ALL BLACK', true],
  ];
  tones.forEach(([id], i) => buttons.push({ id, label: '', ghost: true, x: i * (TILE + GAP), y: GRID_Y, w: TILE, h: TILE }));
  FRAMES.forEach((f, i) => {
    preloadFrame(f.id); // the mirror changes the moment a tile is tapped
    buttons.push({ id: `frame-${f.id}`, label: '', ghost: true, x: i * (TILE + GAP), y: GRID_Y + TILE + GAP, w: TILE, h: TILE });
  });
  return {
    title: '',
    buttons,
    body: (g, hover) => {
      chrome(g);
      const wornFrame = myFrame();
      let plateName: string | null = null;
      let plateKind = '';
      let plateWorn = false;
      let plateIcon: HTMLImageElement | null = null;
      let plateTone: string | null = null;
      tones.forEach(([id, name, black], i) => {
        const x = i * (TILE + GAP);
        const hov = hoverOf(id);
        const on = black === onyx;
        tilePlate(g, x, GRID_Y, TILE, on, on ? KIT.accent : hov > 0.01 ? KIT.lineHover : KIT.line, on ? 3 : 2, hov);
        const tone = black ? '#17171a' : '#f4f2ee';
        g.beginPath();
        g.arc(x + TILE / 2, GRID_Y + TILE * 0.42, TILE * 0.27, 0, Math.PI * 2);
        g.fillStyle = tone;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(255,255,255,0.25)';
        g.stroke();
        tileName(g, name, x, GRID_Y, on || hov > 0.5);
        if (on) badge(g, x + TILE - 12, GRID_Y + 12, 'WORN', KIT.accent, true);
        if (hover === id || (plateName === null && on && !(hover ?? '').startsWith('frame-'))) {
          [plateName, plateKind, plateWorn, plateIcon, plateTone] = [name, 'TONE', on, null, tone];
        }
      });
      FRAMES.forEach((f, i) => {
        const id = `frame-${f.id}`;
        const x = i * (TILE + GAP);
        const y = GRID_Y + TILE + GAP;
        const hov = hoverOf(id);
        const on = wornFrame === f.id;
        tilePlate(g, x, y, TILE, on, on ? KIT.accent : hov > 0.01 ? KIT.lineHover : KIT.line, on ? 3 : 2, hov);
        const icon = forgeIcon(id) ?? forgeIcon('frame-standard');
        if (icon) drawIcon(g, icon, x + TILE / 2, y + TILE * 0.44, TILE - 20, TILE * 0.78);
        tileName(g, f.name, x, y, on || hov > 0.5);
        if (on) badge(g, x + TILE - 12, y + 12, 'WORN', KIT.accent, true);
        if (hover === id) [plateName, plateKind, plateWorn, plateIcon, plateTone] = [f.name, 'FRAME', on, icon, null];
      });
      plate(g, CUST_H - PLATE_Y);
      if (plateName === null) return;
      const art = PLATE_W - 60;
      const cx = PLATE_X + PLATE_W / 2;
      const cy = PLATE_Y + 20 + art / 2;
      if (plateIcon) drawIcon(g, plateIcon, cx, cy, art, art);
      else if (plateTone) {
        g.beginPath();
        g.arc(cx, cy, art * 0.34, 0, Math.PI * 2);
        g.fillStyle = plateTone;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(255,255,255,0.25)';
        g.stroke();
      }
      const ty = PLATE_Y + 40 + art;
      plateTitle(g, plateName, ty);
      plateRows(g, ty + 78, [
        ['SLOT', plateKind],
        ['STATUS', plateWorn ? 'WORN' : 'FREE', plateWorn ? KIT.accent : KIT.positive],
      ]);
    },
  };
}

/* ── PAINT ────────────────────────────────────────────────────────────── */

const TOOL_H = 56;
const TOOL_W = 64;
const SW_COLS = 5;
const SW_ROWS = 4;
const SWATCH = Math.min((GRID_W - (SW_COLS - 1) * GAP) / SW_COLS, (GRID_H - (SW_ROWS - 1) * GAP) / SW_ROWS);

/** The colours a white ink reads badly on (the swatch's shape goes dark). */
const LIGHT_PAINT = new Set([0xf4f2ee, 0xe9e2f2, 0xffe94a, 0x9fdcff, 0x6fffb0]);

function paintFace(hoverOf: HoverOf): Face {
  customizePage.cta = '';
  const tabs = sectionTabs();
  const buttons = tabButtons(tabs, TAB_Y, TAB_H);
  const held = bay.held;
  const marks = myLook().paint.length;
  const armed = marks > 0 && resetArmed();

  // THE TOOL STRIP: the shapes | the held unit's turn / size / stroke | undo, reset | the turn.
  type Tool = [string, string, boolean, boolean, number];
  const tools: Array<Tool | null> = [
    ...PAINT_KINDS.map((k): Tool => [`pb:kind-${k}`, k, bayFaceState.kind === k, false, TOOL_W]),
    null,
    ['pb:rot-', '↺', false, !held, TOOL_W],
    ['pb:rot+', '↻', false, !held, TOOL_W],
    ['pb:size-', '−', false, !held, TOOL_W],
    ['pb:size+', '+', false, !held, TOOL_W],
    ['pb:wid-', 'THIN', false, !held || held.kind !== 'stripe', 92],
    ['pb:wid+', 'THICK', false, !held || held.kind !== 'stripe', 92],
    null,
    ['pb:undo', 'UNDO', false, !!held || marks === 0, 112],
    ['pb:reset', armed ? 'SURE?' : 'RESET', armed, !!held || marks === 0, 112],
    null,
    ['pb:turn-', '◂', false, false, TOOL_W],
    ['pb:turn+', '▸', false, false, TOOL_W],
  ];
  const laid: Array<{ id: string; glyph: string; on: boolean; off: boolean; x: number; w: number }> = [];
  const divs: number[] = [];
  let tx = 0;
  for (const t of tools) {
    if (!t) {
      divs.push(tx + 9);
      tx += 26;
      continue;
    }
    const [id, glyph, on, off, w] = t;
    laid.push({ id, glyph, on, off, x: tx, w });
    buttons.push({ id, label: '', ghost: true, disabled: off, x: tx, y: SUB_Y - 3, w, h: TOOL_H });
    tx += w + 8;
  }

  const rack = rackColours();
  rack.forEach((c, i) =>
    buttons.push({ id: `pb:take-${c}`, label: '', ghost: true, x: (i % SW_COLS) * (SWATCH + GAP), y: GRID_Y + Math.floor(i / SW_COLS) * (SWATCH + GAP), w: SWATCH, h: SWATCH }),
  );
  if (held) buttons.push({ id: 'pb:return', label: 'PUT BACK', x: PLATE_X, y: CUST_H - CTA_H, w: PLATE_W, h: CTA_H, px: 40, tone: KIT.warn });

  return {
    title: '',
    buttons,
    body: (g, hover) => {
      drawFrame(g, tabs, hoverOf);
      for (const t of laid) {
        const hov = t.off ? 0 : hoverOf(t.id);
        const y = SUB_Y - 3;
        g.beginPath();
        g.roundRect(t.x, y, t.w, TOOL_H, 12);
        g.fillStyle = t.on ? accent(0.12) : KIT.plate;
        g.fill();
        if (hov > 0.01) {
          g.fillStyle = `rgba(120,230,255,${(0.09 * hov).toFixed(3)})`;
          g.fill();
        }
        g.lineWidth = t.on ? 2 : 1.5;
        g.strokeStyle = t.on ? KIT.accent : hov > 0.01 ? KIT.lineHover : KIT.line;
        g.stroke();
        const col = t.off ? KIT.disabled : t.on ? KIT.accent : hov > 0 ? `rgba(255,255,255,${(0.82 + 0.18 * hov).toFixed(3)})` : KIT.dim;
        if (t.id.startsWith('pb:kind-')) drawShapeIcon(g, t.glyph as PaintKind, t.x + t.w / 2, y + TOOL_H / 2, 15, col);
        else {
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = font(700, t.glyph.length > 1 ? 19 : 32);
          g.letterSpacing = t.glyph.length > 1 ? '2px' : '0px';
          g.fillStyle = col;
          g.fillText(t.glyph, t.x + t.w / 2, y + TOOL_H / 2 + 1, t.w - 8);
          g.letterSpacing = '0px';
        }
      }
      g.fillStyle = KIT.line;
      for (const dx of divs) g.fillRect(dx, SUB_Y + 9, 2, TOOL_H - 24);
      // The turn's readout, at the strip's end.
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = font(700, 20);
      g.letterSpacing = '2px';
      g.fillStyle = turnIndex() === 0 ? KIT.dim : KIT.accent;
      g.fillText(turnLabel(), tx + 6, SUB_Y - 3 + TOOL_H / 2 + 1, CUST_W - tx - 10);
      g.letterSpacing = '0px';

      let hotColour = -1;
      rack.forEach((c, i) => {
        const id = `pb:take-${c}`;
        if (hover === id) hotColour = c;
        drawSwatch(g, c, (i % SW_COLS) * (SWATCH + GAP), GRID_Y + Math.floor(i / SW_COLS) * (SWATCH + GAP), hoverOf(id));
      });
      drawPaintPlate(g, hotColour, marks);
    },
  };
}

function drawSwatch(g: CanvasRenderingContext2D, colour: number, x: number, y: number, hov: number): void {
  const kind = bayFaceState.kind;
  const owned = ownedCount(kind, colour);
  const price = unitPrice(kind, colour);
  const inHand = bay.held?.kind === kind && bay.held.colour === colour;
  if (inHand || hov > 0.01) {
    g.beginPath();
    g.roundRect(x - 6, y - 6, SWATCH + 12, SWATCH + 12, 22);
    g.fillStyle = inHand ? accent(0.35) : `rgba(255,255,255,${(0.12 * hov).toFixed(3)})`;
    g.fill();
  }
  g.beginPath();
  g.roundRect(x, y, SWATCH, SWATCH, 18);
  g.fillStyle = css(PAINT.colours[colour]);
  g.fill();
  // One you'd buy sits a shade back.
  if (owned === 0) {
    g.fillStyle = 'rgba(6,8,14,0.42)';
    g.fill();
  }
  g.lineWidth = inHand ? 3 : 1.5;
  g.strokeStyle = inHand ? KIT.accent : `rgba(255,255,255,${(0.14 + 0.4 * hov).toFixed(3)})`;
  g.stroke();
  if (owned > 0) badge(g, x + SWATCH - 12, y + SWATCH - 52, `× ${owned}`, '#ffffff', false, 23);
  else badge(g, x + SWATCH - 12, y + SWATCH - 52, `$ ${price}`, canAfford(price) ? '#ffd98f' : KIT.disabled, false, 23);
}

function drawPaintPlate(g: CanvasRenderingContext2D, hotColour: number, marks: number): void {
  const held = bay.held;
  plate(g, held ? PLATE_H : CUST_H - PLATE_Y);
  const colour = hotColour >= 0 ? hotColour : held ? held.colour : -1;
  const kind: PaintKind = hotColour >= 0 || !held ? bayFaceState.kind : held.kind;
  const art = Math.min(PLATE_W - 60, 250);
  const cx = PLATE_X + PLATE_W / 2;
  const cy = PLATE_Y + 24 + art / 2;
  g.beginPath();
  g.roundRect(cx - art / 2, cy - art / 2, art, art, 26);
  if (colour >= 0) {
    g.fillStyle = css(PAINT.colours[colour]);
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.stroke();
    // The shape on it, in the contrast ink.
    const ink = LIGHT_PAINT.has(PAINT.colours[colour]) ? 'rgba(10,10,14,0.85)' : 'rgba(255,255,255,0.9)';
    drawShapeIcon(g, kind, cx, cy, art * 0.2, ink, held && hotColour < 0 ? held.angle * Math.PI * 2 : 0);
  } else {
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fill();
    drawShapeIcon(g, kind, cx, cy, art * 0.2, KIT.dim);
  }
  const ty = PLATE_Y + 48 + art;
  plateTitle(g, colour >= 0 ? PAINT.colourNames[colour] ?? '' : `${KIND_LABEL[kind]}S`, ty);
  const rows: Array<[string, string, string?]> = [['SHAPE', KIND_LABEL[kind]]];
  if (held && hotColour < 0) rows.push(['STATUS', 'ON POINTER', KIT.accent]);
  else if (colour >= 0) {
    const owned = ownedCount(kind, colour);
    const price = unitPrice(kind, colour);
    rows.push(owned > 0 ? ['OWNED', String(owned), KIT.positive] : ['PRICE', `$ ${price}`, canAfford(price) ? KIT.accent : KIT.danger]);
  }
  rows.push(['MARKS', `${marks} / ${PAINT.maxUnits}`, marks >= PAINT.maxUnits ? KIT.warn : undefined]);
  plateRows(g, ty + 74, rows);
}

/* ── the routing ──────────────────────────────────────────────────────── */

/**
 * The page's side of a press, before MenuSystem's: a section or shelf
 * change drops the selection; a tile tap selects it (and still does what
 * it did). Returns the id MenuSystem should run — the CTA's own verb for
 * `cz:go` — or null when the page settled it.
 */
export function customizeRoute(id: string): string | null {
  if (id.startsWith('open-') || id.startsWith('tab-') || id.startsWith('gear-') || id.startsWith('shelf-') || id === 'cz:loadout') customizePage.selected = '';
  if (id.startsWith('shop-gr-') || id.startsWith('shop-pf-')) customizePage.selected = id;
  if (id === 'open-locker' || id === 'open-shop' || id === 'open-paintbay' || id === 'open-bank') customizePage.loadout = false;
  if (id === 'cz:go') return customizePage.cta || null;
  return id;
}

/** Everything the page repaints on. */
export function customizeKey(): string {
  return [
    section(),
    customizePage.selected,
    customization.version,
    customization.tab,
    customization.gearSlot,
    customization.platformShelf,
    coins.balance,
  ].join('|');
}
