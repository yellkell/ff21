/**
 * THE PAINT SECTION's model — where a blank takes its colour (docs/paint.md
 * §2). Its face is THE CUSTOMIZE PAGE's PAINT section (menu/customizePage.ts,
 * back from the Quest build): the shapes, the racks as one swatch grid, the
 * held unit's verbs, UNDO / RESET (two taps) and the turn. This module keeps
 * what the face reads and the local `pb:*` click routing:
 *
 *   THE COLOURS  a colour you own goes on your pointer; one you don't is
 *                bought — one unit — and goes on your pointer, in one tap.
 *   THE HAND     what's on your pointer: turn it, size it (a stripe's
 *                thickness too), send it back. With nothing held, UNDO takes
 *                the last mark back off the body and RESET takes every mark
 *                off (the second tap confirms).
 *   THE TURN     spin the blank to reach its back (the thumbstick spins it
 *                too — see MenuSystem).
 *
 * The BODY work happens off-panel: MenuSystem raycasts the mirror's paint
 * surfaces while PAINT is up — the held unit ghosts onto the body under the
 * ray, trigger commits it, the thumbstick twists and sizes it (grip switches
 * a stripe to thickness), pointing at a placed mark and squeezing lifts it
 * back into the hand, B sends the hand back, A undoes. The state ops live in
 * avatar/paint.ts. This is the ONLY place paint is sold.
 */

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
  stripAll,
  undoLast,
  unitPrice,
  PAINT_KINDS,
  type PaintKind,
} from '../avatar/paint.js';
import { canAfford, coins, spendCoins } from './wallet.js';

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
export const bayFaceState = { kind: 'stripe' as PaintKind, yaw: 0, version: 1, resetAt: -1 };

/** RESET is armed by its first tap, for as long as the paint on the body
 *  stays exactly as it was then: a mark placed, lifted or undone stands
 *  it down, as does any other tap on the face. */
export const resetArmed = (): boolean => bayFaceState.resetAt === paintState.version;

/** The eight faces, named for the side of the blank they put in front of you. */
const TURN_FACE = ['FRONT', 'FRONT L', 'LEFT', 'BACK L', 'BACK', 'BACK R', 'RIGHT', 'FRONT R'];

/** Which eighth the blank is nearest to facing. */
export function turnIndex(): number {
  const eighth = (Math.PI * 2) / 8;
  return ((Math.round(bayFaceState.yaw / eighth) % 8) + 8) % 8;
}

/** The side of the blank the turn puts in front of you (FRONT, BACK L…). */
export function turnLabel(): string {
  return TURN_FACE[turnIndex()];
}

/** Step the turn to the next eighth either way (snapping onto the grid). */
function stepTurn(dir: 1 | -1): void {
  const eighth = (Math.PI * 2) / 8;
  bayFaceState.yaw = (Math.round(bayFaceState.yaw / eighth) + dir) * eighth;
}

export const KIND_LABEL: Record<PaintKind, string> = { stripe: 'STRIPE', dot: 'DOT', square: 'SQUARE', triangle: 'TRIANGLE' };

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
  // RESET is two taps in a row: anything else in between stands it down.
  if (id === 'pb:reset') {
    if (resetArmed()) {
      bayFaceState.resetAt = -1;
      stripAll();
    } else if (myLook().paint.length) bayFaceState.resetAt = paintState.version;
    return done();
  }
  if (id.startsWith('pb:') && resetArmed()) {
    bayFaceState.resetAt = -1;
    bayFaceState.version += 1;
  }
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
  return false;
}

/** Everything the paint faces repaint on — MenuSystem's freshness key. */
export function bayFaceKey(): string {
  return [bayFaceState.version, bayFaceState.kind, turnIndex(), bay.version, invState.version, paintState.version, coins.balance].join('|');
}
