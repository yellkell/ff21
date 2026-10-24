/**
 * THE BOARD's VERSUS page — back from the Meta Quest build (ff2meta
 * UI/Menu/PlayPage.cs): RAVE RAID's SOLO layout in FIRE FIGHT's colours.
 * A SELECT MODE list on the left, a data plate on the right, one CTA under
 * it. No instructions and no sub-lines — a mode is its name and a one-word
 * status; the plate shows only what's real. Every launch is the lobby's own
 * action id, so nothing behind the menu changes.
 *
 * AIM TRAINING (its SHOOT BACK toggle on the plate) and the TUTORIAL replay
 * are modes here; CUSTOM GAMES and the CO-OP RAID too.
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { myStats } from '../net/leaderboard.js';
import { tierForXp } from './progression.js';
import { FF_LOOK, kicker, line, type BoardLook } from './board.js';

/* THE PAGE GRID — shared by every page in this format (the club's board and
 * the rooms page too): a list on the left, a plate on the right, one CTA
 * under the plate. Page px. */
export const PLAY_W = 1300;
export const PLAY_H = 850;
export const LIST_W = 620;
const ROW_Y0 = 66;
const ROW_H = 48;
const ROW_PITCH = 56;
export const PLATE = { x: 670, y: 66, w: 630, h: 560 };
export const CTA = { x: 670, y: 650, w: 630, h: 120 };

/** A list row: the plate, the selection bar, the name left, a one-word status right. */
export function listRow(
  g: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  label: string,
  status: string,
  on: boolean,
  open: boolean,
  hov: number,
  opts: { statusTone?: string; indent?: number } = {},
): void {
  const indent = opts.indent ?? 0;
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, 10);
  g.fillStyle = on ? KIT.accentFaint : `rgba(90,230,255,${(0.035 + 0.05 * hov).toFixed(3)})`;
  g.fill();
  if (on || hov > 0.02) {
    g.lineWidth = on ? 2 : 1.5;
    g.strokeStyle = on ? KIT.accent : `rgba(140,245,255,${(0.75 * 0.6 * hov).toFixed(3)})`;
    g.stroke();
  }
  if (on) {
    g.beginPath();
    g.roundRect(r.x + 8, r.y + (r.h >= 48 ? 11 : 10), 4, r.h - (r.h >= 48 ? 22 : 20), 2);
    g.fillStyle = KIT.accent;
    g.fill();
  }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(600, r.h >= 48 ? 25 : 23);
  g.letterSpacing = '1px';
  g.fillStyle = on ? KIT.textHi : open ? KIT.text : KIT.faint;
  g.fillText(label, r.x + 26 + indent, r.y + r.h / 2 + 1, r.w - 180 - indent);
  if (status) {
    g.textAlign = 'right';
    g.font = font(600, 17);
    g.letterSpacing = '1.5px';
    g.fillStyle = opts.statusTone ?? (open ? KIT.positive : KIT.disabled);
    g.fillText(status, r.x + r.w - 20, r.y + r.h / 2 + 1);
  }
  g.letterSpacing = '0px';
}

/** The plate: a recessed well, a title, a rule, label · value rows. */
export function dataPlate(
  g: CanvasRenderingContext2D,
  title: string,
  data: Array<{ label: string; value: string; tone?: string }>,
  opts: { titleTone?: string; look?: BoardLook } = {},
): void {
  const look = opts.look ?? FF_LOOK;
  g.beginPath();
  g.roundRect(PLATE.x, PLATE.y, PLATE.w, PLATE.h, 18);
  g.fillStyle = look === FF_LOOK ? 'rgba(0,8,20,0.38)' : look.well;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = line(look, 0.3);
  g.stroke();
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 34);
  g.letterSpacing = '2px';
  g.fillStyle = opts.titleTone ?? KIT.textHi;
  g.fillText(title, PLATE.x + 30, PLATE.y + 52, PLATE.w - 60);
  g.fillStyle = line(look, 0.3);
  g.fillRect(PLATE.x + 30, PLATE.y + 92, PLATE.w - 60, 2);
  data.forEach((d, i) => {
    const y = PLATE.y + 140 + i * 56;
    g.textAlign = 'left';
    g.font = font(600, 18);
    g.letterSpacing = '1.5px';
    g.fillStyle = KIT.faint;
    g.fillText(d.label, PLATE.x + 30, y);
    g.textAlign = 'right';
    g.font = font(700, 28);
    g.letterSpacing = '1px';
    g.fillStyle = d.tone ?? KIT.textHi;
    g.fillText(d.value, PLATE.x + PLATE.w - 30, y, PLATE.w - 240);
  });
  g.letterSpacing = '0px';
}

interface ModeRow {
  key: string;
  label: string;
  status: string;
  action: string | null;
  cta: string;
  open: boolean;
}

/** The selected mode (its key). */
let mode = '';

const sealed = (): boolean => !app.tutorialDone;

function modes(): ModeRow[] {
  if (sealed()) {
    const rows: ModeRow[] = [{ key: 'tutorial', label: 'TUTORIAL', status: 'START HERE', action: 'start-tutorial', cta: 'START', open: true }];
    for (const [key, label] of [
      ['quick', 'QUICK MATCH'],
      ['ranked', 'RANKED'],
      ['custom', 'CUSTOM GAMES'],
      ['2v2', '2V2'],
      ['ffa', 'FREE FOR ALL'],
      ['aim', 'AIM TRAINING'],
    ]) {
      rows.push({ key, label, status: 'SEALED', action: null, cta: 'START', open: false });
    }
    return rows;
  }
  const q = app.state === 'queueing';
  const local = app.onlyBots ? 'LOCAL ONLY' : '';
  return [
    q
      ? { key: 'quick', label: 'QUICK MATCH', status: 'SEARCHING', action: 'cancel-queue', cta: 'CANCEL SEARCH', open: true }
      : { key: 'quick', label: 'QUICK MATCH', status: '', action: 'quick-match', cta: 'FIGHT', open: true },
    { key: 'ranked', label: 'RANKED', status: local, action: 'ranked-match', cta: 'FIND MATCH', open: !q && !app.onlyBots },
    { key: 'custom', label: 'CUSTOM GAMES', status: '', action: 'private-open', cta: 'OPEN', open: !q },
    { key: '2v2', label: '2V2', status: '', action: 'arcade-2v2', cta: 'FIGHT', open: !q },
    { key: 'ffa', label: 'FREE FOR ALL', status: '', action: 'arcade-ffa', cta: 'FIGHT', open: !q },
    { key: 'raid', label: 'CO-OP RAID', status: local, action: 'open-raid', cta: 'FORM A SQUAD', open: !q && !app.onlyBots },
    { key: 'aim', label: 'AIM TRAINING', status: '', action: 'start-training', cta: 'START', open: !q },
    { key: 'tutorial', label: 'TUTORIAL', status: '', action: 'start-tutorial', cta: 'START', open: !q },
  ];
}

function selected(rows: ModeRow[]): ModeRow {
  let sel = rows.find((r) => r.key === mode);
  if (!sel || (!sel.open && rows.some((r) => r.open))) {
    // Land on the first open mode (the tutorial while sealed; the search while queueing).
    sel = (app.state === 'queueing' ? rows.find((r) => r.key === 'quick') : undefined) ?? rows.find((r) => r.open) ?? rows[0];
    mode = sel.key;
  }
  return sel;
}

/** The action the CTA fires for the selected mode (null = none). */
export function playAction(): string | null {
  const sel = selected(modes());
  return sel.open ? sel.action : null;
}

/** Select a mode by key (the `mode:<key>` rows, and probes). */
export function selectMode(key: string): void {
  mode = key;
}

/** The plate's numbers: only what's real. The opponent is never "BOT". */
function dataFor(key: string): Array<{ label: string; value: string }> {
  switch (key) {
    case 'quick':
      return app.searching > 0 ? [{ label: 'OPPONENT', value: 'RIVAL' }, { label: 'IN THE QUEUE', value: String(app.searching) }] : [{ label: 'OPPONENT', value: 'RIVAL' }];
    case 'ranked': {
      const xp = myStats().xp;
      return [
        { label: 'TIER', value: tierForXp(xp).name },
        { label: 'XP', value: xp.toLocaleString('en-US') },
      ];
    }
    case '2v2':
      return [{ label: 'TEAMS', value: '2 V 2' }];
    case 'ffa':
      return [{ label: 'FIGHTERS', value: '4' }];
    case 'raid':
      return app.raidsOpen > 0 ? [{ label: 'SQUADS FORMING', value: String(app.raidsOpen) }] : [];
    default:
      return [];
  }
}

export function playPageFace(hoverOf: (id: string) => number): {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
} {
  const rows = modes();
  const sel = selected(rows);
  const buttons: PanelButton[] = rows.map((r, i) => ({
    id: `mode:${r.key}`,
    label: r.label,
    ghost: true,
    x: 0,
    y: ROW_Y0 + i * ROW_PITCH,
    w: LIST_W,
    h: ROW_H,
    disabled: !r.open && r.key !== sel.key,
  }));
  // AIM TRAINING's one option, on its plate (it was PRACTICE's toggle).
  if (sel.key === 'aim' && sel.open) {
    buttons.push({ id: 'toggle-shootback', label: 'SHOOT BACK', x: PLATE.x + 30, y: PLATE.y + 130, w: PLATE.w - 60, h: 84, small: true, selected: app.shootBack, toggle: true });
  }
  const cancel = sel.action === 'cancel-queue';
  buttons.push({
    id: 'play-go',
    label: sel.cta,
    ...CTA,
    primary: sel.open && !cancel,
    tone: cancel ? KIT.danger : undefined,
    disabled: !sel.open,
    px: 40,
  });

  return {
    title: '',
    buttons,
    body: (g) => {
      kicker(g, 'SELECT MODE', 2, 22);
      rows.forEach((r, i) => {
        listRow(g, { x: 0, y: ROW_Y0 + i * ROW_PITCH, w: LIST_W, h: ROW_H }, r.label, r.status, r.key === sel.key, r.open, hoverOf(`mode:${r.key}`));
      });
      // The plate: a recessed well with the mode's name and only real data.
      dataPlate(g, sel.label, dataFor(sel.key));
      // The TUTORIAL's plate calls out like Navi, in fairy blue.
      if (sel.key === 'tutorial') {
        g.textAlign = 'left';
        g.font = font(700, 28);
        g.letterSpacing = '1px';
        g.fillStyle = 'rgb(150,220,255)';
        g.fillText('Hey! Listen!', PLATE.x + 30, PLATE.y + 140, PLATE.w - 60);
      }
      g.letterSpacing = '0px';
    },
  };
}
