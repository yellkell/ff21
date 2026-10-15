/**
 * THE DECKS — what a platform is MADE OF.
 *
 * The platform shop used to sell neon tints over one diamond-plate slab,
 * plus a grin, a bolt and a grid. FF2's decks are stage floors in the
 * club's realistic idiom (DESIGN.md §6: real materials, colour in light),
 * so a skin is now a MATERIAL first — charred oak, pale ash, quarried
 * slate, veined marble, black glass, river ice, jade, gold leaf, crimson
 * lacquer — and the neon tube round the edge is the light it stands in.
 *
 * Every deck is a procedural canvas skin: a colour map and a bump map from
 * the same seeded shader, cached per style and shared by every pad that
 * wears it. No image assets; the whole catalogue is a function of its seeds.
 *
 * ONE TILE, ONE PAD, NO SEAMS. A tile covers the whole pad (DECK_TILE_M),
 * so no pattern ever shows twice on the deck you stand on, and every tile
 * is seamless by construction — the rule that keeps it that way:
 *
 *  - noise comes from `n(x, y, f)`, a value noise whose lattice WRAPS at
 *    its own frequency `f` (a whole number of cells per tile), so it meets
 *    itself at the tile edge;
 *  - anything periodic runs a whole number of times across the tile: board
 *    counts, stone grids, `sin(k·π·x)` with whole k, basalt's hex lattice
 *    sized 7 × 8 so it closes, meteorite bands on whole-number directions;
 *  - per-cell tones hash the cell's WRAPPED index.
 *
 * (The old decks sampled a 32-cell noise over 2–30 cells, so it never
 * wrapped, and tiled a metre-wide square about twice across each pad —
 * a seam down JADE, broken hexes on BASALT, the rings of OBSIDIAN bunched
 * at one edge, and the same knots twice on every plank deck.)
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

export type DeckStyle =
  | 'oak'
  | 'charred'
  | 'ash'
  | 'redwood'
  | 'walnut'
  | 'slate'
  | 'marble'
  | 'obsidian'
  | 'frost'
  | 'jade'
  | 'bullion'
  | 'lacquer'
  | 'tide'
  | 'copper'
  | 'basalt'
  | 'magma'
  | 'meteorite';

export interface DeckLook {
  map: CanvasTexture;
  bump: CanvasTexture;
  /** Per-texel finish for decks made of two materials (CHAMPION's gold in
   *  lacquer): roughness in G, metalness in B — three.js reads both from
   *  one texture. When present the material's roughness and metalness are
   *  1 and this says the rest; the flat values below are ignored. */
  finish?: CanvasTexture;
  /** Tint over the map (the map is authored near its final tone; this is
   *  for lamp-light warmth or a stain). */
  color: number;
  roughness: number;
  metalness: number;
  bumpScale: number;
  envMapIntensity: number;
  /** Self-glow, for decks that burn or shine from within. */
  emissive?: number;
  emissiveIntensity?: number;
  /** Where the glow is: a deck that burns only in its cracks (MAGMA) glows
   *  through its own colour map, so the crust stays black. */
  emissiveMap?: CanvasTexture;
  /** Rotate the map a quarter turn so boards run at the foe (planks only). */
  rotate?: boolean;
}

/** Metres of deck one tile covers — the pad's full width (1.72 m), so the
 *  tile is laid once, centred, and never repeats on a pad. */
export const DECK_TILE_M = 1.72;
/** Texels per tile side. */
const SIZE = 512;

type Rgbh = [number, number, number, number] | [number, number, number, number, number, number];
/** A texel shader: (x, y) in [0, 1) across the tile → [r, g, b, height] or
 *  [r, g, b, height, roughness, metalness]. */
type Shader = (x: number, y: number, n: Noise) => Rgbh;
/** Tiling value noise: `f` whole cells across the tile, `oct` octaves
 *  (each doubling f, so each still wraps), `salt` picks a fresh field. */
type Noise = (x: number, y: number, f: number, oct?: number, salt?: number) => number;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (t: number): number => t * t * (3 - 2 * t);
const frac = (v: number): number => v - Math.floor(v);
const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** A stable 0..1 hash of an integer cell and a salt. */
function hash(i: number, j: number, salt: number): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The tiling noise for one deck (its seed folded into every salt). */
function tilingNoise(seed: number): Noise {
  const one = (x: number, y: number, f: number, salt: number): number => {
    const X = x * f;
    const Y = y * f;
    const x0 = Math.floor(X);
    const y0 = Math.floor(Y);
    const tx = smooth(X - x0);
    const ty = smooth(Y - y0);
    const i0 = mod(x0, f);
    const j0 = mod(y0, f);
    const i1 = mod(x0 + 1, f);
    const j1 = mod(y0 + 1, f);
    const a = hash(i0, j0, salt);
    const b = hash(i1, j0, salt);
    const c = hash(i0, j1, salt);
    const d = hash(i1, j1, salt);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
  return (x, y, f, oct = 2, salt = 0) => {
    let v = 0;
    let amp = 1;
    let sum = 0;
    for (let o = 0; o < oct; o++) {
      v += one(x, y, Math.round(f) << o, seed * 131 + salt * 17 + o * 7919) * amp;
      sum += amp;
      amp *= 0.5;
    }
    return v / sum;
  };
}

interface Skin {
  map: CanvasTexture;
  bump: CanvasTexture;
  finish?: CanvasTexture;
}
const cache = new Map<DeckStyle, Skin>();

/** One pass of a shader into raw texel buffers, rows [y0, y1). */
interface Buffers {
  size: number;
  col: Uint8ClampedArray;
  hgt: Uint8ClampedArray;
  fin: Uint8ClampedArray | null;
}
function buffers(size: number, withFinish: boolean): Buffers {
  const px = size * size * 4;
  return { size, col: new Uint8ClampedArray(px), hgt: new Uint8ClampedArray(px), fin: withFinish ? new Uint8ClampedArray(px) : null };
}
function paintRows(b: Buffers, shade: Shader, n: Noise, y0: number, y1: number): void {
  const S = b.size;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < S; x++) {
      const out = shade(x / S, y / S, n);
      const i = (y * S + x) * 4;
      b.col[i] = clamp01(out[0]) * 255;
      b.col[i + 1] = clamp01(out[1]) * 255;
      b.col[i + 2] = clamp01(out[2]) * 255;
      b.col[i + 3] = 255;
      b.hgt[i] = b.hgt[i + 1] = b.hgt[i + 2] = clamp01(out[3]) * 255;
      b.hgt[i + 3] = 255;
      if (b.fin && out.length === 6) {
        b.fin[i] = 0;
        b.fin[i + 1] = clamp01(out[4]) * 255;
        b.fin[i + 2] = clamp01(out[5]) * 255;
        b.fin[i + 3] = 255;
      }
    }
  }
}
function toCanvas(data: Uint8ClampedArray, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  img.data.set(data);
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * THE REFINE QUEUE. A full 512² deck costs 0.1–0.4 s of shader on a desktop
 * and several times that on a headset — far too long for one frame. So a
 * deck is born as a quick PREVIEW-sized pass (cheaper than the old decks
 * were), handed out at once, and refined to full size a few milliseconds
 * at a time; when the last row lands the textures swap their image. One
 * deck refines at a time. (setTimeout, not rAF: the window's rAF stops
 * during an immersive session.)
 */
const PREVIEW = 128;
const SLICE_MS = 3;
const queue: Array<() => boolean> = [];
let pumping = false;
const settled: Array<() => void> = [];
function pump(): void {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < SLICE_MS) {
    if (queue[0]()) queue.shift();
  }
  if (queue.length) setTimeout(pump, 0);
  else {
    pumping = false;
    settled.splice(0).forEach((fn) => fn());
  }
}
/** Resolves once every deck asked for so far is at full resolution (for
 *  the preview harness and probes; the game never needs to wait). */
export function decksSettled(): Promise<void> {
  return queue.length ? new Promise((r) => settled.push(r)) : Promise.resolve();
}

/** Paint a seamless colour + height (+ finish) set from a per-texel shader. */
function skin(style: DeckStyle, seed: number, shade: Shader): Skin {
  const hit = cache.get(style);
  if (hit) return hit;
  const n = tilingNoise(seed);
  const withFinish = shade(0, 0, n).length === 6;
  const quick = buffers(PREVIEW, withFinish);
  paintRows(quick, shade, n, 0, PREVIEW);
  const wrap = (data: Uint8ClampedArray, srgb: boolean): CanvasTexture => {
    const t = new CanvasTexture(toCanvas(data, PREVIEW));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  const out: Skin = { map: wrap(quick.col, true), bump: wrap(quick.hgt, false) };
  if (quick.fin) out.finish = wrap(quick.fin, false);
  cache.set(style, out);
  // …then the full-size pass, a few rows at a time.
  const full = buffers(SIZE, withFinish);
  let row = 0;
  queue.push(() => {
    const end = Math.min(SIZE, row + 1); // a row is ≤1 ms even for the lacquer
    paintRows(full, shade, n, row, end);
    row = end;
    if (row < SIZE) return false;
    const swap = (t: CanvasTexture | undefined, data: Uint8ClampedArray | null): void => {
      if (!t || !data) return;
      t.dispose(); // the GPU copy is the preview's size — let it re-upload
      t.image = toCanvas(data, SIZE);
      t.needsUpdate = true;
    };
    swap(out.map, full.col);
    swap(out.bump, full.hgt);
    swap(out.finish, full.fin);
    return true;
  });
  if (!pumping) {
    pumping = true;
    setTimeout(pump, 0);
  }
  return out;
}

/* ── planks ─────────────────────────────────────────────────────────── */

/** Boards across v (twelve to the pad, ~14 cm each), laid in lengths: each
 *  board breaks at two butt joints staggered from its neighbours', and
 *  every length is its own piece of wood — its own tone, figure and knots.
 *  `tone` is [r,g,b] of the wood; `spread` how much the pieces differ;
 *  `seamDepth` how dark the gaps read. */
function planks(style: DeckStyle, seed: number, tone: [number, number, number], spread: number, seamDepth: number, grainStrength = 0.1): Skin {
  const BOARDS = 12;
  return skin(style, seed, (x, y, n) => {
    const board = Math.floor(y * BOARDS);
    const local = y * BOARDS - board;
    // Two butt joints per board, half a tile apart, staggered board to board.
    const j = hash(board, 1, seed);
    const along = frac(x - j);
    const piece = board * 2 + (along < 0.5 ? 0 : 1);
    const toJoint = Math.min(along, Math.abs(along - 0.5), 1 - along);
    const joint = 1 - clamp01(toJoint / 0.0035);
    const pieceTone = 1 + (hash(piece, 2, seed) - 0.5) * spread * 2;
    // Long grain: fine lines along u, warped by a slow noise, and the
    // figure — the broad light and dark of the growth rings.
    const warp = n(x, y, 3, 2, piece);
    const grain = 0.5 + 0.5 * Math.sin((y * BOARDS * 9 + warp * 5 + x * 2) * Math.PI * 2);
    const figure = n(x, y, 5, 3, piece + 50);
    // Seam: a dark groove at each board edge, with a soft shoulder.
    const edge = Math.min(local, 1 - local);
    const seam = Math.max(1 - clamp01(edge / 0.05), joint);
    // A knot in about half the lengths: a small dark eye, longer along the
    // grain than across it, with a ring or two round it.
    let knot = 0;
    if (hash(piece, 4, seed) < 0.45) {
      const start = frac(j + (along < 0.5 ? 0 : 0.5));
      const ku = frac(start + 0.08 + hash(piece, 5, seed) * 0.34);
      const kv = 0.3 + hash(piece, 6, seed) * 0.4;
      let du = x - ku;
      du -= Math.round(du);
      const e = Math.hypot(du / 0.02, (local - kv) / (BOARDS * 0.016));
      knot = clamp01(1.4 - e * 1.4) + clamp01(1 - Math.abs(e - 1.5) * 4) * 0.25;
    }
    const l = pieceTone * (1 + (figure - 0.5) * 0.28 + (grain - 0.5) * grainStrength) * (1 - seam * seamDepth) * (1 - knot * 0.4);
    const h = clamp01(0.55 + (grain - 0.5) * 0.25 + (figure - 0.5) * 0.2 - seam * 0.8 - knot * 0.25);
    return [tone[0] * l, tone[1] * l, tone[2] * l, h];
  });
}

/* ── stone + glass + metal ──────────────────────────────────────────── */

function slateSkin(): Skin {
  // Flagstones in a running bond — four courses, three stones a course,
  // every other course shifted half a stone — with ragged grout, each stone
  // its own grey, cleaved in its own direction, and set a hair proud or low.
  return skin('slate', 3101, (x, y, n) => {
    const rows = 4;
    const cols = 3;
    const wob = (n(x, y, 8, 2, 3) - 0.5) * 0.05; // the grout wanders
    const gy = y * rows + wob;
    const row = Math.floor(gy);
    const shift = mod(row, 2) * 0.5;
    const gx = x * cols + shift + wob;
    const col = Math.floor(gx);
    const ex = Math.min(gx - col, 1 - (gx - col));
    const ey = Math.min(gy - row, 1 - (gy - row));
    const grout = 1 - clamp01(Math.min(ex / cols, ey / rows) * cols * rows / 0.09);
    const id = mod(row, rows) * cols + mod(col, cols);
    const stoneTone = 0.78 + hash(id, 1, 3101) * 0.4;
    const hue = hash(id, 2, 3101) - 0.5; // some stones bluer, some greener
    const cleave = n(x, y, 10, 3, id);
    const cleaveLine = Math.abs(Math.sin((x * 6 + y * 2 + cleave * 1.4) * Math.PI));
    const l = stoneTone * (0.5 + (cleave - 0.5) * 0.28 + (cleaveLine - 0.5) * 0.05) * (1 - grout * 0.65);
    const h = clamp01(0.5 + (hash(id, 3, 3101) - 0.5) * 0.18 + (cleave - 0.5) * 0.45 - grout * 0.9);
    return [l * (0.86 - hue * 0.04), l * (0.9 + hue * 0.03), l * (0.98 + hue * 0.03), h];
  });
}

function marbleSkin(): Skin {
  return skin('marble', 3202, (x, y, n) => {
    // Veins: dark lines where a warped field crosses zero — a main family
    // running on the diagonal and a fine web between. Every sine has a
    // whole-number frequency, so |sin| wraps with the tile.
    const warp = n(x, y, 2, 4, 1);
    const v1 = Math.abs(Math.sin((x * 2 + y + warp * 3.2) * Math.PI));
    const vein = clamp01((0.05 - v1) / 0.05) * (0.45 + n(x, y, 6, 2, 2) * 0.55);
    const web = n(x, y, 4, 3, 3);
    const v2 = Math.abs(Math.sin((x - y * 2 + web * 6) * Math.PI));
    const fine = clamp01((0.018 - v2) / 0.018) * clamp01((n(x, y, 3, 2, 4) - 0.35) * 3) * 0.6;
    const cloud = n(x, y, 3, 4, 5);
    // Warm grey stone rather than paper-white: a headset's sun-lit deck
    // tone-maps a 0.9 albedo to a blinding sheet, so the base sits at
    // ~0.7 with the clouding and the veins carrying the read.
    const l = 0.6 + (cloud - 0.5) * 0.22 - vein * 0.42 - fine * 0.25;
    const warm = vein * 0.05; // the veins run a touch warm
    const h = clamp01(0.6 - vein * 0.2 - fine * 0.1 + (cloud - 0.5) * 0.06);
    return [l + warm, l * 0.98, l * 0.94 - warm, h];
  });
}

function obsidianSkin(): Skin {
  return skin('obsidian', 3303, (x, y, n) => {
    // Black glass: conchoidal ripples — the contours of a slow field, the
    // way the glass fractured and flowed — with flow banding in the colour
    // and the faintest rainbow sheen where the bands cross.
    const field = n(x, y, 2, 3, 1);
    const ripple = 0.5 + 0.5 * Math.sin(field * 26 * Math.PI);
    const band = 0.5 + 0.5 * Math.sin((y * 3 + n(x, y, 3, 2, 2) * 2) * Math.PI * 2);
    const sheen = n(x, y, 5, 2, 3);
    const l = 0.07 + band * 0.03 + sheen * 0.03;
    const iri = clamp01((band - 0.8) * 5) * 0.05;
    return [l + iri * 0.4, l * 1.03 + iri * 0.2, l * 1.22 + iri, clamp01(0.5 + (ripple - 0.5) * 0.35)];
  });
}

function frostSkin(): Skin {
  return skin('frost', 3404, (x, y, n) => {
    // River ice: blue depth under a pale skin, trapped bubbles in strings,
    // and two families of long cracks.
    const bubbles = clamp01((n(x, y, 18, 2, 1) - 0.62) * 6) * clamp01((n(x, y, 3, 2, 2) - 0.4) * 3);
    const c1 = Math.abs(Math.sin((x * 2 + n(x, y, 2, 3, 3) * 1.5) * Math.PI));
    const c2 = Math.abs(Math.sin((y * 3 + n(x, y, 2, 3, 4) * 1.2) * Math.PI));
    const crack = Math.max(clamp01((0.02 - c1) / 0.02), clamp01((0.012 - c2) / 0.012) * 0.7);
    const depth = n(x, y, 3, 4, 5);
    const l = 0.74 + (depth - 0.5) * 0.24 + bubbles * 0.14 - crack * 0.28;
    const deep = (0.5 - depth) * 0.12; // darker ice reads bluer
    return [l * (0.84 - deep), l * 0.94, l * 1.04, clamp01(0.6 + bubbles * 0.25 - crack * 0.5 + (depth - 0.5) * 0.1)];
  });
}

function jadeSkin(): Skin {
  return skin('jade', 3505, (x, y, n) => {
    // Green stone with a cloud in it: slow clouding, a swirl through it,
    // and the pale flecks and dark mineral threads real jade carries.
    const cloud = n(x, y, 3, 4, 1);
    const swirl = 0.5 + 0.5 * Math.sin((cloud * 6 + x * 2 + y) * Math.PI);
    const fleck = clamp01((n(x, y, 24, 2, 2) - 0.7) * 5);
    const thread = clamp01((0.03 - Math.abs(Math.sin((y * 2 + n(x, y, 2, 3, 3) * 4) * Math.PI))) / 0.03) * 0.5;
    const l = 0.4 + (cloud - 0.5) * 0.24 + swirl * 0.12 + fleck * 0.12 - thread * 0.12;
    return [l * 0.55, l, l * 0.72, clamp01(0.55 + (cloud - 0.5) * 0.12)];
  });
}

function bullionSkin(): Skin {
  // Gold leaf laid square by square (12 to a side, ~14 cm each), each leaf
  // a hair off the next in tone and angle, the overlaps a line, the leaf
  // itself crinkled.
  return skin('bullion', 3606, (x, y, n) => {
    const k = 12;
    const gx = x * k;
    const gy = y * k;
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    const lx = gx - tx;
    const ly = gy - ty;
    const id = mod(tx, k) * k + mod(ty, k);
    const overlap = clamp01((0.045 - Math.min(lx, ly)) / 0.045);
    const leafTone = 0.86 + hash(id, 1, 3606) * 0.2;
    const burnish = n(x, y, 24, 2, 1);
    const crinkle = n(x, y, 64, 2, 2);
    const l = leafTone * (0.9 + (burnish - 0.5) * 0.14 + (crinkle - 0.5) * 0.08) * (1 - overlap * 0.18);
    return [l, l * 0.79, l * 0.4, clamp01(0.6 + (burnish - 0.5) * 0.08 + (crinkle - 0.5) * 0.12 - overlap * 0.3)];
  });
}

function lacquerSkin(): Skin {
  // THE CHAMPION'S FLOOR — crimson lacquer, deep and glassy, inlaid in real
  // gold (the finish map makes the inlay METAL and the lacquer a clear
  // gloss, one deck, two materials). From the rim in: a black lacquer
  // border carrying a band of gold lozenges between two rules; the crimson
  // field; a sunburst of alternating long and short gold rays; and at the
  // centre a medallion ring holding GOLIATH's own five-spike crown, a ruby
  // at every tip. The tile is centred on the pad, so the design is too.
  return skin('lacquer', 3707, (x, y, n) => {
    const dx = x - 0.5;
    const dy = y - 0.5;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const px = 1 / 512; // one texel, for anti-aliased edges
    const line = (d: number, w: number): number => clamp01((w - Math.abs(d)) / px + 0.5);
    let gold = 0;
    let ruby = 0;
    // Border rules and the lozenge band between them.
    gold = Math.max(gold, line(r - 0.395, 0.0045), line(r - 0.455, 0.003), line(r - 0.372, 0.0022));
    const black = clamp01((r - 0.398) / px + 0.5);
    if (r > 0.4 && r < 0.452) {
      const t = (r - 0.426) / 0.022; // −1..1 across the band
      const s = frac((ang / (Math.PI * 2)) * 40) * 2 - 1; // −1..1 per lozenge
      const loz = Math.abs(t) + Math.abs(s) * 1.1;
      gold = Math.max(gold, clamp01((0.8 - loz) * 12));
    }
    // The sunburst: 24 rays, long and short alternating, tapering outward.
    if (r > 0.14 && r < 0.36) {
      const k = (ang / (Math.PI * 2)) * 24;
      const i = Math.floor(k + 0.5);
      const long = mod(i, 2) === 0;
      const reach = long ? 0.36 : 0.29;
      const off = Math.abs(k - i) * ((Math.PI * 2) / 24) * r; // distance from the ray's axis
      const taper = 0.0065 * clamp01(1 - (r - 0.14) / (reach - 0.14));
      if (r < reach) gold = Math.max(gold, clamp01((taper - off) / px + 0.5));
    }
    // The medallion: a double ring round the crown.
    gold = Math.max(gold, line(r - 0.125, 0.004), line(r - 0.108, 0.0018));
    // The crown (local u across, v up the pad).
    const u = dx / 0.085;
    const v = -dy / 0.085;
    const band = Math.abs(u) < 0.78 && v > -0.55 && v < -0.22 ? 1 : 0;
    let spike = 0;
    for (let k = -2; k <= 2; k++) {
      const cu = k * 0.36;
      const tip = k === 0 ? 0.62 : Math.abs(k) === 1 ? 0.45 : 0.3;
      const hw = 0.13 * clamp01((tip - v) / (tip + 0.22));
      if (v >= -0.24 && v <= tip && Math.abs(u - cu) < hw) spike = 1;
      if (Math.hypot(u - cu, v - tip - 0.08) < 0.085) ruby = 1;
    }
    gold = Math.max(gold, band, spike);
    // The band's jewels, dark set into the gold.
    const setStone = Math.abs(v + 0.385) < 0.07 && Math.abs(mod(u + 0.18, 0.36) - 0.18) < 0.06 && band ? 1 : 0;
    // The lacquer: crimson with depth — slow clouding under a clear coat,
    // the faint brush of the layers laid on by hand.
    const depth = n(x, y, 3, 3, 1);
    const brush = n(x, y, 2, 2, 2) * 0.5 + 0.5 * Math.sin((x * 90 + n(x, y, 4, 2, 3) * 6) * Math.PI * 2) * 0.02;
    const cr: [number, number, number] = [0.38 + (depth - 0.5) * 0.1 + brush * 0.03, 0.035, 0.045];
    const bk: [number, number, number] = [0.028, 0.02, 0.022];
    const base = cr.map((c, i) => c * (1 - black) + bk[i] * black) as [number, number, number];
    const gTone = 0.92 + (n(x, y, 40, 2, 4) - 0.5) * 0.12; // hand-burnished, not stamped
    const g: [number, number, number] = [0.95 * gTone, 0.72 * gTone, 0.32 * gTone];
    const rb: [number, number, number] = [0.75, 0.05, 0.1];
    const inlay = clamp01(gold - setStone);
    const col = base.map((c, i) => c * (1 - inlay) + g[i] * inlay) as [number, number, number];
    const out = col.map((c, i) => c * (1 - ruby) + rb[i] * ruby) as [number, number, number];
    const hgt = clamp01(0.5 + inlay * 0.25 + ruby * 0.35 - setStone * 0.1 + (depth - 0.5) * 0.03);
    // Finish: lacquer is a glassy clear coat; gold is metal, burnished.
    const rough = 0.08 * (1 - inlay) + 0.28 * inlay + ruby * 0.04;
    const metal = inlay;
    return [out[0], out[1], out[2], hgt, rough, metal];
  });
}

function tideSkin(): Skin {
  // Wet green stone under a slick — the tide's own ground.
  return skin('tide', 3808, (x, y, n) => {
    const cloud = n(x, y, 4, 4, 1);
    const wet = 0.5 + 0.5 * Math.sin((n(x, y, 2, 2, 2) * 4 + y * 3) * Math.PI * 2);
    const pebble = clamp01((n(x, y, 20, 2, 3) - 0.66) * 5);
    const l = 0.2 + (cloud - 0.5) * 0.16 + wet * 0.08 + pebble * 0.05;
    return [l * 0.45, l, l * 0.7, clamp01(0.5 + (cloud - 0.5) * 0.2 + pebble * 0.2)];
  });
}

/* ── the forge: metal, stone and fire ───────────────────────────────── */

function copperSkin(): Skin {
  // Hammered copper going green: a field of dimples (planished by hand,
  // so no two the same — ~8 cm each), the metal warm and bright on the
  // ridges between them, VERDIGRIS pooling in the low spots and spreading
  // in blotches, and dark oxide where the hammer bit deepest.
  return skin('copper', 3909, (x, y, n) => {
    const cells = 20;
    const gx = x * cells;
    const gy = y * cells;
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    let bowl = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const ix = mod(cx + ox, cells);
        const iy = mod(cy + oy, cells);
        const px = cx + ox + 0.5 + (hash(ix, iy, 1) - 0.5) * 0.7;
        const py = cy + oy + 0.5 + (hash(ix, iy, 2) - 0.5) * 0.7;
        const rad = 0.55 + hash(ix, iy, 3) * 0.2;
        const d = Math.hypot(gx - px, gy - py);
        bowl = Math.max(bowl, clamp01(1 - d / rad));
      }
    }
    const depth = smooth(bowl);
    const patina = clamp01((n(x, y, 4, 4, 1) - 0.52) * 3.2 + depth * 0.12 - 0.22);
    const oxide = clamp01((n(x, y, 6, 3, 2) - 0.6) * 3) * 0.5;
    const sheen = n(x, y, 32, 2, 3);
    // The hammering lives in the relief and the light, not the paint — a
    // dark spot at every dimple read as polka dots.
    const l = 0.72 + (1 - depth) * 0.06 + (sheen - 0.5) * 0.1 - oxide * 0.22;
    const cu: [number, number, number] = [l, l * 0.57, l * 0.38];
    const green: [number, number, number] = [0.3, 0.6 + (sheen - 0.5) * 0.08, 0.53];
    return [
      cu[0] * (1 - patina) + green[0] * patina,
      cu[1] * (1 - patina) + green[1] * patina,
      cu[2] * (1 - patina) + green[2] * patina,
      clamp01(0.7 - depth * 0.5 + (sheen - 0.5) * 0.06 + patina * 0.08),
    ];
  });
}

function basaltSkin(): Skin {
  // Columnar basalt from above: a honeycomb of six-sided columns (7 across,
  // 8 rows — the one lattice of near-regular hexes that closes on a square
  // tile), each column a touch higher or lower than its neighbours, its
  // top cracked and weathered, a dark seam between.
  const COLS = 7;
  const PAIRS = 4; // row-pairs down the tile
  return skin('basalt', 4010, (x, y, n) => {
    const px = x * COLS * Math.sqrt(3);
    const py = y * PAIRS * 3;
    const q = (Math.sqrt(3) / 3) * px - (1 / 3) * py;
    const r = (2 / 3) * py;
    let rx = Math.round(q);
    let rz = Math.round(r);
    let ry = Math.round(-q - r);
    const dx = Math.abs(rx - q);
    const dy = Math.abs(ry - (-q - r));
    const dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    const hx = Math.sqrt(3) * (rx + rz / 2);
    const hy = 1.5 * rz;
    const ex = px - hx;
    const ey = py - hy;
    const a0 = Math.abs(ex);
    const a1 = Math.abs(ex * 0.5 + ey * 0.866);
    const a2 = Math.abs(ex * 0.5 - ey * 0.866);
    const edge = Math.max(a0, a1, a2) / 0.866; // 0 centre → 1 seam
    const seam = clamp01((edge - 0.88) / 0.09);
    // The column's identity, from its WRAPPED lattice index.
    const wz = mod(rz, PAIRS * 2);
    const wx = mod(rx + Math.floor(rz / (PAIRS * 2)) * PAIRS, COLS);
    const id = wz * COLS + wx;
    const colTone = 0.8 + hash(id, 1, 4010) * 0.4;
    const lift = hash(id, 2, 4010) - 0.5;
    const grain = n(x, y, 24, 3, 1);
    const crackL = Math.abs(Math.sin((ex * 1.3 + ey * 0.7 + hash(id, 3, 4010) * 3) * Math.PI));
    const crack = clamp01((0.03 - crackL) / 0.03) * (hash(id, 4, 4010) > 0.55 ? 1 : 0) * (1 - seam);
    const weather = clamp01((n(x, y, 5, 3, 2) - 0.55) * 2.5) * 0.08;
    const l = 0.2 * colTone * (1 - seam * 0.7) * (1 - crack * 0.5) + (grain - 0.5) * 0.06 + weather;
    const h = clamp01(0.55 + lift * 0.2 - seam * 0.8 - crack * 0.3 + (grain - 0.5) * 0.1 - edge * 0.08);
    return [l * 0.95, l * 0.97, l * 1.05, h];
  });
}

function magmaSkin(): Skin {
  // A black crust cooling over fire: plates of dark rock, and between
  // them the CRACKS — thin, branching, and lit from underneath. The
  // colour map is also the emissive map, so only the cracks glow.
  return skin('magma', 4111, (x, y, n) => {
    const w1 = n(x, y, 3, 4, 1);
    const w2 = n(x, y, 4, 4, 2);
    // Cracks: where a warped field crosses its midline — a thin ridge.
    const c1 = Math.abs(w1 - 0.5);
    const c2 = Math.abs(w2 - 0.52);
    const crack = Math.max(clamp01((0.024 - c1) / 0.024), clamp01((0.016 - c2) / 0.016) * 0.85);
    const glowFade = 0.5 + 0.5 * n(x, y, 6, 2, 3); // some cracks hotter
    const crust = n(x, y, 14, 3, 4);
    const dark = 0.06 + (crust - 0.5) * 0.05;
    const heat = crack * glowFade;
    // The crack's core is yellow-white, its shoulders red; the crust near a
    // crack glows a dull ember.
    const core = clamp01((heat - 0.6) / 0.4);
    const ember = clamp01(0.06 - Math.min(c1, c2)) * 2.5 * glowFade;
    const r = dark * (1 - heat) + (0.75 + core * 0.25) * heat + ember * 0.35;
    const g = dark * (1 - heat) + (0.22 + core * 0.6) * heat + ember * 0.06;
    const b = dark * 1.1 * (1 - heat) + (0.03 + core * 0.35) * heat;
    return [r, g, b, clamp01(0.55 + (crust - 0.5) * 0.35 - crack * 0.6)];
  });
}

function meteoriteSkin(): Skin {
  // Etched iron-nickel: the Widmanstätten figure — three families of
  // parallel lamellae crossing near sixty degrees, bright kamacite on a
  // darker ground, wobbling a hair as a real etch does. The families run
  // along whole-number directions ((1,0), (1,2), (−1,2)) so they wrap.
  // Real iron grows in crystal DOMAINS: in one region one family runs
  // strong and the others faint, and the lamellae are uneven — thick and
  // thin, broken off, never a mesh.
  const FAMILIES: Array<[number, number, number]> = [
    [1, 0, 22],
    [1, 2, 11],
    [-1, 2, 11],
  ];
  return skin('meteorite', 4212, (x, y, n) => {
    const wob = (n(x, y, 4, 3, 1) - 0.5) * 0.6;
    let lam = 0;
    FAMILIES.forEach(([a, b, m], k) => {
      const u = (a * x + b * y) * m + wob;
      const wid = 0.08 + n(x, y, 8, 2, 30 + k) * 0.2;
      const bar = clamp01(1 - Math.abs(frac(u) - 0.5) / wid) ** 1.5;
      // Not every band runs the whole way: a mask breaks them into lamellae.
      const mask = clamp01((n(x, y, 12, 2, 10 + k) - 0.38) * 3.5);
      const domain = 0.25 + 0.75 * clamp01((n(x, y, 2, 2, 20 + k) - 0.35) * 3);
      lam = Math.max(lam, bar * mask * domain);
    });
    const grain = n(x, y, 48, 2, 2);
    const plessite = clamp01((n(x, y, 8, 2, 3) - 0.62) * 4) * (1 - lam) * 0.1; // the fine fill between
    const l = 0.42 + lam * 0.22 + (grain - 0.5) * 0.05 - plessite;
    return [l * 0.96, l * 0.97, l, clamp01(0.5 + lam * 0.2 + (grain - 0.5) * 0.05)];
  });
}

/* ── the looks ───────────────────────────────────────────────────────── */

const tuned = new Set<DeckStyle>();

/** The look for a deck style. The textures are shared per style and tuned
 *  once: one tile to the pad (ExtrudeGeometry UVs are in metres), centred
 *  on the pad so a centred design (CHAMPION's crown) lands in the middle,
 *  and — for planks — a quarter turn so the boards run at the foe. */
export function deckLook(style: DeckStyle): DeckLook {
  const look = rawLook(style);
  if (!tuned.has(style)) {
    tuned.add(style);
    const k = 1 / DECK_TILE_M;
    for (const t of [look.map, look.bump, look.finish]) {
      if (!t) continue;
      t.repeat.set(k, k);
      t.center.set(0.5, 0.5);
      t.rotation = look.rotate ? Math.PI / 2 : 0;
      // With the transform centred at (0.5, 0.5), uv (0, 0) — the pad's
      // centre — lands at 0.5 − k/2 + offset; this puts it on the tile's.
      t.offset.set(k / 2, k / 2);
      t.needsUpdate = true;
    }
  }
  return look;
}

function rawLook(style: DeckStyle): DeckLook {
  switch (style) {
    case 'oak':
      return { ...planks('oak', 1001, [0.72, 0.5, 0.3], 0.14, 0.55), color: 0xffce9a, roughness: 0.55, metalness: 0.05, bumpScale: 0.5, envMapIntensity: 0.25, rotate: true };
    case 'charred':
      return { ...planks('charred', 1002, [0.16, 0.13, 0.12], 0.3, 0.7, 0.2), color: 0xffffff, roughness: 0.8, metalness: 0.02, bumpScale: 0.7, envMapIntensity: 0.2, emissive: 0xff5a1a, emissiveIntensity: 0.05, rotate: true };
    case 'ash':
      return { ...planks('ash', 1003, [0.77, 0.75, 0.69], 0.12, 0.45, 0.14), color: 0xffffff, roughness: 0.6, metalness: 0.03, bumpScale: 0.45, envMapIntensity: 0.3, rotate: true };
    case 'redwood':
      return { ...planks('redwood', 1004, [0.58, 0.24, 0.16], 0.16, 0.6, 0.12), color: 0xffffff, roughness: 0.5, metalness: 0.04, bumpScale: 0.5, envMapIntensity: 0.3, rotate: true };
    case 'walnut':
      return { ...planks('walnut', 1005, [0.34, 0.22, 0.15], 0.22, 0.65, 0.16), color: 0xffffff, roughness: 0.42, metalness: 0.05, bumpScale: 0.45, envMapIntensity: 0.4, rotate: true };
    case 'slate':
      return { ...slateSkin(), color: 0xffffff, roughness: 0.85, metalness: 0.05, bumpScale: 0.6, envMapIntensity: 0.3 };
    case 'marble':
      return { ...marbleSkin(), color: 0xcfccc6, roughness: 0.35, metalness: 0.02, bumpScale: 0.2, envMapIntensity: 0.45 };
    case 'obsidian':
      return { ...obsidianSkin(), color: 0xffffff, roughness: 0.1, metalness: 0.1, bumpScale: 0.25, envMapIntensity: 1.0 };
    case 'frost':
      return { ...frostSkin(), color: 0xffffff, roughness: 0.22, metalness: 0.02, bumpScale: 0.3, envMapIntensity: 0.6, emissive: 0x6ac8ff, emissiveIntensity: 0.06 };
    case 'jade':
      return { ...jadeSkin(), color: 0xffffff, roughness: 0.26, metalness: 0.02, bumpScale: 0.15, envMapIntensity: 0.6 };
    case 'bullion':
      return { ...bullionSkin(), color: 0xffffff, roughness: 0.3, metalness: 0.85, bumpScale: 0.25, envMapIntensity: 0.9, emissive: 0x3a2400, emissiveIntensity: 0.25 };
    case 'lacquer':
      return { ...lacquerSkin(), color: 0xffffff, roughness: 1, metalness: 1, bumpScale: 0.2, envMapIntensity: 1.0, emissive: 0x2a0404, emissiveIntensity: 0.12 };
    case 'tide':
      return { ...tideSkin(), color: 0xffffff, roughness: 0.2, metalness: 0.05, bumpScale: 0.3, envMapIntensity: 0.7, emissive: 0x0d3f2b, emissiveIntensity: 0.14 };
    case 'copper':
      return { ...copperSkin(), color: 0xffffff, roughness: 0.4, metalness: 0.7, bumpScale: 0.7, envMapIntensity: 0.8 };
    case 'basalt':
      return { ...basaltSkin(), color: 0xffffff, roughness: 0.82, metalness: 0.04, bumpScale: 0.6, envMapIntensity: 0.3 };
    case 'magma': {
      const s = magmaSkin();
      return { ...s, color: 0xffffff, roughness: 0.75, metalness: 0.05, bumpScale: 0.5, envMapIntensity: 0.3, emissive: 0xffffff, emissiveIntensity: 1.1, emissiveMap: s.map };
    }
    case 'meteorite':
      return { ...meteoriteSkin(), color: 0xffffff, roughness: 0.34, metalness: 0.92, bumpScale: 0.12, envMapIntensity: 1.0 };
  }
}
