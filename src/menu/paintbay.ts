/**
 * THE PAINT TAB — where a blank takes its colour (docs/paint.md §2).
 *
 * The third face of the one customization plate: LOCKER · STORE · PAINT,
 * the same plate, size and tab strip as the other two, standing beside the
 * mirror. What it shows, top to bottom:
 *
 *   THE SHAPES   stripe · dot · square · triangle, drawn, one lit.
 *   THE COLOURS  every colour on the racks as one grid, for the lit shape.
 *                A colour you own wears its count, and a tap puts one on
 *                your pointer. A colour you don't own wears its price, and
 *                a tap BUYS ONE and puts it on your pointer — paint is
 *                still bought a unit at a time, but running out is never
 *                a trip to another screen.
 *   THE HAND     what's on your pointer and the verbs for it: turn it,
 *                size it (a stripe's thickness too), send it back. With
 *                nothing held, UNDO takes the last mark back off the body.
 *   THE TURN     spin the blank to reach its back (the thumbstick spins it
 *                too — see MenuSystem), and CLOSE.
 *
 * The BODY work happens off-panel: MenuSystem raycasts the mirror's paint
 * surfaces while this face is up — the held unit ghosts onto the body
 * under the ray, trigger commits it, the thumbstick twists and sizes it
 * (grip switches a stripe to thickness), pointing at a placed mark and
 * squeezing lifts it back into the hand, B sends the hand back, A undoes.
 * The state ops live in avatar/paint.ts; this module is the face and the
 * local `pb:*` click routing (the STORE's paint board rides it too).
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { PAINT } from '../config.js';
import {
  bay,
  grantUnit,
  handReturn,
  handTake,
  invState,
  myLook,
  ownedCount,
  paintState,
  undoLast,
  unitPrice,
  PAINT_KINDS,
  type PaintKind,
} from '../avatar/paint.js';
import { canAfford, coins, spendCoins } from './wallet.js';

/** The hub's plate: the same sheet as the LOCKER and the STORE. */
export const BAY_W = 1024;
export const BAY_H = 1024;
const M = 56;
const INNER = BAY_W - M * 2;

/** The brand mark and the three tabs every face of the hub wears. */
export const HUB_TITLE = 'CUSTOMIZATION';
export function hubTabs(active: 'locker' | 'store' | 'paint'): PanelButton[] {
  const y = 36;
  const h = 76;
  return [
    { id: 'open-locker', label: 'LOCKER', tab: true, x: 384, y, w: 176, h, selected: active === 'locker' },
    { id: 'open-shop', label: 'STORE', tab: true, x: 572, y, w: 170, h, selected: active === 'store' },
    { id: 'open-paintbay', label: 'PAINT', tab: true, x: 754, y, w: 170, h, selected: active === 'paint' },
  ];
}

/** The rack's colours on sale — the top shelf is not on the racks yet. */
export function rackColours(): number[] {
  return PAINT.colours.map((_, i) => i).filter((i) => PAINT.tierOf(i) < 2);
}

/**
 * Which shape the grids show, and WHICH WAY THE BLANK IS FACING.
 *
 * The bay paints onto the locker mirror, which stands facing you, so its
 * back is out of reach unless it turns. `yaw` is where it is turning TO
 * (radians, 0 = facing you): the ◂ ▸ buttons step it an eighth at a time
 * and the thumbstick spins it freely; MenuSystem eases the mirror after it.
 */
export const bayFaceState = { kind: 'stripe' as PaintKind, yaw: 0, version: 1 };

/** The eight faces, named for the side of the blank they put in front of you. */
const TURN_FACE = ['FRONT', 'FRONT L', 'LEFT', 'BACK L', 'BACK', 'BACK R', 'RIGHT', 'FRONT R'];

/** Which eighth the blank is nearest to facing. */
function turnIndex(): number {
  const eighth = (Math.PI * 2) / 8;
  return ((Math.round(bayFaceState.yaw / eighth) % 8) + 8) % 8;
}

/** Step the turn to the next eighth either way (snapping onto the grid). */
function stepTurn(dir: 1 | -1): void {
  const eighth = (Math.PI * 2) / 8;
  bayFaceState.yaw = (Math.round(bayFaceState.yaw / eighth) + dir) * eighth;
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

const KIND_LABEL: Record<PaintKind, string> = { stripe: 'STRIPE', dot: 'DOT', square: 'SQUARE', triangle: 'TRIANGLE' };

/** A shape's icon, drawn flat in `fill` — the chips, the hand and the store. */
export function drawShapeIcon(g: CanvasRenderingContext2D, kind: PaintKind, cx: number, cy: number, r: number, fill: string, angle = 0): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.fillStyle = fill;
  g.beginPath();
  if (kind === 'stripe') g.roundRect(-r * 1.25, -r * 0.3, r * 2.5, r * 0.6, r * 0.3);
  else if (kind === 'dot') g.arc(0, 0, r * 0.85, 0, Math.PI * 2);
  else if (kind === 'square') g.roundRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5, r * 0.09);
  else {
    const s = r * 1.9;
    const h = (s * Math.sqrt(3)) / 2;
    g.moveTo(0, (-h * 2) / 3);
    g.lineTo(s / 2, h / 3);
    g.lineTo(-s / 2, h / 3);
    g.closePath();
  }
  g.fill();
  g.restore();
}

/** Shape chips: four across, a drawn icon over the name. */
const SHAPE_Y = 140;
const SHAPE_H = 104;
const shapeRect = (i: number, top = SHAPE_Y, h = SHAPE_H): { x: number; y: number; w: number; h: number } => {
  const w = (INNER - 3 * 16) / 4;
  return { x: M + i * (w + 16), y: top, w, h };
};

/** The colour grid: five across, four down. */
const GRID_Y = 292;
const GRID_COLS = 5;
const CHIP_H = 96;
export const colourRect = (slot: number, top = GRID_Y, h = CHIP_H): { x: number; y: number; w: number; h: number } => {
  const w = (INNER - (GRID_COLS - 1) * 16) / GRID_COLS;
  return { x: M + (slot % GRID_COLS) * (w + 16), y: top + Math.floor(slot / GRID_COLS) * (h + 12), w, h };
};

const HAND_Y = 736;
const HAND_H = 100;
const FOOT_Y = 868;
const FOOT_H = 100;

export interface BayFace {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/** The shape chips as ghost buttons (the body draws them). Shared with the
 *  STORE's paint board, which lays them on its shelf row. */
export function shapeButtons(top = SHAPE_Y, h = SHAPE_H): PanelButton[] {
  return PAINT_KINDS.map((k, i) => ({ id: `pb:kind-${k}`, label: '', ghost: true, ...shapeRect(i, top, h) }));
}

/** Draw the shape chips (lit = the grid's shape). */
export function drawShapeChips(g: CanvasRenderingContext2D, hover: string | null, top = SHAPE_Y, h = SHAPE_H): void {
  PAINT_KINDS.forEach((k, i) => {
    const r = shapeRect(i, top, h);
    const lit = bayFaceState.kind === k;
    const hot = hover === `pb:kind-${k}`;
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, 16);
    g.fillStyle = lit ? KIT.accentFaint : hot ? KIT.plateHover : KIT.plate;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = lit ? KIT.accent : hot ? KIT.lineHover : KIT.line;
    g.stroke();
    const iconR = Math.min(24, h * 0.22);
    drawShapeIcon(g, k, r.x + r.w / 2, r.y + h * 0.38, iconR, lit ? KIT.accent : KIT.text);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(700, 22);
    g.fillStyle = lit || hot ? KIT.textHi : KIT.dim;
    g.fillText(KIND_LABEL[k], r.x + r.w / 2, r.y + h * 0.78);
  });
}

/** One colour chip. `mode` 'paint' shows counts and takes; 'store' shows
 *  price and buys. */
export function drawColourChip(
  g: CanvasRenderingContext2D,
  colour: number,
  r: { x: number; y: number; w: number; h: number },
  mode: 'paint' | 'store',
  hot: boolean,
): void {
  const kind = bayFaceState.kind;
  const owned = ownedCount(kind, colour);
  const price = unitPrice(kind, colour);
  const inHand = mode === 'paint' && bay.held?.kind === kind && bay.held.colour === colour;
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, 14);
  g.fillStyle = css(PAINT.colours[colour]);
  g.fill();
  // A colour you'd have to buy reads a shade back, so the ones you own pop.
  if (mode === 'paint' && owned === 0) {
    g.fillStyle = 'rgba(10,8,6,0.38)';
    g.fill();
  }
  g.lineWidth = inHand || hot ? 4 : 2;
  g.strokeStyle = inHand ? KIT.accent : hot ? '#ffffff' : 'rgba(255,255,255,0.18)';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // The name, small, on a band along the top — the rack speaks its colours.
  g.fillStyle = 'rgba(10,8,6,0.62)';
  g.beginPath();
  g.roundRect(r.x + 6, r.y + 6, r.w - 12, 26, 7);
  g.fill();
  g.fillStyle = '#fff';
  g.font = font(600, 16);
  g.fillText(PAINT.colourNames[colour] ?? '', r.x + r.w / 2, r.y + 20, r.w - 20);
  // The foot: what a tap does.
  const footY = r.y + r.h - 22;
  g.fillStyle = 'rgba(10,8,6,0.78)';
  g.beginPath();
  g.roundRect(r.x + 6, r.y + r.h - 38, r.w - 12, 32, 8);
  g.fill();
  g.font = font(700, 20);
  if (mode === 'paint' && owned > 0) {
    g.fillStyle = '#fff';
    g.fillText(`× ${owned}`, r.x + r.w / 2, footY);
  } else {
    g.fillStyle = canAfford(price) ? '#ffd98f' : 'rgba(255,255,255,0.4)';
    g.fillText(mode === 'store' && owned > 0 ? `$${price}  · ${owned} owned` : `$${price}`, r.x + r.w / 2, footY, r.w - 20);
  }
}

export function bayFace(): BayFace {
  const held = bay.held;
  const buttons: PanelButton[] = [...hubTabs('paint'), ...shapeButtons()];
  rackColours().forEach((c, slot) => buttons.push({ id: `pb:take-${c}`, label: '', ghost: true, ...colourRect(slot) }));

  // THE HAND: the held unit's verbs — or, empty-handed, UNDO.
  const bw = 84;
  if (held) {
    const x0 = M + 236;
    buttons.push(
      { id: 'pb:rot-', label: '↺', sub: 'turn', x: x0, y: HAND_Y, w: bw, h: HAND_H, px: 34 },
      { id: 'pb:rot+', label: '↻', sub: 'turn', x: x0 + 92, y: HAND_Y, w: bw, h: HAND_H, px: 34 },
      { id: 'pb:size-', label: '−', sub: 'smaller', x: x0 + 196, y: HAND_Y, w: bw, h: HAND_H, px: 38 },
      { id: 'pb:size+', label: '+', sub: 'bigger', x: x0 + 288, y: HAND_Y, w: bw, h: HAND_H, px: 38 },
    );
    if (held.kind === 'stripe') {
      buttons.push(
        { id: 'pb:wid-', label: 'THIN', sub: 'stroke', x: x0 + 392, y: HAND_Y, w: bw, h: HAND_H, small: true, px: 20 },
        { id: 'pb:wid+', label: 'THICK', sub: 'stroke', x: x0 + 484, y: HAND_Y, w: bw, h: HAND_H, small: true, px: 20 },
      );
    }
    buttons.push({ id: 'pb:return', label: 'BACK', sub: 'or press B', x: BAY_W - M - 104, y: HAND_Y, w: 104, h: HAND_H, small: true, tone: KIT.warn });
  } else {
    const n = myLook().paint.length;
    buttons.push({
      id: 'pb:undo',
      label: 'UNDO',
      sub: n ? 'last mark back · or press A' : 'nothing painted yet',
      x: M, y: HAND_Y, w: 300, h: HAND_H,
      small: true,
      disabled: n === 0,
    });
  }

  // THE TURN, the purse and CLOSE.
  buttons.push(
    { id: 'pb:turn-', label: '◂', x: M, y: FOOT_Y, w: 74, h: FOOT_H, px: 40 },
    {
      id: 'pb:turn',
      label: TURN_FACE[turnIndex()],
      sub: 'or spin with the stick',
      x: M + 80, y: FOOT_Y, w: 220, h: FOOT_H,
      display: true,
      small: true,
      tone: turnIndex() === 0 ? undefined : KIT.accent,
    },
    { id: 'pb:turn+', label: '▸', x: M + 306, y: FOOT_Y, w: 74, h: FOOT_H, px: 40 },
    { id: 'pb:wallet', label: `$ ${coins.balance}`, sub: 'iron-dollars', x: M + 400, y: FOOT_Y, w: 250, h: FOOT_H, display: true, small: true, tone: KIT.accent },
    { id: 'paintbay-close', label: 'CLOSE', x: BAY_W - M - 240, y: FOOT_Y, w: 240, h: FOOT_H, small: true },
  );

  const body = (g: CanvasRenderingContext2D, hover: string | null): void => {
    drawShapeChips(g, hover);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = font(600, 24);
    g.fillStyle = KIT.dim;
    g.fillText(`${KIND_LABEL[bayFaceState.kind]}S — tap a colour to paint with it`, M, 270);
    g.textAlign = 'right';
    g.fillStyle = KIT.faint;
    g.fillText('$ = buy one', BAY_W - M, 270);
    rackColours().forEach((c, slot) => drawColourChip(g, c, colourRect(slot), 'paint', hover === `pb:take-${c}`));

    // THE HAND.
    g.textAlign = 'left';
    if (held) {
      g.beginPath();
      g.roundRect(M, HAND_Y, 224, HAND_H, 16);
      g.fillStyle = KIT.accentFaint;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = KIT.accent;
      g.stroke();
      drawShapeIcon(g, held.kind, M + 52, HAND_Y + HAND_H / 2, 26, css(PAINT.colours[held.colour]), held.angle * Math.PI * 2);
      g.font = font(700, 20);
      g.fillStyle = KIT.accent;
      g.fillText('ON YOUR POINTER', M + 96, HAND_Y + 34, 124);
      g.font = font(600, 20);
      g.fillStyle = KIT.textHi;
      g.fillText(PAINT.colourNames[held.colour] ?? '', M + 96, HAND_Y + 62, 124);
      g.textAlign = 'center';
      g.font = font(500, 20);
      g.fillStyle = KIT.faint;
      g.fillText(
        held.kind === 'stripe'
          ? 'trigger places · stick turns & sizes · hold grip + stick for thickness'
          : 'trigger places · stick turns & sizes',
        BAY_W / 2,
        HAND_Y + HAND_H + 16,
      );
    } else {
      const n = myLook().paint.length;
      g.font = font(600, 24);
      g.fillStyle = KIT.text;
      g.fillText(`${n} / ${PAINT.maxUnits} marks placed`, M + 324, HAND_Y + 34);
      g.font = font(500, 20);
      g.fillStyle = KIT.faint;
      g.fillText('point at a mark + trigger to pick it back up', M + 324, HAND_Y + 70);
    }
  };

  return { title: HUB_TITLE, body, buttons };
}

/** Buy one unit of the grid's shape in `colour`. False if it can't be afforded. */
function buyOne(colour: number): boolean {
  const kind = bayFaceState.kind;
  const price = unitPrice(kind, colour);
  if (!canAfford(price) || !spendCoins(price)) return false;
  grantUnit(kind, colour);
  return true;
}

/** Nudge the held unit's pose from the panel (the stick's verbs, for
 *  anyone who'd rather press). */
function nudge(field: 'angle' | 'len' | 'wid', by: number): void {
  const h = bay.held;
  if (!h) return;
  if (field === 'angle') h.angle = (((h.angle + by) % 1) + 1) % 1;
  else h[field] = Math.max(0.03, Math.min(PAINT.maxSize, h[field] * by));
  bay.version += 1;
}

/** Route a pressed `pb:*` id. True when handled (bay-local). */
export function bayClick(id: string): boolean {
  const done = (): boolean => {
    bayFaceState.version += 1;
    return true;
  };
  if (id === 'pb:turn-') return stepTurn(-1), done();
  if (id === 'pb:turn+') return stepTurn(1), done();
  if (id === 'pb:turn' || id === 'pb:wallet') return true; // readouts, not buttons
  if (id.startsWith('pb:kind-')) {
    const k = id.slice(8) as PaintKind;
    if (PAINT_KINDS.includes(k)) bayFaceState.kind = k;
    return done();
  }
  if (id === 'pb:return') return handReturn(), done();
  if (id === 'pb:undo') return undoLast(), done();
  if (id === 'pb:rot-') return nudge('angle', -1 / 24), done();
  if (id === 'pb:rot+') return nudge('angle', 1 / 24), done();
  if (id === 'pb:size-') return nudge('len', 1 / 1.15), done();
  if (id === 'pb:size+') return nudge('len', 1.15), done();
  if (id === 'pb:wid-') return nudge('wid', 1 / 1.2), done();
  if (id === 'pb:wid+') return nudge('wid', 1.2), done();
  if (id.startsWith('pb:take-')) {
    // A colour you own goes on the pointer; one you don't is bought — one
    // unit — and goes on the pointer, in the same tap.
    const colour = Number(id.slice(8));
    const kind = bayFaceState.kind;
    if (ownedCount(kind, colour) > 0 || buyOne(colour)) handTake(kind, colour);
    return done();
  }
  if (id.startsWith('pb:buy-')) {
    buyOne(Number(id.slice(7)));
    return done();
  }
  return false;
}

/** Everything the paint faces repaint on — MenuSystem's freshness key. */
export function bayFaceKey(): string {
  return [bayFaceState.version, bayFaceState.kind, turnIndex(), bay.version, invState.version, paintState.version, coins.balance].join('|');
}
