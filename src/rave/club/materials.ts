/**
 * The club's material wardrobe — every surface painted by hand on small
 * tileable canvases (no shipped image assets, same discipline as the rest of
 * the game). NEON INDUSTRIAL: board-formed concrete, checker plate, sealed
 * concrete floor, quilted black vinyl, brushed stainless, rubber matting,
 * painted riveted plate — saturated colour is reserved for LIGHT (the neon
 * runs, the hazard coves, the candles, the eclipse).
 *
 * The function names are the deco wardrobe's (plaster, parquet, velvet,
 * marble, oak…) because build.ts calls them by those names in a hundred
 * places; what each paints is the industrial surface that took that
 * material's job. Roughness separation still carries the "expensive"
 * read: concrete is dead matte, vinyl swallows light, plate is satin,
 * stainless is brushed, galvanised steel is the one thing allowed to shine.
 */

import {
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { DECOR } from './config.js';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function wrap(c: HTMLCanvasElement, repeat: [number, number]): CanvasTexture {
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** Deterministic per-texture rng so rebuilds look identical. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const cache = new Map<string, CanvasTexture>();
function cached(key: string, make: () => CanvasTexture): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = make();
  cache.set(key, tex);
  return tex;
}

/* ── surfaces ───────────────────────────────────────────────────────────── */

/** Board-formed concrete: the grain of the shuttering left in the wall,
 *  pour lines, and a grid of tie holes. (Was: charcoal lime plaster.) */
export function plasterTexture(repeat: [number, number] = [4, 2]): CanvasTexture {
  return cached(`plaster${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x9145);
    g.fillStyle = css(DECOR.plaster);
    g.fillRect(0, 0, 256, 256);
    // Boards: horizontal bands a shade apart, each with faint wood grain
    // pressed into the concrete.
    const BOARD = 32;
    for (let y = 0; y < 256; y += BOARD) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
      g.fillRect(0, y, 256, BOARD);
      g.strokeStyle = 'rgba(0,0,0,0.28)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(256, y + 0.5);
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.07)';
      g.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const gy = y + 4 + r() * (BOARD - 8);
        g.beginPath();
        g.moveTo(0, gy);
        g.bezierCurveTo(90, gy + (r() - 0.5) * 3, 170, gy + (r() - 0.5) * 3, 256, gy);
        g.stroke();
      }
    }
    // Tie holes: a cone of shadow with a lit rim, on a grid.
    for (const x of [48, 208]) {
      for (const y of [64, 192]) {
        const hole = g.createRadialGradient(x - 1, y - 1, 0, x, y, 7);
        hole.addColorStop(0, 'rgba(0,0,0,0.75)');
        hole.addColorStop(0.7, 'rgba(0,0,0,0.5)');
        hole.addColorStop(1, 'rgba(255,255,255,0.08)');
        g.fillStyle = hole;
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Grit and the odd stain.
    for (let i = 0; i < 700; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(220,220,225,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(r() * 256, r() * 256, 1, 1);
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(40,36,30,0.12)';
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 16 + r() * 30, 30 + r() * 60, 0, 0, Math.PI * 2);
      g.fill();
    }
    return wrap(c, repeat);
  });
}

/** CHECKER PLATE — the dance floor. Raised diamond bars in a staggered
 *  grid on dark steel, each with a lit edge up-left and a shadow down-right,
 *  and the wear of ten thousand feet down the middle. (Was: herringbone
 *  parquet.) */
export function parquetTexture(repeat: [number, number] = [3, 3]): CanvasTexture {
  return cached(`parquet${repeat}`, () => {
    const [c, g] = canvas(512);
    const r = rng(0xdacef100);
    g.fillStyle = css(DECOR.oak);
    g.fillRect(0, 0, 512, 512);
    // Mill scale: faint blotches under everything.
    for (let i = 0; i < 60; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)';
      g.beginPath();
      g.ellipse(r() * 512, r() * 512, 20 + r() * 50, 12 + r() * 30, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    const cell = 32;
    g.lineCap = 'round';
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 16; col++) {
        const cx = col * cell + cell / 2 + (row % 2 ? cell / 2 : 0);
        const cy = row * cell + cell / 2;
        const d = cell * 0.27;
        const diag = (row + col) % 2 ? 1 : -1;
        // Shadow, then bar, then highlight — a raised diamond.
        for (const [dx, dy, style, w] of [
          [1.5, 1.5, 'rgba(0,0,0,0.55)', 5],
          [0, 0, 'rgba(120,124,132,0.9)', 4],
          [-1.2, -1.2, 'rgba(230,234,240,0.55)', 1.6],
        ] as const) {
          g.strokeStyle = style;
          g.lineWidth = w;
          g.beginPath();
          g.moveTo(cx - d + dx, cy - d * diag + dy);
          g.lineTo(cx + d + dx, cy + d * diag + dy);
          g.stroke();
        }
      }
    }
    // Wear: the middle is walked bright and the edges keep their scale.
    const wear = g.createRadialGradient(256, 256, 40, 256, 256, 300);
    wear.addColorStop(0, 'rgba(255,255,255,0.07)');
    wear.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = wear;
    g.fillRect(0, 0, 512, 512);
    return wrap(c, repeat);
  });
}

/** Sealed concrete floor with a saw-cut joint grid and the odd crack —
 *  walkways and the bar floor. (Was: honed terrazzo.) */
export function terrazzoTexture(repeat: [number, number] = [6, 6]): CanvasTexture {
  return cached(`terrazzo${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x7e44a);
    g.fillStyle = css(DECOR.stone);
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const t = r();
      g.fillStyle = t > 0.6 ? 'rgba(180,185,198,0.07)' : t > 0.3 ? 'rgba(120,126,140,0.08)' : 'rgba(8,9,12,0.16)';
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 2 + r() * 6, 1 + r() * 4, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // Trowel sweep, faint.
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = 'rgba(255,255,255,0.025)';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 60 + r() * 80, r() * Math.PI, r() * Math.PI + 1.2);
      g.stroke();
    }
    // Saw-cut joints on the tile's edges (they wrap into a grid).
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, 0.5);
    g.lineTo(256, 0.5);
    g.moveTo(0.5, 0);
    g.lineTo(0.5, 256);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 3);
    g.lineTo(256, 3);
    g.moveTo(3, 0);
    g.lineTo(3, 256);
    g.stroke();
    // One hairline crack.
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 0.9;
    g.beginPath();
    let x = 40 + r() * 60;
    let y = 200;
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (r() - 0.3) * 30;
      y -= 20 + r() * 20;
      g.lineTo(x, y);
    }
    g.stroke();
    return wrap(c, repeat);
  });
}

/** DEEP RED QUILTED VELVET — a satin nap, and with `channels` the diamond
 *  quilting of a fight-club banquette, each pad crowned and buttoned. Dark
 *  enough to sit inside the club's black register; red enough to read as
 *  fabric rather than as a hole in the room. */
export function velvetTexture(repeat: [number, number] = [2, 1], channels = 0): CanvasTexture {
  return cached(`velvet${repeat}|${channels}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0xb100d);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, css(DECOR.velvet));
    grad.addColorStop(0.55, css(DECOR.velvetDeep));
    grad.addColorStop(1, css(DECOR.velvet));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // Satin: fine strokes catching a little light.
    for (let i = 0; i < 380; i++) {
      const x = r() * 256;
      g.strokeStyle = r() > 0.5 ? 'rgba(200,205,215,0.035)' : 'rgba(0,0,0,0.07)';
      g.beginPath();
      g.moveTo(x, r() * 256);
      g.lineTo(x + (r() - 0.5) * 4, r() * 256);
      g.stroke();
    }
    if (channels > 0) {
      // Vertical channels become QUILTED PADS: the same width, each with a
      // crowned highlight, a seam, and a button at every crossing.
      const w = 256 / channels;
      const rows = 2;
      const h = 256 / rows;
      for (let i = 0; i < channels; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * w;
          const y = j * h;
          const crown = g.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
          crown.addColorStop(0, 'rgba(255,255,255,0.11)');
          crown.addColorStop(0.7, 'rgba(255,255,255,0.02)');
          crown.addColorStop(1, 'rgba(0,0,0,0.45)');
          g.fillStyle = crown;
          g.fillRect(x, y, w, h);
          g.strokeStyle = 'rgba(0,0,0,0.6)';
          g.lineWidth = 2;
          g.strokeRect(x + 0.5, y + 0.5, w, h);
          // Stitch dashes along the seams.
          g.setLineDash([3, 3]);
          g.strokeStyle = 'rgba(190,195,205,0.18)';
          g.lineWidth = 1;
          g.strokeRect(x + 2.5, y + 2.5, w - 4, h - 4);
          g.setLineDash([]);
          // The button.
          g.fillStyle = 'rgba(0,0,0,0.7)';
          g.beginPath();
          g.arc(x, y, 3.2, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(160,168,176,0.7)';
          g.beginPath();
          g.arc(x - 0.6, y - 0.6, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    return wrap(c, repeat);
  });
}

/** Reeded glass — vertical reeds, backlit by an emissive material. Cooler
 *  than it was: the light behind it is a tube now, not a lamp. */
export function ribbedGlassTexture(repeat: [number, number] = [6, 1]): CanvasTexture {
  return cached(`ribbed${repeat}`, () => {
    const [c, g] = canvas(128);
    const REED = 16;
    for (let x = 0; x < 128; x += REED) {
      const reed = g.createLinearGradient(x, 0, x + REED, 0);
      reed.addColorStop(0, '#4c5560');
      reed.addColorStop(0.28, '#c6d2dc');
      reed.addColorStop(0.5, '#eef6ff');
      reed.addColorStop(0.72, '#c6d2dc');
      reed.addColorStop(1, '#4c5560');
      g.fillStyle = reed;
      g.fillRect(x, 0, REED, 128);
    }
    const fade = g.createLinearGradient(0, 0, 0, 128);
    fade.addColorStop(0, 'rgba(18,22,30,0.35)');
    fade.addColorStop(0.5, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(18,22,30,0.35)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 128, 128);
    return wrap(c, repeat);
  });
}

/** BRUSHED STAINLESS — long drag lines, a soft anisotropic band, a few
 *  scuffs — counter and table tops. (Was: honed marble.) */
export function marbleTexture(repeat: [number, number] = [2, 1]): CanvasTexture {
  return cached(`marble${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x3a4b1e);
    g.fillStyle = '#5c6169';
    g.fillRect(0, 0, 256, 256);
    // The brush: hundreds of hairlines across.
    for (let i = 0; i < 900; i++) {
      const y = r() * 256;
      g.strokeStyle = r() > 0.5 ? `rgba(255,255,255,${0.03 + r() * 0.06})` : `rgba(0,0,0,${0.04 + r() * 0.08})`;
      g.lineWidth = 0.6 + r() * 0.8;
      const x0 = r() * 256;
      g.beginPath();
      g.moveTo(x0 - 80, y);
      g.lineTo(x0 + 80 + r() * 120, y + (r() - 0.5) * 0.6);
      g.stroke();
    }
    // The anisotropic sheen band.
    const band = g.createLinearGradient(0, 0, 0, 256);
    band.addColorStop(0, 'rgba(0,0,0,0.12)');
    band.addColorStop(0.42, 'rgba(255,255,255,0.10)');
    band.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    band.addColorStop(0.58, 'rgba(255,255,255,0.10)');
    band.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = band;
    g.fillRect(0, 0, 256, 256);
    // Scuffs: a few arcs against the grain.
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 20 + r() * 40, r() * Math.PI * 2, r() * Math.PI * 2 + 0.8);
      g.stroke();
    }
    return wrap(c, repeat);
  });
}

/** RUBBER MATTING down the lounge aisle: raised studs on a grid, and a
 *  hazard-amber edge stripe either side. (Was: the deco fan carpet.) */
export function runnerTexture(repeat: [number, number] = [1, 3]): CanvasTexture {
  return cached(`runner${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x5a11);
    g.fillStyle = '#1b1c20';
    g.fillRect(0, 0, 256, 256);
    // The studs.
    for (let y = 8; y < 256; y += 16) {
      for (let x = 8; x < 256; x += 16) {
        if (x < 34 || x > 222) continue;
        const stud = g.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5.5);
        stud.addColorStop(0, 'rgba(120,124,132,0.85)');
        stud.addColorStop(0.6, 'rgba(50,52,58,0.9)');
        stud.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = stud;
        g.beginPath();
        g.arc(x, y, 5.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Hazard stripe edges: amber and black, diagonal.
    for (const [x0, x1] of [
      [8, 26],
      [230, 248],
    ] as const) {
      g.save();
      g.beginPath();
      g.rect(x0, 0, x1 - x0, 256);
      g.clip();
      g.fillStyle = css(DECOR.cove);
      g.fillRect(x0, 0, x1 - x0, 256);
      g.fillStyle = 'rgba(0,0,0,0.85)';
      for (let y = -32; y < 256 + 32; y += 32) {
        g.beginPath();
        g.moveTo(x0 - 20, y);
        g.lineTo(x1 + 20, y + 20);
        g.lineTo(x1 + 20, y + 36);
        g.lineTo(x0 - 20, y + 16);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    // Wear: the middle is walked dull.
    const wear = g.createLinearGradient(64, 0, 192, 0);
    wear.addColorStop(0, 'rgba(0,0,0,0)');
    wear.addColorStop(0.5, 'rgba(0,0,0,0.22)');
    wear.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wear;
    g.fillRect(0, 0, 256, 256);
    void r;
    return wrap(c, repeat);
  });
}

/** PAINTED STEEL PLATE for the bar front and the stage skirt: panels with
 *  a rivet row along every seam, the paint chipped to bare metal at the
 *  edges. (Was: waxed oak planking.) */
export function oakTexture(repeat: [number, number] = [3, 1]): CanvasTexture {
  return cached(`oak${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x0a45);
    g.fillStyle = css(DECOR.oak);
    g.fillRect(0, 0, 256, 256);
    const PANEL = 64;
    for (let y = 0; y < 256; y += PANEL) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
      g.fillRect(0, y, 256, PANEL);
      // The seam: a dark cut and a lit lip.
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(256, y + 0.5);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.09)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y + 2.5);
      g.lineTo(256, y + 2.5);
      g.stroke();
      // Rivets along the seam.
      for (let x = 12; x < 256; x += 24) {
        const riv = g.createRadialGradient(x - 1, y + 9, 0.5, x, y + 10, 4);
        riv.addColorStop(0, 'rgba(190,196,204,0.9)');
        riv.addColorStop(0.6, 'rgba(70,74,80,0.9)');
        riv.addColorStop(1, 'rgba(0,0,0,0.6)');
        g.fillStyle = riv;
        g.beginPath();
        g.arc(x, y + 10, 4, 0, Math.PI * 2);
        g.fill();
      }
      // Chips and scuffs in the paint.
      for (let k = 0; k < 5; k++) {
        g.fillStyle = 'rgba(150,156,164,0.28)';
        g.beginPath();
        g.ellipse(r() * 256, y + 14 + r() * 44, 1 + r() * 4, 0.6 + r() * 2, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
    return wrap(c, repeat);
  });
}

/** CORRUGATED STEEL SHEETING — the stage's back wall, where the velvet
 *  drapes hung: vertical ribs each shaded across its wave, galvanised
 *  spangle in the flats, and rust bleeding up from the bottom edge. */
export function corrugatedTexture(repeat: [number, number] = [2, 2]): CanvasTexture {
  return cached(`corrugated${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0xc0ff33);
    const RIB = 32;
    for (let x = 0; x < 256; x += RIB) {
      const wave = g.createLinearGradient(x, 0, x + RIB, 0);
      wave.addColorStop(0, '#5a6169');
      wave.addColorStop(0.18, '#8d969e');
      wave.addColorStop(0.32, '#b3bcc4');
      wave.addColorStop(0.5, '#8d969e');
      wave.addColorStop(0.72, '#4a5158');
      wave.addColorStop(0.9, '#3a4047');
      wave.addColorStop(1, '#5a6169');
      g.fillStyle = wave;
      g.fillRect(x, 0, RIB, 256);
    }
    // Spangle: the zinc crystal flecks.
    for (let i = 0; i < 500; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    // Rust, bleeding up from the bottom in streaks.
    const rust = g.createLinearGradient(0, 256, 0, 150);
    rust.addColorStop(0, 'rgba(120,58,22,0.55)');
    rust.addColorStop(0.5, 'rgba(120,58,22,0.14)');
    rust.addColorStop(1, 'rgba(120,58,22,0)');
    g.fillStyle = rust;
    g.fillRect(0, 150, 256, 106);
    for (let i = 0; i < 9; i++) {
      const x = r() * 256;
      const h = 30 + r() * 90;
      const streak = g.createLinearGradient(0, 256, 0, 256 - h);
      streak.addColorStop(0, 'rgba(140,70,26,0.45)');
      streak.addColorStop(1, 'rgba(140,70,26,0)');
      g.fillStyle = streak;
      g.fillRect(x, 256 - h, 3 + r() * 5, h);
    }
    return wrap(c, repeat);
  });
}

/* ── material shorthands ────────────────────────────────────────────────── */

/** GALVANISED STEEL — the wardrobe's `brass`: zinc-grey, a little duller
 *  than brass ever was, and the one thing in the building allowed to shine. */
export const brassMat = (rough = 0.28): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: DECOR.brass, metalness: 0.92, roughness: Math.max(0.34, rough + 0.08) });

/** GUNMETAL — the wardrobe's `bronze`: the structural dark steel. */
export const bronzeMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: DECOR.bronze, metalness: 0.85, roughness: 0.48 });

export const blackSteelMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: 0x1b1c21, metalness: 0.8, roughness: 0.55 });

/** A steel piece with a HAZARD-AMBER glow in it — cove strips, ring underglow. */
export const brassGlowMat = (intensity: number): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: DECOR.brass,
    emissive: DECOR.cove,
    emissiveIntensity: intensity,
    metalness: 0.6,
    roughness: 0.4,
  });

/** A NEON TUBE: unlit, tone-mapping bypassed so it burns at its own colour
 *  whatever the room's exposure — the architecture's lines, the rings'
 *  channels, the signage. */
export const neonMat = (color: number = DECOR.neon, intensity = 1): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), toneMapped: false });
