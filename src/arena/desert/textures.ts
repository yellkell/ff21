/**
 * DESERT 2.0 — the material kit. The papercraft era's rule was "colour
 * on a facet"; the new rule is colour ON A SURFACE: every material here
 * carries a procedural canvas map (tint-neutral, so the caller's colour
 * still decides the hue) and a matching bump map cut from the same noise,
 * so sand ripples, rock strata, rust mottle, bark fissures and bone grain
 * catch the low light the way real surfaces do — for one texture fetch
 * apiece and zero extra draws. Textures are cached per kind and shared, so
 * the static merge (keyed on texture uuid) still batches everything that
 * wears the same skin.
 *
 * Nothing here is an image asset: it's all drawn at boot from the same
 * seeded value-noise the dunes use, so the desert stays one deterministic
 * function of its seed.
 */

import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, SpriteMaterial } from 'three';
import { makeRng, valueNoise2D } from './paper.js';
import { bedAt } from './strata.js';

interface Skin {
  map: CanvasTexture;
  bump: CanvasTexture;
}

const cache = new Map<string, Skin>();

function wrap(c: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Sample position → [r, g, b, height], all 0..1. */
type Texel = (x: number, y: number) => [number, number, number, number];

/** Paint a colour + height pair from a per-texel function, cached by key. */
function paint(key: string, size: number, texel: Texel): Skin {
  const hit = cache.get(key);
  if (hit) return hit;
  const col = document.createElement('canvas');
  const hgt = document.createElement('canvas');
  col.width = col.height = hgt.width = hgt.height = size;
  const cc = col.getContext('2d')!;
  const hc = hgt.getContext('2d')!;
  const ci = cc.createImageData(size, size);
  const hi = hc.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, h] = texel(x / size, y / size);
      const i = (y * size + x) * 4;
      ci.data[i] = clamp01(r) * 255;
      ci.data[i + 1] = clamp01(g) * 255;
      ci.data[i + 2] = clamp01(b) * 255;
      ci.data[i + 3] = 255;
      const hv = clamp01(h) * 255;
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv;
      hi.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0);
  hc.putImageData(hi, 0, 0);
  const s: Skin = { map: wrap(col, true), bump: wrap(hgt, false) };
  cache.set(key, s);
  return s;
}

/** Sample position → [r, g, b, height], all 0..1. */
type Shader = (x: number, y: number, n: (fx: number, fy: number, oct?: number) => number) => [number, number, number, number];

/** Paint a tileable colour + height pair from a per-texel shader. */
function skin(key: string, size: number, seed: number, shade: Shader): Skin {
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = makeRng(seed);
  const cells = 32;
  const noiseA = valueNoise2D(rng, cells);
  const noiseB = valueNoise2D(rng, cells);
  // Tileable: the noise grid wraps at `cells`, so sampling in grid units
  // that divide `cells` repeats seamlessly across the texture edge.
  const n = (fx: number, fy: number, oct = 2): number => {
    let v = 0;
    let amp = 1;
    let sum = 0;
    for (let o = 0; o < oct; o++) {
      const s = 1 << o;
      v += (o % 2 ? noiseB : noiseA)(fx * s, fy * s) * amp;
      sum += amp;
      amp *= 0.5;
    }
    return v / sum;
  };
  return paint(key, size, (x, y) => shade(x, y, n));
}

/**
 * TILEABLE value noise with its own cell count per axis: `kx` cells across
 * the tile, `ky` down it, wrapping at both — so a sample at (x, y) in 0..1
 * repeats seamlessly across every edge, and a tall thin cell count (48 × 6)
 * gives STREAKS rather than blobs. The sand and the mesas are built on
 * this: a tile that does not seam is the difference between a desert and
 * a wallpaper.
 */
export function tileNoise(rng: () => number, kx: number, ky: number): (x: number, y: number) => number {
  const grid = new Float32Array(kx * ky);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const at = (xi: number, yi: number): number => grid[(((yi % ky) + ky) % ky) * kx + (((xi % kx) + kx) % kx)];
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = x * kx;
    const fy = y * ky;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

/** A shader over tileable noises: `T(kx, ky?)` hands back a cached noise
 *  at that cell count (one per distinct size, drawn from the skin's seed). */
type TileShader = (x: number, y: number, T: (kx: number, ky?: number) => (x: number, y: number) => number) => [number, number, number, number];

function skinTiled(key: string, size: number, seed: number, shade: TileShader): Skin {
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = makeRng(seed);
  const pool = new Map<string, (x: number, y: number) => number>();
  const T = (kx: number, ky = kx): ((x: number, y: number) => number) => {
    const k = `${kx}x${ky}`;
    let f = pool.get(k);
    if (!f) {
      f = tileNoise(rng, kx, ky);
      pool.set(k, f);
    }
    return f;
  };
  return paint(key, size, (x, y) => shade(x, y, T));
}

/* ── the skins ─────────────────────────────────────────────────────────── */

/**
 * WIND-RIPPLED SAND, second try. The first was one sine across the tile:
 * every ripple the same height, the same spacing, the same direction, over
 * a whole desert — and tiled seventy times, a sheet of corduroy. Real
 * ripples are asymmetric (a long gentle stoss side, a short steep lee
 * face), they wander with the gusts, they live in FIELDS with smooth sand
 * between, and finer cross-ripples run over them. All of that is here, and
 * the whole tile seams nowhere. Tint-neutral: the dunes' vertex colour
 * supplies the tone.
 */
export function sandSkin(): Skin {
  return skinTiled('sand', 256, 101, (x, y, T) => {
    // The ripple field bends with a slow warp, so no two ripples are parallel.
    const warp = (T(3)(x, y) - 0.5) * 0.22 + (T(7)(x + 0.5, y) - 0.5) * 0.05;
    const phase = (y + warp) * 11;
    const saw = phase - Math.floor(phase);
    // Stoss side rises over 72% of the wavelength; the lee drops over 28%.
    const ripple = saw < 0.72 ? saw / 0.72 : 1 - (saw - 0.72) / 0.28;
    // Where the ripples are: fields, with smooth sand between them.
    const field = clamp01((T(4)(x + 0.25, y + 0.25) - 0.3) * 2.0);
    // Cross-ripples: finer, fainter, at a different angle.
    const cross = 0.5 + 0.5 * Math.sin((x * 23 + T(6)(x, y) * 1.4) * Math.PI * 2);
    const grain = T(64)(x, y) * 0.55 + T(32)(x, y) * 0.45;
    const mottle = T(5)(x, y) - 0.5;
    const h = ripple * 0.5 * field + (1 - field) * 0.28 + cross * 0.1 + grain * 0.36;
    const l = 0.85 + (ripple - 0.5) * 0.14 * field + (grain - 0.5) * 0.1 + mottle * 0.08;
    return [l, l * 0.985, l * 0.955, h];
  });
}

/**
 * THE MESA FACE — the bed table (strata.ts) painted: each bed its own
 * sandstone colour, a dark recessed parting at its top, a massive bed
 * pale and proud, a shale seam thin and dark. Over that, the marks the
 * weather leaves: VERTICAL JOINTS (the fracture lines a cliff breaks
 * along, a few per tile, cutting the massive beds most), DESERT VARNISH
 * (dark streaks water draws down the face) and grain. NOT tint-neutral —
 * the colour is in the beds, so the geometry's vertex colour carries only
 * shading and a per-mesa cast. One tile is TILE_M metres of cliff
 * (rocks.ts lays the UVs in metres).
 */
export function mesaSkin(): Skin {
  return skinTiled('mesa', 512, 202, (x, y, T) => {
    const wob = (T(3)(x, y) - 0.5) * 0.014 + (T(24)(x, y) - 0.5) * 0.003;
    const v = (((y + wob) % 1) + 1) % 1;
    const bed = bedAt(v);
    const bl = (v - bed.v0) / Math.max(1e-4, bed.v1 - bed.v0);
    // The parting: the top edge of every bed, sharper on the massive ones.
    const partW = bed.seam ? 0.35 : 0.08;
    const parting = clamp01((bl - (1 - partW)) / partW) * (bed.hard ? 0.6 : 1);
    // Joints: noise that varies only across → vertical lines where it peaks.
    const j = T(18, 1)(x, y);
    const jointMask = clamp01((T(5)(x, y + 0.5) - 0.42) * 4);
    const joint = clamp01((0.045 - Math.abs(j - 0.5)) / 0.045) * jointMask * (bed.hard ? 1 : 0.45);
    // Varnish: tall thin noise → streaks down the face, in some columns only.
    const streak = T(48, 6)(x, y);
    const varnish = clamp01((streak - 0.55) * 2.4) * (0.3 + 0.7 * T(4)(x + 0.3, y)) * (bed.hard ? 1 : 0.5);
    const grain = T(96)(x, y) * 0.5 + T(48)(x, y) * 0.5;
    const shade =
      (1 + (bed.tone - 0.5) * 0.14) *
      (1 - parting * 0.55) *
      (1 - joint * 0.55) *
      (1 - varnish * 0.42) *
      (1 + (grain - 0.5) * 0.2);
    const [r, g, b] = bed.colour;
    const h = 0.5 - bed.inset * 2.5 - parting * 0.5 - joint * 0.35 + (grain - 0.5) * 0.2 - varnish * 0.04;
    return [r * shade, g * shade, b * shade, h];
  });
}

/**
 * A BOULDER's hide: sandstone with no bedding to speak of at this size —
 * fine grain, a few cracks, the pits weathering leaves, a lichen fleck or
 * two. Tint-neutral; the instance colour and the vertex shading decide.
 */
export function boulderSkin(): Skin {
  return skinTiled('boulder', 256, 606, (x, y, T) => {
    const grain = T(64)(x, y) * 0.5 + T(32)(x, y) * 0.5;
    const c1 = Math.abs(T(4)(x, y) - 0.5);
    const c2 = Math.abs(T(6)(x + 0.5, y + 0.3) - 0.48);
    // Cracks are hairlines that fade in and out, not inked outlines; lichen
    // is a grey-green dusting in a few hollows, not paint.
    const crackMask = clamp01((T(3)(x + 0.4, y + 0.1) - 0.35) * 2.5);
    const crack = Math.max(clamp01((0.011 - c1) / 0.011), clamp01((0.009 - c2) / 0.009) * 0.7) * crackMask;
    const pit = clamp01((T(20)(x, y) - 0.68) * 5);
    const lichen = clamp01((T(9)(x + 0.2, y + 0.7) - 0.76) * 6) * (1 - crack);
    const l = 0.84 + (grain - 0.5) * 0.16 - crack * 0.28 - pit * 0.16;
    const h = 0.55 + (grain - 0.5) * 0.3 - crack * 0.5 - pit * 0.4;
    return [l * (1 - lichen * 0.12), l * (1 - lichen * 0.02), l * (1 - lichen * 0.16) * 0.94, h];
  });
}

/**
 * CACTUS HIDE, one tile per RIB: u runs around one rib (the crest at the
 * tile's centre, the troughs at its edges), v runs up the rib with an
 * AREOLE every tile — the pale woolly dot with its fan of spines. The
 * trough is shaded darker than the crest so the ribs read even where the
 * light is flat. Tint-neutral: the plant's own green comes from the
 * material and the vertex colour.
 */
export function cactusSkin(): Skin {
  return skinTiled('cactus', 128, 808, (x, y, T) => {
    // Across the rib: crest at x = 0.5, troughs at the edges.
    const crest = 0.5 + 0.5 * Math.cos((x - 0.5) * Math.PI * 2);
    const grain = T(24)(x, y) * 0.6 + T(12)(x, y) * 0.4;
    // The areole: a pale dot on the crest, and spines fanning from it.
    const dx = x - 0.5;
    const dy = y - 0.5;
    const d = Math.hypot(dx * 1.15, dy * 2.2);
    const wool = clamp01((0.07 - d) / 0.03);
    let spine = 0;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      const ux = Math.cos(a);
      const uy = Math.sin(a) * 0.5; // squashed by the tile's aspect
      const along = dx * ux + dy * uy;
      const across = Math.abs(dx * -uy * 2 + dy * ux * 0.5);
      if (along > 0.02 && along < 0.25) spine = Math.max(spine, clamp01((0.012 - across) / 0.012) * (1 - along / 0.3));
    }
    const l = 0.62 + crest * 0.3 + (grain - 0.5) * 0.1;
    const r = l * 0.86 + wool * 0.35 + spine * 0.4;
    const g = l + wool * 0.28 + spine * 0.3;
    const b = l * 0.7 + wool * 0.3 + spine * 0.25;
    const h = 0.4 + crest * 0.35 + (grain - 0.5) * 0.12 + wool * 0.25;
    return [r, g, b, h];
  });
}

/** Wind-carved rock: horizontal strata, grain, the odd darker seam. */
export function rockSkin(): Skin {
  return skin('rock', 256, 202, (x, y, n) => {
    const warp = n(x * 3, y * 3) * 0.08;
    const strata = 0.5 + 0.5 * Math.sin((y + warp) * Math.PI * 2 * 7);
    const seam = clamp01((n(x * 6, y * 12) - 0.62) * 6);
    const grain = n(x * 24, y * 24, 3);
    const h = clamp01(strata * 0.5 + grain * 0.5 - seam * 0.5);
    const l = 0.78 + (strata - 0.5) * 0.22 + (grain - 0.5) * 0.18 - seam * 0.3;
    return [l, l * 0.93, l * 0.86, h];
  });
}

/** Oxidised iron: mottled, drip-streaked, with bright blooms of rust. */
export function rustSkin(): Skin {
  return skin('rust', 256, 303, (x, y, n) => {
    const mottle = n(x * 8, y * 8, 3);
    const drip = n(x * 20, y * 3, 2); // stretched down the face
    const bloom = clamp01((n(x * 5, y * 5) - 0.58) * 5);
    const h = clamp01(mottle * 0.6 + bloom * 0.5 + (drip - 0.5) * 0.3);
    const l = 0.62 + (mottle - 0.5) * 0.3 - (drip - 0.5) * 0.25;
    return [clamp01(l + bloom * 0.35), clamp01(l * 0.9 + bloom * 0.12), clamp01(l * 0.8), h];
  });
}

/** Dead bark: deep vertical fissures, cracked plates between them. */
export function barkSkin(): Skin {
  return skin('bark', 256, 404, (x, y, n) => {
    const fissure = clamp01((n(x * 14, y * 2, 2) - 0.5) * 3);
    const plate = n(x * 10, y * 10, 3);
    const h = clamp01(0.3 + plate * 0.5 - fissure * 0.6);
    const l = 0.66 + (plate - 0.5) * 0.24 - fissure * 0.4;
    return [l, l * 0.9, l * 0.8, h];
  });
}

/** Sun-cured plank: long grain, a knot or two, the tone drifting. */
export function woodSkin(): Skin {
  return skin('wood', 256, 505, (x, y, n) => {
    const grain = 0.5 + 0.5 * Math.sin((y * 18 + n(x * 2, y * 6) * 3) * Math.PI * 2);
    const tone = n(x * 2, y * 2);
    const h = clamp01(grain * 0.35 + n(x * 20, y * 4, 2) * 0.65);
    const l = 0.74 + (tone - 0.5) * 0.2 + (grain - 0.5) * 0.12;
    return [l, l * 0.92, l * 0.82, h];
  });
}

/** Bleached bone: ivory with pores and a few fine cracks. */
export function boneSkin(): Skin {
  return skin('bone', 256, 606, (x, y, n) => {
    const pore = n(x * 28, y * 28, 3);
    const crack = clamp01((n(x * 4, y * 16, 2) - 0.66) * 8);
    const h = clamp01(0.55 + (pore - 0.5) * 0.5 - crack * 0.8);
    const l = 0.9 + (pore - 0.5) * 0.1 - crack * 0.35;
    return [l, l * 0.97, l * 0.9, h];
  });
}

/* ── materials ─────────────────────────────────────────────────────────── */

export interface SkinOpts {
  /** Texture repeats across UV space. */
  repeat?: [number, number];
  roughness?: number;
  metalness?: number;
  bumpScale?: number;
  envMapIntensity?: number;
  /** Anisotropic filtering on this use of the maps (default 4). The sand
   *  takes 1: at a grazing angle the mip chain then blurs its ripples out
   *  by the mid-distance, which is exactly where a tiled pattern turns into
   *  corduroy if it stays sharp. */
  anisotropy?: number;
}

/** A standard material wearing a skin: colour from `hex`, surface from the
 *  maps. Each call clones the cached textures so per-use repeats never
 *  fight (a clone shares the GPU image). */
export function skinned(s: Skin, hex: string | number, o: SkinOpts = {}): MeshStandardMaterial {
  const map = s.map.clone();
  const bump = s.bump.clone();
  const [rx, ry] = o.repeat ?? [1, 1];
  map.repeat.set(rx, ry);
  bump.repeat.set(rx, ry);
  if (o.anisotropy !== undefined) map.anisotropy = bump.anisotropy = o.anisotropy;
  map.needsUpdate = bump.needsUpdate = true;
  return new MeshStandardMaterial({
    color: hex,
    map,
    bumpMap: bump,
    bumpScale: o.bumpScale ?? 0.03,
    roughness: o.roughness ?? 0.9,
    metalness: o.metalness ?? 0,
    envMapIntensity: o.envMapIntensity ?? 0.45,
  });
}

export const rockMat = (hex: string | number, o: SkinOpts = {}): MeshStandardMaterial =>
  skinned(rockSkin(), hex, { roughness: 0.94, bumpScale: 0.05, ...o });
export const boulderMat = (hex: string | number, o: SkinOpts = {}): MeshStandardMaterial =>
  skinned(boulderSkin(), hex, { roughness: 0.92, bumpScale: 0.06, envMapIntensity: 0.35, ...o });
export const cactusMat = (hex: string | number, o: SkinOpts = {}): MeshStandardMaterial =>
  skinned(cactusSkin(), hex, { roughness: 0.62, bumpScale: 0.02, envMapIntensity: 0.5, ...o });
export const rustMat = (hex: string | number, o: SkinOpts = {}): MeshStandardMaterial =>
  skinned(rustSkin(), hex, { roughness: 0.68, metalness: 0.45, bumpScale: 0.02, envMapIntensity: 0.5, ...o });
export const barkMat = (hex: string | number, o: SkinOpts = {}): MeshStandardMaterial =>
  skinned(barkSkin(), hex, { roughness: 0.97, bumpScale: 0.05, ...o });
export const woodMat = (hex: string | number, o: SkinOpts = {}): MeshStandardMaterial =>
  skinned(woodSkin(), hex, { roughness: 0.92, bumpScale: 0.02, ...o });
export const boneMat = (hex: string | number, o: SkinOpts = {}): MeshStandardMaterial =>
  skinned(boneSkin(), hex, { roughness: 0.5, bumpScale: 0.015, envMapIntensity: 0.9, ...o });

/* ── soft sprites (clouds, glow) ───────────────────────────────────────── */

let softTex: CanvasTexture | null = null;

/** A soft, slightly ragged disc — the cloud puff and the fire's glow. */
export function softSprite(color: string | number, opacity = 1): SpriteMaterial {
  if (!softTex) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const rng = makeRng(707);
    const noise = valueNoise2D(rng, 8);
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size - 0.5;
        const dy = (y + 0.5) / size - 0.5;
        const r = Math.hypot(dx, dy) * 2;
        const rag = 0.86 + noise((x / size) * 6, (y / size) * 6) * 0.28;
        const a = clamp01(1 - r / rag);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = a * a * (3 - 2 * a) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    softTex = new CanvasTexture(c);
    softTex.colorSpace = SRGBColorSpace;
  }
  return new SpriteMaterial({ map: softTex, color, transparent: true, opacity, depthWrite: false });
}
