/**
 * THE TITANS' SKINS — a procedural surface per machine, so the iron reads
 * as iron and not as flat-shaded primitives. Each style gets a seamless
 * tile drawn once (and cached): a near-white COLOUR map that multiplies
 * the paint (so the chassis colour still rules), a ROUGHNESS map (green
 * channel, three.js's convention — the material's own roughness is set to
 * 1 and the map says the rest), a METALNESS map (rust, soot and paint are
 * not bare metal — at a flat 0.9 the painted hulls mirrored the room and
 * went black), and a BUMP map for the relief the arena light catches:
 *
 *   rust     RUSTHOOK — blotched rust over bare steel, pitting, and weeps
 *            running down from every seam. Rough where it's rotten.
 *   forged   PISTONKAISER — drop-forge hammer dimples, soot, and the straw
 *            and blue heat-tint bands of iron that's been in the fire.
 *   plumage  VULTURE — overlapping scale plates, row on row, like the
 *            feathering on a raptor's leg.
 *   armour   JUGGERNAUT — bolted panel seams on a grid, rivets down every
 *            seam, and a weld bead or two.
 *   royal    GOLIATH — brushed black plate, polished, with scrollwork
 *            engraved into it.
 *
 * Seamless by construction: anything drawn near an edge is drawn again
 * one tile over, so a repeat never shows a cut.
 */

import { CanvasTexture, LinearMipMapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';

export type TitanSkinId = 'rust' | 'forged' | 'plumage' | 'armour' | 'royal';

export interface TitanSkinMaps {
  map: CanvasTexture;
  roughnessMap: CanvasTexture;
  /** How metal each spot is (grey value; material.metalness is set to 1). */
  metalnessMap: CanvasTexture;
  bumpMap: CanvasTexture;
  /** How hard the relief reads (material.bumpScale). */
  bumpScale: number;
}

const S = 256;

/** Small seeded rng so the tiles are the same every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(fill: string): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = fill;
  g.fillRect(0, 0, S, S);
  return g;
}

/** Draw `fn` at (x, y) and at every wrapped copy that would touch the tile. */
function wrapped(x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-S, 0, S]) {
    for (const dy of [-S, 0, S]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
      fn(px, py);
    }
  }
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  wrapped(x, y, r, (px, py) => {
    const grad = g.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(px - r, py - r, r * 2, r * 2);
  });
}

function speckle(g: CanvasRenderingContext2D, rand: () => number, n: number, light: string, dark: string, size = 1.5): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? light : dark;
    g.fillRect(rand() * S, rand() * S, size, size);
  }
}

function tex(g: CanvasRenderingContext2D, srgb: boolean): CanvasTexture {
  const t = new CanvasTexture(g.canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipMapLinearFilter;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

/* ── the five skins ───────────────────────────────────────────────────── */

function rust(): [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, number] {
  const r = rng(0x5c4a9);
  const col = canvas('#d9d6d0'); // bare steel under it all
  const rough = canvas('rgb(0,150,0)');
  const bump = canvas('#808080');
  const metal = canvas('#d0d0d0'); // bare steel shines
  // Rust blooms: big soft orange-brown patches, darker hearts.
  for (let i = 0; i < 26; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 18 + r() * 46;
    blob(col, x, y, rad, `rgba(${150 + r() * 50},${70 + r() * 30},${25 + r() * 20},0.75)`);
    blob(col, x, y, rad * 0.45, 'rgba(70,32,14,0.55)');
    blob(rough, x, y, rad, 'rgba(0,245,0,0.8)');
    blob(metal, x, y, rad, 'rgba(40,40,40,0.9)'); // rust is no metal at all
    blob(bump, x, y, rad * 0.8, 'rgba(60,60,60,0.35)');
  }
  // Pitting: a dense scatter of pocks, dark in colour and sunk in relief.
  for (let i = 0; i < 900; i++) {
    const x = r() * S;
    const y = r() * S;
    const d = 0.8 + r() * 2.2;
    col.fillStyle = `rgba(40,20,8,${0.25 + r() * 0.4})`;
    col.beginPath();
    col.arc(x, y, d, 0, Math.PI * 2);
    col.fill();
    bump.fillStyle = 'rgba(20,20,20,0.7)';
    bump.beginPath();
    bump.arc(x, y, d, 0, Math.PI * 2);
    bump.fill();
  }
  // Weeps: thin streaks running DOWN the plate (v grows downward).
  for (let i = 0; i < 34; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 30 + r() * 90;
    const w = 1 + r() * 3;
    for (const dy of [-S, 0]) {
      const grad = col.createLinearGradient(0, y + dy, 0, y + dy + len);
      grad.addColorStop(0, 'rgba(110,50,18,0.55)');
      grad.addColorStop(1, 'rgba(110,50,18,0)');
      col.fillStyle = grad;
      col.fillRect(x, y + dy, w, len);
      col.fillRect(x, y + dy + S, w, len);
    }
  }
  speckle(col, r, 500, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)');
  return [col, rough, bump, metal, 0.012];
}

function forged(): [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, number] {
  const r = rng(0xf0e6e);
  const col = canvas('#e4e2de');
  const rough = canvas('rgb(0,120,0)');
  const bump = canvas('#8a8a8a');
  const metal = canvas('#8c8c8c'); // forged, not polished: it holds its colour
  // Heat tint: soft pools of straw and blue where the iron took the fire —
  // temper colours bloom round a hot spot, they don't run in bands.
  for (let i = 0; i < 14; i++) {
    const straw = r() < 0.55;
    blob(col, r() * S, r() * S, 36 + r() * 44, straw ? 'rgba(215,160,85,0.4)' : 'rgba(95,120,215,0.38)');
  }
  // Hammer dimples: overlapping shallow cups — a dark rim, a lit floor.
  for (let i = 0; i < 150; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 6 + r() * 12;
    wrapped(x, y, rad, (px, py) => {
      const grad = bump.createRadialGradient(px, py, 0, px, py, rad);
      grad.addColorStop(0, 'rgba(60,60,60,0.55)');
      grad.addColorStop(0.75, 'rgba(90,90,90,0.25)');
      grad.addColorStop(1, 'rgba(200,200,200,0.25)');
      bump.fillStyle = grad;
      bump.beginPath();
      bump.arc(px, py, rad, 0, Math.PI * 2);
      bump.fill();
    });
    blob(col, x - rad * 0.3, y - rad * 0.3, rad * 0.8, 'rgba(255,255,255,0.10)');
    wrapped(x, y, rad, (px, py) => {
      col.strokeStyle = 'rgba(0,0,0,0.16)';
      col.lineWidth = 1.2;
      col.beginPath();
      col.arc(px, py, rad * 0.92, 0.2, Math.PI * 1.2);
      col.stroke();
    });
  }
  // Soot: dark smoky drifts, rougher where they lie.
  for (let i = 0; i < 16; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 25 + r() * 50;
    blob(col, x, y, rad, 'rgba(20,18,16,0.35)');
    blob(rough, x, y, rad, 'rgba(0,230,0,0.6)');
    blob(metal, x, y, rad, 'rgba(60,60,60,0.6)');
  }
  speckle(col, r, 700, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.14)');
  return [col, rough, bump, metal, 0.01];
}

function plumage(): [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, number] {
  const r = rng(0x7a17e);
  const col = canvas('#dcdcd4');
  const rough = canvas('rgb(0,105,0)');
  const bump = canvas('#707070');
  const metal = canvas('#8c8c8c');
  // Rows of scale plates, each row offset half a plate, drawn top to
  // bottom so each row laps over the one above — a raptor's leg.
  const w = S / 8;
  const h = S / 10;
  for (let row = -1; row <= 10; row++) {
    for (let k = -1; k <= 8; k++) {
      const x = k * w + (row % 2 ? w / 2 : 0);
      const y = row * h;
      const shade = 0.82 + r() * 0.18;
      // relief: a dome that falls off toward the lower rim
      const grad = bump.createRadialGradient(x + w / 2, y + h * 0.2, 1, x + w / 2, y + h * 0.4, w * 0.62);
      grad.addColorStop(0, '#e8e8e8');
      grad.addColorStop(0.8, '#8c8c8c');
      grad.addColorStop(1, '#303030');
      bump.fillStyle = grad;
      bump.beginPath();
      bump.ellipse(x + w / 2, y + h * 0.35, w * 0.56, h * 1.05, 0, 0, Math.PI);
      bump.fill();
      // colour: each plate its own shade, a dark lip at the rim
      col.fillStyle = `rgba(${Math.round(255 * shade)},${Math.round(255 * shade)},${Math.round(245 * shade)},1)`;
      col.beginPath();
      col.ellipse(x + w / 2, y + h * 0.35, w * 0.56, h * 1.05, 0, 0, Math.PI);
      col.fill();
      col.strokeStyle = 'rgba(0,0,0,0.35)';
      col.lineWidth = 1.2;
      col.beginPath();
      col.ellipse(x + w / 2, y + h * 0.35, w * 0.56, h * 1.05, 0, 0.15, Math.PI - 0.15);
      col.stroke();
      // the plate's quill: a faint spine down the middle
      col.strokeStyle = 'rgba(255,255,255,0.18)';
      col.beginPath();
      col.moveTo(x + w / 2, y + h * 0.4);
      col.lineTo(x + w / 2, y + h * 1.25);
      col.stroke();
    }
  }
  speckle(col, r, 300, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.1)');
  return [col, rough, bump, metal, 0.014];
}

function armour(): [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, number] {
  const r = rng(0xa4a0e);
  const col = canvas('#dedbe2');
  const rough = canvas('rgb(0,140,0)');
  const bump = canvas('#909090');
  const metal = canvas('#666666'); // painted hull — the scuffs are the metal
  // Mottling: slow blotches so the big plates aren't one flat value.
  for (let i = 0; i < 20; i++) {
    blob(col, r() * S, r() * S, 30 + r() * 50, r() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(30,20,40,0.16)');
  }
  // Panel seams on a 2×2 grid (lines at 0 and S/2 wrap cleanly), rivets
  // marching down each side of every seam.
  const seams = [0, S / 2];
  for (const at of seams) {
    for (const vertical of [true, false]) {
      const x0 = vertical ? at : 0;
      const y0 = vertical ? 0 : at;
      const ww = vertical ? 3 : S;
      const hh = vertical ? S : 3;
      bump.fillStyle = '#202020';
      bump.fillRect(x0 - 1.5, y0 - 1.5, ww, hh);
      bump.fillRect(x0 - 1.5 + (vertical && at === 0 ? S : 0), y0 - 1.5 + (!vertical && at === 0 ? S : 0), ww, hh);
      col.fillStyle = 'rgba(20,14,26,0.6)';
      col.fillRect(x0 - 1.5, y0 - 1.5, ww, hh);
      col.fillRect(x0 - 1.5 + (vertical && at === 0 ? S : 0), y0 - 1.5 + (!vertical && at === 0 ? S : 0), ww, hh);
      for (let t = 8; t < S; t += 16) {
        for (const off of [-7, 7]) {
          const x = vertical ? at + off : t;
          const y = vertical ? t : at + off;
          wrapped(x, y, 3, (px, py) => {
            const g1 = bump.createRadialGradient(px - 0.6, py - 0.6, 0, px, py, 2.6);
            g1.addColorStop(0, '#ffffff');
            g1.addColorStop(1, '#909090');
            bump.fillStyle = g1;
            bump.beginPath();
            bump.arc(px, py, 2.6, 0, Math.PI * 2);
            bump.fill();
            col.fillStyle = 'rgba(255,255,255,0.35)';
            col.beginPath();
            col.arc(px - 0.5, py - 0.5, 1.2, 0, Math.PI * 2);
            col.fill();
            col.fillStyle = 'rgba(0,0,0,0.3)';
            col.beginPath();
            col.arc(px + 0.8, py + 0.8, 1.6, 0, Math.PI * 2);
            col.fill();
          });
        }
      }
    }
  }
  // A weld bead across one panel: a ridged line of overlapping ripples.
  for (let t = 0; t < 70; t += 2.2) {
    const x = S * 0.62 + t;
    const y = S * 0.78 + Math.sin(t * 0.15) * 2;
    bump.fillStyle = 'rgba(230,230,230,0.8)';
    bump.beginPath();
    bump.arc(x, y, 2.4, 0, Math.PI * 2);
    bump.fill();
    col.fillStyle = 'rgba(80,60,50,0.35)';
    col.beginPath();
    col.arc(x, y, 2.6, 0, Math.PI * 2);
    col.fill();
  }
  // Scuffs: short bright scratches, the hull's been shot at.
  for (let i = 0; i < 60; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI;
    const len = 4 + r() * 14;
    for (const [g, c] of [[col, 'rgba(255,255,255,0.25)'], [metal, 'rgba(255,255,255,0.9)']] as const) {
      g.strokeStyle = c;
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
  }
  speckle(col, r, 400, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.1)');
  return [col, rough, bump, metal, 0.012];
}

function royal(): [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, number] {
  const r = rng(0x60714);
  const col = canvas('#d8d8dc');
  const rough = canvas('rgb(0,70,0)');
  const bump = canvas('#808080');
  const metal = canvas('#e0e0e0'); // polished plate
  // Brushed grain: fine horizontal streaks, wrapping across the tile.
  for (let i = 0; i < 700; i++) {
    const y = r() * S;
    const x = r() * S;
    const len = 20 + r() * 80;
    const a = r() < 0.5;
    col.fillStyle = a ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
    col.fillRect(x, y, len, 0.8);
    col.fillRect(x - S, y, len, 0.8);
    rough.fillStyle = a ? 'rgba(0,40,0,0.25)' : 'rgba(0,110,0,0.25)';
    rough.fillRect(x, y, len, 0.8);
    rough.fillRect(x - S, y, len, 0.8);
  }
  // Scrollwork: engraved spirals and the vine that links them, cut into
  // the bump and picked out faintly warm in the colour.
  const scroll = (g: CanvasRenderingContext2D, stroke: string, width: number): void => {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.lineCap = 'round';
    const cells = 4;
    const cw = S / cells;
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const ox = cx * cw + cw / 2;
        const oy = cy * cw + cw / 2;
        const dir = (cx + cy) % 2 ? 1 : -1;
        g.beginPath();
        for (let t = 0; t <= Math.PI * 3.2; t += 0.1) {
          const rad = 2 + t * 3.1;
          const x = ox + Math.cos(t * dir) * rad;
          const y = oy + Math.sin(t * dir) * rad;
          if (t === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        // the vine to the next cell (wraps at the tile edge)
        g.beginPath();
        g.moveTo(ox + cw * 0.3, oy);
        g.bezierCurveTo(ox + cw * 0.5, oy - cw * 0.3 * dir, ox + cw * 0.6, oy + cw * 0.3 * dir, ox + cw * 0.72, oy);
        g.stroke();
        // a leaf off the vine
        g.beginPath();
        g.moveTo(ox + cw * 0.5, oy);
        g.quadraticCurveTo(ox + cw * 0.56, oy - cw * 0.2 * dir, ox + cw * 0.46, oy - cw * 0.26 * dir);
        g.stroke();
      }
    }
  };
  scroll(bump, '#3a3a3a', 2.2);
  scroll(col, 'rgba(210,170,80,0.45)', 1.4);
  scroll(rough, 'rgba(0,150,0,0.8)', 2);
  scroll(metal, 'rgba(120,120,120,0.8)', 2);
  speckle(col, r, 200, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.08)');
  return [col, rough, bump, metal, 0.008];
}

const BUILD: Record<TitanSkinId, typeof rust> = { rust, forged, plumage, armour, royal };
const cache = new Map<TitanSkinId, TitanSkinMaps>();

/** The skin's three maps, drawn once per page and shared by every part. */
export function titanSkin(id: TitanSkinId): TitanSkinMaps {
  const hit = cache.get(id);
  if (hit) return hit;
  const [col, rough, bump, metal, bumpScale] = BUILD[id]();
  const maps = {
    map: tex(col, true),
    roughnessMap: tex(rough, false),
    metalnessMap: tex(metal, false),
    bumpMap: tex(bump, false),
    bumpScale,
  };
  cache.set(id, maps);
  return maps;
}
