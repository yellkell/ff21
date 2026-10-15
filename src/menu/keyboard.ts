/**
 * The in-game keyboard — a kit panel of clickable keys, raycast by the
 * same menu pointers. It pops up ONCE per player for a callsign: the first
 * time they do something that puts a name on the leaderboard (starting Aim
 * Training or queueing for multiplayer). The typed callsign is saved and
 * shared by both boards forever after. It also takes a profile note, a
 * safety report, and THE BANK's email and recovery code (menu/bankBoard.ts).
 *
 * Three key sets: the callsign's (letters, digits, dash, space), an EMAIL
 * set (lowercase, with @ . _ and no space) and a DIGITS set for a six-digit
 * code. The caller picks with `open`'s options.
 *
 * It wears the wrap's own kit — the smoked-steel panel, the hairline
 * plates, hazard amber for the hot key and the caret — in the house face,
 * so it reads as one of the menus and not as a leftover from the first
 * game's plate-steel era.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { KIT } from '../ui/kit/panel.js';
import { font, onFontsReady } from '../ui/kit/fonts.js';

const KW = 704;
const KH = 528;
const MAX_LEN = 12;

const NAME_ROWS: string[][] = [
  [...'1234567890'],
  [...'QWERTYUIOP'],
  [...'ASDFGHJKL'],
  [...'ZXCVBNM', '-'],
];
const EMAIL_ROWS: string[][] = [
  [...'1234567890'],
  [...'QWERTYUIOP'],
  [...'ASDFGHJKL'],
  [...'ZXCVBNM', '-', '_'],
];
const DIGIT_ROWS: string[][] = [[...'1234567890']];

interface KeyZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KeyboardOpts {
  /** An email address: lowercase, @ and . on the bottom row, no space. */
  email?: boolean;
  /** A numeric code: the digit row alone. */
  digits?: boolean;
}

export interface NameKeyboard {
  mesh: Mesh;
  /** Show the keyboard, prefilled (usually with the auto callsign). `prompt` is
   *  the heading line (defaults to the battle-name prompt); `maxLen` caps the
   *  entry length (defaults to the 12-char name limit); `opts` picks the
   *  key set. */
  open(initial: string, prompt?: string, maxLen?: number, opts?: KeyboardOpts): void;
  close(): void;
  isOpen(): boolean;
  /** Map a hit UV to the key under it, or null. */
  hitTest(u: number, v: number): string | null;
  /** Apply a key press; when OK lands, returns the finished text (possibly an
   *  empty string — the caller may clear a note); otherwise null. */
  press(key: string): string | null;
  /** Update hover highlight (redraws only on change). */
  setHover(key: string | null): void;
}

export function createNameKeyboard(scene: Scene): NameKeyboard {
  const canvas = document.createElement('canvas');
  canvas.width = KW;
  canvas.height = KH;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(0.88, (0.88 * KH) / KW),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = 'name-keyboard';
  mesh.position.set(0, 1.38, -0.95);
  mesh.visible = false;
  scene.add(mesh);

  let text = '';
  let prompt = 'ENTER YOUR BATTLE NAME';
  let maxLen = MAX_LEN;
  let mode: 'name' | 'email' | 'digits' = 'name';
  let hover: string | null = null;
  let zones: KeyZone[] = [];

  /** A key: the kit's plate, its hairline, and the accent when hot. The
   *  primary (OK) key is solid accent like the wrap's own CTA. */
  const key = (id: string, x: number, y: number, w: number, h: number, label = id, primary = false, danger = false): void => {
    zones.push({ id, x, y, w, h });
    const hot = hover === id;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    if (primary) {
      ctx.fillStyle = hot ? '#ffc35a' : KIT.accent;
      ctx.fill();
    } else {
      ctx.fillStyle = hot ? KIT.plateHover : KIT.plate;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hot ? (danger ? KIT.danger : KIT.accent) : KIT.line;
      ctx.stroke();
    }
    // The kit's edge tick on a hot key.
    if (hot && !primary) {
      ctx.fillStyle = danger ? KIT.danger : KIT.accent;
      ctx.beginPath();
      ctx.roundRect(x + 6, y + 10, 4, h - 20, 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = font(700, Math.round(h * 0.46));
    ctx.letterSpacing = label.length > 1 ? '2px' : '0px';
    ctx.fillStyle = primary ? KIT.onAccent : hot ? KIT.textHi : danger ? KIT.danger : KIT.text;
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.letterSpacing = '0px';
  };

  const draw = (): void => {
    zones = [];
    ctx.clearRect(0, 0, KW, KH);
    // The panel: the wrap's smoked steel, and its corner brackets.
    ctx.fillStyle = KIT.panel;
    ctx.beginPath();
    ctx.roundRect(6, 6, KW - 12, KH - 12, 22);
    ctx.fill();
    ctx.strokeStyle = KIT.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = KIT.accent;
    ctx.lineWidth = 3;
    for (const [x, y, dx, dy] of [
      [22, 22, 1, 1],
      [KW - 22, 22, -1, 1],
      [22, KH - 22, 1, -1],
      [KW - 22, KH - 22, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x + dx * 22, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * 22);
      ctx.stroke();
    }

    // The prompt, in the house face with the wrap's tracking, and the
    // accent tick beside it.
    ctx.fillStyle = KIT.accent;
    ctx.beginPath();
    ctx.roundRect(40, 34, 5, 28, 2.5);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = font(700, 26);
    ctx.letterSpacing = '3px';
    ctx.fillStyle = KIT.accent;
    ctx.fillText(prompt, 58, 48);
    ctx.letterSpacing = '0px';

    // The entry field: a well with a hairline, the text in the house face,
    // and an amber caret while there is room to type. The font shrinks to
    // keep a long note on one line (a name never gets close).
    ctx.beginPath();
    ctx.roundRect(40, 76, KW - 80, 72, 14);
    ctx.fillStyle = KIT.well;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = KIT.lineFaint;
    ctx.stroke();
    ctx.textAlign = 'center';
    const fieldW = KW - 80 - 48;
    let fs = 42;
    ctx.font = font(700, fs);
    // A code reads best spaced out; an email needs every pixel.
    ctx.letterSpacing = mode === 'digits' ? '12px' : mode === 'email' ? '1px' : '4px';
    let w = ctx.measureText(text).width;
    if (w > fieldW) {
      fs = Math.max(18, Math.floor((fs * fieldW) / w));
      ctx.font = font(700, fs);
      w = ctx.measureText(text).width;
    }
    ctx.fillStyle = KIT.textHi;
    ctx.fillText(text, KW / 2, 113);
    if (text.length < maxLen) {
      ctx.fillStyle = KIT.accent;
      ctx.fillRect(KW / 2 + w / 2 + 6, 113 - fs * 0.42, 4, fs * 0.84);
    }
    ctx.letterSpacing = '0px';
    // The counter, faint, on the right of the field.
    ctx.textAlign = 'right';
    ctx.font = font(600, 18);
    ctx.fillStyle = KIT.faint;
    ctx.fillText(`${text.length}/${maxLen}`, KW - 40, 168);

    // The key grid.
    const rows = mode === 'email' ? EMAIL_ROWS : mode === 'digits' ? DIGIT_ROWS : NAME_ROWS;
    const keyH = 58;
    const gap = 8;
    let y = 184;
    for (const row of rows) {
      const keyW = 56;
      const total = row.length * keyW + (row.length - 1) * gap;
      let x = (KW - total) / 2;
      for (const k of row) {
        key(k, x, y, keyW, keyH, mode === 'email' ? k.toLowerCase() : k);
        x += keyW + gap;
      }
      y += keyH + gap;
    }
    // Bottom row: DEL | SPACE | OK — or, for an email, DEL | @ | . | OK.
    key('back', 64, y, 140, keyH, 'DEL', false, true);
    if (mode === 'email') {
      key('@', 216, y, 132, keyH);
      key('.', 356, y, 132, keyH);
    } else if (mode === 'name') {
      key('space', 216, y, 272, keyH, 'SPACE');
    }
    key('ok', 500, y, 140, keyH, 'OK', true);

    texture.needsUpdate = true;
  };

  // The house woff2s may land after the first paint: re-ink when they do.
  onFontsReady(() => {
    if (mesh.visible) draw();
  });

  return {
    mesh,
    open(initial, p, max, opts) {
      mode = opts?.email ? 'email' : opts?.digits ? 'digits' : 'name';
      maxLen = max ?? MAX_LEN;
      text = (mode === 'email' ? initial.toLowerCase() : initial).slice(0, maxLen);
      prompt = p ?? 'ENTER YOUR BATTLE NAME';
      hover = null;
      mesh.visible = true;
      draw();
    },
    close() {
      mesh.visible = false;
    },
    isOpen() {
      return mesh.visible;
    },
    hitTest(u, v) {
      const px = u * KW;
      const py = (1 - v) * KH;
      for (const z of zones) {
        if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return z.id;
      }
      return null;
    },
    press(k) {
      // OK always reports a value — even an empty one, so the caller can clear a
      // note. A non-OK key returns null (nothing finished yet).
      if (k === 'ok') return text.trim();
      if (k === 'back') {
        text = text.slice(0, -1);
      } else if (k === 'space') {
        // No leading or double spaces — they'd only get stripped on save.
        if (text.length > 0 && !text.endsWith(' ') && text.length < maxLen) text += ' ';
      } else if (text.length < maxLen) {
        text += mode === 'email' ? k.toLowerCase() : k;
      }
      draw();
      return null;
    },
    setHover(k) {
      if (k === hover) return;
      hover = k;
      draw();
    },
  };
}
