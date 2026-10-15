/**
 * THE BELT, IN NEON — a championship belt (campaign/belts.ts) painted the
 * way FIRE FIGHT FLUX drew its belts (fff ui/belt.ts): dark, see-through
 * glass with every edge a lit tube and a soft halo round it. Nothing else —
 * no rivets, beads or studs; the light is the detail.
 *
 *   the STRAP          a band of tinted glass, edged in the strap's neon, a
 *                      dashed stitch tube just inside its edge, a keeper loop
 *                      at the left end and the tip tapering off at the right.
 *   the SIDE PLATES    four, left to right: an oval and a cushion medallion
 *                      either side, glass framed in the plate neon with a
 *                      fainter inner ring, each carrying an emblem in light.
 *   the CENTRE PLATE   an octagon, a crest or a sunburst of glass, a double
 *                      tube rim, an inner field ringed in the strap's colour,
 *                      the belt's emblem over the stone; the STONE a bloom of
 *                      its colour round a cut outline; a ribbon with the
 *                      run's name and a plaque with the tier, both lit;
 *                      neon flames licking out behind a Hardcore belt.
 *
 * One painter feeds every belt on screen — the profile, the rack, the
 * launch card — and the 3D belt's textures (ui/beltModel.ts).
 *
 * Authored in BELT UNITS: 1000 across, centred on the origin, y down. Glow
 * is a canvas shadow, which is measured in pixels, not units — so every
 * paint runs at a known pixels-per-unit (`paintAt`).
 */

import { drawBossIcon } from '../campaign/icons.js';
import type { Belt, PlateShape } from '../campaign/belts.js';
import { font, onFontsReady } from './kit/fonts.js';

/** Belt height over width (centre plate and flames included). */
export const BELT_ASPECT = 0.58;

export const STRAP_HALF_W = 500;
export const STRAP_HALF_H = 62;
/** Where the tapered tip begins (right end). */
const TIP_X = 420;

/** The side plates, left to right (each wears `belt.sides[i]`'s emblem). */
export const SIDE_PLATES: ReadonlyArray<{ x: number; kind: 'stud' | 'medal' }> = [
  { x: -362, kind: 'stud' },
  { x: -240, kind: 'medal' },
  { x: 240, kind: 'medal' },
  { x: 362, kind: 'stud' },
];

/** Half-extents of each side plate. */
export const SIDE_SIZE = { medal: { rx: 66, ry: 82 }, stud: { rx: 44, ry: 54 } } as const;

/** Pixels per belt unit of the paint in progress (sizes the glow). */
let PX = 1;

/* ── colour ───────────────────────────────────────────────────────────── */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = (hex: string, a: number): string => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** The white-hot core of a tube in `hex`. */
const hot = (hex: string): string => {
  const [r, g, b] = rgb(hex);
  const w = (c: number): number => Math.round(c + (255 - c) * 0.55);
  return `rgb(${w(r)},${w(g)},${w(b)})`;
};

/* ── outlines (shared with the 3D model's glass slabs) ────────────────── */

/** Anything that takes a path: a canvas context, or a three.js Shape. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
}

/** The centre plate's outline, scaled by `k` about the origin. */
export function plateOutline(p: PathSink, shape: PlateShape, k = 1): void {
  if (shape === 'octagon') {
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const x = Math.cos(a) * 168 * k;
      const y = Math.sin(a) * 180 * k;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
  } else if (shape === 'crest') {
    // A heater shield with a twin-peaked top.
    p.moveTo(-162 * k, -138 * k);
    p.lineTo(-92 * k, -180 * k);
    p.lineTo(0, -150 * k);
    p.lineTo(92 * k, -180 * k);
    p.lineTo(162 * k, -138 * k);
    p.lineTo(166 * k, 34 * k);
    p.quadraticCurveTo(150 * k, 140 * k, 0, 200 * k);
    p.quadraticCurveTo(-150 * k, 140 * k, -166 * k, 34 * k);
  } else {
    // A sunburst: 24 rays, long and short by turns.
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const r = i % 2 === 0 ? (i % 4 === 0 ? 206 : 186) : 152;
      const x = Math.cos(a) * r * k;
      const y = Math.sin(a) * r * k;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
  }
}

/** The field inside the plate. */
function fieldOutline(p: PathSink, shape: PlateShape): void {
  if (shape === 'sun') ellipsePath(p, 0, 0, 128, 128);
  else plateOutline(p, shape, shape === 'crest' ? 0.78 : 0.8);
}

/** An ellipse as quadratic arcs (a Shape-friendly circle). */
function ellipsePath(p: PathSink, cx: number, cy: number, rx: number, ry: number): void {
  const n = 16;
  const c = 1 / Math.cos(Math.PI / n);
  p.moveTo(cx + rx, cy);
  for (let i = 0; i < n; i++) {
    const a1 = ((i + 1) * Math.PI * 2) / n;
    const am = a1 - Math.PI / n;
    p.quadraticCurveTo(cx + Math.cos(am) * rx * c, cy + Math.sin(am) * ry * c, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry);
  }
}

/** A side plate's outline: a cushion medallion, or an oval. */
export function sideOutline(p: PathSink, kind: 'medal' | 'stud', k = 1): void {
  const { rx, ry } = SIDE_SIZE[kind];
  if (kind === 'stud') {
    ellipsePath(p, 0, 0, rx * k, ry * k);
    return;
  }
  // A superellipse: squarer than an oval, softer than a box.
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** 0.6 * rx * k;
    const y = Math.sign(s) * Math.abs(s) ** 0.6 * ry * k;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
}

/** The strap's outline: a square left end, a tapered tip at the right. */
function strapOutline(g: CanvasRenderingContext2D, h = STRAP_HALF_H, inset = 0): void {
  g.beginPath();
  g.moveTo(-STRAP_HALF_W + inset, -h);
  g.lineTo(TIP_X, -h);
  g.quadraticCurveTo(STRAP_HALF_W - 22 - inset, -h * 0.85, STRAP_HALF_W - inset, 0);
  g.quadraticCurveTo(STRAP_HALF_W - 22 - inset, h * 0.85, TIP_X, h);
  g.lineTo(-STRAP_HALF_W + inset, h);
  g.closePath();
}

/* ── light ────────────────────────────────────────────────────────────── */

/** Stroke the current path as a neon tube: a halo, the tube, a hot core.
 *  `w` is the tube's width in belt units. */
function tube(g: CanvasRenderingContext2D, color: string, w: number, strength = 1): void {
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.shadowColor = rgba(color, 0.9 * strength);
  g.shadowBlur = w * 5 * PX;
  g.strokeStyle = rgba(color, strength);
  g.lineWidth = w;
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = rgba(color, 0.3 * strength);
  g.lineWidth = w * 2.6;
  g.stroke();
  g.strokeStyle = strength >= 0.8 ? hot(color) : rgba(color, strength);
  g.lineWidth = w * 0.45;
  g.stroke();
  g.restore();
}

/** Fill the current path with tinted dark glass, brighter at its ends. */
function glass(g: CanvasRenderingContext2D, color: string, x0: number, y0: number, x1: number, y1: number, tint = 0.1): void {
  g.fillStyle = 'rgba(4,8,20,0.5)';
  g.fill();
  const t = g.createLinearGradient(x0, y0, x1, y1);
  t.addColorStop(0, rgba(color, tint * 1.8));
  t.addColorStop(0.45, rgba(color, tint * 0.5));
  t.addColorStop(1, rgba(color, tint * 1.2));
  g.fillStyle = t;
  g.fill();
}

/** An emblem drawn in light. */
function emblem(g: CanvasRenderingContext2D, titan: number, x: number, y: number, r: number, color: string): void {
  g.save();
  g.shadowColor = rgba(color, 0.95);
  g.shadowBlur = r * 0.45 * PX;
  drawBossIcon(g, titan, x, y, r, color);
  g.restore();
  g.save();
  g.globalAlpha = 0.7;
  drawBossIcon(g, titan, x, y, r * 0.97, hot(color));
  g.restore();
}

/** Lit lettering. */
function neonText(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, maxW: number, spacing = 4): void {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, px);
  g.letterSpacing = `${spacing}px`;
  g.shadowColor = rgba(color, 0.95);
  g.shadowBlur = px * 0.5 * PX;
  g.fillStyle = color;
  g.fillText(text, x, y, maxW);
  g.shadowBlur = 0;
  g.fillStyle = hot(color);
  g.fillText(text, x, y, maxW);
  g.restore();
}

/* ── the strap ────────────────────────────────────────────────────────── */

/** The strap, alone (the 3D model's strap texture; the painting's base).
 *  Belt units: x −500…500, y −62…62 (the keeper reaches ±71). */
export function paintStrap(g: CanvasRenderingContext2D, belt: Belt): void {
  const H = STRAP_HALF_H;
  const c = belt.strap;
  strapOutline(g);
  glass(g, c, -500, 0, 500, 0, 0.12);
  tube(g, c, 4.5);

  // A dashed stitch tube just inside the edge, round the tip too.
  g.save();
  g.setLineDash([16, 12]);
  strapOutline(g, H - 15, 12);
  tube(g, c, 2.2, 0.55);
  g.restore();

  // The keeper: a loop of light round the strap at the left end.
  g.beginPath();
  g.roundRect(-450, -H - 9, 30, H * 2 + 18, 8);
  g.fillStyle = 'rgba(4,8,20,0.6)';
  g.fill();
  tube(g, c, 3.2);
}

/* ── the side plates ──────────────────────────────────────────────────── */

/** One side plate centred on the origin (belt units). */
export function paintSidePlate(g: CanvasRenderingContext2D, belt: Belt, kind: 'medal' | 'stud', titan: number): void {
  const { rx, ry } = SIDE_SIZE[kind];
  g.beginPath();
  sideOutline(g, kind);
  g.closePath();
  glass(g, belt.metal, -rx, -ry, rx, ry, 0.14);
  tube(g, belt.metal, 4);
  g.beginPath();
  sideOutline(g, kind, 0.8);
  g.closePath();
  tube(g, belt.strap, 1.8, 0.6);
  emblem(g, titan, 0, 0, kind === 'medal' ? 32 : 21, belt.metal);
}

/* ── the centre plate ─────────────────────────────────────────────────── */

/** Neon flames licking out from behind a Hardcore belt's plate. */
function flames(g: CanvasRenderingContext2D, big: boolean): void {
  const tongues = big ? 13 : 9;
  const reach = big ? 120 : 84;
  for (let i = 0; i < tongues; i++) {
    const t = i / (tongues - 1);
    const a = Math.PI * (1.08 + 0.84 * t); // the upper half, left to right
    const len = reach * (0.7 + 0.3 * Math.sin(i * 2.3) ** 2) * (1 - 0.25 * Math.abs(t - 0.5));
    const r0 = 150;
    const bx = Math.cos(a) * r0;
    const by = Math.sin(a) * r0;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const tongue = (scale: number, color: string, w: number): void => {
      const ex = bx + Math.cos(a) * len * scale;
      const ey = by + Math.sin(a) * len * scale;
      const lean = 16 * scale * (t < 0.5 ? -1 : 1);
      const half = 24 * scale;
      g.beginPath();
      g.moveTo(bx + nx * half, by + ny * half);
      g.quadraticCurveTo(bx + (ex - bx) * 0.6 + nx * half * 0.9, by + (ey - by) * 0.6 + ny * half * 0.9, ex + nx * lean, ey + ny * lean);
      g.quadraticCurveTo(bx + (ex - bx) * 0.5 - nx * half * 0.6, by + (ey - by) * 0.5 - ny * half * 0.6, bx - nx * half, by - ny * half);
      g.fillStyle = rgba(color, 0.12);
      g.fill();
      tube(g, color, w, 0.9);
    };
    tongue(1, '#ff3a1a', 3.2);
    tongue(0.55, '#ffc23a', 2.2);
  }
}

/** A cut stone in light: a bloom of its colour, the girdle, the table, and
 *  the facet lines between them. */
function stone(g: CanvasRenderingContext2D, belt: Belt, x: number, y: number, r: number): void {
  const bloom = g.createRadialGradient(x, y, 0, x, y, r * 2.1);
  bloom.addColorStop(0, rgba(belt.gem, 0.7));
  bloom.addColorStop(0.35, rgba(belt.gem, 0.28));
  bloom.addColorStop(1, rgba(belt.gem, 0));
  g.fillStyle = bloom;
  g.beginPath();
  g.arc(x, y, r * 2.1, 0, Math.PI * 2);
  g.fill();
  const n = 8;
  const pt = (k: number, rr: number): [number, number] => {
    const a = -Math.PI / 2 + Math.PI / n + (k * Math.PI * 2) / n;
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
  };
  const ring = (rr: number): void => {
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const [px, py] = pt(k, rr);
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  };
  ring(r);
  g.fillStyle = rgba(belt.gem, 0.3);
  g.fill();
  tube(g, belt.gem, 3.4);
  ring(r * 0.5);
  tube(g, belt.gem, 2, 0.8);
  g.beginPath();
  for (let k = 0; k < n; k++) {
    const [ax, ay] = pt(k, r);
    const [bx, by] = pt(k, r * 0.5);
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
  }
  tube(g, belt.gem, 1.2, 0.6);
}

/** A ribbon banner with folded tails, its word lit on it. */
function ribbon(g: CanvasRenderingContext2D, belt: Belt, y: number): void {
  const w = 156;
  const h = 24;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(sx * (w - 4), y - h + 10);
    g.lineTo(sx * (w + 34), y - h + 14);
    g.lineTo(sx * (w + 20), y + 4);
    g.lineTo(sx * (w + 36), y + h + 6);
    g.lineTo(sx * (w - 4), y + h + 2);
    glass(g, belt.strap, 0, y - h, 0, y + h, 0.14);
    tube(g, belt.strap, 2.4, 0.75);
  }
  g.beginPath();
  g.moveTo(-w, y - h + 6);
  g.quadraticCurveTo(0, y - h - 8, w, y - h + 6);
  g.lineTo(w, y + h + 2);
  g.quadraticCurveTo(0, y + h - 12, -w, y + h + 2);
  g.closePath();
  g.fillStyle = 'rgba(4,8,20,0.8)';
  g.fill();
  tube(g, belt.strap, 3);
  neonText(g, belt.ribbon, 0, y - 1, 30, belt.strap, w * 1.8);
}

/** The centre plate, centred on the origin (belt units, ±206; ±270 with
 *  flames). */
export function paintCenterPlate(g: CanvasRenderingContext2D, belt: Belt): void {
  const shape = belt.plate;
  if (belt.flames) flames(g, belt.tier === 'blazing');

  // The glass body and its double rim.
  g.beginPath();
  plateOutline(g, shape);
  g.closePath();
  glass(g, belt.metal, -200, -200, 200, 200, 0.12);
  tube(g, belt.metal, 5.5);
  g.beginPath();
  plateOutline(g, shape, 0.92);
  g.closePath();
  tube(g, belt.metal, 2.2, 0.65);
  if (shape === 'sun') {
    // Each ray's spine.
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 24;
      const r = i % 2 === 0 ? 184 : 166;
      g.moveTo(Math.cos(a) * 140, Math.sin(a) * 140);
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    tube(g, belt.metal, 1.6, 0.5);
  }

  // The field, ringed in the strap's colour.
  g.beginPath();
  fieldOutline(g, shape);
  g.closePath();
  g.fillStyle = 'rgba(2,4,12,0.45)';
  g.fill();
  tube(g, belt.strap, 2.6, 0.85);

  emblem(g, belt.emblem, 0, -80, 34, belt.metal);
  stone(g, belt, 0, 4, 40);
  ribbon(g, belt, 88);

  // The plaque: the tier (or the title), lit.
  const py = shape === 'crest' ? 140 : 134;
  g.beginPath();
  g.roundRect(-66, py - 16, 132, 32, 8);
  g.fillStyle = 'rgba(4,8,20,0.8)';
  g.fill();
  tube(g, belt.metal, 2.4, 0.85);
  neonText(g, belt.plaque, 0, py + 1, 19, belt.metal, 120, 3);
}

/* ── the whole belt ───────────────────────────────────────────────────── */

export interface BeltDrawOpts {
  /** Not won yet: a dim, colourless ghost of itself. */
  ghost?: boolean;
}

/** The whole belt, `width` px across, centred on (cx, cy). */
export function drawBelt(g: CanvasRenderingContext2D, belt: Belt, cx: number, cy: number, width: number, opts: BeltDrawOpts = {}): void {
  const img = beltImage(belt, Math.round(width), !!opts.ghost);
  g.drawImage(img, cx - img.width / 2, cy - img.height / 2);
}

/** Run `paint` at `px` pixels per belt unit (the glow is sized off it). */
export function paintAt(px: number, paint: () => void): void {
  const was = PX;
  PX = px;
  try {
    paint();
  } finally {
    PX = was;
  }
}

/** The strap with the plates' footprints cut out of it, so the glass plates
 *  laid over it don't show its tubes through them. */
export function paintStrapUnderPlates(g: CanvasRenderingContext2D, belt: Belt): void {
  paintStrap(g, belt);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  for (const p of SIDE_PLATES) {
    g.save();
    g.translate(p.x, 0);
    g.beginPath();
    sideOutline(g, p.kind);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.beginPath();
  plateOutline(g, belt.plate);
  g.closePath();
  g.fill();
  g.restore();
}

/** Paint the whole belt in belt units (caller has translated + scaled). */
function paintBelt(g: CanvasRenderingContext2D, belt: Belt): void {
  paintStrapUnderPlates(g, belt);
  SIDE_PLATES.forEach((p, i) => {
    g.save();
    g.translate(p.x, 0);
    paintSidePlate(g, belt, p.kind, belt.sides[i]);
    g.restore();
  });
  paintCenterPlate(g, belt);
}

/** Painted belts, cached by belt, width and ghostliness: a panel repaints on
 *  every hover. */
const cache = new Map<string, HTMLCanvasElement>();
// Lettering painted before the kit font landed would stay in the fallback.
onFontsReady(() => cache.clear());

export function beltImage(belt: Belt, width: number, ghost = false): HTMLCanvasElement {
  const w = Math.max(16, Math.round(width));
  const key = `${belt.id}|${w}|${ghost ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round(w * BELT_ASPECT);
  const g = c.getContext('2d')!;
  const s = w / 1000;
  g.translate(w / 2, c.height / 2);
  g.scale(s, s);
  // An unwon belt: the same tubes, unlit — grey glass, a faint outline.
  if (ghost) g.filter = 'grayscale(1) brightness(0.8)';
  paintAt(s, () => paintBelt(g, belt));
  if (ghost) {
    g.filter = 'none';
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
  }
  if (cache.size > 96) cache.clear();
  cache.set(key, c);
  return c;
}
