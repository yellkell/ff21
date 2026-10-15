/**
 * Shared helper for drawing the neon signs (ui/signArt.ts — the countdown
 * 3/2/1/FIGHT and the KO/WIN/TIME/DRAW verdicts) at a consistent VISIBLE
 * size. Each sign sits in a padded canvas (room for its bloom), so the
 * painter registers the box its word actually occupies and the hosts size
 * by THAT — not the padded frame — so a sign reads the same whatever
 * canvas it lands on (the match scoreboard, the arena countdown, the
 * campaign HUD, the pub ring).
 */

export interface ContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const contentBoxes = new WeakMap<HTMLCanvasElement, ContentBox>();

/** Record the visible box of a painted plate (the painter knows it; nobody
 *  has to read pixels back to find it). */
export function registerContentBox(plate: HTMLCanvasElement, box: ContentBox): void {
  contentBoxes.set(plate, box);
}

/** The visible box of a plate — the whole canvas if none was registered. */
export function contentBox(plate: HTMLCanvasElement): ContentBox {
  return contentBoxes.get(plate) ?? { x: 0, y: 0, w: plate.width, h: plate.height };
}

/**
 * Draw a plate centred on a `cw`×`ch` canvas, sized so its VISIBLE content
 * (not the padded frame) is `targetH` tall — but never larger than the
 * canvas' safe area (`margin` inset), so the whole word always stays on screen.
 */
export function drawContentPlate(
  ctx: CanvasRenderingContext2D,
  plate: HTMLCanvasElement,
  cw: number,
  ch: number,
  targetH: number,
  margin: number,
): void {
  const box = contentBox(plate);
  let scale = targetH / box.h;
  const maxW = cw - 2 * margin;
  const maxH = ch - 2 * margin;
  if (box.w * scale > maxW) scale = maxW / box.w;
  if (box.h * scale > maxH) scale = maxH / box.h;
  const bx = (box.x + box.w / 2) * scale;
  const by = (box.y + box.h / 2) * scale;
  ctx.drawImage(plate, cw / 2 - bx, ch / 2 - by, plate.width * scale, plate.height * scale);
}
