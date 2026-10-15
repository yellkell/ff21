/**
 * THE BELT, PAINTED — a championship belt (campaign/belts.ts) drawn in
 * detail on a 2D canvas. One painter feeds everything that shows a belt: the
 * profile's badge, the rack on the campaign panel, the launch card, and the
 * textures of the 3D belt (ui/beltModel.ts) — so they all match.
 *
 *   the STRAP          tooled leather: a pressed diamond-and-scroll pattern
 *                      between two burnished grooves, saddle stitching along
 *                      both edges, darkening toward the ends as it wraps;
 *                      snaps and a stitched keeper at the left end, a tapered
 *                      tip with eyelets at the right.
 *   the SIDE PLATES    four, I–IV left to right: an oval stud and a beaded
 *                      medallion either side, each with an enamel field and
 *                      a titan's emblem struck into it (CHROMEHOOK,
 *                      PISTONKAISER, VULTURE, JUGGERNAUT), rivets at the rim.
 *   the CENTRE PLATE   V, the king: GOLIATH's crown over the stone. An
 *                      octagon (Normal), a crest (Hard) or a sunburst
 *                      (Blazing) in polished, banded metal; a bevelled rim
 *                      and a beaded ring; an engine-turned enamel field; a
 *                      laurel; the faceted centre stone in its prong setting;
 *                      corner stones; the run's name on a ribbon and the tier
 *                      on a plaque; flames behind it on a Hardcore belt.
 *
 * Everything is authored in BELT UNITS: the belt is 1000 across, centred on
 * the origin, y down; `drawBelt` scales it to any width. Small sizes skip
 * the lettering and the finest tooling (there's nothing to read at 100 px).
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

/* ── colour helpers ───────────────────────────────────────────────────── */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix two #rrggbb colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `rgb(${c(ar, br)},${c(ag, bg)},${c(ab, bb)})`;
}

const rgba = (hex: string, a: number): string => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/* ── outlines (shared with the 3D model's extrusions) ─────────────────── */

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

/** The enamel field inside the plate. */
function enamelOutline(p: PathSink, shape: PlateShape): void {
  if (shape === 'sun') {
    ellipsePath(p, 0, 0, 128, 128);
    return;
  }
  plateOutline(p, shape, shape === 'crest' ? 0.78 : 0.8);
}

/** An ellipse as quadratic arcs (a Shape-friendly circle). */
function ellipsePath(p: PathSink, cx: number, cy: number, rx: number, ry: number): void {
  const n = 16;
  p.moveTo(cx + rx, cy);
  for (let i = 0; i < n; i++) {
    const a0 = (i * Math.PI * 2) / n;
    const a1 = ((i + 1) * Math.PI * 2) / n;
    const am = (a0 + a1) / 2;
    const c = 1 / Math.cos(Math.PI / n);
    p.quadraticCurveTo(cx + Math.cos(am) * rx * c, cy + Math.sin(am) * ry * c, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry);
  }
}

/** A side plate's outline: a cushion-cornered medallion, or an oval stud. */
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
function strapOutline(g: CanvasRenderingContext2D): void {
  const H = STRAP_HALF_H;
  g.beginPath();
  g.moveTo(-STRAP_HALF_W + 10, -H);
  g.lineTo(TIP_X, -H);
  g.quadraticCurveTo(STRAP_HALF_W - 20, -H * 0.9, STRAP_HALF_W, 0);
  g.quadraticCurveTo(STRAP_HALF_W - 20, H * 0.9, TIP_X, H);
  g.lineTo(-STRAP_HALF_W + 10, H);
  g.quadraticCurveTo(-STRAP_HALF_W, H, -STRAP_HALF_W, H - 10);
  g.lineTo(-STRAP_HALF_W, -H + 10);
  g.quadraticCurveTo(-STRAP_HALF_W, -H, -STRAP_HALF_W + 10, -H);
  g.closePath();
}

/* ── metal ────────────────────────────────────────────────────────────── */

/** Polished metal: banded light across a diagonal, like a lit plate. */
function metalFill(g: CanvasRenderingContext2D, belt: Belt, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const { hi, mid, lo } = belt.metal;
  const m = g.createLinearGradient(x0, y0, x1, y1);
  m.addColorStop(0, hi);
  m.addColorStop(0.18, mid);
  m.addColorStop(0.42, mix(mid, lo, 0.55));
  m.addColorStop(0.5, hi);
  m.addColorStop(0.62, mid);
  m.addColorStop(0.85, mix(mid, lo, 0.4));
  m.addColorStop(1, lo);
  return m;
}

/** A sweep of light across whatever's clipped. */
function sheen(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a = 0.22): void {
  const s = g.createLinearGradient(x, y, x + w, y + h);
  s.addColorStop(0.3, 'rgba(255,255,255,0)');
  s.addColorStop(0.42, `rgba(255,255,255,${a})`);
  s.addColorStop(0.5, `rgba(255,255,255,${a * 0.3})`);
  s.addColorStop(0.56, `rgba(255,255,255,${a * 0.7})`);
  s.addColorStop(0.66, 'rgba(255,255,255,0)');
  g.fillStyle = s;
  g.fillRect(x, y, w, h);
}

/** A domed rivet or snap. */
function rivet(g: CanvasRenderingContext2D, belt: Belt, x: number, y: number, r: number): void {
  const d = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  d.addColorStop(0, belt.metal.hi);
  d.addColorStop(0.55, belt.metal.mid);
  d.addColorStop(1, belt.metal.lo);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.arc(x + r * 0.15, y + r * 0.25, r * 1.05, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = d;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** A cut stone: crown facets round a table, a prong setting, a glint. */
function gemstone(g: CanvasRenderingContext2D, belt: Belt, x: number, y: number, r: number, detail: boolean): void {
  const { core, glow } = belt.gem;
  // The setting: a collar of metal and its prongs.
  g.save();
  g.shadowColor = rgba(glow, 0.9);
  g.shadowBlur = r * 0.9;
  g.fillStyle = belt.metal.mid;
  g.beginPath();
  g.arc(x, y, r * 1.18, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.lineWidth = r * 0.08;
  g.strokeStyle = belt.metal.lo;
  g.stroke();
  // The stone itself.
  const n = 8;
  const pt = (k: number, rr: number): [number, number] => {
    const a = -Math.PI / 2 + Math.PI / n + (k * Math.PI * 2) / n;
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
  };
  const base = g.createRadialGradient(x - r * 0.2, y - r * 0.3, r * 0.1, x, y, r);
  base.addColorStop(0, mix(glow, '#ffffff', 0.5));
  base.addColorStop(0.45, core);
  base.addColorStop(1, mix(core, '#000000', 0.6));
  g.fillStyle = base;
  g.beginPath();
  for (let k = 0; k < n; k++) {
    const [px, py] = pt(k, r);
    if (k === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  if (detail) {
    // Crown facets between the girdle and the table, light and dark by turns.
    for (let k = 0; k < n; k++) {
      const [ax, ay] = pt(k, r);
      const [bx, by] = pt(k + 1, r);
      const [cx, cy] = pt(k + 1, r * 0.5);
      const [dx, dy] = pt(k, r * 0.5);
      g.fillStyle = k % 2 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
      if (k === 6 || k === 7) g.fillStyle = 'rgba(255,255,255,0.36)';
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.lineTo(cx, cy);
      g.lineTo(dx, dy);
      g.closePath();
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const [px, py] = pt(k, r * 0.5);
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    // Prongs.
    for (let k = 0; k < 4; k++) {
      const [px, py] = pt(k * 2, r * 1.06);
      rivet(g, belt, px, py, r * 0.13);
    }
  }
  // The glint.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  const gx = x - r * 0.32;
  const gy = y - r * 0.36;
  const s = r * 0.32;
  g.beginPath();
  g.moveTo(gx, gy - s);
  g.quadraticCurveTo(gx, gy, gx + s, gy);
  g.quadraticCurveTo(gx, gy, gx, gy + s);
  g.quadraticCurveTo(gx, gy, gx - s, gy);
  g.quadraticCurveTo(gx, gy, gx, gy - s);
  g.fill();
}

/** A struck emblem: its shadow pressed into the enamel, the metal on top. */
function emblem(g: CanvasRenderingContext2D, belt: Belt, titan: number, x: number, y: number, r: number): void {
  drawBossIcon(g, titan, x + r * 0.06, y + r * 0.08, r, 'rgba(0,0,0,0.65)');
  drawBossIcon(g, titan, x, y, r, belt.metal.mid);
  g.save();
  g.beginPath();
  g.rect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 1.1);
  g.clip();
  drawBossIcon(g, titan, x, y, r, rgba(belt.metal.hi, 0.75));
  g.restore();
}

/* ── the strap ────────────────────────────────────────────────────────── */

/** The strap, alone (the 3D model's leather texture; the painting's base).
 *  Belt units: x −500…500, y −62…62. */
export function paintStrap(g: CanvasRenderingContext2D, belt: Belt, detail = true): void {
  const H = STRAP_HALF_H;
  const { face, edge, tool, thread } = belt.strap;

  // The leather: lit along its top edge, rolled away at the bottom.
  strapOutline(g);
  const v = g.createLinearGradient(0, -H, 0, H);
  v.addColorStop(0, edge);
  v.addColorStop(0.1, mix(face, '#ffffff', 0.08));
  v.addColorStop(0.5, face);
  v.addColorStop(0.9, mix(face, edge, 0.5));
  v.addColorStop(1, edge);
  g.fillStyle = v;
  g.fill();

  g.save();
  strapOutline(g);
  g.clip();

  // Grain: a scatter of faint pores, the same every time.
  if (detail) {
    let seed = 1;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 700; i++) g.fillRect(-500 + rnd() * 1000, -H + rnd() * H * 2, 2, 1.4);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 400; i++) g.fillRect(-500 + rnd() * 1000, -H + rnd() * H * 2, 1.6, 1.2);
  }

  // Two burnished grooves, each a dark cut with a lit lip under it.
  for (const y of [-42, 42]) {
    g.fillStyle = rgba(edge, 0.9);
    g.fillRect(-490, y - 1.5, TIP_X + 480, 3);
    g.fillStyle = rgba(tool, 0.7);
    g.fillRect(-490, y + 1.5, TIP_X + 480, 1.5);
  }

  // The tooling between them: a chain of diamonds, each with a scroll curl
  // either side and a punched dot at its heart.
  const pitch = 54;
  for (let x = -462; x < TIP_X - 20; x += pitch) {
    const cx = x + pitch / 2;
    const tooled = (dx: number, dy: number, col: string, lw: number): void => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(cx - 20 + dx, dy);
      g.lineTo(cx + dx, -28 + dy);
      g.lineTo(cx + 20 + dx, dy);
      g.lineTo(cx + dx, 28 + dy);
      g.closePath();
      g.stroke();
      if (detail) {
        g.beginPath();
        g.arc(cx - 27 + dx, -18 + dy, 7, Math.PI * 0.2, Math.PI * 1.6);
        g.stroke();
        g.beginPath();
        g.arc(cx - 27 + dx, 18 + dy, 7, -Math.PI * 1.6, -Math.PI * 0.2);
        g.stroke();
      }
    };
    tooled(1.5, 1.5, rgba(tool, 0.55), 2.5);
    tooled(0, 0, rgba(edge, 0.85), 3);
    g.fillStyle = rgba(edge, 0.9);
    g.beginPath();
    g.arc(cx, 0, 3.5, 0, Math.PI * 2);
    g.fill();
  }

  // Wrapped: the ends turn away from the light.
  const wrap = g.createLinearGradient(-500, 0, 500, 0);
  wrap.addColorStop(0, 'rgba(0,0,0,0.5)');
  wrap.addColorStop(0.25, 'rgba(0,0,0,0)');
  wrap.addColorStop(0.75, 'rgba(0,0,0,0)');
  wrap.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = wrap;
  g.fillRect(-500, -H, 1000, H * 2);
  g.restore();

  // Saddle stitching along both edges (and round the tip).
  const stitch = (x0: number, y0: number, x1: number, y1: number): void => {
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(x0 + 1, y0 + 1.6);
    g.lineTo(x1 + 1, y1 + 1.6);
    g.stroke();
    g.strokeStyle = thread;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const step = detail ? 13 : 26;
  for (let x = -488; x < TIP_X - 6; x += step) {
    stitch(x, -53, x + step * 0.6, -53);
    stitch(x, 53, x + step * 0.6, 53);
  }

  // The rim.
  strapOutline(g);
  g.lineWidth = 4;
  g.strokeStyle = edge;
  g.stroke();

  // The tip: brass eyelets punched through it.
  for (const x of [TIP_X + 22, TIP_X + 50]) {
    g.fillStyle = belt.metal.mid;
    g.beginPath();
    g.arc(x, 0, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#050403';
    g.beginPath();
    g.arc(x, 0, 5, 0, Math.PI * 2);
    g.fill();
  }

  // The left end: two snaps and a stitched keeper.
  rivet(g, belt, -474, -22, 10);
  rivet(g, belt, -474, 22, 10);
  const kx = -432;
  g.fillStyle = mix(face, edge, 0.4);
  g.beginPath();
  g.roundRect(kx - 14, -H - 8, 28, H * 2 + 16, 6);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = edge;
  g.stroke();
  if (detail) {
    g.setLineDash([5, 5]);
    g.strokeStyle = thread;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(kx - 8, -H - 2);
    g.lineTo(kx - 8, H + 2);
    g.moveTo(kx + 8, -H - 2);
    g.lineTo(kx + 8, H + 2);
    g.stroke();
    g.setLineDash([]);
  }
}

/* ── the side plates ──────────────────────────────────────────────────── */

/** One side plate centred on the origin (belt units). */
export function paintSidePlate(g: CanvasRenderingContext2D, belt: Belt, kind: 'medal' | 'stud', titan: number, detail = true): void {
  const { rx, ry } = SIDE_SIZE[kind];

  // Seated in the leather: a shadow under it, then the polished body.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 12;
  g.shadowOffsetY = 5;
  g.beginPath();
  sideOutline(g, kind);
  g.closePath();
  g.fillStyle = metalFill(g, belt, -rx, -ry, rx, ry);
  g.fill();
  g.restore();
  g.lineWidth = 4;
  g.strokeStyle = belt.metal.lo;
  g.stroke();
  // The bevel's lit inner lip.
  g.beginPath();
  sideOutline(g, kind, 0.9);
  g.closePath();
  g.lineWidth = 2.5;
  g.strokeStyle = rgba(belt.metal.hi, 0.85);
  g.stroke();

  // The enamel field.
  const ek = kind === 'medal' ? 0.72 : 0.7;
  g.beginPath();
  sideOutline(g, kind, ek);
  g.closePath();
  const e = g.createRadialGradient(-rx * 0.2, -ry * 0.25, 2, 0, 0, Math.max(rx, ry) * ek);
  e.addColorStop(0, mix(belt.enamel.face, '#ffffff', 0.12));
  e.addColorStop(0.6, belt.enamel.face);
  e.addColorStop(1, belt.enamel.deep);
  g.fillStyle = e;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = belt.metal.lo;
  g.stroke();

  if (detail) {
    // Engine turning: fine rings struck into the enamel.
    g.save();
    g.beginPath();
    sideOutline(g, kind, ek);
    g.closePath();
    g.clip();
    g.strokeStyle = rgba(belt.metal.hi, 0.08);
    g.lineWidth = 1.2;
    for (let r = 6; r < Math.max(rx, ry); r += 6) {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  // A ring of beads round the medallion's rim.
  if (kind === 'medal' && detail) {
    for (let i = 0; i < 22; i++) {
      const a = (i * Math.PI * 2) / 22;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** 0.6 * rx * 0.81;
      const y = Math.sign(s) * Math.abs(s) ** 0.6 * ry * 0.81;
      rivet(g, belt, x, y, 3);
    }
  }

  emblem(g, belt, titan, 0, 0, kind === 'medal' ? 34 : 22);

  // Rivets holding it to the strap.
  if (kind === 'medal') {
    for (const [x, y] of [[-rx * 0.78, -ry * 0.78], [rx * 0.78, -ry * 0.78], [-rx * 0.78, ry * 0.78], [rx * 0.78, ry * 0.78]]) rivet(g, belt, x, y, 5.5);
  } else {
    rivet(g, belt, 0, -ry * 0.84, 4.5);
    rivet(g, belt, 0, ry * 0.84, 4.5);
  }

  // The light catching it.
  g.save();
  g.beginPath();
  sideOutline(g, kind);
  g.closePath();
  g.clip();
  sheen(g, -rx, -ry, rx * 2, ry * 2, 0.28);
  g.restore();
}

/* ── the centre plate ─────────────────────────────────────────────────── */

/** Flames licking out from behind a Hardcore belt's plate. */
function flames(g: CanvasRenderingContext2D, belt: Belt, big: boolean): void {
  const tongues = big ? 13 : 9;
  const reach = big ? 120 : 82;
  for (let i = 0; i < tongues; i++) {
    const t = i / (tongues - 1);
    const a = Math.PI * (1.08 + 0.84 * t); // the upper half, left to right
    const len = reach * (0.7 + 0.3 * Math.sin(i * 2.3) ** 2) * (1 - 0.25 * Math.abs(t - 0.5));
    const r0 = 150;
    const bx = Math.cos(a) * r0;
    const by = Math.sin(a) * r0;
    const tx = Math.cos(a) * (r0 + len);
    const ty = Math.sin(a) * (r0 + len);
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const w = 26;
    const tongue = (scale: number, color: string | CanvasGradient): void => {
      const ex = bx + (tx - bx) * scale;
      const ey = by + (ty - by) * scale;
      const lean = 14 * scale * (t < 0.5 ? -1 : 1);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(bx + nx * w * scale, by + ny * w * scale);
      g.quadraticCurveTo(bx + (ex - bx) * 0.6 + nx * w * 0.9 * scale, by + (ey - by) * 0.6 + ny * w * 0.9 * scale, ex + nx * lean, ey + ny * lean);
      g.quadraticCurveTo(bx + (ex - bx) * 0.5 - nx * w * 0.6 * scale, by + (ey - by) * 0.5 - ny * w * 0.6 * scale, bx - nx * w * scale, by - ny * w * scale);
      g.closePath();
      g.fill();
    };
    const f = g.createLinearGradient(bx, by, tx, ty);
    f.addColorStop(0, '#fff3a0');
    f.addColorStop(0.35, '#ffae1a');
    f.addColorStop(0.75, belt.tier === 'blazing' ? '#ff2a00' : '#e81e10');
    f.addColorStop(1, 'rgba(160,0,0,0)');
    tongue(1, f);
    tongue(0.55, 'rgba(255,240,170,0.55)');
  }
}

/** Corner stones per plate shape. */
const STONES: Record<PlateShape, Array<[number, number]>> = {
  octagon: [[-118, -124], [118, -124], [-118, 124], [118, 124]],
  crest: [[-124, -118], [124, -118], [-128, 46], [128, 46]],
  sun: [[-104, -104], [104, -104], [-104, 104], [104, 104]],
};

/** A laurel branch up one side of the field (sx = −1 left, 1 right). */
function laurel(g: CanvasRenderingContext2D, belt: Belt, sx: number): void {
  const leaves = 9;
  for (let i = 0; i < leaves; i++) {
    const t = i / (leaves - 1);
    const a = Math.PI / 2 + sx * (0.35 + t * 1.55); // from the bottom up the side
    const r = 100;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r + 6;
    g.save();
    g.translate(x, y);
    // Along the branch, tipped outward from it.
    g.rotate(a + (sx > 0 ? 0.55 : -0.55));
    const lg = g.createLinearGradient(-6, 0, 6, 0);
    lg.addColorStop(0, belt.metal.hi);
    lg.addColorStop(1, belt.metal.lo);
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(0, 0, 6, 15 - t * 3, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(belt.metal.lo, 0.8);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(0, 12);
    g.stroke();
    g.restore();
  }
}

/** A ribbon banner with folded tails, and its word struck into it. */
function ribbon(g: CanvasRenderingContext2D, belt: Belt, y: number, word: string, detail: boolean): void {
  const w = 156;
  const h = 24;
  const tail = (sx: number): void => {
    g.fillStyle = mix(belt.strap.face, '#000000', 0.45);
    g.beginPath();
    g.moveTo(sx * (w - 6), y - h + 8);
    g.lineTo(sx * (w + 34), y - h + 14);
    g.lineTo(sx * (w + 20), y + 4);
    g.lineTo(sx * (w + 36), y + h + 6);
    g.lineTo(sx * (w - 6), y + h + 2);
    g.closePath();
    g.fill();
    g.strokeStyle = belt.metal.mid;
    g.lineWidth = 2;
    g.stroke();
  };
  tail(-1);
  tail(1);
  const r = g.createLinearGradient(0, y - h, 0, y + h);
  r.addColorStop(0, mix(belt.strap.face, '#ffffff', 0.25));
  r.addColorStop(0.5, belt.strap.face);
  r.addColorStop(1, mix(belt.strap.face, '#000000', 0.35));
  g.fillStyle = r;
  g.beginPath();
  g.moveTo(-w, y - h + 6);
  g.quadraticCurveTo(0, y - h - 8, w, y - h + 6);
  g.lineTo(w, y + h + 2);
  g.quadraticCurveTo(0, y + h - 12, -w, y + h + 2);
  g.closePath();
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = belt.metal.mid;
  g.stroke();
  if (!detail) return;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, 34);
  g.letterSpacing = '5px';
  // Struck in bright metal on a dark ribbon; in dark metal on a pale one.
  const [r0, g0, b0] = rgb(belt.strap.face);
  const pale = 0.299 * r0 + 0.587 * g0 + 0.114 * b0 > 150;
  g.fillStyle = pale ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
  g.fillText(word, 2, y + 1, w * 1.8);
  g.fillStyle = pale ? belt.metal.lo : belt.metal.hi;
  g.fillText(word, 0, y - 1, w * 1.8);
  g.restore();
}

/** The centre plate, centred on the origin (belt units, ±206). */
export function paintCenterPlate(g: CanvasRenderingContext2D, belt: Belt, detail = true): void {
  const shape = belt.plate;
  if (belt.flames) flames(g, belt, belt.tier === 'blazing');

  // The body: a drop shadow onto the strap, banded polish, a bevelled rim.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.65)';
  g.shadowBlur = 22;
  g.shadowOffsetY = 9;
  g.beginPath();
  plateOutline(g, shape);
  g.closePath();
  g.fillStyle = metalFill(g, belt, -200, -200, 200, 200);
  g.fill();
  g.restore();
  g.lineWidth = 6;
  g.strokeStyle = belt.metal.lo;
  g.stroke();
  g.beginPath();
  plateOutline(g, shape, 0.94);
  g.closePath();
  g.lineWidth = 3;
  g.strokeStyle = rgba(belt.metal.hi, 0.9);
  g.stroke();
  if (shape === 'sun' && detail) {
    // Each ray gets a crease down its spine.
    g.strokeStyle = rgba(belt.metal.lo, 0.6);
    g.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 24;
      const r = i % 2 === 0 ? 196 : 176;
      g.beginPath();
      g.moveTo(Math.cos(a) * 136, Math.sin(a) * 136);
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      g.stroke();
    }
  }

  // A beaded ring just outside the field.
  if (detail) {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n;
      const rx = shape === 'crest' ? 138 : 142;
      const ry = shape === 'crest' ? 150 : shape === 'octagon' ? 152 : 142;
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry + (shape === 'crest' ? 8 : 0);
      if (shape === 'crest' && y < -128) continue; // under the peaks
      rivet(g, belt, x, y, 3.4);
    }
  }

  // The enamel field, engine-turned.
  g.beginPath();
  enamelOutline(g, shape);
  g.closePath();
  const e = g.createRadialGradient(-30, -40, 10, 0, 0, 150);
  e.addColorStop(0, mix(belt.enamel.face, '#ffffff', 0.1));
  e.addColorStop(0.55, belt.enamel.face);
  e.addColorStop(1, belt.enamel.deep);
  g.fillStyle = e;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = belt.metal.lo;
  g.stroke();
  if (detail) {
    g.save();
    g.beginPath();
    enamelOutline(g, shape);
    g.closePath();
    g.clip();
    g.strokeStyle = rgba(belt.metal.hi, 0.07);
    g.lineWidth = 1.3;
    for (let i = 0; i < 36; i++) {
      // A rosette of offset circles — guilloché.
      const a = (i * Math.PI * 2) / 36;
      g.beginPath();
      g.arc(Math.cos(a) * 30, Math.sin(a) * 30, 96, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  laurel(g, belt, -1);
  laurel(g, belt, 1);

  // The belt's emblem over the stone: the king's crown on a run belt, the
  // boss's own mark on its title belt.
  emblem(g, belt, belt.emblem, 0, -78, 36);

  // The centre stone.
  gemstone(g, belt, 0, 8, 42, detail);

  // Corner stones.
  for (const [x, y] of STONES[shape]) {
    rivet(g, belt, x, y, 13);
    g.fillStyle = belt.gem.core;
    g.beginPath();
    g.arc(x, y, 7.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.arc(x - 2.5, y - 2.5, 2.4, 0, Math.PI * 2);
    g.fill();
  }

  // The run's name on the ribbon; the tier on a plaque beneath it.
  ribbon(g, belt, 86, belt.ribbon, detail);
  const py = shape === 'crest' ? 138 : 132;
  g.fillStyle = metalFill(g, belt, -60, py - 14, 60, py + 14);
  g.beginPath();
  g.roundRect(-62, py - 15, 124, 30, 6);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = belt.metal.lo;
  g.stroke();
  if (detail) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(700, 21);
    g.letterSpacing = '3px';
    g.fillStyle = belt.metal.lo;
    g.fillText(belt.plaque, 0, py + 1, 116);
    g.restore();
  }

  // The light catching the whole plate.
  g.save();
  g.beginPath();
  plateOutline(g, shape);
  g.closePath();
  g.clip();
  sheen(g, -210, -210, 420, 420, 0.24);
  g.restore();
}

/* ── the whole belt ───────────────────────────────────────────────────── */

export interface BeltDrawOpts {
  /** Not won yet: drawn as a dim, colourless ghost of itself. */
  ghost?: boolean;
}

/** The whole belt, `width` px across, centred on (cx, cy). */
export function drawBelt(g: CanvasRenderingContext2D, belt: Belt, cx: number, cy: number, width: number, opts: BeltDrawOpts = {}): void {
  const img = beltImage(belt, Math.round(width), !!opts.ghost);
  g.drawImage(img, cx - img.width / 2, cy - img.height / 2);
}

/** Paint the whole belt in belt units (caller has translated + scaled). */
function paintBelt(g: CanvasRenderingContext2D, belt: Belt, detail: boolean): void {
  paintStrap(g, belt, detail);
  SIDE_PLATES.forEach((p, i) => {
    g.save();
    g.translate(p.x, 0);
    paintSidePlate(g, belt, p.kind, belt.sides[i], detail);
    g.restore();
  });
  paintCenterPlate(g, belt, detail);
}

/** Painted belts, cached by belt, width and ghostliness: a panel repaints on
 *  every hover, and a belt is a few thousand strokes. */
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
  if (ghost) g.filter = 'grayscale(1) brightness(0.75)';
  paintBelt(g, belt, w >= 260);
  if (ghost) {
    g.filter = 'none';
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, c);
  return c;
}
