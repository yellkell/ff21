/**
 * THE PROFILE POP-OUT (MENUS 2) — what the floating coin readout became.
 * A chip above the YOU wing wears your name, rank and iron-dollars; tap
 * it and your card drops out over the wing (the RAVE RAID profile-card
 * pattern): the painting behind your name, rank and XP, honours,
 * achievements, your note — and RENAME, which is where a callsign changes
 * now. Two bare kit panels (no glass: the bodies paint their own chrome).
 */

import { KIT, type PanelButton, ACCENT_RGB } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { coins } from './wallet.js';
import { hueToColor } from '../config.js';
import { myProfileRow, myStats } from '../net/leaderboard.js';
import { tierForXp } from './progression.js';
import { coinDisplayValue, profileHintActive } from './menu.js';
import { drawProfileBlock, profileSpots } from './ladder.js';

export const CHIP_W = 768;
export const CHIP_H = 128;
export const CARD_W = 768;
export const CARD_H = 680;

/** Open/closed — MenuSystem shows the card panel off this. */
export const profilePop = { open: false };

export interface PopFace {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** The chip: one ghost button the body paints. */
export function profileChipFace(): PopFace {
  return {
    title: '',
    buttons: [{ id: 'profile-toggle', label: '', ghost: true, x: 0, y: 0, w: CHIP_W, h: CHIP_H }],
    body: (g, hover) => {
      const open = profilePop.open;
      const hot = hover === 'profile-toggle';
      const stats = myStats();
      const tier = tierForXp(stats.xp);
      const rolling = coinDisplayValue() !== coins.balance;
      g.beginPath();
      g.roundRect(4, 4, CHIP_W - 8, CHIP_H - 8, 26);
      g.fillStyle = hot ? 'rgba(20,16,12,0.96)' : KIT.panel;
      g.fill();
      if (open) {
        // The accent wash rides ON the glass — a bare canvas has nothing
        // under it, so the wash alone would read as a pale chip.
        g.fillStyle = `rgba(${ACCENT_RGB},0.14)`;
        g.fill();
      }
      g.lineWidth = 2;
      g.strokeStyle = open ? `rgba(${ACCENT_RGB},0.9)` : hot ? KIT.lineHover : KIT.line;
      g.stroke();
      // The identity mark: a diamond in YOUR accent, glowing faintly.
      const mark = css(hueToColor(app.accentHue, app.accentLight));
      g.save();
      g.translate(50, CHIP_H / 2);
      g.rotate(Math.PI / 4);
      g.fillStyle = mark;
      g.shadowColor = mark;
      g.shadowBlur = 12;
      g.fillRect(-13, -13, 26, 26);
      g.restore();
      g.shadowBlur = 0;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.font = font(700, 38);
      g.letterSpacing = '1.5px';
      g.fillStyle = KIT.textHi;
      g.fillText(stats.name, 92, CHIP_H / 2 - 16, 330);
      g.letterSpacing = '0px';
      g.font = font(500, 22);
      g.fillStyle = KIT.dim;
      g.fillText(`${tier.name} · ${stats.xp} XP`, 92, CHIP_H / 2 + 22, 330);
      // The wallet, right — glints while a bout's coins roll in.
      g.textAlign = 'right';
      g.font = font(700, 40);
      g.fillStyle = rolling ? '#ffd27a' : KIT.accent;
      g.fillText(`$ ${coinDisplayValue()}`, CHIP_W - 84, CHIP_H / 2 - 4);
      g.font = font(600, 22);
      g.fillStyle = KIT.faint;
      g.fillText(open ? '▴' : '▾', CHIP_W - 36, CHIP_H / 2 - 2);
      g.textAlign = 'center';
    },
  };
}

/** The card: your service record + the three buttons. */
export function profileCardFace(): PopFace {
  const row = myProfileRow();
  const buttons: PanelButton[] = [
    { id: 'rename', label: 'RENAME', x: 32, y: 580, w: 224, h: 76, small: true, primary: true },
    { id: 'edit-note', label: 'WRITE NOTE', x: 272, y: 580, w: 240, h: 76, small: true },
    { id: 'profile-close', label: 'CLOSE', x: 528, y: 580, w: 208, h: 76, small: true },
  ];
  for (const s of profileSpots(row, 32, 20, CARD_W - 64)) {
    buttons.push({ id: s.id, label: '', ghost: true, x: s.x, y: s.y, w: s.w, h: s.h });
  }
  return {
    title: '',
    buttons,
    body: (g, hover) => {
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 28;
      g.fillStyle = 'rgba(14,11,8,0.98)';
      g.beginPath();
      g.roundRect(4, 4, CARD_W - 8, CARD_H - 8, 26);
      g.fill();
      g.restore();
      g.lineWidth = 2;
      g.strokeStyle = `rgba(${ACCENT_RGB},0.5)`;
      g.stroke();
      drawProfileBlock(g, row, 32, 20, CARD_W - 64, hover);
      if (profileHintActive()) {
        g.textAlign = 'center';
        g.font = font(600, 20);
        g.fillStyle = KIT.info;
        g.fillText('turn around to the keyboard to write your note', CARD_W / 2, 558);
      }
    },
  };
}
