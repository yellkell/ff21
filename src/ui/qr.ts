/**
 * A QR CODE, drawn on a canvas — for the lobby's invite link (DESIGN.md
 * §8.1: "the lobby shows the link as a QR + short code"). A phone camera
 * pointed at the squad room's panel reads the join link straight off the
 * headset's screen mirror; a headset browser scans it too.
 *
 * Byte mode, error-correction level M, versions 1–10 (up to ~200
 * characters — a join link is ~40). The standard algorithm end to end:
 * segment → codewords → Reed–Solomon blocks → interleave → placement →
 * the mask with the lowest penalty → format/version bits. Nothing here is
 * clever; it is the spec, small enough to read. Verified against a
 * third-party decoder when written (tools/tv-check.mjs asserts the shape).
 */

export interface QrMatrix {
  size: number;
  /** modules[y][x] — true = dark. */
  modules: boolean[][];
}

type Ecl = 'L' | 'M';
const ECL_BITS: Record<Ecl, number> = { L: 1, M: 0 };
/** Per version (index = version), ECC codewords per block. */
const ECC_PER_BLOCK: Record<Ecl, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
};
/** Per version, the number of error-correction blocks. */
const BLOCKS: Record<Ecl, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
};
const MAX_VERSION = 10;

function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

function dataCodewords(ver: number, ecl: Ecl): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * BLOCKS[ecl][ver];
}

/* ── Reed–Solomon over GF(256), poly 0x11D ─────────────────────────────── */

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor);
    });
  }
  return result;
}

/* ── the bit stream ────────────────────────────────────────────────────── */

function encodeBytes(text: string, ver: number, ecl: Ecl): number[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bits: number[] = [];
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver, ecl) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return out;
}

function addEcc(data: number[], ver: number, ecl: Ecl): number[] {
  const numBlocks = BLOCKS[ecl][ver];
  const blockEcc = ECC_PER_BLOCK[ecl][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEcc);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - blockEcc + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - blockEcc || j >= numShort) result.push(block[i]);
    });
  }
  return result;
}

/* ── the matrix ────────────────────────────────────────────────────────── */

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const num = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < num; pos -= step) result.splice(1, 0, pos);
  return result;
}

class Grid {
  readonly ver: number;
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(ver: number) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
  drawFunctionPatterns(ecl: Ecl): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const al = alignmentPositions(this.ver);
    for (let i = 0; i < al.length; i++) {
      for (let j = 0; j < al.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
        this.alignment(al[i], al[j]);
      }
    }
    this.drawFormat(ecl, 0);
    this.drawVersion();
  }
  private finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, d !== 2 && d !== 4);
      }
    }
  }
  private alignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(ecl: Ecl, mask: number): void {
    const data = (ECL_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    const n = this.size;
    for (let i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(i));
    this.setFn(8, n - 8, true);
  }
  private drawVersion(): void {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, bit);
      this.setFn(b, a, bit);
    }
  }
  drawCodewords(data: number[]): void {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    // Runs of five or more in a line, and the finder-like 1:1:3:1:1 pattern
    // (dark-light-dark×3-light-dark with light on at least one side).
    const runPenalty = (line: boolean[]): number => {
      let s = 0;
      const runs: { v: boolean; n: number }[] = [];
      for (const v of line) {
        const last = runs[runs.length - 1];
        if (last && last.v === v) last.n++;
        else runs.push({ v, n: 1 });
      }
      for (const r of runs) if (r.n >= 5) s += 3 + (r.n - 5);
      for (let i = 0; i + 4 < runs.length; i++) {
        const [a, b, c, d, e] = runs.slice(i, i + 5);
        if (!a.v || a.n !== b.n || c.n !== a.n * 3 || d.n !== a.n || e.n !== a.n) continue;
        const before = runs[i - 1];
        const after = runs[i + 5];
        if ((before && before.n >= a.n * 4) || (after && after.n >= a.n * 4) || !before || !after) s += 40;
      }
      return s;
    };
    for (let y = 0; y < n; y++) score += runPenalty(m[y]);
    for (let x = 0; x < n; x++) score += runPenalty(m.map((row) => row[x]));
    // 2×2 blocks of one colour.
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    // Dark/light balance.
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += k * 10;
    return score;
  }
}

/** Encode `text` as a QR matrix (level M, smallest version that fits). */
export function qrEncode(text: string, ecl: Ecl = 'M'): QrMatrix {
  const bytes = new TextEncoder().encode(text).length;
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const need = 4 + (ver < 10 ? 8 : 16) + bytes * 8;
    if (need <= dataCodewords(ver, ecl) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error('qr: text too long');
  const data = addEcc(encodeBytes(text, ver, ecl), ver, ecl);
  let best: QrMatrix | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(ver);
    g.drawFunctionPatterns(ecl);
    g.drawCodewords(data);
    g.applyMask(mask);
    g.drawFormat(ecl, mask);
    const p = g.penalty();
    if (p < bestPenalty) {
      bestPenalty = p;
      best = { size: g.size, modules: g.modules.map((row) => row.slice()) };
    }
  }
  return best as QrMatrix;
}

/**
 * Paint a QR at (x, y), `px` wide, on a 2D context: a light quiet zone of
 * two modules round it (the spec asks four; the panel plate around it is
 * plain enough that two reads), dark modules in `ink`.
 */
export function drawQr(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, ink = '#0d0f12', paper = '#f4f2ee'): void {
  const qr = qrEncode(text);
  const quiet = 2;
  const cell = px / (qr.size + quiet * 2);
  g.fillStyle = paper;
  g.fillRect(x, y, px, px);
  g.fillStyle = ink;
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      // A hair of overlap so the modules never show seams at odd scales.
      g.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.4, cell + 0.4);
    }
  }
}
