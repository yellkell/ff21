/**
 * THE BANK BOARD — the STORE's third chip, where iron-dollars are bought
 * for money (net/bank.ts has the how). Three faces on one board:
 *
 *   THE PACKS   four tiles, coins big and the price small, the shelf's
 *               pick flagged BEST VALUE; under them THE ACCOUNT strip —
 *               PROTECT WITH EMAIL and RECOVER for a bare headset, or the
 *               PROTECTED chip — and the terms in one honest line.
 *   THE CHECKOUT a PAY CODE: six letters on lit plates, to type at
 *               yellkell.com/support on a phone or computer, where you
 *               pick a pack and pay — or PAY THROUGH YOUR HEADSET (the
 *               pay page in the headset's own browser, code filled in).
 *               Under it the pack, the price, the state of play, CANCEL.
 *               When the coins land the face says so, the wallet's readout
 *               counts them up, and PROTECT WITH EMAIL is offered right
 *               there, pre-filled with the email typed at the checkout.
 *   THE RECOVERY the sign-in link has gone to the email; open it on the
 *               phone, read the six-digit code off it, TYPE THE CODE, and
 *               the game restarts as the recovered account.
 *
 * Nothing here charges anything: a tap asks the server for a checkout,
 * and the server (and Stripe, and the ledger) do the rest. The board only
 * ever reads `bank`, so it repaints on `bank.version` like any live text.
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { bank, type CoinPack, loadPacks, priceLabel } from '../net/bank.js';
import { coinImage } from './coinIcon.js';

const M = 56;
const W = 1024;
const INNER = W - M * 2;

export interface BankFace {
  buttons: PanelButton[];
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
}

/** The board, laid out from `top` down to just above `footY`. */
export function bankBoard(top: number, footY: number): BankFace {
  if (bank.status === 'idle') void loadPacks();
  const co = bank.checkout;
  if (co) return checkoutFace(co, top, footY);
  if (bank.recovery.stage !== 'idle') return recoveryFace(top, footY);
  return packsFace(top, footY);
}

/* ── shared chrome ────────────────────────────────────────────────────── */

function heading(g: CanvasRenderingContext2D, text: string, y: number): void {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 22);
  g.letterSpacing = '3px';
  g.fillStyle = KIT.faint;
  g.fillText(text, M, y);
  g.letterSpacing = '0px';
}

/** The mode badge, right-aligned on the heading line: nothing in live
 *  mode, a warning in test/dev (no real money moves), the reason if off. */
function badge(g: CanvasRenderingContext2D, y: number): void {
  let text = '';
  let tone = KIT.warn;
  if (bank.status === 'off') {
    text = `BANK CLOSED — ${bank.note || 'no answer'}`;
    tone = KIT.danger;
  } else if (bank.status === 'loading') {
    text = 'opening the bank…';
    tone = KIT.faint;
  } else if (bank.mode === 'test' || bank.mode === 'dev') {
    text = 'TEST MODE — no real charge';
  }
  if (!text) return;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.font = font(600, 20);
  g.fillStyle = tone;
  g.fillText(text, W - M, y, INNER * 0.6);
}

/** The coin mark: the riveted "$" once it has loaded, a drawn ring until. */
function coinMark(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const img = coinImage();
  if (img) {
    g.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    return;
  }
  g.beginPath();
  g.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
  g.lineWidth = Math.max(2, r * 0.14);
  g.strokeStyle = KIT.accent;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, r * 1.1);
  g.fillStyle = KIT.accent;
  g.fillText('$', cx, cy + r * 0.04);
}

function terms(g: CanvasRenderingContext2D, y: number): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(500, 19);
  g.fillStyle = KIT.faint;
  g.fillText('iron-dollars are a virtual currency for FIRE FIGHT 2 only — no cash value, not refundable once delivered', W / 2, y, INNER);
  g.fillText('buying agrees to the terms at ff2.web.app/terms.html · payment is taken by Stripe, never by the game', W / 2, y + 28, INNER);
}

/** A few lines of wrapped text, left-aligned. */
function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number): void {
  const words = text.split(' ');
  let line = '';
  let n = 0;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxW && line) {
      g.fillText(line, x, y + n * lineH);
      line = w;
      if (++n >= maxLines) return;
    } else {
      line = next;
    }
  }
  if (line) g.fillText(line, x, y + n * lineH);
}

/* ── THE ACCOUNT strip ────────────────────────────────────────────────── */

const STRIP_H = 76;

/** The account's row: the PROTECTED chip, or the two doors (PROTECT WITH
 *  EMAIL, RECOVER). Protecting's own state rides the sub-line. */
function accountButtons(y: number): PanelButton[] {
  const a = bank.account;
  const p = bank.protecting;
  if (a.protected || p.stage === 'done') {
    return [{ id: 'bank-account', label: 'PROTECTED', sub: a.email || 'with your email', x: M, y, w: INNER, h: STRIP_H, display: true, small: true, tone: KIT.positive }];
  }
  const sub = p.stage === 'busy' ? 'protecting…' : p.stage === 'failed' ? p.note : 'so a new headset can get your purchases back';
  return [
    { id: 'bank-protect', label: 'PROTECT WITH EMAIL', sub, x: M, y, w: 540, h: STRIP_H, small: true, tone: p.stage === 'failed' ? KIT.danger : undefined, disabled: p.stage === 'busy' },
    { id: 'bank-recover', label: 'RECOVER', sub: 'bought on another headset?', x: M + 560, y, w: INNER - 560, h: STRIP_H, small: true },
  ];
}

/* ── THE PACKS ────────────────────────────────────────────────────────── */

const COLS = 2;
const GAP = 20;
const TILE_W = (INNER - GAP) / COLS;
const TILE_H = 186;

interface PackTile {
  pack: CoinPack;
  x: number;
  y: number;
}

function packTiles(top: number): PackTile[] {
  return bank.packs.map((pack, i) => ({
    pack,
    x: M + (i % COLS) * (TILE_W + GAP),
    y: top + 56 + Math.floor(i / COLS) * (TILE_H + GAP),
  }));
}

function packsFace(top: number, footY: number): BankFace {
  const tiles = packTiles(top);
  const open = bank.status !== 'off';
  const rows = Math.ceil(tiles.length / COLS);
  const stripY = top + 56 + rows * (TILE_H + GAP) - 4;
  const buttons: PanelButton[] = tiles.map((t) => ({
    id: `bank-pack-${t.pack.id}`,
    label: '',
    ghost: true,
    x: t.x,
    y: t.y,
    w: TILE_W,
    h: TILE_H,
    disabled: !open,
  }));
  buttons.push(...accountButtons(stripY));
  return {
    buttons,
    body: (g, hover) => {
      heading(g, 'TOP UP THE WALLET', top + 16);
      badge(g, top + 16);
      for (const t of tiles) drawPack(g, t, hover === `bank-pack-${t.pack.id}`, open);
      terms(g, Math.min(footY - 40, stripY + STRIP_H + 40));
    },
  };
}

function drawPack(g: CanvasRenderingContext2D, t: PackTile, hot: boolean, open: boolean): void {
  const { pack, x, y } = t;
  g.beginPath();
  g.roundRect(x, y, TILE_W, TILE_H, 18);
  g.fillStyle = hot && open ? KIT.plateHover : KIT.plate;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = pack.best ? KIT.accentDim : hot && open ? KIT.lineHover : KIT.line;
  g.stroke();
  if (pack.best) {
    // The shelf's pick: the kit's edge tick, and a tag on the shoulder.
    g.fillStyle = KIT.accent;
    g.beginPath();
    g.roundRect(x + 8, y + 14, 5, TILE_H - 28, 2.5);
    g.fill();
    g.font = font(700, 16);
    g.letterSpacing = '2px';
    const tag = 'BEST VALUE';
    const tw = g.measureText(tag).width + 24;
    g.beginPath();
    g.roundRect(x + TILE_W - tw - 16, y + 14, tw, 30, 8);
    g.fill();
    g.fillStyle = KIT.onAccent;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(tag, x + TILE_W - tw / 2 - 16, y + 30);
    g.letterSpacing = '0px';
  }
  // A pack is its number and its price — nothing else to read.
  const dim = open ? 1 : 0.5;
  g.globalAlpha = dim;
  const cy = y + TILE_H / 2;
  coinMark(g, x + 76, cy, 42);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 62);
  g.fillStyle = hot && open ? KIT.textHi : KIT.text;
  g.fillText(String(pack.coins), x + 134, cy - 2);
  const nw = g.measureText(String(pack.coins)).width;
  g.font = font(700, 30);
  g.fillStyle = KIT.accent;
  g.fillText('$', x + 134 + nw + 12, cy - 8);
  // The price chip, right.
  const price = priceLabel(pack.minor);
  g.font = font(700, 28);
  const pw = g.measureText(price).width + 40;
  g.beginPath();
  g.roundRect(x + TILE_W - pw - 24, cy - 26, pw, 52, 10);
  g.fillStyle = KIT.well;
  g.fill();
  g.strokeStyle = KIT.accentDim;
  g.lineWidth = 1.5;
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = KIT.accent;
  g.fillText(price, x + TILE_W - pw / 2 - 24, cy + 1);
  g.globalAlpha = 1;
}

/* ── THE CHECKOUT ─────────────────────────────────────────────────────── */

const QR_PX = 300;

/**
 * A pay code on six lit plates, one letter each in big type, so nobody
 * mistakes a letter typing it on a phone; a wider gap down the middle,
 * because two groups of three read faster than six in a row. Centred on
 * `cx`, top at `y`.
 */
function codeTiles(g: CanvasRenderingContext2D, code: string, cx: number, y: number): void {
  const n = code.length;
  const tw = 116;
  const th = 136;
  const gap = 14;
  const mid = n === 6 ? 30 : 0;
  let x = cx - (n * tw + (n - 1) * gap + mid) / 2;
  for (let i = 0; i < n; i++) {
    if (n === 6 && i === 3) x += mid;
    g.beginPath();
    g.roundRect(x, y, tw, th, 16);
    g.fillStyle = KIT.well;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = KIT.accent;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(700, 96);
    g.fillStyle = KIT.textHi;
    g.fillText(code[i], x + tw / 2, y + th / 2 + 4);
    x += tw + gap;
  }
}

/** The code on the board: where to go, what to type, what it buys. */
function payCodeFace(co: NonNullable<typeof bank.checkout>, top: number, footY: number): BankFace {
  const by = top + 446;
  const buttons: PanelButton[] = [
    { id: 'bank-open', label: 'PAY THROUGH YOUR HEADSET', sub: "opens the pay page in the headset's browser", x: M, y: by, w: 620, h: 92, small: true },
    { id: 'bank-cancel', label: 'CANCEL', x: M + 640, y: by, w: INNER - 640, h: 92, small: true },
  ];
  return {
    buttons,
    body: (g) => {
      heading(g, 'CHECKOUT', top + 16);
      badge(g, top + 16);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(600, 24);
      g.fillStyle = KIT.dim;
      g.fillText('on your phone or computer, go to', W / 2, top + 70);
      g.font = font(700, 56);
      g.fillStyle = KIT.accent;
      g.fillText(co.page, W / 2, top + 120, INNER);
      g.font = font(600, 24);
      g.fillStyle = KIT.dim;
      g.fillText('and type this code', W / 2, top + 172);
      codeTiles(g, co.code, W / 2, top + 196);
      g.font = font(600, 22);
      g.fillStyle = KIT.faint;
      g.fillText(`${co.pack.coins} iron-dollars · ${priceLabel(co.pack.minor)} — you can pick another pack there`, W / 2, top + 368, INNER);
      g.font = font(600, 24);
      g.fillStyle = KIT.info;
      g.fillText('waiting for the payment — the coins land here the moment it clears', W / 2, top + 406, INNER);
      terms(g, footY - 40);
    },
  };
}

function checkoutFace(co: NonNullable<typeof bank.checkout>, top: number, footY: number): BankFace {
  if (co.state === 'waiting' && co.code) return payCodeFace(co, top, footY);
  const x0 = M + QR_PX + 40;
  const w0 = INNER - QR_PX - 40;
  const buttons: PanelButton[] = [];
  const p = bank.protecting;
  if (co.state === 'paid') {
    const bare = !bank.account.protected && p.stage !== 'done';
    buttons.push({ id: 'bank-done', label: 'DONE', x: x0, y: top + 372, w: bare ? 240 : 300, h: 92, primary: !bare, small: bare });
    if (bare) {
      buttons.push({
        id: 'bank-protect',
        label: 'PROTECT WITH EMAIL',
        sub: p.stage === 'busy' ? 'protecting…' : p.stage === 'failed' ? p.note : 'so a new headset can get them back',
        x: x0 + 260, y: top + 372, w: w0 - 260, h: 92,
        primary: p.stage !== 'failed',
        tone: p.stage === 'failed' ? KIT.danger : undefined,
        disabled: p.stage === 'busy',
      });
    }
  } else if (co.state === 'failed' || co.state === 'expired') {
    buttons.push({ id: 'bank-done', label: 'BACK', x: x0, y: top + 372, w: 300, h: 92, small: true });
  } else {
    buttons.push({ id: 'bank-cancel', label: 'CANCEL', x: x0, y: top + 486, w: 240, h: 72, small: true });
  }
  return {
    buttons,
    body: (g) => {
      heading(g, co.state === 'paid' ? 'PAID' : 'CHECKOUT', top + 16);
      badge(g, top + 16);
      const qy = top + 56;
      // The plate the code sat on: what is happening, at a glance.
      {
        g.beginPath();
        g.roundRect(M, qy, QR_PX, QR_PX, 14);
        g.fillStyle = KIT.well;
        g.fill();
        g.strokeStyle = KIT.line;
        g.lineWidth = 2;
        g.stroke();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = font(600, 24);
        g.fillStyle = co.state === 'paid' ? KIT.positive : KIT.faint;
        g.fillText(co.state === 'opening' ? 'opening…' : co.state === 'paid' ? '✓' : '—', M + QR_PX / 2, qy + QR_PX / 2);
      }
      // THE PACK — its number and its price — and the state of play.
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      coinMark(g, x0 + 34, qy + 50, 34);
      g.font = font(700, 60);
      g.fillStyle = KIT.accent;
      g.fillText(`+${co.paid || co.pack.coins}`, x0 + 84, qy + 48);
      const nw = g.measureText(`+${co.paid || co.pack.coins}`).width;
      g.font = font(700, 28);
      g.fillText('$', x0 + 84 + nw + 12, qy + 42);
      g.font = font(600, 24);
      g.fillStyle = KIT.dim;
      g.fillText(`${priceLabel(co.pack.minor)} · iron-dollars`, x0, qy + 118);
      // The line that says where it stands.
      let line = '';
      let tone = KIT.info;
      switch (co.state) {
        case 'opening':
          line = 'asking the bank for a checkout…';
          tone = KIT.faint;
          break;
        case 'waiting':
          line = 'waiting for the payment — the coins land here the moment it clears';
          break;
        case 'paid':
          line = bank.account.protected || p.stage === 'done'
            ? `${co.paid} $ landed in your wallet — protected with ${bank.account.email || 'your email'}`
            : `${co.paid} $ landed in your wallet`;
          tone = KIT.positive;
          break;
        case 'failed':
          line = co.note || 'the bank could not open a checkout';
          tone = KIT.danger;
          break;
        case 'expired':
          line = 'this checkout has expired — start another from the packs';
          tone = KIT.warn;
          break;
      }
      g.font = font(600, 22);
      g.fillStyle = tone;
      wrapText(g, line, x0, qy + 172, w0, 30, 3);
      terms(g, footY - 40);
    },
  };
}

/* ── THE RECOVERY ─────────────────────────────────────────────────────── */

function recoveryFace(top: number, footY: number): BankFace {
  const r = bank.recovery;
  const buttons: PanelButton[] = [];
  const y0 = top + 330;
  switch (r.stage) {
    case 'sending':
      buttons.push({ id: 'bank-recover-cancel', label: 'CANCEL', x: M, y: y0 + 120, w: 240, h: 72, small: true });
      break;
    case 'sent':
      buttons.push({ id: 'bank-code', label: 'TYPE THE CODE', sub: 'the six digits on the phone', x: M, y: y0, w: 440, h: 92, primary: true });
      buttons.push({ id: 'bank-recover', label: 'SEND IT AGAIN', sub: 'or to another email', x: M + 460, y: y0, w: INNER - 460, h: 92, small: true });
      buttons.push({ id: 'bank-recover-cancel', label: 'CANCEL', x: M, y: y0 + 120, w: 240, h: 72, small: true });
      break;
    case 'redeeming':
    case 'done':
      break;
    case 'failed':
      buttons.push({ id: 'bank-recover', label: 'TRY AGAIN', x: M, y: y0, w: 300, h: 92, primary: true });
      buttons.push({ id: 'bank-recover-cancel', label: 'BACK', x: M + 320, y: y0, w: 240, h: 92, small: true });
      break;
  }
  return {
    buttons,
    body: (g) => {
      heading(g, 'RECOVER YOUR PURCHASES', top + 16);
      badge(g, top + 16);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      let title = '';
      let tone = KIT.text;
      const lines: string[] = [];
      switch (r.stage) {
        case 'sending':
          title = 'ONE MOMENT';
          lines.push(`emailing a sign-in link to ${r.email}…`);
          break;
        case 'sent':
          title = 'CHECK YOUR EMAIL';
          lines.push(`a sign-in link is on its way to ${r.email}.`);
          lines.push('open it on your phone: it signs you in there and shows a six-digit code.');
          lines.push('type the code here, and this headset becomes your account — the game restarts with everything back.');
          lines.push('opened the link in this headset\'s own browser? then just restart the game.');
          break;
        case 'redeeming':
          title = 'SIGNING YOU IN';
          lines.push('one moment…');
          break;
        case 'done':
          title = 'WELCOME BACK';
          tone = KIT.positive;
          lines.push('restarting as your account…');
          break;
        case 'failed':
          title = 'THAT DIDN\'T WORK';
          tone = KIT.danger;
          lines.push(r.note || 'try again');
          break;
      }
      g.font = font(700, 40);
      g.fillStyle = tone;
      g.fillText(title, M, top + 90);
      g.font = font(600, 23);
      g.fillStyle = KIT.dim;
      let y = top + 150;
      for (const line of lines) {
        wrapText(g, line, M, y, INNER, 30, 2);
        y += g.measureText(line).width > INNER ? 60 : 38;
      }
      terms(g, footY - 40);
    },
  };
}
