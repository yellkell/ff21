/**
 * CUSTOMIZATION — THE LOCKER and THE STORE (MENUS 3): one plate, two faces,
 * on the panel kit. What you own and wear; what you don't and could.
 *
 * The panel is named for what you came to do, not for what the body is
 * called under the hood. "THE BLANK" is the mannequin's engineering name
 * (avatar/mannequin.ts) and it stays there; nothing in the menus asks a
 * player to learn it.
 *
 * The tab grammar the wrap wears (MENUS 2) comes to the modals: LOCKER ·
 * STORE across the top, and under it the row of sub-boards each face
 * offers — PLATFORMS · GEAR · COLOUR in the locker, PLATFORMS · GEAR ·
 * BANK in the store (there is nothing to buy about your own base tone,
 * and the BANK — iron-dollars for money, menu/bankBoard.ts — is nothing
 * to wear). PAINT is not sold here: it is bought where it is used, a tap
 * on a colour on the PAINT tab buying one unit — a second paint shop in
 * the STORE only left you wondering which one to use.
 *
 * Both catalogue boards carry a SHELF row under the chips: the GEAR board
 * shows one slot at a time (HEAD · BODY · HANDS) and the PLATFORMS board
 * one material at a time (TIMBER · STONE · FORGE · HONOURS), because a
 * board of seventeen tiles crushed them until the prices fell off. Nine
 * to a shelf at full size.
 *
 * The TILES are ghost buttons the body paints: the kit owns the plate, the
 * hover ease and the hit-test, while the artwork stays the bespoke icon
 * painters this game already had (menu/skinIcons.ts — a deck's grain, a
 * gear piece's silhouette). A tile in the store that is being TRIED ON
 * grows a real BUY button; the rest of its chrome is drawn. Hovering a
 * tile reads its one line — what the thing IS — in place of the price.
 *
 * The COLOUR face is the BASE TONE and nothing else: all white or all
 * black. Everything past the base tone is PAINT (the bay, on the YOU wing).
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { customization, gearOwned, myFrame, platformOwned } from './customization.js';
import { canAfford, coins } from './wallet.js';
import { DECK_SHELVES, PLATFORM_SKINS, PLATFORMS_OPEN, type PlatformSkin, platformShelf } from '../avatar/skins.js';
import { GEAR as GEAR_CATALOGUE, type GearDef, type GearSlot } from '../avatar/gear.js';
import { drawGearIcon, drawPlatformIcon } from './skinIcons.js';
import { bankBoard } from './bankBoard.js';
import { HUB_TITLE, hubTabs } from './paintbay.js';
import { FRAMES, preloadFrame } from '../avatar/forge.js';
import { drawIcon, forgeIcon } from './forgeIcons.js';

export const LOCKER_W = 1024;
export const LOCKER_H = 1024;

const M = 56;
const INNER = LOCKER_W - M * 2;
const SUB_Y = 140;
const SUB_H = 64;
/** Every catalogue board carries a shelf row under the board chips, so the
 *  grid starts below it — and holds at most nine tiles, three rows at
 *  full size. */
const SHELF_Y = 216;
const SHELF_H = 52;
const GRID_TOP = SHELF_Y + SHELF_H + 24;
const COLS = 3;
const GAP = 20;
const TILE_W = (INNER - (COLS - 1) * GAP) / COLS;
const FOOT_Y = LOCKER_H - 140;

/** THE BASE: the one pair of buttons this board carries. */
const BASE_Y = 268;
const BASE_H = 108;

/** The brand mark in the tab strip. The TABS say which face is up, so the
 *  mark says what the plate is FOR — repeating "LOCKER" beside the lit
 *  LOCKER tab told you nothing twice. */
const TITLE = HUB_TITLE;

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export interface LockerFace {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/* ── which board is showing ───────────────────────────────────────────── */

type Board = 'platforms' | 'gear' | 'colour' | 'bank';

/** COLOUR is the locker's alone, the BANK the store's; the other face
 *  falls back to pads (or to GEAR while PLATFORMS are paused,
 *  avatar/skins.ts PLATFORMS_OPEN). (Paint is bought and used on the PAINT
 *  tab.) */
function board(locker: boolean): Board {
  const b = pickBoard(locker);
  return b === 'platforms' && !PLATFORMS_OPEN ? 'gear' : b;
}

function pickBoard(locker: boolean): Board {
  const t = customization.tab;
  if (!locker && t === 'colour') return 'platforms';
  if (locker && t === 'bank') return 'platforms';
  if (t === 'gear' || t === 'colour' || t === 'bank') return t;
  return 'platforms';
}

interface Tile {
  id: string;
  kind: 'platform' | 'gear';
  def: PlatformSkin | GearDef;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The tiles this face is showing, laid out three across. The LOCKER lists
 *  what you own (tap to wear), the STORE what you don't (tap to try on). */
function tiles(locker: boolean): Tile[] {
  const b = board(locker);
  const picked: Array<{ kind: 'platform' | 'gear'; def: PlatformSkin | GearDef; index: number }> = [];
  if (b === 'gear') {
    GEAR_CATALOGUE.forEach((g, i) => {
      if (!g.hidden && g.slot === customization.gearSlot && gearOwned(g.id) === locker) picked.push({ kind: 'gear', def: g, index: i });
    });
  } else if (b === 'platforms') {
    PLATFORM_SKINS.forEach((s, i) => {
      if (platformShelf(s) === customization.platformShelf && platformOwned(s.id) === locker) picked.push({ kind: 'platform', def: s, index: i });
    });
  }
  const top = GRID_TOP;
  // Three across; a shelf of more than nine goes FOUR across, so every
  // tile keeps its full height (squeezed into a fourth row, a tile's name
  // and price ran into each other).
  const cols = picked.length > COLS * 3 ? COLS + 1 : COLS;
  const tileW = cols === COLS ? TILE_W : (INNER - (cols - 1) * GAP) / cols;
  const rows = Math.max(1, Math.ceil(picked.length / cols));
  // Three rows fit at full height; a deeper shelf shares the same span.
  const span = FOOT_Y - 24 - top;
  const step = rows <= 3 ? 196 : Math.floor(span / rows);
  const h = Math.min(176, step - 20);
  return picked.map((p, i) => ({
    id: `shop-${p.kind === 'gear' ? 'gr' : 'pf'}-${p.index}`,
    ...p,
    x: M + (i % cols) * (tileW + GAP),
    y: top + Math.floor(i / cols) * step,
    w: tileW,
    h,
  }));
}

/** Is this the thing the STORE is currently trying on? */
function previewed(t: Tile): boolean {
  return customization.preview?.kind === t.kind && customization.preview.id === t.def.id;
}

const buyRect = (t: Tile): { x: number; y: number; w: number; h: number } => ({
  x: t.x + 14,
  y: t.y + t.h - 58,
  w: t.w - 28,
  h: 46,
});

/* ── the faces ────────────────────────────────────────────────────────── */

export function lockerFace(locker: boolean): LockerFace {
  const b = board(locker);
  const buttons: PanelButton[] = hubTabs(locker ? 'locker' : 'store');

  // The sub-board chips: what this face has to show.
  const boards: Array<[Board, string, string]> = locker
    ? [
        ['platforms', 'PLATFORMS', 'tab-platforms'],
        ['gear', 'GEAR', 'tab-gear'],
        ['colour', 'BODY', 'tab-colour'],
      ]
    : [
        ['platforms', 'PLATFORMS', 'tab-platforms'],
        ['gear', 'GEAR', 'tab-gear'],
        ['bank', 'BANK', 'tab-bank'],
      ];
  const cw = (INNER - (boards.length - 1) * 16) / boards.length;
  boards.forEach(([key, label, id], i) => {
    const paused = key === 'platforms' && !PLATFORMS_OPEN;
    buttons.push({ id, label, x: M + i * (cw + 16), y: SUB_Y, w: cw, h: SUB_H, small: true, selected: b === key, disabled: paused });
  });
  // THE SHELVES: one slot of gear, or one material of pad, at a time.
  if (b === 'gear') {
    // HEADS first: a whole head (avatar/heads.ts) is the biggest thing
    // you can change about the blank; HEADGEAR is what bolts on over it.
    const shelves: Array<[GearSlot, string]> = [
      ['face', 'HEADS'],
      ['head', 'HEADGEAR'],
      ['shoulders', 'SHOULDERS'],
      ['body', 'BODY'],
      ['hands', 'HANDS'],
    ];
    const sw = (INNER - (shelves.length - 1) * 16) / shelves.length;
    shelves.forEach(([slot, label], i) => {
      buttons.push({
        id: `gear-${slot}`,
        label,
        x: M + i * (sw + 16), y: SHELF_Y, w: sw, h: SHELF_H,
        small: true,
        px: 22,
        selected: customization.gearSlot === slot,
      });
    });
  } else if (b === 'platforms') {
    const sw = (INNER - (DECK_SHELVES.length - 1) * 16) / DECK_SHELVES.length;
    DECK_SHELVES.forEach(([shelf, label], i) => {
      buttons.push({
        id: `shelf-${shelf}`,
        label,
        x: M + i * (sw + 16), y: SHELF_Y, w: sw, h: SHELF_H,
        small: true,
        px: 22,
        selected: customization.platformShelf === shelf,
      });
    });
  }

  buttons.push({ id: 'custom-close', label: 'CLOSE', x: LOCKER_W - M - 240, y: FOOT_Y + 24, w: 240, h: 84, small: true });
  if (!locker) {
    // The purse. On the catalogue boards it is a door to the BANK; on the
    // bank board itself, the readout.
    buttons.push({
      id: b === 'bank' ? 'store-wallet' : 'tab-bank',
      label: `$ ${coins.balance}`,
      sub: b === 'bank' ? 'iron-dollars' : 'iron-dollars · TOP UP',
      x: M, y: FOOT_Y + 24, w: 300, h: 84,
      display: b === 'bank',
      small: true,
      tone: KIT.accent,
    });
  }

  if (b === 'colour') return { title: TITLE, buttons: [...buttons, ...colourButtons()], body: colourBody };
  if (b === 'bank') {
    const bb = bankBoard(SHELF_Y, FOOT_Y);
    return { title: TITLE, buttons: [...buttons, ...bb.buttons], body: bb.body };
  }

  const shown = tiles(locker);
  for (const t of shown) {
    buttons.push({ id: t.id, label: '', ghost: true, x: t.x, y: t.y, w: t.w, h: t.h });
    // A tile being tried on grows a real BUY — unless it is EARNED, which
    // no amount of money answers.
    if (!locker && previewed(t) && !(t.kind === 'platform' && (t.def as PlatformSkin).earnedBy)) {
      const price = (t.def as { price?: number }).price ?? 0;
      const r = buyRect(t);
      buttons.push({
        id: `shop-buy-${t.kind === 'gear' ? 'gr' : 'pf'}-${t.index}`,
        label: `BUY  $ ${price}`,
        x: r.x, y: r.y, w: r.w, h: r.h,
        small: true,
        primary: canAfford(price),
        disabled: !canAfford(price),
      });
    }
  }
  return {
    title: TITLE,
    buttons,
    body: (g, hover) => {
      for (const t of shown) drawTile(g, t, locker, hover);
      if (shown.length === 0) {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = font(500, 26);
        g.fillStyle = KIT.faint;
        g.fillText(
          locker ? 'nothing on this shelf yet — the STORE has the rest' : 'you own every one of these',
          LOCKER_W / 2,
          GRID_TOP + 160,
        );
      }
    },
  };
}

/** One cosmetic tile: the icon, the name, and what it costs or says. */
function drawTile(g: CanvasRenderingContext2D, t: Tile, locker: boolean, hover: string | null): void {
  const gear = t.kind === 'gear';
  const accent = gear ? 0xc9a86a : (t.def as PlatformSkin).neon;
  const tint = css(accent);
  const worn = gear ? customization.gear.includes(t.def.id) : customization.platform === t.def.id;
  const owned = gear ? gearOwned(t.def.id) : platformOwned(t.def.id);
  const tryOn = !locker && previewed(t);
  const hot = hover === t.id;

  g.beginPath();
  g.roundRect(t.x, t.y, t.w, t.h, 18);
  g.fillStyle = worn || tryOn ? KIT.accentFaint : hot ? KIT.plateHover : KIT.plate;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = worn || tryOn ? tint : hot ? KIT.lineHover : KIT.line;
  g.stroke();
  // The edge tick the kit's own buttons wear, in the piece's own colour.
  if (worn || tryOn) {
    g.fillStyle = tint;
    g.beginPath();
    g.roundRect(t.x + 8, t.y + 14, 5, t.h - 28, 2.5);
    g.fill();
  }

  const cx = t.x + t.w / 2;
  const iconR = t.h * 0.24;
  const iconY = t.y + t.h * (tryOn ? 0.27 : 0.34);
  // THE FORGE's render of the piece (menu/forgeIcons.ts) when it has one;
  // the drawn glyph until it lands, or for a piece not yet forged.
  const art = gear ? forgeIcon(t.def.id) : null;
  if (art) drawIcon(g, art, cx, t.y + t.h * (tryOn ? 0.29 : 0.36), t.w - 24, t.h * (tryOn ? 0.5 : 0.62));
  else if (gear) drawGearIcon(g, t.def as GearDef, cx, iconY, iconR, tint);
  else drawPlatformIcon(g, t.def as PlatformSkin, cx, iconY, iconR);

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, 26);
  g.fillStyle = worn || tryOn || hot ? KIT.textHi : KIT.text;
  g.fillText(t.def.name, cx, t.y + t.h * (tryOn ? 0.54 : 0.68), t.w - 28);

  // The footer line: the blurb on hover; otherwise worn, owned, earned, or priced.
  if (tryOn) return; // the BUY button owns the strip
  g.font = font(600, 20);
  if (hot) {
    g.fillStyle = KIT.dim;
    g.font = font(500, 19);
    g.fillText(t.def.blurb, cx, t.y + t.h - 24, t.w - 24);
  } else if (worn) {
    g.fillStyle = KIT.accent;
    g.fillText(gear ? 'WORN' : 'EQUIPPED', cx, t.y + t.h - 24);
  } else if (owned) {
    g.fillStyle = KIT.faint;
    g.fillText(gear ? 'tap to wear' : 'tap to stand on', cx, t.y + t.h - 24);
  } else if (!gear && (t.def as PlatformSkin).earnedBy) {
    g.fillStyle = KIT.info;
    g.fillText((t.def as PlatformSkin).earnedBy ?? 'EARNED', cx, t.y + t.h - 24, t.w - 24);
  } else {
    const price = (t.def as { price?: number }).price ?? 0;
    g.fillStyle = canAfford(price) ? KIT.accent : KIT.disabled;
    g.fillText(`$ ${price}`, cx, t.y + t.h - 24);
  }
}

/* ── BODY: the base tone and THE FRAME ────────────────────────────────── */
//
// The board the locker calls BODY (its id is still 'tab-colour', for the
// probes) carries the two things about the blank itself that are yours to
// pick and cost nothing: the base TONE, and the FRAME — the body's shape
// (avatar/forge.ts), four Blender builds that share one hitbox. Each frame
// tile is a studio render of the frame itself.

const FRAME_Y = BASE_Y + BASE_H + 74;
const FRAME_GAP = 18;
const FRAME_W = (INNER - (FRAMES.length - 1) * FRAME_GAP) / FRAMES.length;
const FRAME_H = FOOT_Y - 30 - FRAME_Y;

function colourButtons(): PanelButton[] {
  const onyx = customization.avatar === 'onyx';
  const half = (INNER - 24) / 2;
  const out: PanelButton[] = [
    { id: 'base-white', label: 'ALL WHITE', sub: onyx ? 'you, bare' : 'worn', x: M, y: BASE_Y, w: half, h: BASE_H, selected: !onyx },
    { id: 'base-black', label: 'ALL BLACK', sub: onyx ? 'worn' : 'you, in onyx', x: M + half + 24, y: BASE_Y, w: half, h: BASE_H, selected: onyx },
  ];
  FRAMES.forEach((f, i) => {
    preloadFrame(f.id); // the mirror changes the moment a tile is tapped
    out.push({ id: `frame-${f.id}`, label: '', ghost: true, x: M + i * (FRAME_W + FRAME_GAP), y: FRAME_Y, w: FRAME_W, h: FRAME_H });
  });
  return out;
}

function colourBody(g: CanvasRenderingContext2D, hover: string | null): void {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 22);
  g.letterSpacing = '3px';
  g.fillStyle = KIT.faint;
  g.fillText('THE TONE', M, BASE_Y - 26);
  g.fillText('THE FRAME', M, FRAME_Y - 26);
  g.letterSpacing = '0px';
  g.textAlign = 'right';
  g.font = font(500, 20);
  g.fillStyle = KIT.dim;
  g.fillText('one hitbox for every frame — paint follows you between them', M + INNER, FRAME_Y - 26);
  const worn = myFrame();
  FRAMES.forEach((f, i) => {
    const x = M + i * (FRAME_W + FRAME_GAP);
    const id = `frame-${f.id}`;
    const on = worn === f.id;
    const hot = hover === id;
    g.beginPath();
    g.roundRect(x, FRAME_Y, FRAME_W, FRAME_H, 18);
    g.fillStyle = on ? KIT.accentFaint : hot ? KIT.plateHover : KIT.plate;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = on ? KIT.accent : hot ? KIT.lineHover : KIT.line;
    g.stroke();
    if (on) {
      g.fillStyle = KIT.accent;
      g.beginPath();
      g.roundRect(x + 8, FRAME_Y + 14, 5, FRAME_H - 28, 2.5);
      g.fill();
    }
    const cx = x + FRAME_W / 2;
    const img = forgeIcon(`frame-${f.id}`);
    if (img) drawIcon(g, img, cx, FRAME_Y + (FRAME_H - 96) / 2 + 8, FRAME_W - 16, FRAME_H - 104);
    g.textAlign = 'center';
    g.font = font(700, 26);
    g.fillStyle = on || hot ? KIT.textHi : KIT.text;
    g.fillText(f.name, cx, FRAME_Y + FRAME_H - 62, FRAME_W - 20);
    g.font = font(on ? 600 : 500, 18);
    g.fillStyle = on ? KIT.accent : KIT.dim;
    g.fillText(on ? 'WORN' : hot ? f.blurb : 'tap to wear', cx, FRAME_Y + FRAME_H - 28, FRAME_W - 16);
  });
}
