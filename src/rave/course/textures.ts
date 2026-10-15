/**
 * The two pictures the course paints for itself. No image assets ship
 * (research/02 §5) — both are drawn onto a canvas at build time, and neither
 * uses RNG, so the circuit looks the same every night.
 *
 * The soft glow the invitation circle wears is the venue's own
 * (materials/glow.ts): a course inside the club should light its floor with
 * the club's light.
 */

import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { PALETTE } from '../config.js';
import { font } from '../ui/fonts.js';

/**
 * THE PLAY-AREA PATTERN, exactly as Eye of the Temple draws it: a thick
 * border along the play-area edge and a thick circle at the centre
 * (research/03 §3). Platforms show the crop of the square they claim, so the
 * ghost overlay makes level-design correctness a picture you look at.
 */
export function patternTexture(): CanvasTexture {
  const size = 768;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const stroke = size * 0.035;
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = stroke;
  g.strokeRect(stroke * 0.75, stroke * 0.75, size - stroke * 1.5, size - stroke * 1.5);
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.13, 0, Math.PI * 2);
  g.stroke();
  // Faint seams marking the nine squares, so a single-square crop still reads.
  g.lineWidth = size * 0.006;
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  for (let i = 1; i < 3; i++) {
    g.beginPath();
    g.moveTo((size / 3) * i, 0);
    g.lineTo((size / 3) * i, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, (size / 3) * i);
    g.lineTo(size, (size / 3) * i);
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * THE DECK FACE — what a platform's top wears under its light. The decks
 * were checker plate tinted per instance, and the checker fought the tint:
 * every state the deck can be in (docked, counting out, under way, burnt)
 * was a wash over hatching, and from a metre up it read as a dirty tile.
 * Now the face is the DARK half of a neon sign: brushed gunmetal, a
 * machined groove around the inset panel, a bolt at each corner — nothing
 * on it glows. The glow is the ETCH (etchTexture) laid over it as its own
 * layer, so the state colours light the traces and leave the metal alone.
 */
export function deckTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  // Brushed grain: fine horizontal streaks, deterministic (no RNG — the
  // circuit looks the same every night).
  for (let y = 0; y < size; y += 2) {
    const k = ((y * 7919) % 97) / 97;
    g.fillStyle = `rgba(0,0,0,${0.06 + 0.12 * k})`;
    g.fillRect(0, y, size, 1);
  }
  // The inset panel, a shade darker, with a machined groove around it.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(size * 0.09, size * 0.09, size * 0.82, size * 0.82);
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = size * 0.02;
  g.strokeRect(size * 0.09, size * 0.09, size * 0.82, size * 0.82);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = size * 0.006;
  g.strokeRect(size * 0.105, size * 0.105, size * 0.79, size * 0.79);
  // Hex bolts in the corners of the outer frame.
  for (const [x, y] of [
    [0.045, 0.045],
    [0.955, 0.045],
    [0.045, 0.955],
    [0.955, 0.955],
  ]) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = size * 0.024;
      g.lineTo(x * size + Math.cos(a) * r, y * size + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.arc(x * size - size * 0.005, y * size - size * 0.005, size * 0.009, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * THE ETCH — the neon half of the deck. Circuit traces cut into the inset
 * panel and lit from inside: a lattice of fine lines, nodes where they
 * cross, a hollow diamond at the centre (the mark to stand on), and
 * brackets in the four corners. White on transparent with the halo baked
 * in, so the instance colour is the whole story: cyan on ground you may
 * step on, amber as it counts out, red under way. Additive over the metal.
 */
export function etchTexture(): CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const in0 = size * 0.12;
  const in1 = size * 0.88;
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = size * 0.012;
  g.lineCap = 'round';
  // The lattice: a 4×4 field of traces inside the panel, thin and faint —
  // at a distance it must average to next to nothing, or the whole face
  // reads as a wash instead of as lines.
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.lineWidth = size * 0.005;
  const cells = 4;
  for (let i = 1; i < cells; i++) {
    const t = in0 + ((in1 - in0) * i) / cells;
    g.beginPath();
    g.moveTo(in0, t);
    g.lineTo(in1, t);
    g.stroke();
    g.beginPath();
    g.moveTo(t, in0);
    g.lineTo(t, in1);
    g.stroke();
  }
  // Nodes where traces cross — small filled squares, brighter.
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 1; i < cells; i++) {
    for (let j = 1; j < cells; j++) {
      if ((i + j) % 2) continue;
      const x = in0 + ((in1 - in0) * i) / cells;
      const y = in0 + ((in1 - in0) * j) / cells;
      g.fillRect(x - size * 0.012, y - size * 0.012, size * 0.024, size * 0.024);
    }
  }
  // The frame trace, bright, just inside the groove.
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = size * 0.018;
  g.strokeRect(in0, in0, in1 - in0, in1 - in0);
  // Corner brackets outside it, on the outer frame.
  const bl = size * 0.08;
  g.lineWidth = size * 0.018;
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const x = size / 2 - sx * size * 0.455;
    const y = size / 2 - sy * size * 0.455;
    g.beginPath();
    g.moveTo(x, y + sy * bl);
    g.lineTo(x, y);
    g.lineTo(x + sx * bl, y);
    g.stroke();
  }
  // The diamond at the centre, hollow, with a dot in it.
  const d = size * 0.12;
  g.lineWidth = size * 0.02;
  g.beginPath();
  g.moveTo(size / 2, size / 2 - d);
  g.lineTo(size / 2 + d, size / 2);
  g.lineTo(size / 2, size / 2 + d);
  g.lineTo(size / 2 - d, size / 2);
  g.closePath();
  g.stroke();
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.02, 0, Math.PI * 2);
  g.fill();
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * THE UNDERGLOW — a soft radial bloom under every machine, the light of
 * whatever drives it spilling onto the void's glass. Square-ish rather
 * than round (a superellipse), so it reads as a deck's shadow lit from
 * inside rather than a spotlight.
 */
export function glowTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      // Superellipse radius (n = 3): rounder than a box, squarer than a disc.
      const r = Math.pow(Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 3), 1 / 3);
      const a = Math.max(0, 1 - r);
      const k = a * a * (3 - 2 * a);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(k * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

export interface PanelSpec {
  title?: string;
  lines: string[];
  small?: string;
  width: number; // metres
  color?: string;
  accent?: number;
  /**
   * A DIRECTION BAND across the foot of the card: the words GO THIS WAY and
   * an arrow, pointing the side the circuit actually runs.
   *
   * The route out of the home pad is one-way — home, east, up, north, west,
   * home — and standing on the pad for the first time there is nothing in
   * the view that says so. The floor's invitation appears a beat later and
   * is a circle of light on the ground, which you have to already be
   * looking down to find. This is on the one thing you are certainly
   * looking at, because it is the only writing in the place.
   */
  way?: 'left' | 'right';
}

/** Just the picture, for a card that changes what it says. */
export function panelTexture(spec: PanelSpec): { tex: CanvasTexture; aspect: number } {
  const W = 1024;
  const pad = 64;
  const titleSize = 104;
  const lineSize = 60;
  const smallSize = 34;
  const lineGap = 26;
  // The way band is the instruction you act on, so it is set at the title's
  // weight rather than the body's — a caption under two louder lines is a
  // caption, and gets read last or not at all.
  const waySize = 76;
  let h = pad * 2;
  if (spec.title) h += titleSize + 40;
  h += spec.lines.length * (lineSize + lineGap);
  if (spec.small) h += smallSize + 30;
  if (spec.way) h += waySize + 12;

  const accent = spec.accent ?? PALETTE.magenta;
  const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, h);
  // Nearly solid. At 0.72 the circuit's own lasers and grid read straight
  // through the card and fought every letter on it; the void is a place of
  // thin bright lines, and the one surface with words on it is allowed to
  // be the one surface you cannot see through.
  g.fillStyle = 'rgba(8,3,12,0.93)';
  g.fillRect(0, 0, W, h);
  g.strokeStyle = 'rgba(255,42,213,0.62)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, h - 6);

  const color = spec.color ?? '#e8c6ff';
  let y = pad;
  g.textAlign = 'center';
  if (spec.title) {
    g.fillStyle = css(accent);
    g.shadowColor = css(accent);
    g.shadowBlur = 22;
    g.font = font(700, titleSize);
    g.letterSpacing = '10px';
    // Bounded like the body lines: a title long enough to overrun would
    // otherwise paint straight off the edge of the panel.
    g.fillText(spec.title, W / 2, y + titleSize * 0.82, W - pad * 2);
    g.letterSpacing = '0px';
    g.shadowBlur = 0;
    y += titleSize + 40;
  }
  g.fillStyle = color;
  g.font = font(600, lineSize);
  for (const line of spec.lines) {
    g.fillText(line, W / 2, y + lineSize * 0.8, W - pad * 2);
    y += lineSize + lineGap;
  }
  if (spec.small) {
    g.fillStyle = 'rgba(232,198,255,0.6)';
    g.font = font(500, smallSize);
    g.fillText(spec.small, W / 2, y + smallSize * 0.9, W - pad * 2);
    y += smallSize + 30;
  }

  // THE WAY BAND. The words and the arrow are centred as one group, so the
  // pair reads as a single sign rather than as a caption with a decoration
  // beside it. The arrow is DRAWN rather than typed: a glyph would inherit
  // whatever the fallback font thinks an arrow is, at whatever weight, and
  // this one has to be as loud as the word next to it.
  if (spec.way) {
    const label = 'GO THIS WAY';
    const right = spec.way === 'right';
    g.font = font(700, waySize);
    g.letterSpacing = '6px';
    const textW = g.measureText(label).width;
    const shaft = 92;
    const head = 54;
    const arrowW = shaft + head;
    const gap = 34;
    const x0 = (W - (textW + gap + arrowW)) / 2;
    const mid = y + waySize * 0.52;

    // A rule above it, so the band is its own line of the sign rather than
    // a third sentence running on from the second.
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(pad, y - 14);
    g.lineTo(W - pad, y - 14);
    g.stroke();

    g.fillStyle = css(accent);
    g.shadowColor = css(accent);
    g.shadowBlur = 26;
    g.textAlign = 'left';
    // The arrow leads on the side it points to, the way a real sign does.
    g.fillText(label, right ? x0 : x0 + arrowW + gap, y + waySize * 0.8);
    g.letterSpacing = '0px';

    const ax = right ? x0 + textW + gap : x0;
    const tip = right ? ax + arrowW : ax;
    const tail = right ? ax : ax + arrowW;
    const barb = right ? tip - head : tip + head;
    g.beginPath();
    g.moveTo(tail, mid - 10);
    g.lineTo(barb, mid - 10);
    g.lineTo(barb, mid - 30);
    g.lineTo(tip, mid);
    g.lineTo(barb, mid + 30);
    g.lineTo(barb, mid + 10);
    g.lineTo(tail, mid + 10);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.textAlign = 'center';
  }

  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  return { tex, aspect: h / W };
}

/**
 * A text panel, planted ~3 m out (research/02 §6) in the house typeface and
 * the house magenta. Four lines is the whole manual: embodied movement
 * doesn't have to be learned (research/03 §5).
 *
 * SINGLE-SIDED, deliberately. A card is written to be read from one place —
 * these face the home pad — and a double-sided one hands anybody standing
 * behind it a page of mirror writing, which from the skywalk is the biggest
 * thing in the view straight down. Better to be nothing from the back.
 */
export function textPanel(spec: PanelSpec): Mesh {
  const { tex, aspect } = panelTexture(spec);
  return new Mesh(
    new PlaneGeometry(spec.width, spec.width * aspect),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
}
